/**
 * reactions.ts — Persisted emoji reactions for any object inside a Trip.
 *
 * Messages carry their own reactions (see chat.ts). This module covers the
 * OTHER reactable surfaces the design shows reaction chips on — expense "tab"
 * cards and settle/payment events — which are derived rows, not messages, so
 * they need a target-keyed store of their own.
 *
 * A reaction is keyed by (trip_id, target, emoji, user_id). `target` is an
 * opaque string the client owns, e.g. "exp:<expenseId>" or "pay:<edgeKey>".
 * Toggling is idempotent per user. Authorization REUSES the trip capability
 * model (isTripAuthorized) exactly like chat.ts — link-holders may read, but a
 * session user is required to react (reactions are per-user).
 */

import { Request, Response, Router } from "express";
import { db } from "./db";
import { getTrip, isTripAuthorized, Trip } from "./trips";

// ---- Schema ----------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS trip_reactions (
    trip_id TEXT NOT NULL,
    target TEXT NOT NULL,
    emoji TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (trip_id, target, emoji, user_id)
  );
`);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_trip_reactions_trip ON trip_reactions (trip_id)"
);

// ---- Limits ----------------------------------------------------------------

const MAX_TARGET_LEN = 200;
const MAX_EMOJI_LEN = 8;

// ---- Types -----------------------------------------------------------------

interface SerializedReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

// ---- Authorization (reuse trip capability model) ---------------------------

function authorizeTrip(req: Request, trip: Trip): boolean {
  return isTripAuthorized({
    providedToken: req.header("x-trip-token") || null,
    shareToken: trip.shareToken,
    userId: req.userId || null,
    ownerUserId: trip.ownerUserId || null,
    memberUserIds: trip.members
      .filter((m) => m.userId)
      .map((m) => m.userId as string),
  });
}

// ---- Aggregation -----------------------------------------------------------

/** All reactions for a trip as { target: [{emoji,count,mine}] }. */
function reactionsForTrip(
  tripId: string,
  viewerId: string | null
): Record<string, SerializedReaction[]> {
  const rows = db
    .prepare(
      "SELECT target, emoji, user_id FROM trip_reactions WHERE trip_id = ?"
    )
    .all(tripId) as { target: string; emoji: string; user_id: string }[];

  // target -> emoji -> { count, mine }
  const byTarget: Record<string, Record<string, { count: number; mine: boolean }>> = {};
  for (const r of rows) {
    const t = (byTarget[r.target] = byTarget[r.target] || {});
    const e = (t[r.emoji] = t[r.emoji] || { count: 0, mine: false });
    e.count += 1;
    if (viewerId && r.user_id === viewerId) e.mine = true;
  }

  const out: Record<string, SerializedReaction[]> = {};
  for (const target of Object.keys(byTarget)) {
    out[target] = Object.keys(byTarget[target]).map((emoji) => ({
      emoji,
      count: byTarget[target][emoji].count,
      mine: byTarget[target][emoji].mine,
    }));
  }
  return out;
}

/** A single target's reactions as [{emoji,count,mine}]. */
function reactionsForTarget(
  tripId: string,
  target: string,
  viewerId: string | null
): SerializedReaction[] {
  const rows = db
    .prepare(
      "SELECT emoji, user_id FROM trip_reactions WHERE trip_id = ? AND target = ?"
    )
    .all(tripId, target) as { emoji: string; user_id: string }[];
  const map: Record<string, { count: number; mine: boolean }> = {};
  for (const r of rows) {
    const e = (map[r.emoji] = map[r.emoji] || { count: 0, mine: false });
    e.count += 1;
    if (viewerId && r.user_id === viewerId) e.mine = true;
  }
  return Object.keys(map).map((emoji) => ({
    emoji,
    count: map[emoji].count,
    mine: map[emoji].mine,
  }));
}

// ---- Router ----------------------------------------------------------------

export const reactionsRouter = Router();

/**
 * GET /api/trips/:id/reactions — every reaction in the trip, grouped by target,
 * with the viewer's own reactions flagged. One cheap call hydrates all cards.
 */
reactionsRouter.get(
  "/api/trips/:id/reactions",
  (req: Request, res: Response): void => {
    const trip = getTrip(req.params.id);
    if (!trip) {
      res.status(404).json({ error: "trip not found" });
      return;
    }
    if (!authorizeTrip(req, trip)) {
      res.status(403).json({ error: "not authorized for this trip" });
      return;
    }
    res.json({ reactions: reactionsForTrip(trip.id, req.userId || null) });
  }
);

/**
 * POST /api/trips/:id/reactions { target, emoji } — toggle the signed-in user's
 * reaction on a target. Requires a session. Returns the target's fresh
 * reaction array.
 */
reactionsRouter.post(
  "/api/trips/:id/reactions",
  (req: Request, res: Response): void => {
    const trip = getTrip(req.params.id);
    if (!trip) {
      res.status(404).json({ error: "trip not found" });
      return;
    }
    if (!authorizeTrip(req, trip)) {
      res.status(403).json({ error: "not authorized for this trip" });
      return;
    }
    if (!req.userId) {
      res.status(401).json({ error: "sign in to react" });
      return;
    }

    const body = (req.body || {}) as { target?: unknown; emoji?: unknown };
    const target = String(body.target || "").slice(0, MAX_TARGET_LEN);
    const emoji = String(body.emoji || "").slice(0, MAX_EMOJI_LEN);
    if (!target) {
      res.status(400).json({ error: "target required" });
      return;
    }
    if (!emoji) {
      res.status(400).json({ error: "emoji required" });
      return;
    }

    const existing = db
      .prepare(
        "SELECT 1 FROM trip_reactions WHERE trip_id = ? AND target = ? AND emoji = ? AND user_id = ?"
      )
      .get(trip.id, target, emoji, req.userId);

    if (existing) {
      db.prepare(
        "DELETE FROM trip_reactions WHERE trip_id = ? AND target = ? AND emoji = ? AND user_id = ?"
      ).run(trip.id, target, emoji, req.userId);
    } else {
      db.prepare(
        "INSERT INTO trip_reactions (trip_id, target, emoji, user_id, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(trip.id, target, emoji, req.userId, new Date().toISOString());
    }

    res.json({
      target,
      reactions: reactionsForTarget(trip.id, target, req.userId),
    });
  }
);
