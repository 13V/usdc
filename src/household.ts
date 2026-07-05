/**
 * household.ts — The roommates "household hub" (rent + utilities +
 * subscriptions in one monthly view).
 *
 * A household is an ordinary Trip flagged kind="household". The hub is a pure
 * FRAMING layer: it AGGREGATES what already exists — recurring.ts rules tied
 * to the trip (rent, utilities), subscriptions.ts subscriptions tied to the
 * trip, and the trip's own ledger (to tell "posted this month" from
 * "upcoming") — it owns no parallel bill store.
 *
 * Proration: when a member moves in/out mid-month (trip_members.moved_in_at /
 * moved_out_at, day granularity), that month's recurring charges split by
 * days-in-residence instead of evenly. This module prorates the hub's
 * "your share" DISPLAY and offers a one-tap adjust that rewrites one posted
 * even-split expense into exact per-member prorated expenses (the same
 * per-member-expense trick subscriptions.ts uses for weighted shares).
 * recurring.ts materialization itself stays untouched — rent usually posts on
 * the 1st BEFORE anyone records a mid-month move, so ledger-time proration
 * would still need this adjustment path anyway; one mechanism, one truth.
 *
 * GUARDRAIL: ALL money is integer cents; prorated shares ALWAYS sum exactly
 * to the amount being split (largest-remainder via split.distributeWeighted).
 *
 * Mount (integrator):
 *   import { householdRouter } from "./household";
 *   app.use(householdRouter);
 */

import { Router, Request, Response } from "express";

import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { requireAuth } from "./auth";
import {
  getTrip,
  addExpense,
  deleteExpense,
  updateTrip,
  setMemberResidency,
  Trip,
} from "./trips";
import { fmt, distributeEven, distributeWeighted } from "./split";
import { daysInMonth, shareCents } from "./subscriptions";
import { writeRateLimit } from "./ratelimit";

// ---- Proration math (pure, testable) ----------------------------------------

/** UTC-midnight ms of an ISO date's calendar day, or NaN if unparseable. */
export function dayUTC(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NaN;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const DAY_MS = 86400000;

/**
 * Days a member is resident during a UTC month, given optional move-in /
 * move-out dates (both INCLUSIVE, day granularity). No dates = the full
 * month; a same-day move in+out = 1 day; a window that misses the month
 * entirely = 0. Unparseable dates are ignored (treated as unset) — bad
 * metadata must never zero someone's rent.
 */
export function residentDays(
  yearUTC: number,
  monthIndexUTC: number,
  movedInAt?: string | null,
  movedOutAt?: string | null
): number {
  const dim = daysInMonth(yearUTC, monthIndexUTC);
  let from = Date.UTC(yearUTC, monthIndexUTC, 1);
  let to = Date.UTC(yearUTC, monthIndexUTC, dim);
  if (movedInAt) {
    const t = dayUTC(movedInAt);
    if (!Number.isNaN(t) && t > from) from = t;
  }
  if (movedOutAt) {
    const t = dayUTC(movedOutAt);
    if (!Number.isNaN(t) && t < to) to = t;
  }
  if (to < from) return 0;
  return Math.round((to - from) / DAY_MS) + 1;
}

/**
 * Split `amountCents` across members by days-in-residence: integer cents,
 * largest-remainder, summing EXACTLY to amountCents (zero-sum: no penny lost
 * or created). Members with 0 days get exactly 0 and carry no weight. Equal
 * days for everyone degrades to the ledger's even split (distributeEven
 * order). Throws if NO member has a positive day count.
 */
export function prorateByDays(
  amountCents: number,
  entries: { id: string; days: number }[]
): Map<string, number> {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error(`prorateByDays: expected non-negative integer cents, got ${amountCents}`);
  }
  const out = new Map<string, number>(entries.map((e) => [e.id, 0]));
  const live = entries.filter((e) => Number.isFinite(e.days) && e.days > 0);
  if (live.length === 0) throw new Error("prorateByDays: no resident participants");
  const parts = distributeWeighted(amountCents, live.map((e) => e.days));
  live.forEach((e, i) => out.set(e.id, parts[i]));
  return out;
}

/** Monthly-normalized cents for a recurring interval (hub is a monthly view). */
export function monthlyizeCents(amountCents: number, interval: string): number {
  if (interval === "yearly") return Math.round(amountCents / 12);
  if (interval === "weekly") return Math.round((amountCents * 52) / 12);
  const m = /^(\d+)d$/.exec(interval);
  if (m) {
    const n = Number(m[1]);
    if (n > 0) return Math.round((amountCents * 30) / n);
  }
  return amountCents; // "monthly" and anything unknown
}

// ---- Validation (pure, testable) ---------------------------------------------

/**
 * Validate a move-in/move-out date from the client. null/""/undefined clears
 * (ok, iso null); otherwise it must parse and land in a sane year (2000..2100
 * — a typo'd year must not silently zero someone's rent share). Normalizes to
 * "YYYY-MM-DD" (day granularity is all proration uses).
 */
export function validateMoveDate(
  v: unknown
): { ok: true; iso: string | null } | { ok: false; error: string } {
  if (v === null || v === undefined || v === "") return { ok: true, iso: null };
  if (typeof v !== "string" && typeof v !== "number") {
    return { ok: false, error: "date must be a string" };
  }
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return { ok: false, error: "not a valid date" };
  const y = d.getUTCFullYear();
  if (y < 2000 || y > 2100) return { ok: false, error: "date out of range" };
  return { ok: true, iso: d.toISOString().slice(0, 10) };
}

/** True iff the residency window is coherent (out on/after in, when both set). */
export function residencyPairOk(
  movedInAt?: string | null,
  movedOutAt?: string | null
): boolean {
  if (!movedInAt || !movedOutAt) return true;
  const a = dayUTC(movedInAt);
  const b = dayUTC(movedOutAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return true; // unparseable = ignored
  return b >= a;
}

// ---- Hub aggregation helpers (pure, testable) --------------------------------

export interface HubBillTotalsLike {
  monthlyCents: number;
  yourShareCents: number | null;
}

/** The hub's headline totals: whole-household month + "your month: $X". */
export function hubTotals(bills: HubBillTotalsLike[]): {
  monthCents: number;
  yourMonthCents: number;
} {
  let monthCents = 0;
  let yourMonthCents = 0;
  for (const b of bills) {
    monthCents += b.monthlyCents;
    if (b.yourShareCents != null) yourMonthCents += b.yourShareCents;
  }
  return { monthCents, yourMonthCents };
}

/**
 * Find the ledger expense that IS this bill's charge for the given month:
 * same title (or the "<title> · prorated" replacements the adjust flow
 * writes), created inside that UTC month, and not a transfer. Materialized
 * recurring/subscription expenses keep their rule/subscription title, so
 * title+month is the join key — the hub never stores its own link table.
 */
export function findPosted<
  T extends { title: string; createdAt: string; kind?: string | null }
>(expenses: T[], billTitle: string, yearUTC: number, monthIndexUTC: number): T | undefined {
  const from = Date.UTC(yearUTC, monthIndexUTC, 1);
  const to = Date.UTC(yearUTC, monthIndexUTC + 1, 1);
  return expenses.find((e) => {
    if (e.kind) return false;
    if (e.title !== billTitle && e.title !== `${billTitle} · prorated`) return false;
    const t = new Date(e.createdAt).getTime();
    return Number.isFinite(t) && t >= from && t < to;
  });
}

// ---- Data access (dual backend; reads recurring/subscriptions tables) --------

interface TripRuleRow {
  id: string;
  title: string;
  amount_cents: number;
  paid_by: string;
  participants: string; // JSON array string (normalized)
  interval: string;
  next_due: string;
}

interface TripSubRow {
  id: string;
  name: string;
  icon: string | null;
  amount_cents: number;
  interval: string;
  payer_member_id: string;
  members: string; // JSON array string (normalized)
  shares: string; // JSON object string (normalized)
  next_renewal: string;
}

function jsonText(v: unknown, fallback: string): string {
  if (v == null) return fallback;
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Active, unpaused recurring rules attached to this trip (rent, utilities). */
async function listTripRecurring(tripId: string): Promise<TripRuleRow[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("recurring")
      .select("*")
      .eq("trip_id", tripId)
      .eq("active", 1)
      .eq("paused", 0)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`household.listTripRecurring: ${error.message}`);
    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      title: String(r.title),
      amount_cents: Number(r.amount_cents),
      paid_by: String(r.paid_by),
      participants: jsonText(r.participants, "[]"),
      interval: String(r.interval),
      next_due: String(r.next_due),
    }));
  }
  return db
    .prepare(
      "SELECT id, title, amount_cents, paid_by, participants, interval, next_due FROM recurring WHERE trip_id = ? AND active = 1 AND paused = 0 ORDER BY created_at ASC, rowid ASC"
    )
    .all(tripId) as TripRuleRow[];
}

/** Active shared subscriptions attached to this trip. */
async function listTripSubscriptions(tripId: string): Promise<TripSubRow[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("subscriptions")
      .select("*")
      .eq("trip_id", tripId)
      .eq("active", 1)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`household.listTripSubscriptions: ${error.message}`);
    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      name: String(r.name),
      icon: (r.icon as string | null) ?? null,
      amount_cents: Number(r.amount_cents),
      interval: String(r.interval),
      payer_member_id: String(r.payer_member_id),
      members: jsonText(r.members, "[]"),
      shares: jsonText(r.shares, "{}"),
      next_renewal: String(r.next_renewal),
    }));
  }
  return db
    .prepare(
      "SELECT id, name, icon, amount_cents, interval, payer_member_id, members, shares, next_renewal FROM subscriptions WHERE trip_id = ? AND active = 1 ORDER BY created_at ASC, rowid ASC"
    )
    .all(tripId) as TripSubRow[];
}

// ---- Router helpers -----------------------------------------------------------

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

function memberName(trip: Trip, id: string): string {
  const m = trip.members.find((x) => x.id === id);
  return m ? m.name : id;
}

// ---- Router --------------------------------------------------------------------

export const householdRouter = Router();

// Per-route requireAuth ONLY — this router is mounted path-lessly
// (app.use(householdRouter)); a router-wide guard would gate the whole app.

/**
 * PATCH /api/trips/:id/household { household: boolean } — flag / unflag a
 * group as a household ("roommates 🏠"). Owner or any claimed member.
 */
householdRouter.patch(
  "/api/trips/:id/household",
  writeRateLimit,
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.userId as string;
    if (!isSafeId(req.params.id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const trip = await getTrip(req.params.id);
    if (!trip) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (!isTripParty(trip, userId)) {
      res.status(403).json({ error: "not authorized for this trip" });
      return;
    }
    const household = (req.body || {}).household;
    if (typeof household !== "boolean") {
      res.status(400).json({ error: "household must be a boolean" });
      return;
    }
    const updated = await updateTrip(trip.id, { kind: household ? "household" : null });
    res.json({ ok: true, kind: updated.kind || null });
  }
);

/**
 * PATCH /api/trips/:id/members/:mid/residency { movedInAt?, movedOutAt? } —
 * set a household member's move-in/move-out dates (day granularity; null/""
 * clears). Owner or any claimed member; dates validated + pair-checked.
 */
householdRouter.patch(
  "/api/trips/:id/members/:mid/residency",
  writeRateLimit,
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.userId as string;
    if (!isSafeId(req.params.id) || !isSafeId(req.params.mid)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const trip = await getTrip(req.params.id);
    if (!trip) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (!isTripParty(trip, userId)) {
      res.status(403).json({ error: "not authorized for this trip" });
      return;
    }
    const member = trip.members.find((m) => m.id === req.params.mid);
    if (!member) {
      res.status(404).json({ error: "member not found" });
      return;
    }

    const body = (req.body || {}) as { movedInAt?: unknown; movedOutAt?: unknown };
    if (body.movedInAt === undefined && body.movedOutAt === undefined) {
      res.status(400).json({ error: "nothing to update" });
      return;
    }
    const patch: { movedInAt?: string | null; movedOutAt?: string | null } = {};
    if (body.movedInAt !== undefined) {
      const v = validateMoveDate(body.movedInAt);
      if (!v.ok) {
        res.status(400).json({ error: `movedInAt: ${v.error}` });
        return;
      }
      patch.movedInAt = v.iso;
    }
    if (body.movedOutAt !== undefined) {
      const v = validateMoveDate(body.movedOutAt);
      if (!v.ok) {
        res.status(400).json({ error: `movedOutAt: ${v.error}` });
        return;
      }
      patch.movedOutAt = v.iso;
    }
    // Pair check against the values that WILL be stored (patch + existing).
    const nextIn = patch.movedInAt !== undefined ? patch.movedInAt : member.movedInAt ?? null;
    const nextOut = patch.movedOutAt !== undefined ? patch.movedOutAt : member.movedOutAt ?? null;
    if (!residencyPairOk(nextIn, nextOut)) {
      res.status(400).json({ error: "move-out can't be before move-in" });
      return;
    }

    const updated = await setMemberResidency(trip.id, member.id, patch);
    const fresh = updated.members.find((m) => m.id === member.id);
    res.json({
      ok: true,
      member: {
        id: member.id,
        movedInAt: (fresh && fresh.movedInAt) || null,
        movedOutAt: (fresh && fresh.movedOutAt) || null,
      },
    });
  }
);

/**
 * GET /api/trips/:id/household?month=YYYY-MM — the "this month" hub.
 * Aggregates the trip's recurring rules + shared subscriptions into bill rows
 * (amount, your share — prorated by residency for recurring — next charge,
 * posted/pending) plus the "your month: $X" headline. Member-only.
 */
householdRouter.get(
  "/api/trips/:id/household",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.userId as string;
    if (!isSafeId(req.params.id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const trip = await getTrip(req.params.id);
    if (!trip) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (!isTripParty(trip, userId)) {
      res.status(403).json({ error: "not authorized for this trip" });
      return;
    }

    // Which month? Default: the current UTC month.
    let yearUTC: number;
    let month0: number;
    const q = req.query.month;
    if (q !== undefined) {
      const m = /^(\d{4})-(\d{2})$/.exec(String(q));
      const mm = m ? Number(m[2]) : 0;
      if (!m || mm < 1 || mm > 12) {
        res.status(400).json({ error: "month must be YYYY-MM" });
        return;
      }
      yearUTC = Number(m[1]);
      month0 = mm - 1;
    } else {
      const now = new Date();
      yearUTC = now.getUTCFullYear();
      month0 = now.getUTCMonth();
    }

    const viewer = trip.members.find((m) => m.userId === userId);
    const memberById = new Map(trip.members.map((m) => [m.id, m]));
    const dim = daysInMonth(yearUTC, month0);
    const daysOf = (memberId: string): number => {
      const m = memberById.get(memberId);
      if (!m) return dim; // unknown → full month (never zero someone silently)
      return residentDays(yearUTC, month0, m.movedInAt, m.movedOutAt);
    };

    const [rules, subs] = await Promise.all([
      listTripRecurring(trip.id),
      listTripSubscriptions(trip.id),
    ]);

    const bills: Record<string, unknown>[] = [];

    // Recurring rules (rent, utilities): even split — prorated by residency
    // days when this month has a mover.
    for (const r of rules) {
      let participants: string[];
      try {
        participants = (JSON.parse(r.participants) as string[]).filter((p) =>
          memberById.has(p)
        );
      } catch {
        participants = [];
      }
      if (!participants.length) continue;
      const monthlyCents = monthlyizeCents(r.amount_cents, r.interval);
      const entries = participants.map((p) => ({ id: p, days: daysOf(p) }));
      const prorated = entries.some((e) => e.days !== dim);
      let shares: Map<string, number>;
      try {
        shares = prorateByDays(monthlyCents, entries);
      } catch {
        // Nobody resident this month — nothing owed by anyone.
        shares = new Map(participants.map((p) => [p, 0]));
      }
      const yourShareCents =
        viewer && participants.includes(viewer.id) ? shares.get(viewer.id) ?? 0 : null;
      const posted = findPosted(trip.expenses, r.title, yearUTC, month0);

      // One-tap adjust: the posted charge is a ≥2-person even split whose
      // prorated-by-residency shares differ — offer to rewrite it.
      let canAdjust = false;
      if (posted && prorated && posted.participants.length >= 2 && posted.title === r.title) {
        const pEntries = posted.participants.map((p) => ({ id: p, days: daysOf(p) }));
        try {
          const want = prorateByDays(posted.amountCents, pEntries);
          const even = distributeEven(posted.amountCents, posted.participants.length);
          canAdjust = posted.participants.some((p, i) => (want.get(p) ?? 0) !== even[i]);
        } catch {
          canAdjust = false;
        }
      }

      bills.push({
        source: "recurring",
        id: r.id,
        title: r.title,
        icon: null,
        amountCents: r.amount_cents,
        amountFmt: fmt(r.amount_cents),
        interval: r.interval,
        monthlyCents,
        monthlyFmt: fmt(monthlyCents),
        yourShareCents,
        yourShareFmt: yourShareCents == null ? null : fmt(yourShareCents),
        prorated,
        nextChargeAt: r.next_due,
        payerName: memberName(trip, r.paid_by),
        paid: !!posted,
        paidAt: posted ? posted.createdAt : null,
        canAdjust,
        adjustExpenseId: canAdjust && posted ? posted.id : null,
      });
    }

    // Shared subscriptions: their share weights are explicit (weighted plans),
    // so they keep subscriptions.ts's own math — no residency proration.
    for (const s of subs) {
      let memberIds: string[];
      let shareMap: Record<string, number>;
      try {
        memberIds = (JSON.parse(s.members) as string[]).filter((p) => memberById.has(p));
        shareMap = JSON.parse(s.shares) as Record<string, number>;
      } catch {
        continue;
      }
      if (!memberIds.length) continue;
      const perShare = shareCents(s.amount_cents, memberIds, shareMap);
      const monthlyCents = monthlyizeCents(s.amount_cents, s.interval);
      let yourShareCents: number | null = null;
      if (viewer && memberIds.includes(viewer.id)) {
        const raw = perShare.get(viewer.id) ?? 0;
        yourShareCents = s.interval === "yearly" ? Math.round(raw / 12) : raw;
      }
      const title = `${s.icon ? s.icon + " " : ""}${s.name}`;
      const posted = findPosted(trip.expenses, title, yearUTC, month0);
      bills.push({
        source: "subscription",
        id: s.id,
        title: s.name,
        icon: s.icon,
        amountCents: s.amount_cents,
        amountFmt: fmt(s.amount_cents),
        interval: s.interval,
        monthlyCents,
        monthlyFmt: fmt(monthlyCents),
        yourShareCents,
        yourShareFmt: yourShareCents == null ? null : fmt(yourShareCents),
        prorated: false,
        nextChargeAt: s.next_renewal,
        payerName: memberName(trip, s.payer_member_id),
        paid: !!posted,
        paidAt: posted ? posted.createdAt : null,
        canAdjust: false,
        adjustExpenseId: null,
      });
    }

    const totals = hubTotals(
      bills.map((b) => ({
        monthlyCents: b.monthlyCents as number,
        yourShareCents: b.yourShareCents as number | null,
      }))
    );

    res.json({
      tripId: trip.id,
      household: trip.kind === "household",
      month: `${yearUTC}-${String(month0 + 1).padStart(2, "0")}`,
      daysInMonth: dim,
      bills,
      totals: {
        monthCents: totals.monthCents,
        monthFmt: fmt(totals.monthCents),
        yourMonthCents: totals.yourMonthCents,
        yourMonthFmt: fmt(totals.yourMonthCents),
      },
    });
  }
);

/**
 * POST /api/trips/:id/household/adjust { expenseId } — one-tap proration for
 * a transition month: replace ONE posted even-split expense with exact
 * per-member prorated expenses ("<title> · prorated", paid by the same
 * payer), by days-in-residence during that expense's month. Movers-out with
 * 0 days simply get no replacement row. Balance effect is penny-exact: the
 * per-member amounts are the prorated shares themselves. Member-only.
 */
householdRouter.post(
  "/api/trips/:id/household/adjust",
  writeRateLimit,
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.userId as string;
    if (!isSafeId(req.params.id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const trip = await getTrip(req.params.id);
    if (!trip) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (!isTripParty(trip, userId)) {
      res.status(403).json({ error: "not authorized for this trip" });
      return;
    }
    if (trip.kind !== "household") {
      res.status(400).json({ error: "not a household group" });
      return;
    }
    const expenseId = (req.body || {}).expenseId;
    if (!isSafeId(expenseId)) {
      res.status(400).json({ error: "expenseId required" });
      return;
    }
    const exp = trip.expenses.find((e) => e.id === expenseId);
    if (!exp) {
      res.status(404).json({ error: "expense not found" });
      return;
    }
    if (exp.kind || exp.participants.length < 2) {
      res.status(400).json({ error: "that expense can't be prorated" });
      return;
    }

    // Prorate by residency during the month the charge posted.
    const posted = new Date(exp.createdAt);
    if (Number.isNaN(posted.getTime())) {
      res.status(400).json({ error: "that expense can't be prorated" });
      return;
    }
    const yearUTC = posted.getUTCFullYear();
    const month0 = posted.getUTCMonth();
    const memberById = new Map(trip.members.map((m) => [m.id, m]));
    const dim = daysInMonth(yearUTC, month0);
    const entries = exp.participants.map((p) => {
      const m = memberById.get(p);
      return { id: p, days: m ? residentDays(yearUTC, month0, m.movedInAt, m.movedOutAt) : dim };
    });

    let shares: Map<string, number>;
    try {
      shares = prorateByDays(exp.amountCents, entries);
    } catch {
      res.status(400).json({ error: "nobody was resident that month" });
      return;
    }
    const even = distributeEven(exp.amountCents, exp.participants.length);
    const differs = exp.participants.some((p, i) => (shares.get(p) ?? 0) !== even[i]);
    if (!differs) {
      res.status(400).json({ error: "already matches the prorated split" });
      return;
    }

    // Void the even split, then append exact per-member prorated expenses
    // (subscriptions.ts's weighted-share pattern; the payer's own share nets
    // to zero so it gets no row). Void FIRST so a mid-flight failure leaves
    // the group under-charged (recoverable) rather than double-charged.
    await deleteExpense(trip.id, exp.id);
    let added = 0;
    for (const p of exp.participants) {
      if (p === exp.paidBy) continue;
      const cents = shares.get(p) ?? 0;
      if (cents <= 0) continue;
      await addExpense(trip.id, {
        title: `${exp.title} · prorated`,
        amountCents: cents,
        paidBy: exp.paidBy,
        participants: [p],
      });
      added += 1;
    }

    res.json({ ok: true, replacedExpenseId: exp.id, added });
  }
);
