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
// `paused` is distinct from `active`: a paused rule still exists and shows in
// the list (so it can be resumed), but is skipped by the materializer. `active`
// stays the delete flag. Additive migration.
{
  const cols = db.prepare("PRAGMA table_info(recurring)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "paused")) {
    db.exec("ALTER TABLE recurring ADD COLUMN paused INTEGER NOT NULL DEFAULT 0");
  }
}

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
  if (interval === "yearly") {
    d.setUTCFullYear(d.getUTCFullYear() + 1);
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
  if (interval === "weekly" || interval === "monthly" || interval === "yearly") return true;
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
  paused: number;
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
    paused: !!row.paused,
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
          .prepare("SELECT * FROM recurring WHERE active = 1 AND paused = 0 AND owner_user_id = ?")
          .all(ownerUserId)
      : db.prepare("SELECT * FROM recurring WHERE active = 1 AND paused = 0").all()
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

/**
 * PATCH /api/recurring/:id — pause/resume AND/OR edit fields in place.
 *   { paused: boolean }                              → pause/resume
 *   { title?, amountCents?, paidBy?, participants?, interval?, startDate? } → edit
 * Editing in place (a single UPDATE) is ATOMIC, replacing the old delete-then-
 * create dance the client used to do (which could duplicate a rule on failure).
 * Paused rules stay listed but are skipped by the materializer; on resume we roll
 * next_due past now so a long pause doesn't dump a backlog.
 */
recurringRouter.patch("/api/recurring/:id", requireAuth, (req: Request, res: Response) => {
  const userId = req.userId as string;
  const body = (req.body || {}) as {
    paused?: unknown; title?: unknown; amountCents?: unknown;
    paidBy?: unknown; participants?: unknown; interval?: unknown; startDate?: unknown;
  };
  const row = db
    .prepare("SELECT * FROM recurring WHERE id = ? AND owner_user_id = ? AND active = 1")
    .get(req.params.id, userId) as RecurringRow | undefined;
  if (!row) {
    res.status(404).json({ error: "rule not found" });
    return;
  }

  const sets: string[] = [];
  const vals: unknown[] = [];

  // pause / resume
  if (body.paused !== undefined) {
    if (typeof body.paused !== "boolean") {
      res.status(400).json({ error: "paused must be a boolean" });
      return;
    }
    let nextDue = row.next_due;
    if (!body.paused && row.paused) {
      try {
        const now = Date.now();
        let guard = 0;
        while (new Date(nextDue).getTime() <= now && guard++ < 1000) {
          nextDue = advanceDue(nextDue, row.interval);
        }
      } catch { /* leave as-is */ }
    }
    sets.push("paused = ?"); vals.push(body.paused ? 1 : 0);
    sets.push("next_due = ?"); vals.push(nextDue);
  }

  // field edits
  const editing =
    body.title !== undefined || body.amountCents !== undefined || body.paidBy !== undefined ||
    body.participants !== undefined || body.interval !== undefined || body.startDate !== undefined;
  if (editing) {
    const trip = getTrip(row.trip_id);
    const memberIds = new Set(trip ? trip.members.map((m) => m.id) : []);

    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (!t) { res.status(400).json({ error: "title required" }); return; }
      sets.push("title = ?"); vals.push(t);
    }
    if (body.amountCents !== undefined) {
      const a = Number(body.amountCents);
      if (!Number.isInteger(a) || a < 1 || a > 100000000) {
        res.status(400).json({ error: "amountCents must be an integer between 1 and 100000000" });
        return;
      }
      sets.push("amount_cents = ?"); vals.push(a);
    }
    if (body.interval !== undefined) {
      if (!isValidInterval(body.interval)) {
        res.status(400).json({ error: 'interval must be "weekly", "monthly", "yearly", or "<n>d"' });
        return;
      }
      sets.push("interval = ?"); vals.push(body.interval);
    }
    if (body.participants !== undefined) {
      if (!Array.isArray(body.participants) || body.participants.length === 0) {
        res.status(400).json({ error: "participants must be a non-empty array" });
        return;
      }
      const ps = Array.from(new Set(body.participants.map((p: unknown) => String(p))));
      if (trip) {
        for (const p of ps) {
          if (!memberIds.has(p)) { res.status(400).json({ error: `participant ${p} is not a trip member` }); return; }
        }
      }
      sets.push("participants = ?"); vals.push(JSON.stringify(ps));
    }
    if (body.paidBy !== undefined) {
      const pb = String(body.paidBy);
      if (trip && !memberIds.has(pb)) { res.status(400).json({ error: "paidBy must be a trip member" }); return; }
      sets.push("paid_by = ?"); vals.push(pb);
    }
    if (body.startDate !== undefined) {
      const dt = new Date(String(body.startDate));
      if (Number.isNaN(dt.getTime())) { res.status(400).json({ error: "startDate is not a valid date" }); return; }
      sets.push("next_due = ?"); vals.push(dt.toISOString());
    }
  }

  if (!sets.length) {
    res.status(400).json({ error: "nothing to update" });
    return;
  }

  vals.push(row.id);
  db.prepare(`UPDATE recurring SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as any[]));
  const updated = db.prepare("SELECT * FROM recurring WHERE id = ?").get(row.id) as RecurringRow;
  res.json(serialize(updated));
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
