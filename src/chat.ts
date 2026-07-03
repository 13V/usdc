/**
 * chat.ts — Group chat + receipt messages for a Trip.
 *
 * Every Trip is a shared group. Members (and anyone holding the share link)
 * can post text messages and receipt photos that everyone in the group sees.
 *
 * Authorization REUSES the trip capability model (see trips.ts:isTripAuthorized):
 * a request is authorized if it carries the trip's share token via the
 * `X-Trip-Token` header, OR its session user (req.userId) is the trip owner or a
 * claimed member. Anonymous link-holders can therefore read AND post, exactly
 * like the rest of the trip surface.
 *
 * GUARDRAIL: validate everything; never throw raw to the client. Receipt photos
 * arrive as data-URL strings (the server already permits a 12mb JSON body).
 */

import * as crypto from "crypto";
import { Request, Response, Router } from "express";
import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { getTrip, isTripAuthorized, Trip } from "./trips";
import { getUser, serializeUser } from "./users";
import { writeRateLimit } from "./ratelimit";

// ---- Schema ----------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS trip_messages (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL,
    user_id TEXT,
    author TEXT NOT NULL,
    text TEXT,
    image TEXT,
    created_at TEXT NOT NULL
  );
`);
// Reactions: a JSON map { "🫡": ["userId", ...], ... }. Additive migration.
{
  const cols = db.prepare("PRAGMA table_info(trip_messages)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "reactions")) {
    db.exec("ALTER TABLE trip_messages ADD COLUMN reactions TEXT");
  }
}

// ---- Limits ----------------------------------------------------------------

const MAX_TEXT_LEN = 2000;
const MAX_IMAGE_LEN = 1_500_000; // ~1.5MB data URL
const PAGE_CAP = 200;

// ---- Types -----------------------------------------------------------------

interface SerializedReaction {
  emoji: string;
  count: number;
  mine: boolean;
}
interface SerializedMessage {
  id: string;
  userId: string | null;
  author: string;
  text: string | null;
  image: string | null;
  createdAt: string;
  reactions: SerializedReaction[];
}

function parseReactions(raw: any): Record<string, string[]> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch (_) {
    return {};
  }
}

function hydrateMessage(row: any, viewerId?: string | null): SerializedMessage {
  const map = parseReactions(row.reactions);
  const reactions: SerializedReaction[] = Object.keys(map)
    .map((emoji) => ({
      emoji,
      count: Array.isArray(map[emoji]) ? map[emoji].length : 0,
      mine: !!viewerId && Array.isArray(map[emoji]) && map[emoji].indexOf(viewerId) >= 0,
    }))
    .filter((r) => r.count > 0);
  return {
    id: row.id,
    userId: row.user_id ?? null,
    author: row.author,
    text: row.text ?? null,
    image: row.image ?? null,
    createdAt: row.created_at,
    reactions,
  };
}

// ---- Authorization (reuse trip capability model) ---------------------------

/**
 * Authorized iff the request carries the trip's share token (X-Trip-Token) or
 * its session user is the trip owner / a claimed member. Pure delegation to
 * isTripAuthorized — keeps chat access identical to the rest of the trip.
 */
function authorizeTripChat(req: Request, trip: Trip): boolean {
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

/**
 * Resolve a human-readable author label for a signed-in user: their display
 * name, else handle, else a shortened wallet, else a stable fallback.
 */
async function authorLabelForUser(userId: string): Promise<string> {
  const user = await getUser(userId);
  if (!user) return "Member";
  const s = await serializeUser(user);
  if (s.displayName) return s.displayName;
  if (s.handle) return s.handle;
  const wallet = s.primaryWallet || (s.wallets.length ? s.wallets[0] : null);
  if (wallet && wallet.length > 8) {
    return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
  }
  if (wallet) return wallet;
  return "Member";
}

// ---- Data access (SQLite or Supabase) --------------------------------------

interface MessageRow {
  id: string;
  trip_id: string;
  user_id: string | null;
  author: string;
  text: string | null;
  image: string | null;
  created_at: string;
  reactions: string | null;
}

/**
 * Insert a new message row. Returns nothing — callers already hold the values
 * they need for the response (so no read-back is required).
 */
async function insertMessage(row: {
  id: string;
  trip_id: string;
  user_id: string | null;
  author: string;
  text: string | null;
  image: string | null;
  created_at: string;
}): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase().from("trip_messages").insert({
      id: row.id,
      trip_id: row.trip_id,
      user_id: row.user_id,
      author: row.author,
      text: row.text,
      image: row.image,
      created_at: row.created_at,
    });
    if (error) throw new Error(`chat.insertMessage: ${error.message}`);
    return;
  }
  db.prepare(
    "INSERT INTO trip_messages (id, trip_id, user_id, author, text, image, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(row.id, row.trip_id, row.user_id, row.author, row.text, row.image, row.created_at);
}

/**
 * List a trip's messages ascending by time, capped at PAGE_CAP. When `after`
 * is supplied, only messages strictly newer than that ISO timestamp.
 */
async function listMessages(
  tripId: string,
  after: string | null
): Promise<MessageRow[]> {
  if (usingSupabase) {
    let q = supabase()
      .from("trip_messages")
      .select("*")
      .eq("trip_id", tripId);
    if (after) q = q.gt("created_at", after);
    const { data, error } = await q
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(PAGE_CAP);
    if (error) throw new Error(`chat.listMessages: ${error.message}`);
    return (data || []) as MessageRow[];
  }
  if (after) {
    return db
      .prepare(
        "SELECT * FROM trip_messages WHERE trip_id = ? AND created_at > ? ORDER BY created_at ASC, rowid ASC LIMIT ?"
      )
      .all(tripId, after, PAGE_CAP) as MessageRow[];
  }
  return db
    .prepare(
      "SELECT * FROM trip_messages WHERE trip_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?"
    )
    .all(tripId, PAGE_CAP) as MessageRow[];
}

/** Fetch a single message scoped to its trip, or null. */
async function getMessage(
  mid: string,
  tripId: string
): Promise<MessageRow | null> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("trip_messages")
      .select("*")
      .eq("id", mid)
      .eq("trip_id", tripId)
      .maybeSingle();
    if (error) throw new Error(`chat.getMessage: ${error.message}`);
    return (data as MessageRow) ?? null;
  }
  const row = db
    .prepare("SELECT * FROM trip_messages WHERE id = ? AND trip_id = ?")
    .get(mid, tripId) as MessageRow | undefined;
  return row ?? null;
}

/** Persist the reactions JSON for a message. */
async function updateReactions(
  mid: string,
  tripId: string,
  reactionsJson: string
): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase()
      .from("trip_messages")
      .update({ reactions: reactionsJson })
      .eq("id", mid)
      .eq("trip_id", tripId);
    if (error) throw new Error(`chat.updateReactions: ${error.message}`);
    return;
  }
  db.prepare("UPDATE trip_messages SET reactions = ? WHERE id = ? AND trip_id = ?")
    .run(reactionsJson, mid, tripId);
}

/** Delete a message scoped to its trip. */
async function deleteMessage(mid: string, tripId: string): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase()
      .from("trip_messages")
      .delete()
      .eq("id", mid)
      .eq("trip_id", tripId);
    if (error) throw new Error(`chat.deleteMessage: ${error.message}`);
    return;
  }
  db.prepare("DELETE FROM trip_messages WHERE id = ? AND trip_id = ?").run(
    mid,
    tripId
  );
}

// ---- Router ----------------------------------------------------------------

export const chatRouter = Router();

/**
 * POST /api/trips/:id/messages — post a text and/or receipt-photo message.
 * Body: { text?: string, image?: string }
 */
chatRouter.post(
  "/api/trips/:id/messages",
  writeRateLimit,
  async (req: Request, res: Response): Promise<void> => {
    const trip = await getTrip(req.params.id);
    if (!trip) {
      res.status(404).json({ error: "trip not found" });
      return;
    }
    if (!authorizeTripChat(req, trip)) {
      res.status(403).json({ error: "not authorized for this trip" });
      return;
    }

    const body = (req.body || {}) as { text?: unknown; image?: unknown };

    // Normalize text.
    let text: string | null = null;
    if (body.text !== undefined && body.text !== null) {
      if (typeof body.text !== "string") {
        res.status(400).json({ error: "text must be a string" });
        return;
      }
      text = body.text;
      if (text.length > MAX_TEXT_LEN) {
        res.status(400).json({ error: `text too long (max ${MAX_TEXT_LEN})` });
        return;
      }
    }

    // Normalize image (optional receipt-photo data URL).
    let image: string | null = null;
    if (body.image !== undefined && body.image !== null && body.image !== "") {
      if (typeof body.image !== "string") {
        res.status(400).json({ error: "image must be a string" });
        return;
      }
      image = body.image;
      if (!image.startsWith("data:image/")) {
        res.status(400).json({ error: "image must be a data:image/ URL" });
        return;
      }
      if (image.length > MAX_IMAGE_LEN) {
        res.status(400).json({ error: "image too large" });
        return;
      }
    }

    // Require at least one of text/image (after trimming whitespace-only text).
    const hasText = text !== null && text.trim().length > 0;
    const hasImage = image !== null;
    if (!hasText && !hasImage) {
      res.status(400).json({ error: "need text or image" });
      return;
    }

    const author = req.userId ? await authorLabelForUser(req.userId) : "Guest";
    const userId = req.userId || null;
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await insertMessage({
        id,
        trip_id: trip.id,
        user_id: userId,
        author,
        text: hasText ? text : null,
        image,
        created_at: createdAt,
      });
    } catch {
      res.status(500).json({ error: "could not save message" });
      return;
    }

    res.status(201).json({
      id,
      userId,
      author,
      text: hasText ? text : null,
      image,
      createdAt,
    });
  }
);

/**
 * GET /api/trips/:id/messages?after=<iso?> — list messages ascending by time.
 * If `after` is supplied, only messages strictly newer are returned (cheap
 * polling). Capped at PAGE_CAP messages.
 */
chatRouter.get(
  "/api/trips/:id/messages",
  async (req: Request, res: Response): Promise<void> => {
    const trip = await getTrip(req.params.id);
    if (!trip) {
      res.status(404).json({ error: "trip not found" });
      return;
    }
    if (!authorizeTripChat(req, trip)) {
      res.status(403).json({ error: "not authorized for this trip" });
      return;
    }

    const afterRaw = req.query.after;
    const after =
      typeof afterRaw === "string" && afterRaw.length > 0 ? afterRaw : null;

    const rows = await listMessages(trip.id, after);

    res.json({ messages: rows.map((r) => hydrateMessage(r, req.userId || null)) });
  }
);

/**
 * POST /api/trips/:id/messages/:mid/react { emoji } — toggle the signed-in
 * user's reaction on a message. Requires a session (reactions are per-user).
 */
chatRouter.post(
  "/api/trips/:id/messages/:mid/react",
  writeRateLimit,
  async (req: Request, res: Response): Promise<void> => {
    const trip = await getTrip(req.params.id);
    if (!trip) { res.status(404).json({ error: "trip not found" }); return; }
    if (!authorizeTripChat(req, trip)) { res.status(403).json({ error: "not authorized for this trip" }); return; }
    if (!req.userId) { res.status(401).json({ error: "sign in to react" }); return; }
    const emoji = String((req.body && req.body.emoji) || "").slice(0, 8);
    if (!emoji) { res.status(400).json({ error: "emoji required" }); return; }

    const row = await getMessage(req.params.mid, trip.id);
    if (!row) { res.status(404).json({ error: "message not found" }); return; }

    const map = parseReactions(row.reactions);
    const list = Array.isArray(map[emoji]) ? map[emoji] : [];
    const i = list.indexOf(req.userId);
    if (i >= 0) list.splice(i, 1); else list.push(req.userId);
    if (list.length) map[emoji] = list; else delete map[emoji];
    await updateReactions(row.id, trip.id, JSON.stringify(map));

    res.json(hydrateMessage({ ...row, reactions: JSON.stringify(map) }, req.userId));
  }
);

/**
 * DELETE /api/trips/:id/messages/:mid — delete a message. Allowed for the
 * message's own author (user_id === req.userId) or the trip owner.
 */
chatRouter.delete(
  "/api/trips/:id/messages/:mid",
  writeRateLimit,
  async (req: Request, res: Response): Promise<void> => {
    const trip = await getTrip(req.params.id);
    if (!trip) {
      res.status(404).json({ error: "trip not found" });
      return;
    }
    if (!authorizeTripChat(req, trip)) {
      res.status(403).json({ error: "not authorized for this trip" });
      return;
    }

    const row = await getMessage(req.params.mid, trip.id);
    if (!row) {
      res.status(404).json({ error: "message not found" });
      return;
    }

    const isAuthor =
      !!req.userId && row.user_id != null && row.user_id === req.userId;
    const isOwner =
      !!req.userId && !!trip.ownerUserId && trip.ownerUserId === req.userId;
    if (!isAuthor && !isOwner) {
      res.status(403).json({ error: "not allowed to delete this message" });
      return;
    }

    await deleteMessage(req.params.mid, trip.id);
    res.json({ ok: true });
  }
);
