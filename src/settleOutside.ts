/**
 * settleOutside.ts — "Settled another way": cash / Venmo / Zelle claims.
 *
 * Not everyone in a friend group holds USDC on day one. When a debtor pays a
 * creditor OUTSIDE the app (cash at the table, Venmo, whatever), the ledger
 * still needs to clear — but nobody's word alone may move a balance. So this
 * module models a two-step handshake:
 *
 *   1. the DEBTOR files a claim ("I paid you $23 in cash") → status "pending".
 *      Nothing about the ledger changes. The creditor gets a push.
 *   2. the CREDITOR confirms → the caller (tabs.ts / server.ts trips routes)
 *      records the actual ledger effect (a cash tab entry / a transfer
 *      expense). Decline just closes the claim; the debtor can also cancel;
 *      stale claims expire after CLAIM_TTL_MS.
 *
 * STRICT SCOPE: this file owns the `outside_claims` table, its pure state
 * machine, and nothing else. It imports NO feature module (tabs.ts and
 * server.ts import it, never the reverse), so there are no import cycles.
 * The ledger mutation on confirm belongs to the caller.
 *
 * GUARDRAIL: ALL money is integer cents. A pending claim NEVER counts toward
 * any balance anywhere.
 */

import * as crypto from "crypto";
import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { fmt } from "./split";

// ---- Schema (idempotent; Supabase mirror lives in supabase/schema.sql) ------

db.exec(`
  CREATE TABLE IF NOT EXISTS outside_claims (
    id TEXT PRIMARY KEY,
    context TEXT NOT NULL,
    trip_id TEXT,
    from_member_id TEXT,
    to_member_id TEXT,
    debtor_user_id TEXT NOT NULL,
    creditor_user_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    method TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    resolved_at TEXT
  );
`);

// ---- Types -------------------------------------------------------------------

export interface OutsideClaimRow {
  id: string;
  /** 'tab' (1:1 friend tab) | 'trip' (group ledger). */
  context: string;
  trip_id: string | null;
  from_member_id: string | null;
  to_member_id: string | null;
  /** The claimant — the person who says they already paid. */
  debtor_user_id: string;
  /** The only account allowed to confirm/decline. */
  creditor_user_id: string;
  amount_cents: number;
  method: string;
  note: string | null;
  /** 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'expired'. */
  status: string;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
}

// ---- Pure: methods + phrasing (exported for settleOutside.selftest.ts) --------

export const OUTSIDE_METHODS = ["cash", "venmo", "zelle", "other"] as const;
export type OutsideMethod = (typeof OUTSIDE_METHODS)[number];

export function isOutsideMethod(v: unknown): v is OutsideMethod {
  return typeof v === "string" && (OUTSIDE_METHODS as readonly string[]).includes(v);
}

/** "in cash 💵" / "on venmo" — reads naturally after "paid you $23 …". */
export function methodPhrase(method: string): string {
  switch (method) {
    case "cash":
      return "in cash 💵";
    case "venmo":
      return "on venmo";
    case "zelle":
      return "on zelle";
    default:
      return "another way 🤝";
  }
}

// ---- Pure: amount resolution ---------------------------------------------------

export const MAX_OUTSIDE_CENTS = 100_000_000; // mirror tabs.ts / server.ts caps
/** Pending claims go stale after a week — a nudge to re-ask, not a zombie. */
export const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Resolve the claimed amount against what the debtor CURRENTLY owes
 * (`netOwedCents`, positive integer cents). Omitted amount = the whole debt;
 * an explicit amount must be an integer in 1..min(net, MAX_OUTSIDE_CENTS) —
 * partial cash payments reuse the same "the rest stays owed" semantics as
 * partial on-chain settles.
 */
export function resolveOutsideAmount(
  netOwedCents: number,
  amountCents?: unknown
): { amountCents: number } | { status: number; error: string } {
  if (!Number.isInteger(netOwedCents) || netOwedCents <= 0) {
    return { status: 400, error: "you're square — nothing to settle" };
  }
  const cap = Math.min(netOwedCents, MAX_OUTSIDE_CENTS);
  if (amountCents == null) return { amountCents: cap };
  const amt = Number(amountCents);
  if (!Number.isInteger(amt) || amt < 1 || amt > cap) {
    return { status: 400, error: "amount must be between 1 cent and what's owed" };
  }
  return { amountCents: amt };
}

// ---- Pure: claim state machine ---------------------------------------------------

export type ClaimVerb = "confirm" | "decline" | "cancel";

export type ClaimDecision =
  | { ok: true; next: "confirmed" | "declined" | "cancelled"; already?: false }
  | { ok: true; already: true }
  | { ok: false; status: number; error: string };

export function isClaimExpired(
  claim: { status: string; expires_at: string },
  nowIso: string
): boolean {
  // ISO-8601 strings compare correctly as strings (same format everywhere).
  return claim.status === "pending" && !!claim.expires_at && nowIso >= claim.expires_at;
}

/**
 * Decide what `verb` by `byUserId` does to `claim` at `nowIso`.
 * The whole security model in one pure function:
 *   - confirm/decline: CREDITOR only (the debtor's claim alone never clears).
 *   - cancel: DEBTOR only.
 *   - repeating an action that already happened is idempotent ({already:true});
 *   - any other verb on a resolved claim is a 409; an expired pending claim
 *     is a 410 for everything except cancel (cancelling stale is harmless).
 */
export function decideClaimAction(
  claim: { status: string; expires_at: string; debtor_user_id: string; creditor_user_id: string },
  verb: ClaimVerb,
  byUserId: string,
  nowIso: string
): ClaimDecision {
  const wants = verb === "confirm" ? "confirmed" : verb === "decline" ? "declined" : "cancelled";
  const mustBe = verb === "cancel" ? claim.debtor_user_id : claim.creditor_user_id;
  if (byUserId !== mustBe) {
    return {
      ok: false,
      status: 403,
      error:
        verb === "cancel"
          ? "only the person who filed this claim can cancel it"
          : "only the person who got paid can confirm or decline this",
    };
  }
  if (claim.status === wants) return { ok: true, already: true };
  if (claim.status !== "pending") {
    return { ok: false, status: 409, error: `this claim was already ${claim.status}` };
  }
  if (verb !== "cancel" && isClaimExpired(claim, nowIso)) {
    return { ok: false, status: 410, error: "this claim expired — ask them to send it again" };
  }
  return { ok: true, next: wants };
}

// ---- Serialization ---------------------------------------------------------------

export function serializeOutsideClaim(row: OutsideClaimRow, meId?: string) {
  return {
    id: row.id,
    context: row.context,
    tripId: row.trip_id,
    from: row.from_member_id,
    to: row.to_member_id,
    debtorUserId: row.debtor_user_id,
    creditorUserId: row.creditor_user_id,
    iAmDebtor: meId != null ? row.debtor_user_id === meId : undefined,
    iAmCreditor: meId != null ? row.creditor_user_id === meId : undefined,
    amountCents: row.amount_cents,
    amountFmt: fmt(row.amount_cents),
    method: row.method,
    methodPhrase: methodPhrase(row.method),
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

// ---- Persistence ------------------------------------------------------------------

/** Ids are crypto.randomUUID()s — enforce the shape before .or() embedding (tabs.ts). */
function isSafeId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v);
}

export function newOutsideClaim(input: {
  context: "tab" | "trip";
  tripId?: string | null;
  fromMemberId?: string | null;
  toMemberId?: string | null;
  debtorUserId: string;
  creditorUserId: string;
  amountCents: number;
  method: OutsideMethod;
  note: string | null;
}): OutsideClaimRow {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    context: input.context,
    trip_id: input.tripId ?? null,
    from_member_id: input.fromMemberId ?? null,
    to_member_id: input.toMemberId ?? null,
    debtor_user_id: input.debtorUserId,
    creditor_user_id: input.creditorUserId,
    amount_cents: input.amountCents,
    method: input.method,
    note: input.note,
    status: "pending",
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + CLAIM_TTL_MS).toISOString(),
    resolved_at: null,
  };
}

export async function insertOutsideClaim(row: OutsideClaimRow): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase().from("outside_claims").insert({ ...row });
    if (error) throw new Error(`settleOutside.insert: ${error.message}`);
    return;
  }
  db.prepare(
    `INSERT INTO outside_claims
       (id, context, trip_id, from_member_id, to_member_id, debtor_user_id,
        creditor_user_id, amount_cents, method, note, status, created_at,
        expires_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.context,
    row.trip_id,
    row.from_member_id,
    row.to_member_id,
    row.debtor_user_id,
    row.creditor_user_id,
    row.amount_cents,
    row.method,
    row.note,
    row.status,
    row.created_at,
    row.expires_at,
    row.resolved_at
  );
}

export async function getOutsideClaim(id: string): Promise<OutsideClaimRow | undefined> {
  if (!isSafeId(id)) return undefined;
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("outside_claims")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`settleOutside.get: ${error.message}`);
    return (data as OutsideClaimRow | null) ?? undefined;
  }
  return db.prepare("SELECT * FROM outside_claims WHERE id = ?").get(id) as
    | OutsideClaimRow
    | undefined;
}

/**
 * Atomically move a claim out of 'pending'. Returns true iff THIS call won the
 * transition — the confirm route uses this as its idempotency/race lock, so a
 * double-tap (or two devices) can only ever apply the ledger effect once.
 */
export async function transitionOutsideClaim(
  id: string,
  next: "confirmed" | "declined" | "cancelled" | "expired",
  resolvedAtIso: string
): Promise<boolean> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("outside_claims")
      .update({ status: next, resolved_at: resolvedAtIso })
      .eq("id", id)
      .eq("status", "pending")
      .select("id");
    if (error) throw new Error(`settleOutside.transition: ${error.message}`);
    return !!data && data.length > 0;
  }
  const info = db
    .prepare("UPDATE outside_claims SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'")
    .run(next, resolvedAtIso, id);
  return info.changes > 0;
}

/** Lazily expire a pending claim that has passed its TTL. Returns the live row or undefined. */
async function liveOrExpire(row: OutsideClaimRow | undefined): Promise<OutsideClaimRow | undefined> {
  if (!row) return undefined;
  const now = new Date().toISOString();
  if (isClaimExpired(row, now)) {
    await transitionOutsideClaim(row.id, "expired", now); // best-effort
    return undefined;
  }
  return row;
}

/** The newest live pending TAB claim between two users (either direction). */
export async function getPendingTabClaim(
  aUserId: string,
  bUserId: string
): Promise<OutsideClaimRow | undefined> {
  if (!isSafeId(aUserId) || !isSafeId(bUserId)) return undefined;
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("outside_claims")
      .select("*")
      .eq("context", "tab")
      .eq("status", "pending")
      .or(
        `and(debtor_user_id.eq.${aUserId},creditor_user_id.eq.${bUserId}),and(debtor_user_id.eq.${bUserId},creditor_user_id.eq.${aUserId})`
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`settleOutside.pendingTab: ${error.message}`);
    return liveOrExpire((data as OutsideClaimRow | null) ?? undefined);
  }
  const row = db
    .prepare(
      `SELECT * FROM outside_claims
       WHERE context = 'tab' AND status = 'pending'
         AND ((debtor_user_id = ? AND creditor_user_id = ?)
           OR (debtor_user_id = ? AND creditor_user_id = ?))
       ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(aUserId, bUserId, bUserId, aUserId) as OutsideClaimRow | undefined;
  return liveOrExpire(row);
}

/** All live pending claims on one trip (both cards + the waiting rows). */
export async function listPendingTripClaims(tripId: string): Promise<OutsideClaimRow[]> {
  if (!isSafeId(tripId)) return [];
  let rows: OutsideClaimRow[];
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("outside_claims")
      .select("*")
      .eq("context", "trip")
      .eq("trip_id", tripId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`settleOutside.pendingTrip: ${error.message}`);
    rows = (data as OutsideClaimRow[]) ?? [];
  } else {
    rows = db
      .prepare(
        `SELECT * FROM outside_claims
         WHERE context = 'trip' AND trip_id = ? AND status = 'pending'
         ORDER BY created_at DESC, rowid DESC`
      )
      .all(tripId) as OutsideClaimRow[];
  }
  const live: OutsideClaimRow[] = [];
  for (const r of rows) {
    const l = await liveOrExpire(r);
    if (l) live.push(l);
  }
  return live;
}
