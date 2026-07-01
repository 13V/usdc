/**
 * nudges.ts — Payment reminders ("nudges") + a derived notifications feed.
 *
 * A NUDGE is a lightweight, NON-money reminder: the caller pokes a counterparty
 * to pay them back. It never moves funds and never requires the target to be a
 * real Divvy user — if they aren't reachable we still record the nudge (so the
 * caller has a record) and report sent:false.
 *
 * STRICT SCOPE: this file owns the `nudges` table and this router only. It reads
 * (never writes) friends/users state via their exported helpers; it does not
 * modify any other module.
 *
 * Mount (integrator):
 *   import { nudgesRouter } from "./nudges";
 *   app.use(nudgesRouter);
 */

import * as crypto from "crypto";
import { Router, Request, Response } from "express";

import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { requireAuth } from "./auth";
import { getUser, serializeUser } from "./users";
import { sendPush } from "./push";

// ---- Schema (idempotent) ---------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS nudges (
    id TEXT PRIMARY KEY,
    from_user_id TEXT NOT NULL,
    to_user_id TEXT,
    to_name TEXT,
    trip_id TEXT,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// ---- Types -----------------------------------------------------------------

interface NudgeRow {
  id: string;
  from_user_id: string;
  to_user_id: string | null;
  to_name: string | null;
  trip_id: string | null;
  kind: string;
  created_at: string;
}

const MAX_LEN = 256;

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.length > MAX_LEN) return null;
  return trimmed;
}

// ---- Persistence -----------------------------------------------------------

async function insertNudge(row: NudgeRow): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase().from("nudges").insert({
      id: row.id,
      from_user_id: row.from_user_id,
      to_user_id: row.to_user_id,
      to_name: row.to_name,
      trip_id: row.trip_id,
      kind: row.kind,
      created_at: row.created_at,
    });
    if (error) throw new Error(`nudges.insertNudge: ${error.message}`);
    return;
  }
  db.prepare(
    `INSERT INTO nudges
       (id, from_user_id, to_user_id, to_name, trip_id, kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.from_user_id,
    row.to_user_id,
    row.to_name,
    row.trip_id,
    row.kind,
    row.created_at
  );
}

/** Nudges RECEIVED by a user (to_user_id = me), newest first. */
async function receivedNudges(userId: string): Promise<NudgeRow[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("nudges")
      .select("*")
      .eq("to_user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`nudges.receivedNudges: ${error.message}`);
    return (data as NudgeRow[]) ?? [];
  }
  return db
    .prepare(
      "SELECT * FROM nudges WHERE to_user_id = ? ORDER BY created_at DESC, rowid DESC"
    )
    .all(userId) as NudgeRow[];
}

// ---- Friend-request reads (mirror friends.ts GET /api/friends/requests) ----
// Read-only duplicates of the friends.ts edge queries so we can derive incoming
// friend requests WITHOUT importing/modifying friends.ts internals.

async function outgoingFriendIds(meId: string): Promise<string[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("friendships")
      .select("friend_user_id")
      .eq("user_id", meId);
    if (error) throw new Error(`nudges.outgoingFriendIds: ${error.message}`);
    return (data || []).map((r: any) => r.friend_user_id);
  }
  return (
    db
      .prepare("SELECT friend_user_id FROM friendships WHERE user_id = ?")
      .all(meId) as any[]
  ).map((r) => r.friend_user_id);
}

async function incomingFriendIds(meId: string): Promise<string[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("friendships")
      .select("user_id")
      .eq("friend_user_id", meId);
    if (error) throw new Error(`nudges.incomingFriendIds: ${error.message}`);
    return (data || []).map((r: any) => r.user_id);
  }
  return (
    db
      .prepare("SELECT user_id FROM friendships WHERE friend_user_id = ?")
      .all(meId) as any[]
  ).map((r) => r.user_id);
}

/**
 * Read-only wallet -> existing userId (or null). Mirrors friends.ts: a wallet is
 * linked either as a Solana identity (provider='solana', subject=wallet) or via
 * user_wallets. Never creates a user — nudging must not mint accounts.
 */
async function resolveUserIdByWallet(wallet: string): Promise<string | null> {
  if (usingSupabase) {
    const { data: idRow } = await supabase()
      .from("identities").select("user_id")
      .eq("provider", "solana").eq("subject", wallet).maybeSingle();
    if (idRow && (idRow as any).user_id) return (idRow as any).user_id;
    const { data: wRow } = await supabase()
      .from("user_wallets").select("user_id").eq("wallet", wallet).limit(1).maybeSingle();
    return (wRow && (wRow as any).user_id) || null;
  }
  const idRow: any = db
    .prepare("SELECT user_id FROM identities WHERE provider = 'solana' AND subject = ?")
    .get(wallet);
  if (idRow && idRow.user_id) return idRow.user_id;
  const wRow: any = db
    .prepare("SELECT user_id FROM user_wallets WHERE wallet = ? LIMIT 1")
    .get(wallet);
  return (wRow && wRow.user_id) || null;
}

/** Pending incoming requests: they added me, I haven't added back. */
async function pendingFriendRequestIds(meId: string): Promise<string[]> {
  const [out, inc] = await Promise.all([
    outgoingFriendIds(meId),
    incomingFriendIds(meId),
  ]);
  const outSet = new Set(out);
  return inc.filter((id) => !outSet.has(id));
}

// ---- Notification items ----------------------------------------------------

interface NotificationItem {
  type: "friend_request" | "nudge";
  title: string;
  createdAt: string;
  [extra: string]: unknown;
}

// ---- Router ----------------------------------------------------------------

export const nudgesRouter = Router();

// Dedicated limiter so reminders can't be spammed (a nudge is a notification to
// another user). Mirrors the small fixed-window limiters in server.ts.
function nudgeRateLimit() {
  const max = 20;
  const windowMs = 60_000; // ~20 nudges/min per IP
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: () => void): void => {
    const now = Date.now();
    const ip = req.ip || "unknown";
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      if (hits.size > 10000) {
        for (const [k, v] of hits) {
          if (v.every((t) => now - t >= windowMs)) hits.delete(k);
        }
      }
      res.status(429).json({ error: "too many requests, slow down" });
      return;
    }
    recent.push(now);
    hits.set(ip, recent);
    next();
  };
}

/**
 * POST /api/nudge { name?, userId?, tripId?, kind? }
 * Record a payment reminder. Never moves money. If the counterparty resolves to
 * a real user we record to_user_id and report sent:true; otherwise we still
 * record the nudge (with to_name) and report sent:false.
 */
nudgesRouter.post(
  "/api/nudge",
  nudgeRateLimit(),
  requireAuth,
  async (req: Request, res: Response) => {
    const fromUserId = req.userId as string;
    const body = (req.body || {}) as {
      name?: unknown;
      userId?: unknown;
      wallet?: unknown;
      tripId?: unknown;
      kind?: unknown;
    };

    const toName = cleanString(body.name);
    const targetUserId = cleanString(body.userId);
    const targetWallet = cleanString(body.wallet);
    const tripId = cleanString(body.tripId);
    const kind = cleanString(body.kind) || "pay";

    // Resolve to_user_id so the nudge actually lands in the target's
    // notifications. Try an explicit userId first, then the counterparty's
    // wallet (what the home screen has). A miss just records to_name (sent:false).
    let toUserId: string | null = null;
    try {
      if (targetUserId) {
        const u = await getUser(targetUserId);
        if (u) toUserId = u.id;
      }
      if (!toUserId && targetWallet) {
        toUserId = await resolveUserIdByWallet(targetWallet);
      }
    } catch {
      // A lookup failure shouldn't block recording the nudge.
      toUserId = null;
    }

    if (!toUserId && !toName) {
      res.status(400).json({ error: "Provide a userId or name to nudge." });
      return;
    }

    const row: NudgeRow = {
      id: crypto.randomUUID(),
      from_user_id: fromUserId,
      to_user_id: toUserId,
      to_name: toName,
      trip_id: tripId,
      kind,
      created_at: new Date().toISOString(),
    };
    await insertNudge(row);

    // Push the nudge to the target if they're a real user. Best-effort.
    if (toUserId) {
      let fromLabel = "Someone";
      try {
        const u = await getUser(fromUserId);
        if (u) { const su = await serializeUser(u); fromLabel = su.displayName || su.handle || "Someone"; }
      } catch { /* generic label */ }
      void sendPush(toUserId, {
        title: "Payment reminder 👋",
        body: `${fromLabel} nudged you to settle up`,
        url: "/#/activity",
        tag: `nudge:${row.id}`,
      });
    }

    res.json({ ok: true, sent: !!toUserId, id: row.id });
  }
);

/**
 * GET /api/me/notifications
 * Actionable items for the caller, derived from EXISTING data:
 *   - incoming friend requests (mirrors friends.ts GET /api/friends/requests)
 *   - nudges RECEIVED by this user (to_user_id = me)
 * Resilient: a failing sub-source contributes nothing rather than 500-ing.
 */
nudgesRouter.get(
  "/api/me/notifications",
  requireAuth,
  async (req: Request, res: Response) => {
    const meId = req.userId as string;
    const items: NotificationItem[] = [];

    // Incoming friend requests.
    try {
      const pending = await pendingFriendRequestIds(meId);
      for (const id of pending) {
        try {
          const u = await getUser(id);
          if (!u) continue;
          const su = await serializeUser(u);
          items.push({
            type: "friend_request",
            title: `${su.displayName || su.handle || "Someone"} sent you a friend request`,
            createdAt: new Date().toISOString(),
            fromUserId: u.id,
            from: su,
          });
        } catch {
          continue;
        }
      }
    } catch {
      // Friends source unavailable — skip it, still return what we can.
    }

    // Nudges received.
    try {
      const nudges = await receivedNudges(meId);
      for (const n of nudges) {
        let fromLabel = "Someone";
        try {
          const u = await getUser(n.from_user_id);
          if (u) {
            const su = await serializeUser(u);
            fromLabel = su.displayName || su.handle || "Someone";
          }
        } catch {
          /* fall back to the generic label */
        }
        items.push({
          type: "nudge",
          title: `${fromLabel} nudged you to pay`,
          createdAt: n.created_at,
          nudgeId: n.id,
          fromUserId: n.from_user_id,
          tripId: n.trip_id,
          kind: n.kind,
        });
      }
    } catch {
      // Nudges source unavailable — skip it.
    }

    // Newest first (ISO-8601 string compare is correct for same-format stamps).
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

    res.json({ items, unread: items.length });
  }
);
