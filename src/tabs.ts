/**
 * tabs.ts — Running one-on-one tabs with friends.
 *
 * A TAB is the pair (you, friend): a running ledger of tiny entries
 * ("+$7 coffee") with a NET balance, settled in one USDC payment. It exists
 * because most IOUs between friends are small and recurring — a tab captures
 * them in two taps, no group/trip needed.
 *
 * Why not a pure aggregation over ious.ts: an IOU row is single-owner with a
 * FREE-TEXT counterparty (name + optional wallet, no user id), so the other
 * person never sees it, and each IOU settles individually. A tab is shared
 * BOTH ways — either friend sees the same ledger from their own perspective —
 * and settling pays the NET across many entries in one payment. The
 * settle/verify machinery reuses the exact ious.ts/trips code path:
 * Solana Pay URL + throwaway reference, validatePayment, claimSignature.
 *
 * PARTIAL PAYMENTS: settle may carry `partialCents` (payer-only, clamped to
 * (0, net]) — the Solana Pay request is built at that amount (settlement
 * status "open_partial"). A VERIFIED partial doesn't flip entries; it inserts
 * a system "payment" ledger row that arithmetically reduces the net (pay $20
 * of a $47 tab → tab shows $27, history shows the payment). A later full
 * settle covers exactly the remainder and flips everything, payment rows
 * included ("payment" → "payment_paid").
 *
 * SETTLED OUTSIDE (settleOutside.ts): the debtor can claim they paid the
 * creditor off-app (cash / venmo / zelle). The claim is PENDING and touches
 * nothing; only the creditor's CONFIRM inserts a "cash_payment" ledger row
 * (same arithmetic as "payment", but no chain signature exists — so this path
 * deliberately never touches claimSignature/verify). A confirmed full-net
 * claim also flips the covered entries, exactly like an on-chain full settle.
 *
 * GUARDRAIL: ALL money is integer cents.
 *
 * Mount (integrator):
 *   import { tabsRouter } from "./tabs";
 *   app.use(tabsRouter);
 */

import * as crypto from "crypto";
import { Router, Request, Response } from "express";
import { Connection, clusterApiUrl } from "@solana/web3.js";

import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { requireAuth } from "./auth";
import { getUser, getPrimaryWallet, serializeUser } from "./users";
import {
  buildSolanaPayUrl,
  newReference,
  USDC_MINT,
  Cluster,
} from "./solanaPay";
import { validatePayment } from "./verify";
import { claimSignature } from "./consumedSignatures";
import { alert } from "./alerts";
import { fmt, toCents } from "./split";
import { moneyRateLimit, writeRateLimit } from "./ratelimit";
import { sendPush } from "./push";
import {
  isOutsideMethod,
  methodPhrase,
  resolveOutsideAmount,
  decideClaimAction,
  newOutsideClaim,
  insertOutsideClaim,
  getOutsideClaim,
  transitionOutsideClaim,
  getPendingTabClaim,
  serializeOutsideClaim,
  ClaimVerb,
  OutsideMethod,
} from "./settleOutside";

// ---- Config ----------------------------------------------------------------

const cluster = (process.env.CLUSTER || "devnet") as Cluster;
const rpcUrl = process.env.RPC_URL || clusterApiUrl(cluster);

// ---- Schema (idempotent) ---------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS tab_entries (
    id TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    friend_user_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    note TEXT,
    status TEXT NOT NULL,
    settlement_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tab_settlements (
    id TEXT PRIMARY KEY,
    payer_user_id TEXT NOT NULL,
    payee_user_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    reference TEXT,
    pay_wallet TEXT,
    status TEXT NOT NULL,
    signature TEXT,
    created_at TEXT NOT NULL
  );
`);

// ---- Types -----------------------------------------------------------------

type Direction = "they_owe" | "i_owe";

export interface TabEntryRow {
  id: string;
  created_by: string;
  friend_user_id: string;
  direction: string;
  amount_cents: number;
  note: string | null;
  // 'open' | 'paid' | 'payment' (verified partial-settle offset, live) |
  // 'payment_paid' (offset covered by a later settle) | 'cash_payment'
  // (creditor-CONFIRMED off-app payment, live) | 'cash_payment_paid'
  status: string;
  settlement_id: string | null;
  created_at: string;
}

interface TabSettlementRow {
  id: string;
  payer_user_id: string;
  payee_user_id: string;
  amount_cents: number;
  reference: string | null;
  pay_wallet: string | null;
  // 'open' | 'open_partial' (pays less than the net) | 'paid' | 'cancelled'
  status: string;
  signature: string | null;
  created_at: string;
}

// ---- Pure balance math (exported for tabs.selftest.ts) ----------------------

/** The fields the balance math needs — decoupled from the full row. */
export interface TabEntryLike {
  created_by: string;
  direction: string; // 'they_owe' | 'i_owe', relative to created_by
  amount_cents: number;
  status: string; // 'open' | 'paid' | 'payment' | 'payment_paid'
}

/**
 * Signed cents of one entry from `meId`'s perspective. + = the other person
 * owes me, − = I owe them. An entry's stored direction is relative to its
 * CREATOR, so the sign flips when the viewer isn't the creator.
 */
export function signedCents(e: TabEntryLike, meId: string): number {
  const sign =
    e.created_by === meId
      ? e.direction === "they_owe"
        ? 1
        : -1
      : e.direction === "they_owe"
        ? -1
        : 1;
  return sign * e.amount_cents;
}

/**
 * Net OPEN balance of a tab from `meId`'s perspective (integer cents).
 * + = the friend owes me, − = I owe the friend. Paid entries don't count.
 * "payment" rows (a verified partial settlement's offset) DO count — that's
 * how a $20 partial arithmetically shrinks a $47 tab to $27. "cash_payment"
 * rows (creditor-confirmed off-app payments) count identically.
 */
export function computeTabBalance(entries: TabEntryLike[], meId: string): number {
  let net = 0;
  for (const e of entries) {
    if (e.status === "open" || e.status === "payment" || e.status === "cash_payment") {
      net += signedCents(e, meId);
    }
  }
  return net;
}

/**
 * Who pays whom to settle a balance (balance is from `meId`'s perspective).
 * Returns null when there's nothing to settle.
 */
export function settlementParties(
  balanceCents: number,
  meId: string,
  friendId: string
): { payer: string; payee: string } | null {
  if (balanceCents === 0) return null;
  return balanceCents > 0
    ? { payer: friendId, payee: meId }
    : { payer: meId, payee: friendId };
}

// ---- Pure settle-request math (exported for tabs.selftest.ts) ----------------

/** What a settle request resolves to: who pays whom, how much, partial or not. */
export interface SettleTarget {
  payer: string;
  payee: string;
  amountCents: number;
  /** true = pays less than the net; the remainder stays on the tab. */
  partial: boolean;
}
export interface SettleReject {
  status: number;
  error: string;
}

/**
 * Resolve a settle request against the CURRENT net. Optional `partialCents`
 * asks to pay only part of it: integer cents in (0, net], and payer-only —
 * you can part-pay what YOU owe, not shrink what a friend owes you. Paying
 * exactly the net is just a full settle (entries get flipped, not offset).
 */
export function resolveSettleRequest(
  balanceCents: number,
  meId: string,
  friendId: string,
  partialCents?: unknown
): SettleTarget | SettleReject {
  const parties = settlementParties(balanceCents, meId, friendId);
  if (!parties) return { status: 400, error: "you're square — nothing to settle" };
  const net = Math.abs(balanceCents);
  if (partialCents == null) return { ...parties, amountCents: net, partial: false };
  const amt = Number(partialCents);
  if (!Number.isInteger(amt) || amt < 1 || amt > net) {
    return {
      status: 400,
      error: "partial amount must be between 1 cent and what's owed",
    };
  }
  if (parties.payer !== meId) {
    return { status: 403, error: "you can only part-pay a tab you owe" };
  }
  return { ...parties, amountCents: amt, partial: amt < net };
}

/**
 * Can an existing open settlement serve `target`? The payer must match. An
 * EXPLICIT amount must match exactly (same cents, same partial-ness) — else
 * the request supersedes it (cancel + rebuild). A bare request reuses an
 * exact full-net match, or keeps a pending PARTIAL alive as long as it still
 * fits inside the net (`target.amountCents` IS the net for a bare request) —
 * so reopening the sheet, or the payee requesting, never clobbers a partial
 * payment already in flight against its reference.
 */
export function canReuseSettlement(
  existing: { amount_cents: number; payer_user_id: string; status: string },
  target: SettleTarget,
  explicitAmount: boolean
): boolean {
  if (existing.payer_user_id !== target.payer) return false;
  const existingPartial = existing.status === "open_partial";
  if (explicitAmount) {
    return existing.amount_cents === target.amountCents && existingPartial === target.partial;
  }
  if (!existingPartial) return existing.amount_cents === target.amountCents;
  return existing.amount_cents <= target.amountCents;
}

/**
 * The system-generated ledger row a VERIFIED partial payment leaves behind:
 * money moved payer→payee on-chain, so from the payer's side "they owe me"
 * that much back — the net arithmetically drops by the paid amount while the
 * original entries stay open. Status "payment": counts toward the balance,
 * can't be deleted (not "open"), and a later covering settle flips it to
 * "payment_paid" together with the entries it helped pay down.
 */
export function paymentEntry(
  payerId: string,
  payeeId: string,
  amountCents: number,
  settlementId: string,
  nowIso: string
): TabEntryRow {
  return {
    id: crypto.randomUUID(),
    created_by: payerId,
    friend_user_id: payeeId,
    direction: "they_owe",
    amount_cents: amountCents,
    note: `settled ${fmt(amountCents)} 💸`,
    status: "payment",
    settlement_id: settlementId,
    created_at: nowIso,
  };
}

/**
 * The ledger row a creditor-CONFIRMED off-app payment leaves behind: exactly
 * paymentEntry's arithmetic (payer-created "they_owe" offset), but with its
 * own "cash_payment" status — no chain signature exists, so the row must
 * never look like a verified on-chain payment. settlement_id carries the
 * outside CLAIM id so history points back at the confirmation.
 */
export function cashPaymentEntry(
  payerId: string,
  payeeId: string,
  amountCents: number,
  claimId: string,
  method: string,
  nowIso: string
): TabEntryRow {
  return {
    ...paymentEntry(payerId, payeeId, amountCents, claimId, nowIso),
    status: "cash_payment",
    note: `settled ${fmt(amountCents)} ${methodPhrase(method)}`,
  };
}

// ---- Input validation --------------------------------------------------------

const MAX_NOTE = 140;
const MAX_AMOUNT_CENTS = 100000000; // mirror ious.ts

/**
 * User ids are crypto.randomUUID()s. Enforce that shape defensively so ids are
 * safe to embed in Supabase .or() filter strings (no commas/parens).
 */
function isSafeId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v);
}

// ---- Friendship reads (read-only mirror of friends.ts edges) ----------------
// Duplicated queries, same pattern as nudges.ts: derive the relationship gate
// WITHOUT importing/modifying friends.ts internals.

async function isMutualFriend(meId: string, otherId: string): Promise<boolean> {
  if (usingSupabase) {
    const { data: a, error: e1 } = await supabase()
      .from("friendships")
      .select("friend_user_id")
      .eq("user_id", meId)
      .eq("friend_user_id", otherId)
      .maybeSingle();
    if (e1) throw new Error(`tabs.isMutualFriend: ${e1.message}`);
    if (!a) return false;
    const { data: b, error: e2 } = await supabase()
      .from("friendships")
      .select("friend_user_id")
      .eq("user_id", otherId)
      .eq("friend_user_id", meId)
      .maybeSingle();
    if (e2) throw new Error(`tabs.isMutualFriend: ${e2.message}`);
    return !!b;
  }
  const a = db
    .prepare("SELECT 1 FROM friendships WHERE user_id = ? AND friend_user_id = ?")
    .get(meId, otherId);
  const b = db
    .prepare("SELECT 1 FROM friendships WHERE user_id = ? AND friend_user_id = ?")
    .get(otherId, meId);
  return a !== undefined && b !== undefined;
}

// ---- Persistence -------------------------------------------------------------

async function insertEntry(row: TabEntryRow): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase().from("tab_entries").insert({
      id: row.id,
      created_by: row.created_by,
      friend_user_id: row.friend_user_id,
      direction: row.direction,
      amount_cents: row.amount_cents,
      note: row.note,
      status: row.status,
      settlement_id: row.settlement_id,
      created_at: row.created_at,
    });
    if (error) throw new Error(`tabs.insertEntry: ${error.message}`);
    return;
  }
  db.prepare(
    `INSERT INTO tab_entries
       (id, created_by, friend_user_id, direction, amount_cents, note, status,
        settlement_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.created_by,
    row.friend_user_id,
    row.direction,
    row.amount_cents,
    row.note,
    row.status,
    row.settlement_id,
    row.created_at
  );
}

/** ALL entries involving `meId` (either side), newest first. */
async function listMyEntries(meId: string): Promise<TabEntryRow[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("tab_entries")
      .select("*")
      .or(`created_by.eq.${meId},friend_user_id.eq.${meId}`)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`tabs.listMyEntries: ${error.message}`);
    return (data as TabEntryRow[]) ?? [];
  }
  return db
    .prepare(
      `SELECT * FROM tab_entries WHERE created_by = ? OR friend_user_id = ?
       ORDER BY created_at DESC, rowid DESC`
    )
    .all(meId, meId) as TabEntryRow[];
}

/** Entries between exactly this pair (either direction), newest first. */
async function listPairEntries(meId: string, friendId: string): Promise<TabEntryRow[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("tab_entries")
      .select("*")
      .or(
        `and(created_by.eq.${meId},friend_user_id.eq.${friendId}),and(created_by.eq.${friendId},friend_user_id.eq.${meId})`
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(`tabs.listPairEntries: ${error.message}`);
    return (data as TabEntryRow[]) ?? [];
  }
  return db
    .prepare(
      `SELECT * FROM tab_entries
       WHERE (created_by = ? AND friend_user_id = ?)
          OR (created_by = ? AND friend_user_id = ?)
       ORDER BY created_at DESC, rowid DESC`
    )
    .all(meId, friendId, friendId, meId) as TabEntryRow[];
}

/** Delete one of MY open entries; returns true if a row was removed. */
async function deleteOwnOpenEntry(id: string, meId: string): Promise<boolean> {
  if (usingSupabase) {
    const { count, error } = await supabase()
      .from("tab_entries")
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("created_by", meId)
      .eq("status", "open");
    if (error) throw new Error(`tabs.deleteOwnOpenEntry: ${error.message}`);
    return (count ?? 0) > 0;
  }
  const info = db
    .prepare("DELETE FROM tab_entries WHERE id = ? AND created_by = ? AND status = 'open'")
    .run(id, meId);
  return info.changes > 0;
}

/**
 * Mark the pair's open entries created at/before `cutoffIso` as paid via
 * `settlementId`. The cutoff keeps entries added AFTER the settlement request
 * was built out of it — they stay open on the fresh tab. Partial-payment
 * offset rows ("payment") are part of the arithmetic being covered, so they
 * flip too — to "payment_paid", keeping their OWN settlement_id so history
 * still points at the payment that created them.
 */
async function settlePairEntries(
  meId: string,
  friendId: string,
  cutoffIso: string,
  settlementId: string
): Promise<void> {
  if (usingSupabase) {
    const pair = `and(created_by.eq.${meId},friend_user_id.eq.${friendId}),and(created_by.eq.${friendId},friend_user_id.eq.${meId})`;
    const { error } = await supabase()
      .from("tab_entries")
      .update({ status: "paid", settlement_id: settlementId })
      .eq("status", "open")
      .lte("created_at", cutoffIso)
      .or(pair);
    if (error) throw new Error(`tabs.settlePairEntries: ${error.message}`);
    const { error: e2 } = await supabase()
      .from("tab_entries")
      .update({ status: "payment_paid" })
      .eq("status", "payment")
      .lte("created_at", cutoffIso)
      .or(pair);
    if (e2) throw new Error(`tabs.settlePairEntries: ${e2.message}`);
    const { error: e3 } = await supabase()
      .from("tab_entries")
      .update({ status: "cash_payment_paid" })
      .eq("status", "cash_payment")
      .lte("created_at", cutoffIso)
      .or(pair);
    if (e3) throw new Error(`tabs.settlePairEntries: ${e3.message}`);
    return;
  }
  db.prepare(
    `UPDATE tab_entries
        SET status = CASE WHEN status = 'payment' THEN 'payment_paid'
                          WHEN status = 'cash_payment' THEN 'cash_payment_paid'
                          ELSE 'paid' END,
            settlement_id = COALESCE(settlement_id, ?)
     WHERE status IN ('open', 'payment', 'cash_payment') AND created_at <= ?
       AND ((created_by = ? AND friend_user_id = ?)
         OR (created_by = ? AND friend_user_id = ?))`
  ).run(settlementId, cutoffIso, meId, friendId, friendId, meId);
}

async function insertSettlement(row: TabSettlementRow): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase().from("tab_settlements").insert({
      id: row.id,
      payer_user_id: row.payer_user_id,
      payee_user_id: row.payee_user_id,
      amount_cents: row.amount_cents,
      reference: row.reference,
      pay_wallet: row.pay_wallet,
      status: row.status,
      signature: row.signature,
      created_at: row.created_at,
    });
    if (error) throw new Error(`tabs.insertSettlement: ${error.message}`);
    return;
  }
  db.prepare(
    `INSERT INTO tab_settlements
       (id, payer_user_id, payee_user_id, amount_cents, reference, pay_wallet,
        status, signature, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.payer_user_id,
    row.payee_user_id,
    row.amount_cents,
    row.reference,
    row.pay_wallet,
    row.status,
    row.signature,
    row.created_at
  );
}

/** Latest OPEN settlement (full or partial) between the pair (either direction). */
async function getOpenSettlement(
  meId: string,
  friendId: string
): Promise<TabSettlementRow | undefined> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("tab_settlements")
      .select("*")
      .in("status", ["open", "open_partial"])
      .or(
        `and(payer_user_id.eq.${meId},payee_user_id.eq.${friendId}),and(payer_user_id.eq.${friendId},payee_user_id.eq.${meId})`
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`tabs.getOpenSettlement: ${error.message}`);
    return (data as TabSettlementRow | null) ?? undefined;
  }
  return db
    .prepare(
      `SELECT * FROM tab_settlements
       WHERE status IN ('open', 'open_partial')
         AND ((payer_user_id = ? AND payee_user_id = ?)
           OR (payer_user_id = ? AND payee_user_id = ?))
       ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(meId, friendId, friendId, meId) as TabSettlementRow | undefined;
}

/** Cancel a stale unpaid settlement (superseded by a fresh net). */
async function cancelSettlement(id: string): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase()
      .from("tab_settlements")
      .update({ status: "cancelled" })
      .eq("id", id)
      .in("status", ["open", "open_partial"]);
    if (error) throw new Error(`tabs.cancelSettlement: ${error.message}`);
    return;
  }
  db.prepare(
    "UPDATE tab_settlements SET status = 'cancelled' WHERE id = ? AND status IN ('open', 'open_partial')"
  ).run(id);
}

async function markSettlementPaid(id: string, signature: string | null): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase()
      .from("tab_settlements")
      .update({ status: "paid", signature })
      .eq("id", id);
    if (error) throw new Error(`tabs.markSettlementPaid: ${error.message}`);
    return;
  }
  db.prepare("UPDATE tab_settlements SET status = ?, signature = ? WHERE id = ?").run(
    "paid",
    signature,
    id
  );
}

// ---- Serialization -----------------------------------------------------------

/** One ledger entry, normalized to the VIEWER's perspective. */
function serializeEntry(row: TabEntryRow, meId: string) {
  const signed = signedCents(row, meId);
  const isCash = row.status === "cash_payment" || row.status === "cash_payment_paid";
  return {
    id: row.id,
    // direction from the viewer's side: they_owe = the friend owes me.
    direction: signed >= 0 ? "they_owe" : "i_owe",
    addedByMe: row.created_by === meId,
    amountCents: row.amount_cents,
    amountFmt: fmt(row.amount_cents),
    signedCents: signed,
    note: row.note,
    // clients see the simple open/paid lifecycle; `payment` marks the row as
    // a settlement payment ("settled $20 💸"), `cash` as one confirmed off-app
    // ("settled $20 in cash 💵 · confirmed"). Raw statuses never leave here.
    status:
      row.status === "payment" || row.status === "cash_payment"
        ? "open"
        : row.status === "payment_paid" || row.status === "cash_payment_paid"
          ? "paid"
          : row.status,
    payment: row.status === "payment" || row.status === "payment_paid" || isCash,
    cash: isCash,
    createdAt: row.created_at,
  };
}

/** Rebuild the Solana Pay url from the stored reference + pay_wallet. */
function settlementUrl(row: TabSettlementRow): string | null {
  if (!row.reference || !row.pay_wallet) return null;
  return buildSolanaPayUrl({
    recipient: row.pay_wallet,
    amountCents: row.amount_cents,
    splToken: USDC_MINT[cluster],
    reference: row.reference,
    label: "Divvy tab",
    message: "settle up",
  });
}

function serializeSettlement(row: TabSettlementRow, meId: string) {
  return {
    id: row.id,
    payerUserId: row.payer_user_id,
    payeeUserId: row.payee_user_id,
    iAmPayer: row.payer_user_id === meId,
    amountCents: row.amount_cents,
    amountFmt: fmt(row.amount_cents),
    url: settlementUrl(row),
    reference: row.reference,
    // clients see the simple lifecycle; `partial` marks a part-payment request
    status: row.status === "open_partial" ? "open" : row.status,
    partial: row.status === "open_partial",
    signature: row.signature,
    createdAt: row.created_at,
  };
}

function balanceDirection(cents: number): "owed" | "owes" | "settled" {
  return cents > 0 ? "owed" : cents < 0 ? "owes" : "settled";
}

// ---- Push nudges (reuse push.ts — best-effort, never blocks the write) -------

async function callerLabel(userId: string): Promise<string> {
  try {
    const u = await getUser(userId);
    if (u) {
      const su = await serializeUser(u);
      return su.displayName || su.handle || "Someone";
    }
  } catch {
    /* generic label */
  }
  return "Someone";
}

// ---- Router ------------------------------------------------------------------

export const tabsRouter = Router();

// NOTE: requireAuth is applied PER ROUTE (this router mounts at "/", so a
// router-level use(requireAuth) would gate the whole app — see ious.ts).

/**
 * GET /api/tabs — my tabs: one row per friend with entries, with the net
 * balance from my perspective (+ = they owe me), newest activity first.
 */
tabsRouter.get("/api/tabs", requireAuth, async (req: Request, res: Response) => {
  const meId = req.userId as string;
  const entries = await listMyEntries(meId);

  // Group by counterparty. Entries arrive newest-first, so the first entry we
  // see per friend is the latest activity.
  const byFriend = new Map<string, TabEntryRow[]>();
  for (const e of entries) {
    const otherId = e.created_by === meId ? e.friend_user_id : e.created_by;
    const list = byFriend.get(otherId);
    if (list) list.push(e);
    else byFriend.set(otherId, [e]);
  }

  const tabs = [];
  for (const [friendId, list] of byFriend) {
    const friend = await getUser(friendId);
    if (!friend) continue; // counterparty account gone — skip the tab
    const balanceCents = computeTabBalance(list, meId);
    tabs.push({
      friend: await serializeUser(friend),
      balanceCents,
      balanceFmt: fmt(Math.abs(balanceCents)),
      direction: balanceDirection(balanceCents),
      entryCount: list.length,
      openCount: list.filter((e) => e.status === "open").length,
      lastActivity: list[0].created_at,
    });
  }
  tabs.sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : a.lastActivity > b.lastActivity ? -1 : 0));
  return res.json({ tabs });
});

/**
 * GET /api/tabs/:friendUserId — one tab: friend identity, net balance, the
 * full ledger (viewer-normalized), and any open settlement request.
 */
tabsRouter.get("/api/tabs/:friendUserId", requireAuth, async (req: Request, res: Response) => {
  const meId = req.userId as string;
  const friendId = req.params.friendUserId;
  if (!isSafeId(friendId) || friendId === meId) {
    return res.status(400).json({ error: "invalid friend id" });
  }

  const entries = await listPairEntries(meId, friendId);
  // Relationship gate: a tab is visible to its two participants. Friends can
  // open an empty tab; a stranger's id gets a 404 (no user enumeration).
  if (!entries.length && !(await isMutualFriend(meId, friendId))) {
    return res.status(404).json({ error: "not found" });
  }

  const friend = await getUser(friendId);
  if (!friend) return res.status(404).json({ error: "not found" });

  const balanceCents = computeTabBalance(entries, meId);
  const settlement = await getOpenSettlement(meId, friendId);
  const outside = await getPendingTabClaim(meId, friendId);
  return res.json({
    friend: await serializeUser(friend),
    balanceCents,
    balanceFmt: fmt(Math.abs(balanceCents)),
    direction: balanceDirection(balanceCents),
    entries: entries.map((e) => serializeEntry(e, meId)),
    settlement: settlement ? serializeSettlement(settlement, meId) : null,
    // a pending "settled another way" claim between us (never affects balance)
    outsideClaim: outside ? serializeOutsideClaim(outside, meId) : null,
  });
});

/**
 * POST /api/tabs/:friendUserId/entries { direction, amountCents|total, note? }
 * Add one entry to the tab. Direction is from MY side: "they_owe" = the friend
 * owes me, "i_owe" = I owe them. Nudges the friend via push (best-effort).
 */
tabsRouter.post(
  "/api/tabs/:friendUserId/entries",
  writeRateLimit,
  requireAuth,
  async (req: Request, res: Response) => {
    const meId = req.userId as string;
    const friendId = req.params.friendUserId;
    if (!isSafeId(friendId)) return res.status(400).json({ error: "invalid friend id" });
    if (friendId === meId) {
      return res.status(400).json({ error: "you can't run a tab with yourself" });
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const direction = body.direction as Direction;
    if (direction !== "i_owe" && direction !== "they_owe") {
      return res.status(400).json({ error: 'direction must be "i_owe" or "they_owe"' });
    }

    // Amount: prefer explicit integer cents, else parse dollars total (ious.ts).
    let amountCents: number;
    try {
      amountCents =
        body.amountCents != null
          ? Number(body.amountCents)
          : toCents(body.total as number | string);
    } catch {
      return res.status(400).json({ error: "invalid amount" });
    }
    if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > MAX_AMOUNT_CENTS) {
      return res
        .status(400)
        .json({ error: `amountCents must be an integer in 1..${MAX_AMOUNT_CENTS}` });
    }

    let note: string | null = null;
    if (body.note != null && String(body.note).trim() !== "") {
      note = String(body.note).trim();
      if (note.length > MAX_NOTE) {
        return res.status(400).json({ error: `note must be at most ${MAX_NOTE} chars` });
      }
    }

    // The counterparty must be a real, MUTUAL friend — a tab is a shared
    // ledger, so this also stops entry-spam at strangers and id probing.
    const friend = await getUser(friendId);
    if (!friend || !(await isMutualFriend(meId, friendId))) {
      return res.status(404).json({ error: "no such friend — add them first" });
    }

    const row: TabEntryRow = {
      id: crypto.randomUUID(),
      created_by: meId,
      friend_user_id: friendId,
      direction,
      amount_cents: amountCents,
      note,
      status: "open",
      settlement_id: null,
      created_at: new Date().toISOString(),
    };
    await insertEntry(row);

    // Nudge the other side of the tab (reuses push.ts; fire-and-forget).
    const fromLabel = await callerLabel(meId);
    const what = fmt(amountCents) + (note ? ` — ${note.slice(0, 48)}` : "");
    void sendPush(friendId, {
      title: "Tab updated 🧾",
      body:
        direction === "they_owe"
          ? `${fromLabel} added ${what} · you owe them`
          : `${fromLabel} added ${what} · they owe you`,
      url: `/#/tab/${meId}`,
      tag: `tab:${row.id}`,
    });

    return res.status(201).json(serializeEntry(row, meId));
  }
);

/**
 * DELETE /api/tabs/entries/:id — remove one of MY open entries (typo fixes).
 * Settled entries are history and can't be removed.
 */
tabsRouter.delete(
  "/api/tabs/entries/:id",
  writeRateLimit,
  requireAuth,
  async (req: Request, res: Response) => {
    const meId = req.userId as string;
    const removed = await deleteOwnOpenEntry(req.params.id, meId);
    if (!removed) return res.status(404).json({ error: "not found" });
    return res.json({ ok: true });
  }
);

/**
 * POST /api/tabs/:friendUserId/settle { partialCents? } — build (or return)
 * the settlement request for the tab's CURRENT net: one Solana Pay payment
 * from the debtor to the creditor's primary wallet. Optional `partialCents`
 * (payer-only, integer in (0, net]) builds the request at that amount instead
 * — the remainder stays on the tab. A stale open request (net changed, or a
 * different amount was asked for) is cancelled and rebuilt; a pending partial
 * survives bare rebuilds while it still fits inside the net.
 */
tabsRouter.post(
  "/api/tabs/:friendUserId/settle",
  writeRateLimit,
  requireAuth,
  async (req: Request, res: Response) => {
    const meId = req.userId as string;
    const friendId = req.params.friendUserId;
    if (!isSafeId(friendId) || friendId === meId) {
      return res.status(400).json({ error: "invalid friend id" });
    }

    const entries = await listPairEntries(meId, friendId);
    if (!entries.length && !(await isMutualFriend(meId, friendId))) {
      return res.status(404).json({ error: "not found" });
    }

    const balanceCents = computeTabBalance(entries, meId);
    const partialCents = (req.body || {})?.partialCents as unknown;
    const target = resolveSettleRequest(balanceCents, meId, friendId, partialCents);
    if ("error" in target) return res.status(target.status).json({ error: target.error });

    // Reuse an open request that still matches what's being asked for;
    // otherwise it's superseded — cancel it and build a fresh one.
    const existing = await getOpenSettlement(meId, friendId);
    if (existing) {
      if (canReuseSettlement(existing, target, partialCents != null)) {
        return res.json(serializeSettlement(existing, meId));
      }
      await cancelSettlement(existing.id);
    }

    const payWallet = await getPrimaryWallet(target.payee);
    if (!payWallet) {
      return res.status(400).json({
        error:
          target.payee === meId
            ? "add a wallet first so they can pay you"
            : "they haven't added a wallet to get paid at yet",
      });
    }

    const row: TabSettlementRow = {
      id: crypto.randomUUID(),
      payer_user_id: target.payer,
      payee_user_id: target.payee,
      amount_cents: target.amountCents,
      reference: newReference(),
      pay_wallet: payWallet,
      status: target.partial ? "open_partial" : "open",
      signature: null,
      created_at: new Date().toISOString(),
    };
    await insertSettlement(row);
    return res.status(201).json(serializeSettlement(row, meId));
  }
);

/**
 * POST /api/tabs/:friendUserId/settle/verify — check the chain for payment of
 * the pair's open settlement. On success a FULL settlement flips the entries
 * it covered to paid; a PARTIAL one leaves the ledger open and records a
 * "payment" offset row instead (the net drops by the paid amount, history
 * shows the payment). Either way the other side gets a push.
 */
tabsRouter.post(
  "/api/tabs/:friendUserId/settle/verify",
  moneyRateLimit,
  requireAuth,
  async (req: Request, res: Response) => {
    const meId = req.userId as string;
    const friendId = req.params.friendUserId;
    if (!isSafeId(friendId) || friendId === meId) {
      return res.status(400).json({ error: "invalid friend id" });
    }

    const row = await getOpenSettlement(meId, friendId);
    if (!row) return res.status(400).json({ error: "no open settlement to verify" });
    if (!row.reference || !row.pay_wallet) {
      return res.status(400).json({ error: "this settlement has no payable request to verify" });
    }
    const isPartial = row.status === "open_partial";

    const connection = new Connection(rpcUrl, "confirmed");
    const result = await validatePayment(connection, {
      reference: row.reference,
      recipient: row.pay_wallet,
      splToken: USDC_MINT[cluster],
      amountCents: row.amount_cents,
    });

    let verified = result.ok;
    if (result.ok && result.signature) {
      // Global guard: one on-chain signature settles at most ONE debt across
      // the whole system (bills, trips, ious, AND tabs). See ious.ts.
      const claimed = await claimSignature(result.signature, `tab:${row.id}`);
      if (!claimed) {
        alert("high", "signature_reuse_blocked", {
          context: "tab",
          settlementId: row.id,
          signature: result.signature,
        });
        verified = false; // already consumed elsewhere — do not double-discharge
      } else if (isPartial) {
        await markSettlementPaid(row.id, result.signature);
        // A partial doesn't close any entries — it leaves a "payment" offset
        // row carrying the settlement id, so the net drops by the paid amount
        // and the ledger shows the payment. A later full settle covers exactly
        // the remainder (and flips this row along with the rest).
        await insertEntry(
          paymentEntry(
            row.payer_user_id,
            row.payee_user_id,
            row.amount_cents,
            row.id,
            new Date().toISOString()
          )
        );
        const payerLabel = await callerLabel(row.payer_user_id);
        void sendPush(friendId, {
          title: "Tab payment 💸",
          body: `${payerLabel} paid ${fmt(row.amount_cents)} toward the tab — the rest stays on it`,
          url: `/#/tab/${meId}`,
          tag: `tab-settle:${row.id}`,
        });
      } else {
        await markSettlementPaid(row.id, result.signature);
        // Only entries that existed when the request was built are covered —
        // anything added since stays open on the fresh tab.
        await settlePairEntries(meId, friendId, row.created_at, row.id);
        const fromLabel = await callerLabel(meId);
        void sendPush(friendId, {
          title: "Tab settled 🎉",
          body: `${fromLabel} settled your tab — ${fmt(row.amount_cents)}`,
          url: `/#/tab/${meId}`,
          tag: `tab-settle:${row.id}`,
        });
      }
    }

    const updated = { ...row, status: verified ? "paid" : row.status, signature: verified ? result.signature || null : row.signature };
    return res.json({
      ...serializeSettlement(updated as TabSettlementRow, meId),
      partial: isPartial,
      verified,
      reason: verified
        ? result.reason
        : result.ok
          ? "payment already used to settle another debt"
          : result.reason,
    });
  }
);

// ---- Settled outside the app (cash / venmo / zelle) ---------------------------
// Two-step handshake (settleOutside.ts): the debtor files a PENDING claim, the
// creditor confirms it — only then does the ledger move. No chain signature
// exists here, so this path never touches verify/claimSignature.

/**
 * POST /api/tabs/:friendUserId/settle-outside { amountCents?, method, note? }
 * Debtor-only: claim you already paid the friend off-app. Amount defaults to
 * the whole net and is clamped to (0, net] (partial semantics: the rest stays
 * on the tab). Creates a pending claim + pushes the creditor; the ledger does
 * NOT change until they confirm. A newer claim supersedes a pending one.
 */
tabsRouter.post(
  "/api/tabs/:friendUserId/settle-outside",
  writeRateLimit,
  requireAuth,
  async (req: Request, res: Response) => {
    const meId = req.userId as string;
    const friendId = req.params.friendUserId;
    if (!isSafeId(friendId) || friendId === meId) {
      return res.status(400).json({ error: "invalid friend id" });
    }

    const entries = await listPairEntries(meId, friendId);
    if (!entries.length && !(await isMutualFriend(meId, friendId))) {
      return res.status(404).json({ error: "not found" });
    }

    // Only the DEBTOR can claim an outside payment — a creditor "claiming"
    // would be asking to erase their own receivable via the wrong door.
    const balanceCents = computeTabBalance(entries, meId);
    if (balanceCents >= 0) {
      return res
        .status(400)
        .json({ error: "you can only claim a payment for a tab you owe" });
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const method = body.method;
    if (!isOutsideMethod(method)) {
      return res.status(400).json({ error: "method must be cash, venmo, zelle, or other" });
    }
    const amount = resolveOutsideAmount(-balanceCents, body.amountCents);
    if ("error" in amount) return res.status(amount.status).json({ error: amount.error });
    let note: string | null = null;
    if (body.note != null && String(body.note).trim() !== "") {
      note = String(body.note).trim();
      if (note.length > MAX_NOTE) {
        return res.status(400).json({ error: `note must be at most ${MAX_NOTE} chars` });
      }
    }

    // A fresh claim supersedes any pending one between this pair.
    const existing = await getPendingTabClaim(meId, friendId);
    if (existing) await transitionOutsideClaim(existing.id, "cancelled", new Date().toISOString());

    const row = newOutsideClaim({
      context: "tab",
      debtorUserId: meId,
      creditorUserId: friendId,
      amountCents: amount.amountCents,
      method: method as OutsideMethod,
      note,
    });
    await insertOutsideClaim(row);

    const fromLabel = await callerLabel(meId);
    void sendPush(friendId, {
      title: "settled outside? 💵",
      body: `${fromLabel} says they paid you ${fmt(amount.amountCents)} ${methodPhrase(method)} — confirm?`,
      url: `/#/tab/${meId}`,
      tag: `tab-outside:${row.id}`,
    });

    return res.status(201).json(serializeOutsideClaim(row, meId));
  }
);

/**
 * POST /api/tabs/:friendUserId/settle-outside/:claimId/(confirm|decline|cancel)
 * confirm/decline: creditor-only. cancel: debtor-only. Confirm is idempotent
 * and race-safe (the pending→confirmed transition is the lock): it inserts a
 * "cash_payment" ledger row, and — when the claim covers the whole net — flips
 * the covered entries exactly like a full on-chain settle.
 */
tabsRouter.post(
  "/api/tabs/:friendUserId/settle-outside/:claimId/:verb(confirm|decline|cancel)",
  writeRateLimit,
  requireAuth,
  async (req: Request, res: Response) => {
    const meId = req.userId as string;
    const friendId = req.params.friendUserId;
    const claimId = req.params.claimId;
    const verb = req.params.verb as ClaimVerb;
    if (!isSafeId(friendId) || friendId === meId || !isSafeId(claimId)) {
      return res.status(400).json({ error: "invalid id" });
    }

    const claim = await getOutsideClaim(claimId);
    // The claim must be a TAB claim between exactly me and :friendUserId —
    // anything else is indistinguishable from "no such claim" (no probing).
    const pair = claim && new Set([claim.debtor_user_id, claim.creditor_user_id]);
    if (!claim || claim.context !== "tab" || !pair!.has(meId) || !pair!.has(friendId)) {
      return res.status(404).json({ error: "not found" });
    }

    const nowIso = new Date().toISOString();
    const decision = decideClaimAction(claim, verb, meId, nowIso);
    if (!decision.ok) {
      if (decision.status === 410) await transitionOutsideClaim(claim.id, "expired", nowIso);
      return res.status(decision.status).json({ error: decision.error });
    }
    if (decision.already) {
      return res.json({ ...serializeOutsideClaim(claim, meId), already: true });
    }

    if (verb !== "confirm") {
      await transitionOutsideClaim(claim.id, decision.next, nowIso);
      if (verb === "decline") {
        const fromLabel = await callerLabel(meId);
        void sendPush(claim.debtor_user_id, {
          title: "hmm — not confirmed",
          body: `${fromLabel} didn't confirm your ${fmt(claim.amount_cents)} ${methodPhrase(claim.method)} — the tab stays as-is`,
          url: `/#/tab/${meId}`,
          tag: `tab-outside:${claim.id}`,
        });
      }
      return res.json({ ...serializeOutsideClaim({ ...claim, status: decision.next }, meId) });
    }

    // CONFIRM — I'm the creditor. The claim must still fit inside what the
    // debtor currently owes me (entries may have moved since it was filed).
    const entries = await listPairEntries(meId, friendId);
    const owedToMe = computeTabBalance(entries, meId);
    if (owedToMe < claim.amount_cents) {
      return res.status(409).json({
        error: "the tab changed since this claim — ask them to claim it again",
      });
    }

    // Atomic pending→confirmed transition is the idempotency/race lock: only
    // the winner applies the ledger effect.
    const won = await transitionOutsideClaim(claim.id, "confirmed", nowIso);
    if (!won) {
      const latest = await getOutsideClaim(claim.id);
      if (latest && latest.status === "confirmed") {
        return res.json({ ...serializeOutsideClaim(latest, meId), already: true });
      }
      return res.status(409).json({ error: `this claim was already ${latest?.status || "resolved"}` });
    }

    const entryRow = cashPaymentEntry(
      claim.debtor_user_id,
      claim.creditor_user_id,
      claim.amount_cents,
      claim.id,
      claim.method,
      nowIso
    );
    try {
      await insertEntry(entryRow);
      // Covers the whole net → flip everything, like a full on-chain settle.
      if (claim.amount_cents === owedToMe) {
        await settlePairEntries(meId, friendId, entryRow.created_at, claim.id);
      }
    } catch (err) {
      // Ledger write failed — put the claim back so the confirm can be retried.
      if (usingSupabase) {
        await supabase().from("outside_claims").update({ status: "pending", resolved_at: null }).eq("id", claim.id);
      } else {
        db.prepare("UPDATE outside_claims SET status = 'pending', resolved_at = NULL WHERE id = ?").run(claim.id);
      }
      throw err;
    }

    const myLabel = await callerLabel(meId);
    void sendPush(claim.debtor_user_id, {
      title: "confirmed ✓",
      body: `${myLabel} confirmed your ${fmt(claim.amount_cents)} ${methodPhrase(claim.method)} — the tab's updated`,
      url: `/#/tab/${meId}`,
      tag: `tab-outside:${claim.id}`,
    });

    return res.json({
      ...serializeOutsideClaim({ ...claim, status: "confirmed", resolved_at: nowIso }, meId),
      confirmed: true,
    });
  }
);
