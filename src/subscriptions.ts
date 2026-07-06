/**
 * subscriptions.ts — Shared subscriptions (the group Netflix/Spotify/etc.).
 *
 * A SUBSCRIPTION is a recurring split with subscription framing: a service
 * (name + quick-pick icon), a monthly/yearly amount, a renewal DAY-OF-MONTH,
 * the member who pays the provider, and the members who split it (integer
 * share weights, default even). On each renewal we materialize the split into
 * the group's trip ledger (reusing trips.addExpense exactly like recurring.ts)
 * and nudge every member via the existing push machinery
 * ("🍿 netflix renews today — your share is $4.25").
 *
 * Why not a recurring.ts rule + metadata: recurring's advanceDue("monthly")
 * uses raw Date month arithmetic, which OVERFLOWS month-end (Jan 31 → Mar 3)
 * and then drifts forever, while a subscription must anchor to its renewal
 * day (31st → feb 28 → mar 31). Its shares can also be weighted — recurring's
 * even-only participants can't carry that. So this module owns a thin table
 * and mirrors recurring.ts's architecture instead: idempotent schema, dual
 * backend, CAS-claimed at-most-once materialization, catch-up cap, lazy
 * materialize on GET plus an unref'd self-scheduler.
 *
 * GUARDRAIL: ALL money is integer cents.
 *
 * Mount (integrator):
 *   import { subscriptionsRouter } from "./subscriptions";
 *   app.use(subscriptionsRouter);
 */

import * as crypto from "crypto";
import { Router, Request, Response } from "express";

import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { requireAuth } from "./auth";
import { getTrip, addExpense, listTripsForUser, Trip } from "./trips";
import { toCents, fmt, distributeWeighted } from "./split";
import { LEDGER_MAX_CENTS } from "./limits";
import { writeRateLimit } from "./ratelimit";
import { sendPush } from "./push";

// ---- Schema (idempotent) ---------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    trip_id TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    service TEXT,
    amount_cents INTEGER NOT NULL,
    interval TEXT NOT NULL,
    renewal_day INTEGER NOT NULL,
    payer_member_id TEXT NOT NULL,
    members TEXT NOT NULL,
    shares TEXT NOT NULL,
    next_renewal TEXT NOT NULL,
    created_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS subscription_renewals (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    period TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// ---- Renewal-date math (pure, testable) --------------------------------------

export type SubInterval = "monthly" | "yearly";

/** Days in a UTC month (monthIndex 0..11, any overflow normalized by Date). */
export function daysInMonth(yearUTC: number, monthIndexUTC: number): number {
  return new Date(Date.UTC(yearUTC, monthIndexUTC + 1, 0)).getUTCDate();
}

/**
 * Advance a renewal timestamp by one interval, ANCHORED to `renewalDay`:
 * short months clamp (the 31st renews feb 28 / apr 30) but the anchor never
 * drifts — the next long month snaps back to the 31st. This is exactly what
 * recurring.advanceDue("monthly") can't do (Date overflows Jan 31 + 1mo to
 * Mar 3 and stays wrong forever). Preserves the time-of-day. Throws on bad
 * input.
 */
export function advanceRenewal(iso: string, interval: SubInterval, renewalDay: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`advanceRenewal: invalid date ${iso}`);
  if (!Number.isInteger(renewalDay) || renewalDay < 1 || renewalDay > 31) {
    throw new Error(`advanceRenewal: renewal day must be 1..31, got ${renewalDay}`);
  }
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth();
  if (interval === "monthly") {
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  } else if (interval === "yearly") {
    y += 1;
  } else {
    throw new Error(`advanceRenewal: unknown interval ${interval}`);
  }
  const day = Math.min(renewalDay, daysInMonth(y, m));
  return new Date(
    Date.UTC(y, m, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())
  ).toISOString();
}

/**
 * First renewal moment for a new subscription: `renewalDay` of the current
 * UTC month (clamped to month length) if that day hasn't passed yet — a
 * renewal day of TODAY is due immediately, so "netflix renews today" lands on
 * creation day — otherwise the same (clamped) day next month.
 */
export function firstRenewal(now: Date, renewalDay: number): string {
  if (!Number.isInteger(renewalDay) || renewalDay < 1 || renewalDay > 31) {
    throw new Error(`firstRenewal: renewal day must be 1..31, got ${renewalDay}`);
  }
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const thisMonth = Date.UTC(y, m, Math.min(renewalDay, daysInMonth(y, m)));
  if (thisMonth >= Date.UTC(y, m, now.getUTCDate())) return new Date(thisMonth).toISOString();
  const ny = m === 11 ? y + 1 : y;
  const nm = (m + 1) % 12;
  return new Date(Date.UTC(ny, nm, Math.min(renewalDay, daysInMonth(ny, nm)))).toISOString();
}

// ---- Share math (pure, testable) ---------------------------------------------

/** A member's effective weight: their entry in the shares map, defaulting to 1. */
function effectiveWeight(shares: Record<string, number>, memberId: string): number {
  const w = shares[memberId];
  return Number.isInteger(w) && (w as number) > 0 ? (w as number) : 1;
}

/**
 * Per-member share of `amountCents` by integer weights (largest-remainder via
 * split.distributeWeighted), defaulting every unlisted member to weight 1.
 * The returned shares ALWAYS sum to `amountCents` exactly.
 */
export function shareCents(
  amountCents: number,
  memberIds: string[],
  shares: Record<string, number>
): Map<string, number> {
  if (memberIds.length === 0) throw new Error("shareCents: no members");
  const weights = memberIds.map((id) => effectiveWeight(shares, id));
  const parts = distributeWeighted(amountCents, weights);
  const out = new Map<string, number>();
  memberIds.forEach((id, i) => out.set(id, parts[i]));
  return out;
}

/** The fields nudge targeting needs — decoupled from the full trip member. */
export interface SubMemberLike {
  id: string;
  userId?: string | null;
}

/**
 * Who gets the renewal-day "your share is $X" push: every member with a
 * linked user account EXCEPT the payer (they front the provider, they don't
 * owe a share), deduped by userId (one person claiming two member slots gets
 * one push).
 */
export function nudgeTargets(
  members: SubMemberLike[],
  payerMemberId: string,
  perShare: Map<string, number>
): { userId: string; shareCents: number }[] {
  const seen = new Set<string>();
  const out: { userId: string; shareCents: number }[] = [];
  for (const m of members) {
    if (m.id === payerMemberId) continue;
    if (!m.userId) continue;
    if (seen.has(m.userId)) continue;
    seen.add(m.userId);
    out.push({ userId: m.userId, shareCents: perShare.get(m.id) ?? 0 });
  }
  return out;
}

// ---- Row hydration / serialization -----------------------------------------

interface SubscriptionRow {
  id: string;
  owner_user_id: string;
  trip_id: string;
  name: string;
  icon: string | null;
  service: string | null;
  amount_cents: number;
  interval: string;
  renewal_day: number;
  payer_member_id: string;
  members: string; // JSON array of trip member ids
  shares: string; // JSON object memberId -> integer weight
  next_renewal: string;
  created_at: string;
  active: number;
}

interface RenewalRow {
  id: string;
  subscription_id: string;
  amount_cents: number;
  period: string;
  created_at: string;
}

/**
 * Normalize a row from either backend into the in-memory shape. Like
 * recurring.mapRow: SQLite stores `members`/`shares` as JSON strings,
 * Supabase as JSONB values.
 */
function mapRow(raw: Record<string, unknown>): SubscriptionRow {
  return {
    id: String(raw.id),
    owner_user_id: String(raw.owner_user_id),
    trip_id: String(raw.trip_id),
    name: String(raw.name),
    icon: (raw.icon as string | null) ?? null,
    service: (raw.service as string | null) ?? null,
    amount_cents: Number(raw.amount_cents),
    interval: String(raw.interval),
    renewal_day: Number(raw.renewal_day),
    payer_member_id: String(raw.payer_member_id),
    members: typeof raw.members === "string" ? raw.members : JSON.stringify(raw.members ?? []),
    shares: typeof raw.shares === "string" ? raw.shares : JSON.stringify(raw.shares ?? {}),
    next_renewal: String(raw.next_renewal),
    created_at: String(raw.created_at),
    active: Number(raw.active),
  };
}

/** Monthly-normalized cents (yearly amounts averaged across 12 months). */
function monthlyCentsOf(amountCents: number, interval: string): number {
  return interval === "yearly" ? Math.round(amountCents / 12) : amountCents;
}

/**
 * Serialize one subscription for the client, hydrating member identities +
 * per-member shares from the trip. `viewerUserId` drives `yourShareCents`
 * (the share of the trip member the viewer has claimed) and `canEdit`.
 */
async function serialize(
  row: SubscriptionRow,
  viewerUserId: string,
  tripCache?: Map<string, Trip>
): Promise<Record<string, unknown>> {
  const trip = tripCache?.get(row.trip_id) ?? (await getTrip(row.trip_id));
  const tripMembers = new Map((trip ? trip.members : []).map((m) => [m.id, m]));
  const memberIds = (JSON.parse(row.members) as string[]).filter((id) => tripMembers.has(id));
  const shares = JSON.parse(row.shares) as Record<string, number>;
  const perShare = memberIds.length ? shareCents(row.amount_cents, memberIds, shares) : new Map<string, number>();

  let yourShareCents: number | null = null;
  const members = memberIds.map((id) => {
    const m = tripMembers.get(id) as Trip["members"][number];
    const cents = perShare.get(id) as number;
    if (m.userId && m.userId === viewerUserId && yourShareCents == null) yourShareCents = cents;
    return {
      id: m.id,
      name: m.name,
      emoji: m.emoji,
      color: m.color,
      userId: m.userId || null,
      shareCents: cents,
      shareFmt: fmt(cents),
      weight: effectiveWeight(shares, id),
      isPayer: m.id === row.payer_member_id,
    };
  });

  return {
    id: row.id,
    tripId: row.trip_id,
    tripName: trip ? trip.name : null,
    name: row.name,
    icon: row.icon,
    service: row.service,
    amountCents: row.amount_cents,
    amountFmt: fmt(row.amount_cents),
    monthlyCents: monthlyCentsOf(row.amount_cents, row.interval),
    interval: row.interval,
    renewalDay: row.renewal_day,
    payerMemberId: row.payer_member_id,
    members,
    yourShareCents,
    yourShareFmt: yourShareCents == null ? null : fmt(yourShareCents),
    nextRenewal: row.next_renewal,
    createdAt: row.created_at,
    canEdit: row.owner_user_id === viewerUserId,
  };
}

// ---- Data access (dual backend) --------------------------------------------

/** Fetch one subscription by id (regardless of owner/active). */
async function getSub(id: string): Promise<SubscriptionRow | undefined> {
  if (usingSupabase) {
    const { data, error } = await supabase().from("subscriptions").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`subscriptions.getSub: ${error.message}`);
    return data ? mapRow(data) : undefined;
  }
  const row = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapRow(row) : undefined;
}

/** Fetch one ACTIVE subscription owned by `userId`, by id. */
async function getOwnedActiveSub(id: string, userId: string): Promise<SubscriptionRow | undefined> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("subscriptions")
      .select("*")
      .eq("id", id)
      .eq("owner_user_id", userId)
      .eq("active", 1)
      .maybeSingle();
    if (error) throw new Error(`subscriptions.getOwnedActiveSub: ${error.message}`);
    return data ? mapRow(data) : undefined;
  }
  const row = db
    .prepare("SELECT * FROM subscriptions WHERE id = ? AND owner_user_id = ? AND active = 1")
    .get(id, userId) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : undefined;
}

/** Insert a new subscription row. */
async function insertSub(row: {
  id: string;
  owner_user_id: string;
  trip_id: string;
  name: string;
  icon: string | null;
  service: string | null;
  amount_cents: number;
  interval: string;
  renewal_day: number;
  payer_member_id: string;
  members: string[];
  shares: Record<string, number>;
  next_renewal: string;
  created_at: string;
}): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase().from("subscriptions").insert({
      id: row.id,
      owner_user_id: row.owner_user_id,
      trip_id: row.trip_id,
      name: row.name,
      icon: row.icon,
      service: row.service,
      amount_cents: row.amount_cents,
      interval: row.interval,
      renewal_day: row.renewal_day,
      payer_member_id: row.payer_member_id,
      members: row.members, // JSONB: pass the array directly
      shares: row.shares, // JSONB: pass the object directly
      next_renewal: row.next_renewal,
      created_at: row.created_at,
      active: 1,
    });
    if (error) throw new Error(`subscriptions.insertSub: ${error.message}`);
    return;
  }
  db.prepare(
    `INSERT INTO subscriptions
       (id, owner_user_id, trip_id, name, icon, service, amount_cents, interval,
        renewal_day, payer_member_id, members, shares, next_renewal, created_at, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(
    row.id,
    row.owner_user_id,
    row.trip_id,
    row.name,
    row.icon,
    row.service,
    row.amount_cents,
    row.interval,
    row.renewal_day,
    row.payer_member_id,
    JSON.stringify(row.members),
    JSON.stringify(row.shares),
    row.next_renewal,
    row.created_at
  );
}

/**
 * Active subscriptions the viewer can see: ones they created OR ones attached
 * to a trip they're in (`tripIds` comes from trips.listTripsForUser — server-
 * derived, never client input). Newest first.
 */
async function listActiveForViewer(userId: string, tripIds: string[]): Promise<SubscriptionRow[]> {
  if (usingSupabase) {
    const byId = new Map<string, SubscriptionRow>();
    const { data: own, error } = await supabase()
      .from("subscriptions")
      .select("*")
      .eq("active", 1)
      .eq("owner_user_id", userId);
    if (error) throw new Error(`subscriptions.listActiveForViewer: ${error.message}`);
    for (const r of own ?? []) byId.set(String((r as Record<string, unknown>).id), mapRow(r));
    if (tripIds.length) {
      const { data: shared, error: e2 } = await supabase()
        .from("subscriptions")
        .select("*")
        .eq("active", 1)
        .in("trip_id", tripIds);
      if (e2) throw new Error(`subscriptions.listActiveForViewer: ${e2.message}`);
      for (const r of shared ?? []) byId.set(String((r as Record<string, unknown>).id), mapRow(r));
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
    );
  }
  const placeholders = tripIds.map(() => "?").join(", ");
  const rows = (
    tripIds.length
      ? db
          .prepare(
            `SELECT * FROM subscriptions
             WHERE active = 1 AND (owner_user_id = ? OR trip_id IN (${placeholders}))
             ORDER BY created_at DESC, rowid DESC`
          )
          .all(userId, ...tripIds)
      : db
          .prepare("SELECT * FROM subscriptions WHERE active = 1 AND owner_user_id = ? ORDER BY created_at DESC, rowid DESC")
          .all(userId)
  ) as Record<string, unknown>[];
  return rows.map(mapRow);
}

/** Subscriptions eligible for materialization (active), optionally one owner's. */
async function listDueCandidates(ownerUserId?: string): Promise<SubscriptionRow[]> {
  if (usingSupabase) {
    let q = supabase().from("subscriptions").select("*").eq("active", 1);
    if (ownerUserId) q = q.eq("owner_user_id", ownerUserId);
    const { data, error } = await q;
    if (error) throw new Error(`subscriptions.listDueCandidates: ${error.message}`);
    return (data ?? []).map(mapRow);
  }
  const rows = (
    ownerUserId
      ? db.prepare("SELECT * FROM subscriptions WHERE active = 1 AND owner_user_id = ?").all(ownerUserId)
      : db.prepare("SELECT * FROM subscriptions WHERE active = 1").all()
  ) as Record<string, unknown>[];
  return rows.map(mapRow);
}

/**
 * Atomically CLAIM one renewal: advance next_renewal from `from` → `to` ONLY
 * if it still equals `from`. Same CAS as recurring.claimNextDue — it makes
 * materialization at-most-once per period even when the self-scheduler and a
 * lazy GET race, so a renewal is never double-billed to the group.
 */
async function claimNextRenewal(id: string, from: string, to: string): Promise<boolean> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("subscriptions")
      .update({ next_renewal: to })
      .eq("id", id)
      .eq("next_renewal", from)
      .select("id");
    if (error) throw new Error(`subscriptions.claimNextRenewal: ${error.message}`);
    return !!data && data.length > 0;
  }
  const res = db
    .prepare("UPDATE subscriptions SET next_renewal = ? WHERE id = ? AND next_renewal = ?")
    .run(to, id, from);
  return res.changes > 0;
}

/** Soft-delete (deactivate) one subscription, unconditionally. */
async function deactivateSub(id: string): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase().from("subscriptions").update({ active: 0 }).eq("id", id);
    if (error) throw new Error(`subscriptions.deactivateSub: ${error.message}`);
    return;
  }
  db.prepare("UPDATE subscriptions SET active = 0 WHERE id = ?").run(id);
}

/** Soft-delete one ACTIVE subscription owned by `userId`. True iff a row changed. */
async function deleteOwnedSub(id: string, userId: string): Promise<boolean> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("subscriptions")
      .update({ active: 0 })
      .eq("id", id)
      .eq("owner_user_id", userId)
      .eq("active", 1)
      .select("id");
    if (error) throw new Error(`subscriptions.deleteOwnedSub: ${error.message}`);
    return (data ?? []).length > 0;
  }
  const info = db
    .prepare("UPDATE subscriptions SET active = 0 WHERE id = ? AND owner_user_id = ? AND active = 1")
    .run(id, userId);
  return info.changes > 0;
}

/**
 * Apply a dynamic field update, then return the fresh row. `fields` keys are
 * snake_case columns; `members`/`shares`, if present, are JS values (this
 * layer handles the per-backend serialization). Mirrors
 * recurring.updateRuleFields.
 */
async function updateSubFields(id: string, fields: Record<string, unknown>): Promise<SubscriptionRow> {
  if (usingSupabase) {
    const { error } = await supabase().from("subscriptions").update({ ...fields }).eq("id", id);
    if (error) throw new Error(`subscriptions.updateSubFields: ${error.message}`);
    const { data, error: selErr } = await supabase()
      .from("subscriptions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (selErr) throw new Error(`subscriptions.updateSubFields(select): ${selErr.message}`);
    return mapRow(data as Record<string, unknown>);
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [col, value] of Object.entries(fields)) {
    sets.push(`${col} = ?`);
    // SQLite: members/shares columns store JSON strings.
    vals.push(col === "members" || col === "shares" ? JSON.stringify(value) : value);
  }
  vals.push(id);
  db.prepare(`UPDATE subscriptions SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as any[]));
  return mapRow(db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id) as Record<string, unknown>);
}

/** Record one materialized renewal (drives the detail screen's history). */
async function insertRenewal(row: RenewalRow): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase().from("subscription_renewals").insert({
      id: row.id,
      subscription_id: row.subscription_id,
      amount_cents: row.amount_cents,
      period: row.period,
      created_at: row.created_at,
    });
    if (error) throw new Error(`subscriptions.insertRenewal: ${error.message}`);
    return;
  }
  db.prepare(
    `INSERT INTO subscription_renewals (id, subscription_id, amount_cents, period, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(row.id, row.subscription_id, row.amount_cents, row.period, row.created_at);
}

/** Renewal history for one subscription, newest first, capped. */
async function listRenewals(subscriptionId: string, limit: number): Promise<RenewalRow[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("subscription_renewals")
      .select("*")
      .eq("subscription_id", subscriptionId)
      .order("period", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`subscriptions.listRenewals: ${error.message}`);
    return (data as RenewalRow[]) ?? [];
  }
  return db
    .prepare(
      `SELECT * FROM subscription_renewals WHERE subscription_id = ?
       ORDER BY period DESC, rowid DESC LIMIT ?`
    )
    .all(subscriptionId, limit) as RenewalRow[];
}

// ---- Materialize -----------------------------------------------------------

const MAX_CATCHUP = 12; // cap catch-up iterations per subscription per pass
const NUDGE_FRESH_MS = 48 * 3600 * 1000; // only nudge renewals from the last 48h

/**
 * Materialize one claimed renewal: append the split to the trip's ledger,
 * record the renewal, and push the renewal-day nudge. Even shares become a
 * single evenly-split expense (identical to what recurring.ts would append);
 * weighted shares become one exact per-member expense each (the trip expense
 * model only splits evenly), skipping the payer's own share.
 */
async function renewOnce(row: SubscriptionRow, period: string, nowMs: number): Promise<void> {
  const trip = await getTrip(row.trip_id);
  if (!trip) throw new Error("renewOnce: trip gone");
  const tripMemberIds = new Set(trip.members.map((m) => m.id));
  const memberIds = (JSON.parse(row.members) as string[]).filter((id) => tripMemberIds.has(id));
  if (!memberIds.length || !tripMemberIds.has(row.payer_member_id)) {
    throw new Error("renewOnce: members gone");
  }
  const shares = JSON.parse(row.shares) as Record<string, number>;
  const perShare = shareCents(row.amount_cents, memberIds, shares);
  const title = `${row.icon ? row.icon + " " : ""}${row.name}`;

  const w0 = effectiveWeight(shares, memberIds[0]);
  const even = memberIds.every((id) => effectiveWeight(shares, id) === w0);
  if (even) {
    await addExpense(row.trip_id, {
      title,
      amountCents: row.amount_cents,
      paidBy: row.payer_member_id,
      participants: memberIds,
    });
  } else {
    for (const id of memberIds) {
      if (id === row.payer_member_id) continue;
      const cents = perShare.get(id) as number;
      if (cents > 0) {
        await addExpense(row.trip_id, {
          title,
          amountCents: cents,
          paidBy: row.payer_member_id,
          participants: [id],
        });
      }
    }
  }

  await insertRenewal({
    id: crypto.randomUUID(),
    subscription_id: row.id,
    amount_cents: row.amount_cents,
    period,
    created_at: new Date().toISOString(),
  });

  // Renewal-day nudge — only for a FRESH renewal. A backlog catch-up after a
  // long-idle server must not fire months of stale "renews today" pushes.
  if (nowMs - new Date(period).getTime() <= NUDGE_FRESH_MS) {
    const label = String(row.name).toLowerCase();
    const prefix = row.icon ? row.icon + " " : "";
    const subMembers = trip.members.filter((m) => memberIds.includes(m.id));
    for (const t of nudgeTargets(subMembers, row.payer_member_id, perShare)) {
      void sendPush(t.userId, {
        title: "renewal day 🔁",
        body: `${prefix}${label} renews today — your share is ${fmt(t.shareCents)}`,
        url: "/#/subscriptions",
        tag: `sub:${row.id}:${period}`,
      });
    }
    // The payer fronts the provider — tell them the split landed on the tab.
    const payer = trip.members.find((m) => m.id === row.payer_member_id);
    if (payer && payer.userId) {
      void sendPush(payer.userId, {
        title: "renewal day 🔁",
        body: `${prefix}${label} renews today — ${fmt(row.amount_cents)} went on ${trip.name}`,
        url: "/#/subscriptions",
        tag: `sub:${row.id}:${period}`,
      });
    }
  }
}

/**
 * For each active subscription (optionally one owner's) whose next_renewal
 * has passed, materialize the split and advance, catching up to MAX_CATCHUP
 * periods. Each subscription is isolated in try/catch; one whose trip/members
 * vanished is deactivated so it stops being retried (recurring.ts pattern).
 * Returns the number of renewals materialized.
 */
export async function materializeDueSubscriptions(ownerUserId?: string): Promise<number> {
  const now = Date.now();
  const rows = await listDueCandidates(ownerUserId);

  let materialized = 0;

  for (const row of rows) {
    try {
      let nextRenewal = row.next_renewal;
      let iterations = 0;
      while (new Date(nextRenewal).getTime() <= now && iterations < MAX_CATCHUP) {
        const advanced = advanceRenewal(nextRenewal, row.interval as SubInterval, row.renewal_day);
        // Claim this period FIRST (atomic CAS). Losing means another pass
        // already materialized it — stop, do NOT double-bill the group.
        const won = await claimNextRenewal(row.id, nextRenewal, advanced);
        if (!won) break;
        await renewOnce(row, nextRenewal, now);
        nextRenewal = advanced;
        materialized += 1;
        iterations += 1;
      }
    } catch {
      try {
        await deactivateSub(row.id);
      } catch {
        /* best effort */
      }
    }
  }

  return materialized;
}

// ---- Input validation --------------------------------------------------------

const MAX_AMOUNT_CENTS = LEDGER_MAX_CENTS; // shared env-tunable cap (src/limits.ts)
const MAX_NAME = 80;
const MAX_ICON = 16;
const MAX_SERVICE = 32;
const MAX_WEIGHT = 1000;

/** Ids are crypto.randomUUID()s — enforce the shape defensively (tabs.ts). */
function isSafeId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v);
}

/** Caller must be the trip owner or a claimed member (recurring.ts gate). */
function isTripParty(trip: Trip, userId: string): boolean {
  const isOwner = !!trip.ownerUserId && trip.ownerUserId === userId;
  const isMember = trip.members.some((m) => m.userId && m.userId === userId);
  return isOwner || isMember;
}

/**
 * Validate a members + shares pair against the trip. Returns the deduped
 * member id list and pruned shares map, or an error string.
 */
function checkMembersAndShares(
  trip: Trip,
  membersIn: unknown,
  sharesIn: unknown
): { members: string[]; shares: Record<string, number> } | { error: string } {
  const memberIds = new Set(trip.members.map((m) => m.id));

  let members: string[];
  if (membersIn == null) {
    members = trip.members.map((m) => m.id);
  } else {
    if (!Array.isArray(membersIn) || membersIn.length === 0) {
      return { error: "members must be a non-empty array of trip member ids" };
    }
    members = Array.from(new Set(membersIn.map((m: unknown) => String(m))));
    for (const m of members) {
      if (!isSafeId(m) || !memberIds.has(m)) return { error: `member ${m} is not a trip member` };
    }
  }

  const shares: Record<string, number> = {};
  if (sharesIn != null) {
    if (typeof sharesIn !== "object" || Array.isArray(sharesIn)) {
      return { error: "shares must be an object of memberId -> integer weight" };
    }
    const inSub = new Set(members);
    for (const [k, v] of Object.entries(sharesIn as Record<string, unknown>)) {
      if (!inSub.has(k)) return { error: `share key ${k} is not a subscription member` };
      const w = Number(v);
      if (!Number.isInteger(w) || w < 1 || w > MAX_WEIGHT) {
        return { error: `share weights must be integers 1..${MAX_WEIGHT}` };
      }
      shares[k] = w;
    }
  }

  return { members, shares };
}

// ---- Router ----------------------------------------------------------------

export const subscriptionsRouter = Router();

// Per-route requireAuth ONLY — this router is mounted path-lessly
// (app.use(subscriptionsRouter)); a router-wide guard would gate the whole app.

subscriptionsRouter.post("/api/subscriptions", writeRateLimit, requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const body = (req.body || {}) as Record<string, unknown>;

  const tripId = String(body.tripId || "");
  const trip = await getTrip(tripId);
  if (!trip) {
    res.status(404).json({ error: "trip not found" });
    return;
  }
  if (!isTripParty(trip, userId)) {
    res.status(403).json({ error: "not authorized for this trip" });
    return;
  }

  // Amount: amountCents takes precedence; otherwise derive from `total` dollars.
  let amountCents: number;
  try {
    amountCents = body.amountCents != null ? Number(body.amountCents) : toCents(body.total as number | string);
  } catch {
    res.status(400).json({ error: "invalid amount" });
    return;
  }
  if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > MAX_AMOUNT_CENTS) {
    res.status(400).json({ error: `amountCents must be an integer between 1 and ${MAX_AMOUNT_CENTS}` });
    return;
  }

  const name = String(body.name || "").trim();
  if (name.length < 1 || name.length > MAX_NAME) {
    res.status(400).json({ error: `name must be 1..${MAX_NAME} chars` });
    return;
  }
  const icon = body.icon != null ? String(body.icon).trim() : "";
  if (icon.length > MAX_ICON) {
    res.status(400).json({ error: `icon must be at most ${MAX_ICON} chars` });
    return;
  }
  const service = body.service != null ? String(body.service).trim().toLowerCase() : "";
  if (service.length > MAX_SERVICE) {
    res.status(400).json({ error: `service must be at most ${MAX_SERVICE} chars` });
    return;
  }

  const interval = body.interval == null ? "monthly" : String(body.interval);
  if (interval !== "monthly" && interval !== "yearly") {
    res.status(400).json({ error: 'interval must be "monthly" or "yearly"' });
    return;
  }

  const renewalDay = body.renewalDay == null ? new Date().getUTCDate() : Number(body.renewalDay);
  if (!Number.isInteger(renewalDay) || renewalDay < 1 || renewalDay > 31) {
    res.status(400).json({ error: "renewalDay must be an integer 1..31" });
    return;
  }

  const payerMemberId = String(body.payerMemberId || "");
  if (!trip.members.some((m) => m.id === payerMemberId)) {
    res.status(400).json({ error: "payerMemberId must be a trip member" });
    return;
  }

  const checked = checkMembersAndShares(trip, body.members, body.shares);
  if ("error" in checked) {
    res.status(400).json({ error: checked.error });
    return;
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await insertSub({
    id,
    owner_user_id: userId,
    trip_id: tripId,
    name,
    icon: icon || null,
    service: service || null,
    amount_cents: amountCents,
    interval,
    renewal_day: renewalDay,
    payer_member_id: payerMemberId,
    members: checked.members,
    shares: checked.shares,
    next_renewal: firstRenewal(new Date(), renewalDay),
    created_at: createdAt,
  });

  // A renewal day of today is due immediately — materialize it so the split
  // (and the "renews today" nudge) lands right away instead of in ≤60s.
  try {
    await materializeDueSubscriptions(userId);
  } catch {
    /* never let materialization break the create */
  }

  const row = (await getSub(id)) as SubscriptionRow;
  res.json(await serialize(row, userId));
});

subscriptionsRouter.get("/api/subscriptions", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  // Lazy materialize first so the list reflects renewals that just passed.
  try {
    await materializeDueSubscriptions(userId);
  } catch {
    /* never let materialization break the read */
  }
  const trips = await listTripsForUser(userId);
  const tripCache = new Map(trips.map((t) => [t.id, t]));
  const rows = await listActiveForViewer(userId, trips.map((t) => t.id));
  const subscriptions = await Promise.all(rows.map((r) => serialize(r, userId, tripCache)));

  // "your subscriptions cost you $X/mo": the viewer's share where they've
  // claimed a member slot, monthly-normalized; plus the full monthly total.
  let monthlyCents = 0;
  let yourMonthlyCents = 0;
  for (const s of subscriptions) {
    monthlyCents += s.monthlyCents as number;
    const share = s.yourShareCents as number | null;
    if (share != null) {
      yourMonthlyCents += (s.interval as string) === "yearly" ? Math.round(share / 12) : share;
    }
  }

  res.json({
    subscriptions,
    totals: {
      monthlyCents,
      monthlyFmt: fmt(monthlyCents),
      yourMonthlyCents,
      yourMonthlyFmt: fmt(yourMonthlyCents),
    },
  });
});

subscriptionsRouter.get("/api/subscriptions/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  if (!isSafeId(req.params.id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const row = await getSub(req.params.id);
  if (!row || !row.active) {
    res.status(404).json({ error: "not found" });
    return;
  }
  // Visible to the creator and to the trip's parties only (no id probing).
  const trip = await getTrip(row.trip_id);
  const allowed = row.owner_user_id === userId || (trip ? isTripParty(trip, userId) : false);
  if (!allowed) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const renewals = (await listRenewals(row.id, 12)).map((r) => ({
    id: r.id,
    period: r.period,
    amountCents: r.amount_cents,
    amountFmt: fmt(r.amount_cents),
    createdAt: r.created_at,
  }));
  res.json({ ...(await serialize(row, userId)), renewals });
});

/**
 * PATCH /api/subscriptions/:id — edit fields in place (creator only).
 *   { name?, icon?, service?, amountCents?, interval?, renewalDay?,
 *     payerMemberId?, members?, shares? }
 * A renewalDay change re-anchors next_renewal to the next occurrence of the
 * new day. A single UPDATE keeps the edit atomic (recurring.ts PATCH pattern).
 */
subscriptionsRouter.patch("/api/subscriptions/:id", writeRateLimit, requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  if (!isSafeId(req.params.id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const body = (req.body || {}) as Record<string, unknown>;
  const row = await getOwnedActiveSub(req.params.id, userId);
  if (!row) {
    res.status(404).json({ error: "subscription not found" });
    return;
  }

  const trip = await getTrip(row.trip_id);
  if (!trip) {
    res.status(404).json({ error: "trip not found" });
    return;
  }

  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 1 || name.length > MAX_NAME) {
      res.status(400).json({ error: `name must be 1..${MAX_NAME} chars` });
      return;
    }
    updates.name = name;
  }
  if (body.icon !== undefined) {
    const icon = String(body.icon).trim();
    if (icon.length > MAX_ICON) {
      res.status(400).json({ error: `icon must be at most ${MAX_ICON} chars` });
      return;
    }
    updates.icon = icon || null;
  }
  if (body.service !== undefined) {
    const service = String(body.service).trim().toLowerCase();
    if (service.length > MAX_SERVICE) {
      res.status(400).json({ error: `service must be at most ${MAX_SERVICE} chars` });
      return;
    }
    updates.service = service || null;
  }
  if (body.amountCents !== undefined) {
    const a = Number(body.amountCents);
    if (!Number.isInteger(a) || a < 1 || a > MAX_AMOUNT_CENTS) {
      res.status(400).json({ error: `amountCents must be an integer between 1 and ${MAX_AMOUNT_CENTS}` });
      return;
    }
    updates.amount_cents = a;
  }
  if (body.interval !== undefined) {
    const interval = String(body.interval);
    if (interval !== "monthly" && interval !== "yearly") {
      res.status(400).json({ error: 'interval must be "monthly" or "yearly"' });
      return;
    }
    updates.interval = interval;
  }
  if (body.renewalDay !== undefined) {
    const day = Number(body.renewalDay);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      res.status(400).json({ error: "renewalDay must be an integer 1..31" });
      return;
    }
    updates.renewal_day = day;
    updates.next_renewal = firstRenewal(new Date(), day);
  }
  if (body.payerMemberId !== undefined) {
    const pm = String(body.payerMemberId);
    if (!trip.members.some((m) => m.id === pm)) {
      res.status(400).json({ error: "payerMemberId must be a trip member" });
      return;
    }
    updates.payer_member_id = pm;
  }
  if (body.members !== undefined || body.shares !== undefined) {
    const checked = checkMembersAndShares(
      trip,
      body.members !== undefined ? body.members : (JSON.parse(row.members) as string[]),
      body.shares !== undefined ? body.shares : JSON.parse(row.shares)
    );
    if ("error" in checked) {
      res.status(400).json({ error: checked.error });
      return;
    }
    updates.members = checked.members;
    updates.shares = checked.shares;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "nothing to update" });
    return;
  }

  const updated = await updateSubFields(row.id, updates);
  res.json(await serialize(updated, userId));
});

subscriptionsRouter.delete("/api/subscriptions/:id", writeRateLimit, requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  if (!isSafeId(req.params.id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const changed = await deleteOwnedSub(req.params.id, userId);
  if (!changed) {
    res.status(404).json({ error: "subscription not found" });
    return;
  }
  res.json({ ok: true });
});

// ---- Self-scheduler (belt-and-suspenders) ----------------------------------
// Lazy materialize on GET covers active users; this one catches renewals whose
// owners haven't opened the app (the renewal-day nudge must still fire).
// unref() so it never holds the process open. Mirrors recurring.ts.
let schedulerRunning = false;
const timer = setInterval(() => {
  if (schedulerRunning) return; // don't let a slow pass overlap the next tick
  schedulerRunning = true;
  void (async () => {
    try {
      await materializeDueSubscriptions();
    } catch {
      /* ignore */
    } finally {
      schedulerRunning = false;
    }
  })();
}, 60000);
timer.unref?.();
