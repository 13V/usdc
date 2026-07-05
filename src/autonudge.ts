/**
 * autonudge.ts — Due dates + Mochi's auto-nudge cadence.
 *
 * A due date is a soft "settle by" moment: on a tab ("square up by sunday"),
 * on a group (trips.due_at), or on a single expense (expenses.due_at — chip
 * only, the group cadence drives reminders). AUTO-NUDGE is the set-and-forget
 * part: the CREDITOR opts a debt into a cadence (gentle / standard / spicy)
 * and Mochi handles the awkward collection — reminders start once the due
 * date passes (immediately when there is none) and escalate along the same
 * tone ladder manual nudges use, capped at the 🦆 stage.
 *
 * HARD RULES (all enforced in the pure decideAutoNudge, tested offline):
 *   - never nudge a settled / zero debt;
 *   - never while a settle-outside claim is pending with the creditor;
 *   - at most ONE auto-nudge per (debt, debtor) per 24h regardless of cadence;
 *   - stop after the debt clears or MAX_AUTO_SENDS sends;
 *   - a debtor can never configure nudges aimed at themselves.
 *
 * Engine: mirrors subscriptions.ts — lazy pass on this module's GETs plus an
 * unref'd 60s self-scheduler; the per-(config, debtor) send state row is
 * claimed with a CAS update, so racing passes (or a restart mid-pass) can
 * never double-send. Delivery reuses push.ts; every sent auto-nudge is also
 * recorded through nudges.recordAutoNudge so it lands in the existing
 * notifications feed.
 *
 * STRICT SCOPE: this file owns auto_nudge_configs / auto_nudge_sends and this
 * router. It reads tabs/trips/claims via their exported helpers (plus a
 * read-only mirror of the tab pair query, nudges.ts-style) and never mutates
 * another module's tables.
 *
 * Mount (integrator):
 *   import { autonudgeRouter } from "./autonudge";
 *   app.use(autonudgeRouter);
 */

import { Router, Request, Response } from "express";

import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { requireAuth } from "./auth";
import { getTrip, Trip } from "./trips";
import { computeBalances } from "./ledger";
import { simplifyDebts } from "./simplify";
import { computeTabBalance, TabEntryLike } from "./tabs";
import { getPendingTabClaim, listPendingTripClaims } from "./settleOutside";
import { getUser, serializeUser } from "./users";
import { sendPush } from "./push";
import { nudgeBody, recordAutoNudge } from "./nudges";
import { fmt } from "./split";
import { writeRateLimit } from "./ratelimit";

// ---- Schema (idempotent; Supabase mirror lives in supabase/schema.sql) ------

db.exec(`
  CREATE TABLE IF NOT EXISTS auto_nudge_configs (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    trip_id TEXT,
    creditor_user_id TEXT NOT NULL,
    debtor_user_id TEXT,
    cadence TEXT NOT NULL,
    due_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auto_nudge_sends (
    id TEXT PRIMARY KEY,
    config_id TEXT NOT NULL,
    debtor_user_id TEXT NOT NULL,
    last_sent_at TEXT,
    send_count INTEGER NOT NULL DEFAULT 0
  );
`);

// ---- Pure: cadence + due-date math (exported for autonudge.selftest.ts) -----

export type Cadence = "off" | "gentle" | "standard" | "spicy";

/** Days between auto-nudges per cadence. */
export const CADENCE_DAYS: Record<Exclude<Cadence, "off">, number> = {
  gentle: 5,
  standard: 3,
  spicy: 1,
};

/** HARD RULE: at most one auto-nudge per (debt, debtor) per 24h. */
export const MIN_GAP_MS = 24 * 60 * 60 * 1000;
/** HARD RULE: Mochi gives up (quietly) after this many sends per debtor. */
export const MAX_AUTO_SENDS = 10;
/** Sane due-date horizon: at most ~a year out. */
export const MAX_DUE_HORIZON_MS = 366 * 24 * 60 * 60 * 1000;

export function isCadence(v: unknown): v is Cadence {
  return v === "off" || v === "gentle" || v === "standard" || v === "spicy";
}

/**
 * Validate a client-supplied due date. null/"" clears it. A bare YYYY-MM-DD is
 * normalized to the END of that UTC day ("due sunday" means all of sunday).
 * Must land in the future and within MAX_DUE_HORIZON_MS of `nowMs`.
 */
export function validateDueAt(
  v: unknown,
  nowMs: number
): { ok: true; dueAt: string | null } | { ok: false; error: string } {
  if (v == null || v === "") return { ok: true, dueAt: null };
  if (typeof v !== "string") return { ok: false, error: "due date must be a date string" };
  const s = v.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59.999Z` : s;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { ok: false, error: "that's not a real date" };
  if (t <= nowMs) return { ok: false, error: "due date has to be in the future" };
  if (t > nowMs + MAX_DUE_HORIZON_MS) return { ok: false, error: "due date can be at most a year out" };
  return { ok: true, dueAt: new Date(t).toISOString() };
}

/**
 * Which rung of the manual nudge tone ladder this auto-send uses. Send #1 is
 * the polite one; escalation CAPS at stage 4 — the existing 🦆 — so repeated
 * auto-nudges re-send the duck rather than inventing new drama.
 */
export function escalationStage(sendCount: number): number {
  return Math.min(Math.max(sendCount, 0) + 1, 4);
}

export interface AutoNudgeInput {
  cadence: string;
  /** Reminders start after this passes; null = immediately. */
  dueAt: string | null;
  lastSentAt: string | null;
  sendCount: number;
  /** Integer cents the debtor currently owes the creditor. */
  debtCents: number;
  /** A settle-outside claim is awaiting the creditor — don't dun them. */
  claimPending: boolean;
  debtorUserId: string;
  creditorUserId: string;
  nowMs: number;
}

export type AutoNudgeDecision =
  | { send: true; stage: number }
  | { send: false; reason: string };

/** The whole hard-rule set in one pure, offline-testable function. */
export function decideAutoNudge(i: AutoNudgeInput): AutoNudgeDecision {
  const no = (reason: string): AutoNudgeDecision => ({ send: false, reason });
  if (!isCadence(i.cadence) || i.cadence === "off") return no("cadence off");
  if (i.debtorUserId === i.creditorUserId) return no("self-nudge");
  if (!Number.isInteger(i.debtCents) || i.debtCents <= 0) return no("debt settled");
  if (i.claimPending) return no("claim pending");
  if (i.sendCount >= MAX_AUTO_SENDS) return no("send cap reached");
  if (i.dueAt) {
    const due = new Date(i.dueAt).getTime();
    if (!Number.isNaN(due) && due > i.nowMs) return no("not due yet");
  }
  if (i.lastSentAt) {
    const last = new Date(i.lastSentAt).getTime();
    if (!Number.isNaN(last)) {
      if (i.nowMs - last < MIN_GAP_MS) return no("24h floor");
      if (i.nowMs - last < CADENCE_DAYS[i.cadence] * 24 * 60 * 60 * 1000) {
        return no("cadence interval");
      }
    }
  }
  return { send: true, stage: escalationStage(i.sendCount) };
}

/**
 * When the next auto-nudge would go out (ISO), or null when the cadence is
 * off. Never sent yet → the due date (or "now" when there is none); otherwise
 * lastSent + cadence interval (which is never under the 24h floor).
 */
export function nextSendAt(
  cadence: string,
  dueAt: string | null,
  lastSentAt: string | null,
  nowMs: number
): string | null {
  if (!isCadence(cadence) || cadence === "off") return null;
  if (lastSentAt) {
    const last = new Date(lastSentAt).getTime();
    if (!Number.isNaN(last)) {
      const gap = Math.max(CADENCE_DAYS[cadence] * 24 * 60 * 60 * 1000, MIN_GAP_MS);
      return new Date(last + gap).toISOString();
    }
  }
  if (dueAt) {
    const due = new Date(dueAt).getTime();
    if (!Number.isNaN(due) && due > nowMs) return new Date(due).toISOString();
  }
  return new Date(nowMs).toISOString();
}

// ---- Rows -------------------------------------------------------------------

interface ConfigRow {
  id: string;
  scope: string; // 'tab' | 'trip'
  trip_id: string | null;
  creditor_user_id: string;
  debtor_user_id: string | null; // tab scope only
  cadence: string;
  due_at: string | null; // tab scope "square up by"; trip scope uses trips.due_at
  created_at: string;
  updated_at: string;
}

interface SendRow {
  id: string;
  config_id: string;
  debtor_user_id: string;
  last_sent_at: string | null;
  send_count: number;
}

/** Deterministic config ids double as the uniqueness constraint (PK upsert). */
function tabConfigId(creditorUserId: string, debtorUserId: string): string {
  return `tab:${creditorUserId}:${debtorUserId}`;
}
function tripConfigId(tripId: string, creditorUserId: string): string {
  return `trip:${tripId}:${creditorUserId}`;
}
function sendRowId(configId: string, debtorUserId: string): string {
  return `${configId}|${debtorUserId}`;
}

/** Ids are crypto.randomUUID()s — enforce the shape defensively (tabs.ts). */
function isSafeId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v);
}

// ---- Persistence (dual backend) ----------------------------------------------

async function getConfig(id: string): Promise<ConfigRow | undefined> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("auto_nudge_configs").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`autonudge.getConfig: ${error.message}`);
    return (data as ConfigRow | null) ?? undefined;
  }
  return db.prepare("SELECT * FROM auto_nudge_configs WHERE id = ?").get(id) as ConfigRow | undefined;
}

async function upsertConfig(row: ConfigRow): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase()
      .from("auto_nudge_configs")
      .upsert({ ...row }, { onConflict: "id" });
    if (error) throw new Error(`autonudge.upsertConfig: ${error.message}`);
    return;
  }
  db.prepare(
    `INSERT INTO auto_nudge_configs
       (id, scope, trip_id, creditor_user_id, debtor_user_id, cadence, due_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET cadence = excluded.cadence, due_at = excluded.due_at,
       updated_at = excluded.updated_at`
  ).run(
    row.id, row.scope, row.trip_id, row.creditor_user_id, row.debtor_user_id,
    row.cadence, row.due_at, row.created_at, row.updated_at
  );
}

/** All configs with an active cadence (the engine's work list). */
async function listActiveConfigs(): Promise<ConfigRow[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("auto_nudge_configs").select("*").neq("cadence", "off");
    if (error) throw new Error(`autonudge.listActiveConfigs: ${error.message}`);
    return (data as ConfigRow[]) ?? [];
  }
  return db.prepare("SELECT * FROM auto_nudge_configs WHERE cadence != 'off'").all() as ConfigRow[];
}

/** All TAB configs where `userId` is on either side (for list-screen chips). */
async function listTabConfigsFor(userId: string): Promise<ConfigRow[]> {
  if (!isSafeId(userId)) return [];
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("auto_nudge_configs")
      .select("*")
      .eq("scope", "tab")
      .or(`creditor_user_id.eq.${userId},debtor_user_id.eq.${userId}`);
    if (error) throw new Error(`autonudge.listTabConfigsFor: ${error.message}`);
    return (data as ConfigRow[]) ?? [];
  }
  return db
    .prepare(
      "SELECT * FROM auto_nudge_configs WHERE scope = 'tab' AND (creditor_user_id = ? OR debtor_user_id = ?)"
    )
    .all(userId, userId) as ConfigRow[];
}

export async function getAutoNudgeSendState(
  configId: string,
  debtorUserId: string
): Promise<{ last_sent_at: string | null; send_count: number } | undefined> {
  const id = sendRowId(configId, debtorUserId);
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("auto_nudge_sends").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`autonudge.getSendState: ${error.message}`);
    return (data as SendRow | null) ?? undefined;
  }
  return db.prepare("SELECT * FROM auto_nudge_sends WHERE id = ?").get(id) as SendRow | undefined;
}

/** Send-state rows for one config (drives the creditor's "3 sent" stat). */
async function listSendStates(configId: string): Promise<SendRow[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("auto_nudge_sends").select("*").eq("config_id", configId);
    if (error) throw new Error(`autonudge.listSendStates: ${error.message}`);
    return (data as SendRow[]) ?? [];
  }
  return db.prepare("SELECT * FROM auto_nudge_sends WHERE config_id = ?").all(configId) as SendRow[];
}

/** Create the (config, debtor) state row if absent. Idempotent. */
export async function ensureAutoNudgeSendRow(configId: string, debtorUserId: string): Promise<void> {
  const id = sendRowId(configId, debtorUserId);
  if (usingSupabase) {
    const { error } = await supabase()
      .from("auto_nudge_sends")
      .upsert(
        { id, config_id: configId, debtor_user_id: debtorUserId, last_sent_at: null, send_count: 0 },
        { onConflict: "id", ignoreDuplicates: true }
      );
    if (error) throw new Error(`autonudge.ensureSendRow: ${error.message}`);
    return;
  }
  db.prepare(
    `INSERT OR IGNORE INTO auto_nudge_sends (id, config_id, debtor_user_id, last_sent_at, send_count)
     VALUES (?, ?, ?, NULL, 0)`
  ).run(id, configId, debtorUserId);
}

/**
 * Atomically CLAIM one send: bump (last_sent_at, send_count) ONLY if the row
 * still carries the exact state the caller decided on. Same CAS idea as
 * subscriptions.claimNextRenewal — the winner sends, losers (a racing pass, a
 * restarted server replaying stale state) do nothing, so a debtor can never be
 * double-nudged for one slot. Also re-enforces the send cap at the DB layer.
 */
export async function claimAutoNudgeSend(
  configId: string,
  debtorUserId: string,
  prevLastSentAt: string | null,
  prevSendCount: number,
  nowIso: string
): Promise<boolean> {
  const id = sendRowId(configId, debtorUserId);
  if (usingSupabase) {
    let q = supabase()
      .from("auto_nudge_sends")
      .update({ last_sent_at: nowIso, send_count: prevSendCount + 1 })
      .eq("id", id)
      .eq("send_count", prevSendCount)
      .lt("send_count", MAX_AUTO_SENDS);
    q = prevLastSentAt == null ? q.is("last_sent_at", null) : q.eq("last_sent_at", prevLastSentAt);
    const { data, error } = await q.select("id");
    if (error) throw new Error(`autonudge.claimSend: ${error.message}`);
    return !!data && data.length > 0;
  }
  const info = db
    .prepare(
      `UPDATE auto_nudge_sends SET last_sent_at = ?, send_count = ?
       WHERE id = ? AND COALESCE(last_sent_at, '') = ? AND send_count = ? AND send_count < ?`
    )
    .run(nowIso, prevSendCount + 1, id, prevLastSentAt ?? "", prevSendCount, MAX_AUTO_SENDS);
  return info.changes > 0;
}

// ---- Tab pair entries (read-only mirror of tabs.listPairEntries) -------------
// Same pattern as nudges.ts's friendship reads: duplicate the edge query so we
// never import/modify tabs.ts internals (its pure balance math IS exported).

async function pairEntries(aUserId: string, bUserId: string): Promise<TabEntryLike[]> {
  if (!isSafeId(aUserId) || !isSafeId(bUserId)) return [];
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("tab_entries")
      .select("created_by, direction, amount_cents, status")
      .or(
        `and(created_by.eq.${aUserId},friend_user_id.eq.${bUserId}),and(created_by.eq.${bUserId},friend_user_id.eq.${aUserId})`
      );
    if (error) throw new Error(`autonudge.pairEntries: ${error.message}`);
    return (data as TabEntryLike[]) ?? [];
  }
  return db
    .prepare(
      `SELECT created_by, direction, amount_cents, status FROM tab_entries
       WHERE (created_by = ? AND friend_user_id = ?) OR (created_by = ? AND friend_user_id = ?)`
    )
    .all(aUserId, bUserId, bUserId, aUserId) as TabEntryLike[];
}

// ---- Engine -------------------------------------------------------------------

interface DebtToNudge {
  debtorUserId: string;
  debtCents: number;
  claimPending: boolean;
  dueAt: string | null;
  url: string;
  contextLabel: string;
}

/** Resolve one config into the live debts it should be watching. */
async function resolveDebts(cfg: ConfigRow): Promise<DebtToNudge[]> {
  if (cfg.scope === "tab") {
    const debtor = cfg.debtor_user_id;
    if (!debtor) return [];
    const entries = await pairEntries(cfg.creditor_user_id, debtor);
    // + = the debtor owes the creditor (viewer = creditor).
    const debtCents = computeTabBalance(entries, cfg.creditor_user_id);
    if (debtCents <= 0) return [];
    const claim = await getPendingTabClaim(cfg.creditor_user_id, debtor);
    return [{
      debtorUserId: debtor,
      debtCents,
      claimPending: !!claim,
      dueAt: cfg.due_at,
      // the debtor opens the tab keyed by their FRIEND (= the creditor)
      url: `/#/tab/${cfg.creditor_user_id}`,
      contextLabel: "your tab",
    }];
  }

  // trip scope: every simplified debt pointing at the creditor's member slot.
  if (!cfg.trip_id) return [];
  const trip = await getTrip(cfg.trip_id);
  if (!trip) return [];
  const credMember = trip.members.find((m) => m.userId === cfg.creditor_user_id);
  if (!credMember) return [];
  // Balances over the UNFILTERED expense list — kind:"transfer" rows are how
  // confirmed settle-outside payments clear debts, so they must count here.
  const balances = computeBalances(
    trip.members.map((m) => m.id),
    trip.expenses.map((e) => ({ amountCents: e.amountCents, paidBy: e.paidBy, participants: e.participants }))
  );
  const transfers = simplifyDebts(balances).filter((t) => t.to === credMember.id);
  if (!transfers.length) return [];
  const pending = await listPendingTripClaims(trip.id);
  const membersById = new Map(trip.members.map((m) => [m.id, m]));
  const out: DebtToNudge[] = [];
  for (const t of transfers) {
    const debtorMember = membersById.get(t.from);
    if (!debtorMember || !debtorMember.userId) continue; // unclaimed slot — nowhere to push
    const debtorUserId = debtorMember.userId;
    const claimPending = pending.some(
      (c) =>
        (c.debtor_user_id === debtorUserId && c.creditor_user_id === cfg.creditor_user_id) ||
        (c.from_member_id === t.from && c.to_member_id === credMember.id)
    );
    out.push({
      debtorUserId,
      debtCents: t.amountCents,
      claimPending,
      dueAt: trip.dueAt ?? null,
      url: `/#/group/${trip.id}`,
      contextLabel: trip.name,
    });
  }
  return out;
}

async function userLabel(userId: string): Promise<string> {
  try {
    const u = await getUser(userId);
    if (u) {
      const su = await serializeUser(u);
      return su.displayName || su.handle || "someone";
    }
  } catch { /* generic label */ }
  return "someone";
}

/**
 * One engine pass: for every active config (optionally scoped), decide per
 * debtor and send at most one claimed nudge each. Every config is isolated in
 * try/catch (subscriptions.ts pattern). Returns the number of nudges sent.
 */
export async function runAutoNudgePass(filter?: {
  tripId?: string;
  tabUserIds?: [string, string];
}): Promise<number> {
  const nowMs = Date.now();
  let configs: ConfigRow[];
  try {
    configs = await listActiveConfigs();
  } catch {
    return 0;
  }
  if (filter?.tripId) {
    configs = configs.filter((c) => c.scope === "trip" && c.trip_id === filter.tripId);
  }
  if (filter?.tabUserIds) {
    const pair = new Set(filter.tabUserIds);
    configs = configs.filter(
      (c) => c.scope === "tab" && pair.has(c.creditor_user_id) && !!c.debtor_user_id && pair.has(c.debtor_user_id)
    );
  }

  let sent = 0;
  for (const cfg of configs) {
    try {
      const debts = await resolveDebts(cfg);
      for (const debt of debts) {
        const state = await getAutoNudgeSendState(cfg.id, debt.debtorUserId);
        const lastSentAt = state?.last_sent_at ?? null;
        const sendCount = state?.send_count ?? 0;
        const decision = decideAutoNudge({
          cadence: cfg.cadence,
          dueAt: debt.dueAt,
          lastSentAt,
          sendCount,
          debtCents: debt.debtCents,
          claimPending: debt.claimPending,
          debtorUserId: debt.debtorUserId,
          creditorUserId: cfg.creditor_user_id,
          nowMs,
        });
        if (!decision.send) continue;
        // Claim FIRST (CAS on the exact state we decided on) — winner sends.
        await ensureAutoNudgeSendRow(cfg.id, debt.debtorUserId);
        const nowIso = new Date().toISOString();
        const won = await claimAutoNudgeSend(cfg.id, debt.debtorUserId, lastSentAt, sendCount, nowIso);
        if (!won) continue;
        const label = await userLabel(cfg.creditor_user_id);
        void sendPush(debt.debtorUserId, {
          title: decision.stage >= 4 ? "🦆 mochi reminder" : "mochi reminder 🐸",
          body: `${nudgeBody(label, decision.stage)} — ${fmt(debt.debtCents)} on ${debt.contextLabel}`,
          url: debt.url,
          tag: `autonudge:${cfg.id}:${debt.debtorUserId}:${sendCount + 1}`,
        });
        // Land it in the existing notifications feed too (best-effort).
        try {
          await recordAutoNudge(cfg.creditor_user_id, debt.debtorUserId, cfg.trip_id);
        } catch { /* the push already went out */ }
        sent += 1;
      }
    } catch {
      /* one broken config never blocks the rest */
    }
  }
  return sent;
}

// ---- Serialization -------------------------------------------------------------

function serializeMine(cfg: ConfigRow, sends: SendRow[], nowMs: number) {
  const totalSent = sends.reduce((a, s) => a + s.send_count, 0);
  let lastSentAt: string | null = null;
  for (const s of sends) {
    if (s.last_sent_at && (!lastSentAt || s.last_sent_at > lastSentAt)) lastSentAt = s.last_sent_at;
  }
  return {
    cadence: cfg.cadence,
    dueAt: cfg.due_at,
    overdue: !!(cfg.due_at && new Date(cfg.due_at).getTime() <= nowMs),
    sendCount: totalSent,
    lastSentAt,
    nextAt: nextSendAt(cfg.cadence, cfg.due_at, lastSentAt, nowMs),
  };
}

// ---- Router ----------------------------------------------------------------------

export const autonudgeRouter = Router();

// Per-route requireAuth ONLY — mounted path-lessly (subscriptions.ts pattern).

/** Caller must be the trip owner or a claimed member (subscriptions.ts gate). */
function isTripParty(trip: Trip, userId: string): boolean {
  const isOwner = !!trip.ownerUserId && trip.ownerUserId === userId;
  const isMember = trip.members.some((m) => m.userId && m.userId === userId);
  return isOwner || isMember;
}

/**
 * GET /api/autonudge/tab/:friendUserId
 * Due date + cadence for the tab with this friend, both directions:
 *   mine   — what I (as creditor) configured for what they owe me;
 *   theirs — what the friend configured for what I owe them (date + cadence
 *            only, so the debtor sees "square up by fri · mochi will remind you").
 */
autonudgeRouter.get("/api/autonudge/tab/:friendUserId", requireAuth, async (req: Request, res: Response) => {
  const meId = req.userId as string;
  const friendId = req.params.friendUserId;
  if (!isSafeId(friendId) || friendId === meId) {
    return res.status(400).json({ error: "invalid friend id" });
  }
  // Lazy pass scoped to this pair (subscriptions.ts lazy-materialize pattern).
  try { await runAutoNudgePass({ tabUserIds: [meId, friendId] }); } catch { /* read still works */ }

  const nowMs = Date.now();
  const mine = await getConfig(tabConfigId(meId, friendId));
  const theirs = await getConfig(tabConfigId(friendId, meId));
  return res.json({
    mine: mine ? serializeMine(mine, await listSendStates(mine.id), nowMs) : null,
    theirs: theirs
      ? {
          cadence: theirs.cadence,
          dueAt: theirs.due_at,
          overdue: !!(theirs.due_at && new Date(theirs.due_at).getTime() <= nowMs),
        }
      : null,
  });
});

/**
 * PUT /api/autonudge/tab/:friendUserId { cadence?, dueAt? }
 * Creditor-side settings for this tab: a "square up by" date and/or Mochi's
 * cadence. Only fields provided change. The caller is ALWAYS the creditor of
 * the configured debt (the engine only ever nudges debts owed TO the config
 * owner), so a debtor can't aim nudges at themselves by construction.
 */
autonudgeRouter.put(
  "/api/autonudge/tab/:friendUserId",
  writeRateLimit,
  requireAuth,
  async (req: Request, res: Response) => {
    const meId = req.userId as string;
    const friendId = req.params.friendUserId;
    if (!isSafeId(friendId)) return res.status(400).json({ error: "invalid friend id" });
    if (friendId === meId) {
      return res.status(400).json({ error: "you can't auto-remind yourself" });
    }
    // Gate: the pair must actually have a tab. One shared response for a
    // missing user AND a stranger (strangers can't have entries), so this
    // route can't be used to probe which ids belong to real accounts.
    const friend = await getUser(friendId);
    const entries = friend ? await pairEntries(meId, friendId) : [];
    if (!friend || !entries.length) {
      return res.status(400).json({ error: "no tab with this friend yet — add an entry first" });
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const existing = await getConfig(tabConfigId(meId, friendId));

    let cadence = existing?.cadence ?? "off";
    if (body.cadence !== undefined) {
      if (!isCadence(body.cadence)) {
        return res.status(400).json({ error: "cadence must be off, gentle, standard, or spicy" });
      }
      cadence = body.cadence;
    }
    let dueAt = existing?.due_at ?? null;
    if (body.dueAt !== undefined) {
      const v = validateDueAt(body.dueAt, Date.now());
      if (!v.ok) return res.status(400).json({ error: v.error });
      dueAt = v.dueAt;
    }

    const nowIso = new Date().toISOString();
    const row: ConfigRow = {
      id: tabConfigId(meId, friendId),
      scope: "tab",
      trip_id: null,
      creditor_user_id: meId,
      debtor_user_id: friendId,
      cadence,
      due_at: dueAt,
      created_at: existing?.created_at ?? nowIso,
      updated_at: nowIso,
    };
    await upsertConfig(row);
    // No due date + cadence on = start immediately — fire the first pass now.
    try { await runAutoNudgePass({ tabUserIds: [meId, friendId] }); } catch { /* async engine will catch up */ }
    return res.json(serializeMine(row, await listSendStates(row.id), Date.now()));
  }
);

/**
 * GET /api/autonudge/tabs — all tab due/cadence configs touching me, for the
 * tabs/home list chips: [{ friendUserId, iAmCreditor, cadence, dueAt, overdue }].
 */
autonudgeRouter.get("/api/autonudge/tabs", requireAuth, async (req: Request, res: Response) => {
  const meId = req.userId as string;
  const rows = await listTabConfigsFor(meId);
  const nowMs = Date.now();
  return res.json({
    tabs: rows
      .filter((r) => r.debtor_user_id && (r.due_at || r.cadence !== "off"))
      .map((r) => {
        const iAmCreditor = r.creditor_user_id === meId;
        return {
          friendUserId: iAmCreditor ? (r.debtor_user_id as string) : r.creditor_user_id,
          iAmCreditor,
          cadence: r.cadence,
          dueAt: r.due_at,
          overdue: !!(r.due_at && new Date(r.due_at).getTime() <= nowMs),
        };
      }),
  });
});

/**
 * GET /api/autonudge/trip/:tripId — my auto-remind config for this group
 * (creditor-scoped; the group's due date itself lives on the trip).
 */
autonudgeRouter.get("/api/autonudge/trip/:tripId", requireAuth, async (req: Request, res: Response) => {
  const meId = req.userId as string;
  const tripId = req.params.tripId;
  if (!isSafeId(tripId)) return res.status(400).json({ error: "invalid id" });
  const trip = await getTrip(tripId);
  if (!trip || !isTripParty(trip, meId)) return res.status(404).json({ error: "not found" });
  try { await runAutoNudgePass({ tripId }); } catch { /* read still works */ }
  const mine = await getConfig(tripConfigId(tripId, meId));
  return res.json({
    mine: mine ? serializeMine(mine, await listSendStates(mine.id), Date.now()) : null,
    dueAt: trip.dueAt ?? null,
  });
});

/**
 * PUT /api/autonudge/trip/:tripId { cadence }
 * Opt this group's debts-owed-to-ME into Mochi's cadence. Requires a claimed
 * member slot (debts are computed against MY member); the group "settle by"
 * date is set via PATCH /api/trips/:id, owner/member gated there.
 */
autonudgeRouter.put(
  "/api/autonudge/trip/:tripId",
  writeRateLimit,
  requireAuth,
  async (req: Request, res: Response) => {
    const meId = req.userId as string;
    const tripId = req.params.tripId;
    if (!isSafeId(tripId)) return res.status(400).json({ error: "invalid id" });
    const trip = await getTrip(tripId);
    if (!trip || !isTripParty(trip, meId)) return res.status(404).json({ error: "not found" });
    if (!trip.members.some((m) => m.userId === meId)) {
      return res.status(400).json({ error: "claim your spot first so mochi knows who's owed" });
    }
    const body = (req.body || {}) as Record<string, unknown>;
    if (!isCadence(body.cadence)) {
      return res.status(400).json({ error: "cadence must be off, gentle, standard, or spicy" });
    }
    const existing = await getConfig(tripConfigId(tripId, meId));
    const nowIso = new Date().toISOString();
    const row: ConfigRow = {
      id: tripConfigId(tripId, meId),
      scope: "trip",
      trip_id: tripId,
      creditor_user_id: meId,
      debtor_user_id: null,
      cadence: body.cadence,
      due_at: null,
      created_at: existing?.created_at ?? nowIso,
      updated_at: nowIso,
    };
    await upsertConfig(row);
    try { await runAutoNudgePass({ tripId }); } catch { /* async engine will catch up */ }
    return res.json(serializeMine(row, await listSendStates(row.id), Date.now()));
  }
);

// ---- Self-scheduler (belt-and-suspenders) ------------------------------------
// Lazy passes on the GET/PUT routes cover active users; this catches debtors
// whose creditors haven't opened the app. unref() so it never holds the
// process open. Mirrors subscriptions.ts, including the overlap guard.
let schedulerRunning = false;
const timer = setInterval(() => {
  if (schedulerRunning) return; // don't let a slow pass overlap the next tick
  schedulerRunning = true;
  void (async () => {
    try {
      await runAutoNudgePass();
    } catch {
      /* ignore */
    } finally {
      schedulerRunning = false;
    }
  })();
}, 60000);
timer.unref?.();
