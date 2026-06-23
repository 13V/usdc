/**
 * recurring.ts — Recurring splits (the retention feature).
 *
 * A recurrence rule targets an existing Trip and auto-adds an expense each
 * period (rent, subscriptions, etc.). When a rule's next-due moment passes, we
 * "materialize" it: append an expense to the trip and advance next-due by one
 * interval, catching up if several periods elapsed while no one looked.
 *
 * GUARDRAIL: ALL money is integer cents.
 *
 * Mount (integrator):
 *   import { recurringRouter } from "./recurring";
 *   app.use(recurringRouter);
 */

import * as crypto from "crypto";
import { Router, Request, Response } from "express";

import { db } from "./db";
import { requireAuth } from "./auth";
import { getTrip, addExpense } from "./trips";
import { toCents, fmt } from "./split";

// ---- Schema (idempotent) ---------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS recurring (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT,
    trip_id TEXT,
    title TEXT,
    amount_cents INTEGER,
    paid_by TEXT,
    participants TEXT,
    interval TEXT,
    next_due TEXT,
    created_at TEXT,
    active INTEGER DEFAULT 1
  );
`);

// ---- Date math (pure, testable) --------------------------------------------

/**
 * Advance an ISO timestamp by one interval. Intervals:
 *   - "weekly"  -> +7 days
 *   - "monthly" -> +1 calendar month (clamped to month length by Date)
 *   - "<n>d"    -> +n days (n a positive integer, e.g. "10d")
 * Returns an ISO string. Throws on an unknown interval form.
 */
export function advanceDue(iso: string, interval: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`advanceDue: invalid date ${iso}`);

  if (interval === "weekly") {
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString();
  }
  if (interval === "monthly") {
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString();
  }
  const m = /^(\d+)d$/.exec(interval);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`advanceDue: bad day count ${interval}`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString();
  }
  throw new Error(`advanceDue: unknown interval ${interval}`);
}

/** True iff `interval` is one of the allowed forms. */
function isValidInterval(interval: unknown): interval is string {
  if (typeof interval !== "string") return false;
  if (interval === "weekly" || interval === "monthly") return true;
  return /^\d+d$/.test(interval) && Number(interval.slice(0, -1)) > 0;
}

// ---- Row hydration / serialization -----------------------------------------

interface RecurringRow {
  id: string;
  owner_user_id: string | null;
  trip_id: string;
  title: string;
  amount_cents: number;
  paid_by: string;
  participants: string;
  interval: string;
  next_due: string;
  created_at: string;
  active: number;
}

function serialize(row: RecurringRow): Record<string, unknown> {
  const trip = getTrip(row.trip_id);
  return {
    id: row.id,
    tripId: row.trip_id,
    tripName: trip ? trip.name : null,
    title: row.title,
    amountCents: row.amount_cents,
    amountFmt: fmt(row.amount_cents),
    paidBy: row.paid_by,
    participants: JSON.parse(row.participants),
    interval: row.interval,
    nextDue: row.next_due,
    createdAt: row.created_at,
  };
}

// ---- Materialize -----------------------------------------------------------

const MAX_CATCHUP = 12; // cap catch-up iterations per rule per pass

/**
 * For each active rule (optionally filtered to one owner) whose next_due has
 * passed, append the expense to its trip and advance next_due, catching up to
 * MAX_CATCHUP periods. Each rule is isolated in try/catch so one bad rule (e.g.
 * its trip was deleted) can't break the others — such rules are deactivated.
 * Returns the number of expenses materialized.
 */
export function materializeDue(ownerUserId?: string): number {
  const now = Date.now();
  const rows = (
    ownerUserId
      ? db
          .prepare("SELECT * FROM recurring WHERE active = 1 AND owner_user_id = ?")
          .all(ownerUserId)
      : db.prepare("SELECT * FROM recurring WHERE active = 1").all()
  ) as RecurringRow[];

  const setDue = db.prepare("UPDATE recurring SET next_due = ? WHERE id = ?");
  const deactivate = db.prepare("UPDATE recurring SET active = 0 WHERE id = ?");

  let materialized = 0;

  for (const row of rows) {
    try {
      let nextDue = row.next_due;
      let iterations = 0;
      while (new Date(nextDue).getTime() <= now && iterations < MAX_CATCHUP) {
        addExpense(row.trip_id, {
          title: row.title,
          amountCents: row.amount_cents,
          paidBy: row.paid_by,
          participants: JSON.parse(row.participants),
        });
        nextDue = advanceDue(nextDue, row.interval);
        setDue.run(nextDue, row.id);
        materialized += 1;
        iterations += 1;
      }
    } catch {
      // A rule whose trip/members vanished can never succeed — retire it so it
      // stops blocking and stops being retried every pass.
      try {
        deactivate.run(row.id);
      } catch {
        /* best effort */
      }
    }
  }

  return materialized;
}

// ---- Router ----------------------------------------------------------------

export const recurringRouter = Router();

// Per-route requireAuth ONLY. This router is mounted path-lessly
// (app.use(recurringRouter)); a router-wide guard would gate the whole app.

recurringRouter.post("/api/recurring", requireAuth, (req: Request, res: Response) => {
  const userId = req.userId as string;
  const body = req.body || {};

  const tripId = String(body.tripId || "");
  const trip = getTrip(tripId);
  if (!trip) {
    res.status(404).json({ error: "trip not found" });
    return;
  }

  // Authorize: caller must be the trip owner or a claimed member.
  const isOwner = !!trip.ownerUserId && trip.ownerUserId === userId;
  const isMember = trip.members.some((m) => m.userId && m.userId === userId);
  if (!isOwner && !isMember) {
    res.status(403).json({ error: "not authorized for this trip" });
    return;
  }

  // Amount: amountCents takes precedence; otherwise derive from `total` dollars.
  let amountCents: number;
  try {
    amountCents = body.amountCents != null ? Number(body.amountCents) : toCents(body.total);
  } catch {
    res.status(400).json({ error: "invalid amount" });
    return;
  }
  if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 100000000) {
    res.status(400).json({ error: "amountCents must be an integer between 1 and 100000000" });
    return;
  }

  // Title.
  const title = String(body.title || "").trim();
  if (title.length < 1 || title.length > 140) {
    res.status(400).json({ error: "title must be 1..140 chars" });
    return;
  }

  // paidBy must be a member.
  const memberIds = new Set(trip.members.map((m) => m.id));
  const paidBy = String(body.paidBy || "");
  if (!memberIds.has(paidBy)) {
    res.status(400).json({ error: "paidBy must be a trip member" });
    return;
  }

  // Participants: default to ALL trip members; must be a non-empty subset.
  let participants: string[];
  if (body.participants == null) {
    participants = trip.members.map((m) => m.id);
  } else {
    if (!Array.isArray(body.participants)) {
      res.status(400).json({ error: "participants must be an array of member ids" });
      return;
    }
    participants = body.participants.map((p: unknown) => String(p));
    if (participants.length === 0) {
      res.status(400).json({ error: "participants must be non-empty" });
      return;
    }
    for (const p of participants) {
      if (!memberIds.has(p)) {
        res.status(400).json({ error: `participant ${p} is not a trip member` });
        return;
      }
    }
  }

  // Interval.
  if (!isValidInterval(body.interval)) {
    res.status(400).json({ error: 'interval must be "weekly", "monthly", or "<n>d"' });
    return;
  }
  const interval = body.interval as string;

  // next_due: startDate or now. Validate parseability if provided.
  let nextDue: string;
  if (body.startDate != null) {
    const t = new Date(String(body.startDate));
    if (Number.isNaN(t.getTime())) {
      res.status(400).json({ error: "startDate is not a valid date" });
      return;
    }
    nextDue = t.toISOString();
  } else {
    nextDue = new Date().toISOString();
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO recurring
       (id, owner_user_id, trip_id, title, amount_cents, paid_by, participants, interval, next_due, created_at, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(
    id,
    userId,
    tripId,
    title,
    amountCents,
    paidBy,
    JSON.stringify(participants),
    interval,
    nextDue,
    createdAt
  );

  const row = db.prepare("SELECT * FROM recurring WHERE id = ?").get(id) as RecurringRow;
  res.json(serialize(row));
});

recurringRouter.get("/api/recurring", requireAuth, (req: Request, res: Response) => {
  const userId = req.userId as string;
  // Lazy materialize first so the returned rules reflect due expenses.
  try {
    materializeDue(userId);
  } catch {
    /* never let materialization break the read */
  }
  const rows = db
    .prepare("SELECT * FROM recurring WHERE active = 1 AND owner_user_id = ? ORDER BY created_at DESC")
    .all(userId) as RecurringRow[];
  res.json({ rules: rows.map(serialize) });
});

recurringRouter.delete("/api/recurring/:id", requireAuth, (req: Request, res: Response) => {
  const userId = req.userId as string;
  const info = db
    .prepare("UPDATE recurring SET active = 0 WHERE id = ? AND owner_user_id = ? AND active = 1")
    .run(req.params.id, userId);
  if (info.changes === 0) {
    res.status(404).json({ error: "rule not found" });
    return;
  }
  res.json({ ok: true });
});

recurringRouter.post("/api/recurring/run", requireAuth, (req: Request, res: Response) => {
  const userId = req.userId as string;
  const materialized = materializeDue(userId);
  res.json({ materialized });
});

// ---- Self-scheduler (belt-and-suspenders) ----------------------------------
// Lazy materialize on GET covers the common case; this catches rules whose
// owners are inactive. unref() so it never holds the process open.
const timer = setInterval(() => {
  try {
    materializeDue();
  } catch {
    /* ignore */
  }
}, 60000);
timer.unref?.();
