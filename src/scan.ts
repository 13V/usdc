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
If the image is not a readable receipt, set total to 0 and confidence to "low".`;

interface RawScan {
  total: number;
  subtotal?: number;
  tax?: number;
  tip?: number;
  merchant?: string;
  currency?: string;
  confidence?: string;
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
  return {
    totalCents: toCentsSafe(raw.total),
    subtotalCents: toCentsSafe(raw.subtotal),
    taxCents: toCentsSafe(raw.tax),
    tipCents: toCentsSafe(raw.tip),
    currency: (raw.currency || "USD").toUpperCase(),
    merchant: raw.merchant || undefined,
    confidence: conf,
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
