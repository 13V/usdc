/**
 * scan.ts — Read a receipt photo and pull out the total (fast path for the
 * "scan the receipt, pick the people, send links" flow).
 *
 * Uses Claude vision (Anthropic API) when ANTHROPIC_API_KEY is set. Receipt OCR
 * is exactly an image-understanding task, so this is the effective path. With no
 * key, scanReceipt throws NoScanProvider and the caller falls back to manual
 * entry — the rest of the flow works regardless.
 *
 * GUARDRAIL: money stays integer cents. The model returns decimal dollars; we
 * convert once with toCents() and never touch floats again.
 */

import Anthropic from "@anthropic-ai/sdk";
import { toCents } from "./split";

export class NoScanProvider extends Error {
  constructor() {
    super("No receipt-scan provider configured (set ANTHROPIC_API_KEY).");
    this.name = "NoScanProvider";
  }
}

/** One line item read off the receipt. Money is integer cents (line total for
 *  the whole `qty`, after toCents conversion). Items are best-effort. */
export interface ScannedItem {
  label: string;
  /** Units on this line (>=1). The `cents` is the total for all of them. */
  qty: number;
  /** Line total in integer cents (qty × unit price). */
  cents: number;
}

export interface ScannedReceipt {
  /** Grand total actually due, integer cents. */
  totalCents: number;
  subtotalCents?: number;
  taxCents?: number;
  tipCents?: number;
  currency: string;
  merchant?: string;
  /** Model's own confidence: low | medium | high. */
  confidence: "low" | "medium" | "high";
  /** Line items, when the receipt was legible enough to read them. Optional —
   *  the model omits these on blurry receipts, and the whole itemized flow is a
   *  progressive enhancement on top of the total. */
  items?: ScannedItem[];
  /** "ok" when the items roughly reconcile against the subtotal, "low" when the
   *  sum is wildly off (still returned, but the UI should treat it as a hint). */
  itemsConfidence?: "ok" | "low";
}

const MODEL = "claude-opus-4-8";

const SYSTEM = `You read photos of restaurant and store receipts and extract the amounts.
Return ONLY a single JSON object, no prose, no markdown fences, with these keys:
  "total"      number  — the GRAND TOTAL actually due (after tax; include tip only if it is printed on the receipt), in the receipt's currency, as a decimal like 87.40
  "subtotal"   number  — the pre-tax subtotal, or 0 if not shown
  "tax"        number  — tax/VAT/GST amount, or 0 if not shown
  "tip"        number  — tip/gratuity printed on the receipt, or 0 if none
  "merchant"   string  — the venue name, or "" if unclear
  "currency"   string  — ISO code like "USD","AUD","EUR", best guess from symbols/context
  "confidence" string  — "high","medium", or "low" for how sure you are of the total
  "items"      array   — the individual line items, so people can split "who had what".
                         Each element is an object:
                           "label" string — the dish/product name as printed, e.g. "cheeseburger"
                           "qty"   number — how many of this line (default 1)
                           "price" number — the LINE TOTAL for that row (qty × unit price), a decimal like 24.00
                         Include every food/drink/product line. DO NOT include tax, tip,
                         subtotal, total, or discount lines as items. If you cannot read the
                         items clearly, return an empty array [] — never guess.
If the image is not a readable receipt, set total to 0, confidence to "low", and items to [].`;

interface RawItem {
  label?: string;
  qty?: number;
  price?: number;
}

interface RawScan {
  total: number;
  subtotal?: number;
  tax?: number;
  tip?: number;
  merchant?: string;
  currency?: string;
  confidence?: string;
  items?: RawItem[];
}

/** Pull the first JSON object out of a model text reply (tolerates stray text). */
function extractJson(text: string): RawScan {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("scan: model did not return JSON");
  }
  return JSON.parse(text.slice(start, end + 1)) as RawScan;
}

function toCentsSafe(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return toCents(v);
}

/** Hard caps so a hostile/hallucinated payload can't produce junk items. */
const MAX_ITEMS = 40;
const MAX_ITEM_CENTS = 1_000_000_00; // $1,000,000 per line — absurd, drop above
const MAX_ITEM_LABEL = 80;

/**
 * Clean the raw items array: convert prices to integer cents, drop empties /
 * non-positive / absurd lines, clamp qty and label length, and cap the count.
 * Returns undefined when nothing survives (so callers can omit the field).
 */
function cleanItems(raw: RawItem[] | undefined): ScannedItem[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ScannedItem[] = [];
  for (const it of raw) {
    if (out.length >= MAX_ITEMS) break;
    const cents = toCentsSafe(it && it.price);
    if (cents <= 0 || cents > MAX_ITEM_CENTS) continue; // junk / absurd → drop
    let qty = Number(it && it.qty);
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    qty = Math.min(Math.floor(qty), 99);
    let label = String((it && it.label) || "item").trim();
    if (!label) label = "item";
    if (label.length > MAX_ITEM_LABEL) label = label.slice(0, MAX_ITEM_LABEL);
    out.push({ label, qty, cents });
  }
  return out.length ? out : undefined;
}

/**
 * Sanity-check the items against the subtotal. If they're wildly off, we still
 * return them (they're useful) but flag low confidence so the UI can hint. When
 * we have no subtotal to compare against, assume "ok".
 */
function reconcileItems(items: ScannedItem[], subtotalCents: number): "ok" | "low" {
  if (!subtotalCents || subtotalCents <= 0) return "ok";
  const sum = items.reduce((a, it) => a + it.cents, 0);
  const drift = Math.abs(sum - subtotalCents);
  // Tolerate the larger of 15% of subtotal or $5 (rounding, unread lines, etc.).
  const tolerance = Math.max(Math.round(subtotalCents * 0.15), 500);
  return drift > tolerance ? "low" : "ok";
}

/**
 * Scan a receipt image (raw base64, no data: prefix) and return the amounts.
 * Throws NoScanProvider if no API key is configured.
 */
export async function scanReceipt(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"
): Promise<ScannedReceipt> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new NoScanProvider();

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "Extract the amounts from this receipt as JSON." },
        ],
      },
    ],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const raw = extractJson(text);

  const conf = raw.confidence === "high" || raw.confidence === "medium" ? raw.confidence : "low";
  const subtotalCents = toCentsSafe(raw.subtotal);
  const items = cleanItems(raw.items);
  return {
    totalCents: toCentsSafe(raw.total),
    subtotalCents,
    taxCents: toCentsSafe(raw.tax),
    tipCents: toCentsSafe(raw.tip),
    currency: (raw.currency || "USD").toUpperCase(),
    merchant: raw.merchant || undefined,
    confidence: conf,
    ...(items ? { items, itemsConfidence: reconcileItems(items, subtotalCents) } : {}),
  };
}

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** Strip a `data:image/...;base64,` prefix if present; return {data, mediaType}. */
export function parseDataUrl(input: string): { data: string; mediaType: ImageMediaType } {
  const m = /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,(.*)$/s.exec(input);
  if (m) {
    const mediaType: ImageMediaType = m[1] === "image/jpg" ? "image/jpeg" : (m[1] as ImageMediaType);
    return { data: m[2], mediaType };
  }
  // Assume raw base64 JPEG if no prefix.
  return { data: input, mediaType: "image/jpeg" };
}
