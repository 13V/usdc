/**
 * bill.ts — Bill + BillParticipant model.
 *
 * createBill() computes the split, generates a unique reference per person, and
 * builds each person's Solana Pay URL. Bills can be persisted to disk as JSON.
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  computeSplit,
  SplitMode,
  SplitShare,
  fmt,
} from "./split";
import {
  buildSolanaPayUrl,
  newReference,
  USDC_MINT,
  Cluster,
} from "./solanaPay";

export interface BillParticipant {
  name: string;
  /** Amount owed, integer cents. */
  amountCents: number;
  /** Unique reference pubkey used to detect this person's payment. */
  reference: string;
  /** Solana Pay URL for this person. */
  url: string;
  /** Whether we've seen a confirmed payment for this reference. */
  paid: boolean;
  /** Confirmed signature, once paid. */
  signature?: string;
  /** Divvy user this share belongs to (when split with a friend) — lets the
   *  tab auto-appear on that person's home. */
  userId?: string;
  /** That person's wallet (fallback identity if userId isn't known yet). */
  wallet?: string;
}

/**
 * FX provenance recorded on a bill when its total came from a foreign-currency
 * receipt. The total is always stored in USD cents; this is the locked record
 * of how we got there, for transparency/fairness.
 */
export interface BillFx {
  /** ISO code of the original currency, e.g. "THB". */
  sourceCurrency: string;
  /** Original major amount in that currency, e.g. 2450.00. */
  sourceAmount: number;
  /** USD per 1 unit of the source currency, locked at capture. */
  rate: number;
  /** When the rate was as-of. */
  asOf: string;
  /** Rate source, e.g. "open.er-api.com" or "fallback". */
  source: string;
}

export interface Bill {
  id: string;
  title: string;
  createdAt: string;
  cluster: Cluster;
  /** The signed-in user who created this bill (owns it on their home tabs). */
  creatorUserId?: string;
  /** Collector wallet (base58). */
  collector: string;
  /** USDC mint used. */
  splToken: string;
  /** Total to collect, integer cents. */
  totalCents: number;
  mode: SplitMode;
  participants: BillParticipant[];
  /** Set when the total was converted from a foreign currency. */
  fx?: BillFx;
}

export interface CreateBillInput {
  title: string;
  cluster: Cluster;
  collector: string;
  creatorUserId?: string;
  totalCents: number;
  names: string[];
  /** Optional per-participant identity, aligned with `names` by index, so a
   *  share split with a Divvy friend can be delivered to their account. */
  participantMeta?: ({ userId?: string; wallet?: string } | null)[];
  mode: SplitMode;
  weights?: number[];
  customCents?: number[];
  fx?: BillFx;
}

export function createBill(input: CreateBillInput): Bill {
  const splToken = USDC_MINT[input.cluster];
  if (!splToken) throw new Error(`createBill: no USDC mint for cluster ${input.cluster}`);

  const shares: SplitShare[] = computeSplit({
    totalCents: input.totalCents,
    names: input.names,
    mode: input.mode,
    weights: input.weights,
    customCents: input.customCents,
  });

  const participants: BillParticipant[] = shares.map((share, i) => {
    const reference = newReference();
    const url = buildSolanaPayUrl({
      recipient: input.collector,
      amountCents: share.cents,
      splToken,
      reference,
      label: input.title,
      message: `${share.name}'s share — ${fmt(share.cents)}`,
    });
    const meta = input.participantMeta && input.participantMeta[i];
    return {
      name: share.name,
      amountCents: share.cents,
      reference,
      url,
      paid: false,
      ...(meta && meta.userId ? { userId: meta.userId } : {}),
      ...(meta && meta.wallet ? { wallet: meta.wallet } : {}),
    };
  });

  return {
    id: randomUUID(),
    title: input.title,
    createdAt: new Date().toISOString(),
    cluster: input.cluster,
    ...(input.creatorUserId ? { creatorUserId: input.creatorUserId } : {}),
    collector: input.collector,
    splToken,
    totalCents: input.totalCents,
    mode: input.mode,
    participants,
    ...(input.fx ? { fx: input.fx } : {}),
  };
}

/** Sum of everything collected so far (paid shares), in cents. */
export function collectedCents(bill: Bill): number {
  return bill.participants.filter((p) => p.paid).reduce((a, p) => a + p.amountCents, 0);
}

/** Sum of everything still outstanding, in cents. */
export function outstandingCents(bill: Bill): number {
  return bill.totalCents - collectedCents(bill);
}

// ---- File persistence (simple JSON, one file per bill) --------------------

const BILLS_DIR = path.resolve(process.cwd(), "bills");

export function billPath(id: string): string {
  return path.join(BILLS_DIR, `${id}.json`);
}

export function saveBill(bill: Bill): string {
  fs.mkdirSync(BILLS_DIR, { recursive: true });
  const p = billPath(bill.id);
  fs.writeFileSync(p, JSON.stringify(bill, null, 2));
  return p;
}

export function loadBill(id: string): Bill {
  const p = billPath(id);
  if (!fs.existsSync(p)) throw new Error(`loadBill: no bill at ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8")) as Bill;
}

export function listBills(): Bill[] {
  if (!fs.existsSync(BILLS_DIR)) return [];
  return fs
    .readdirSync(BILLS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(BILLS_DIR, f), "utf8")) as Bill)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
