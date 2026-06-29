/**
 * friends.ts — Friends system.
 *
 * Users add each other as friends (by handle or wallet) so they can quickly
 * start groups together. Friendships are MUTUAL: adding someone stores both
 * directions, and removing drops both.
 *
 * STRICT SCOPE: this file owns the `friendships` table and the friends router
 * only. It reuses identity/serialization from users.ts and auth from auth.ts.
 *
 * Mount with:
 *   import { friendsRouter } from "./friends";
 *   app.use(friendsRouter);
 */

import { Router, Request, Response } from "express";
import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { requireAuth } from "./auth";
import {
  getUser,
  findByHandle,
  serializeUser,
  User,
} from "./users";

// ---- Schema (idempotent) ---------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS friendships (
    user_id TEXT NOT NULL,
    friend_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, friend_user_id)
  );
`);

// ---- Input validation ------------------------------------------------------

const MAX_LEN = 256;

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.length > MAX_LEN) return null;
  return trimmed;
}

// ---- Wallet -> user resolution ---------------------------------------------

/**
 * Resolve a wallet to its owning user. A wallet is linked either as a Solana
 * identity (provider='solana', subject=<wallet>) or via the user_wallets table.
 * Identity is the canonical mapping; user_wallets is the fallback.
 */
async function resolveUserByWallet(wallet: string): Promise<User | null> {
  if (usingSupabase) {
    const { data: idRow, error: idErr } = await supabase()
      .from("identities")
      .select("user_id")
      .eq("provider", "solana")
      .eq("subject", wallet)
      .maybeSingle();
    if (idErr) throw new Error(`friends.resolveUserByWallet: ${idErr.message}`);
    if (idRow && idRow.user_id) {
      const u = await getUser(idRow.user_id);
      if (u) return u;
    }

    const { data: wRow, error: wErr } = await supabase()
      .from("user_wallets")
      .select("user_id")
      .eq("wallet", wallet)
      .limit(1)
      .maybeSingle();
    if (wErr) throw new Error(`friends.resolveUserByWallet: ${wErr.message}`);
    if (wRow && wRow.user_id) {
      const u = await getUser(wRow.user_id);
      if (u) return u;
    }

    return null;
  }

  const idRow: any = db
    .prepare(
      "SELECT user_id FROM identities WHERE provider = 'solana' AND subject = ?"
    )
    .get(wallet);
  if (idRow && idRow.user_id) {
    const u = await getUser(idRow.user_id);
    if (u) return u;
  }

  const wRow: any = db
    .prepare("SELECT user_id FROM user_wallets WHERE wallet = ? LIMIT 1")
    .get(wallet);
  if (wRow && wRow.user_id) {
    const u = await getUser(wRow.user_id);
    if (u) return u;
  }

  return null;
}

/**
 * Resolve a target user by handle or wallet. Returns the user or null.
 */
async function resolveUserByHandleOrWallet(input: {
  handle?: string;
  wallet?: string;
}): Promise<User | null> {
  if (input.handle) {
    return (await findByHandle(input.handle)) || null;
  }
  if (input.wallet) {
    return resolveUserByWallet(input.wallet);
  }
  return null;
}

// ---- Friendship writes -----------------------------------------------------

const insertFriendship = db.prepare(
  `INSERT OR IGNORE INTO friendships (user_id, friend_user_id, created_at)
   VALUES (?, ?, ?)`
);

/**
 * Add a single directed edge meId → themId. A lone edge is a PENDING request
 * (me asked them); friendship is ACCEPTED only when both directions exist
 * (they add/accept me back). Idempotent.
 */
async function addDirectedFriendship(meId: string, themId: string): Promise<void> {
  const now = new Date().toISOString();
  if (usingSupabase) {
    const { error } = await supabase()
      .from("friendships")
      .upsert([{ user_id: meId, friend_user_id: themId, created_at: now }],
        { onConflict: "user_id,friend_user_id", ignoreDuplicates: true });
    if (error) throw new Error(`friends.addDirected: ${error.message}`);
    return;
  }
  insertFriendship.run(meId, themId, now);
}

/** friend_user_ids that meId has added/requested (outgoing edges). */
async function outgoingIds(meId: string): Promise<string[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("friendships").select("friend_user_id").eq("user_id", meId);
    if (error) throw new Error(`friends.outgoing: ${error.message}`);
    return (data || []).map((r: any) => r.friend_user_id);
  }
  return (db.prepare("SELECT friend_user_id FROM friendships WHERE user_id = ?").all(meId) as any[])
    .map((r) => r.friend_user_id);
}

/** user_ids that have added/requested meId (incoming edges). */
async function incomingIds(meId: string): Promise<string[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("friendships").select("user_id").eq("friend_user_id", meId);
    if (error) throw new Error(`friends.incoming: ${error.message}`);
    return (data || []).map((r: any) => r.user_id);
  }
  return (db.prepare("SELECT user_id FROM friendships WHERE friend_user_id = ?").all(meId) as any[])
    .map((r) => r.user_id);
}

async function removeFriendship(meId: string, themId: string): Promise<void> {
  if (usingSupabase) {
    const { error: e1 } = await supabase()
      .from("friendships")
      .delete()
      .eq("user_id", meId)
      .eq("friend_user_id", themId);
    if (e1) throw new Error(`friends.removeFriendship: ${e1.message}`);
    const { error: e2 } = await supabase()
      .from("friendships")
      .delete()
      .eq("user_id", themId)
      .eq("friend_user_id", meId);
    if (e2) throw new Error(`friends.removeFriendship: ${e2.message}`);
    return;
  }

  const del = db.prepare(
    "DELETE FROM friendships WHERE user_id = ? AND friend_user_id = ?"
  );
  const tx = db.transaction(() => {
    del.run(meId, themId);
    del.run(themId, meId);
  });
  tx();
}

// ---- Router ----------------------------------------------------------------

export const friendsRouter = Router();

/**
 * POST /api/friends { handle?, wallet? }
 * Add a friend by handle or wallet (mutual).
 */
friendsRouter.post(
  "/api/friends",
  requireAuth,
  async (req: Request, res: Response) => {
    const meId = req.userId as string;

    const body = (req.body || {}) as { handle?: unknown; wallet?: unknown };
    const handle = cleanString(body.handle);
    const wallet = cleanString(body.wallet);

    if (!handle && !wallet) {
      res
        .status(400)
        .json({ error: "Provide a handle or wallet to add a friend." });
      return;
    }

    const target = await resolveUserByHandleOrWallet({
      handle: handle || undefined,
      wallet: wallet || undefined,
    });

    if (!target) {
      res.status(404).json({
        error:
          "No Divvy user with that handle/wallet — invite them to sign up.",
      });
      return;
    }

    if (target.id === meId) {
      res.status(400).json({ error: "You can't add yourself as a friend." });
      return;
    }

    // Send a friend REQUEST (one-way). If they had already requested me, this
    // completes the pair → we're now friends (accepted).
    const incomingBefore = await incomingIds(meId);
    await addDirectedFriendship(meId, target.id);
    const accepted = incomingBefore.includes(target.id);
    res.json({ friend: await serializeUser(target), status: accepted ? "accepted" : "requested" });
  }
);

/**
 * GET /api/friends
 * Accepted friends only (mutual — both directions exist).
 */
friendsRouter.get(
  "/api/friends",
  requireAuth,
  async (req: Request, res: Response) => {
    const meId = req.userId as string;
    const [out, inc] = await Promise.all([outgoingIds(meId), incomingIds(meId)]);
    const incSet = new Set(inc);
    const mutual = out.filter((id) => incSet.has(id));
    const friends = [];
    for (const id of mutual) {
      const u = await getUser(id);
      if (u) friends.push(await serializeUser(u));
    }
    res.json({ friends });
  }
);

/**
 * GET /api/friends/requests
 * Incoming pending requests (they added me, I haven't accepted back).
 */
friendsRouter.get(
  "/api/friends/requests",
  requireAuth,
  async (req: Request, res: Response) => {
    const meId = req.userId as string;
    const [out, inc] = await Promise.all([outgoingIds(meId), incomingIds(meId)]);
    const outSet = new Set(out);
    const incSet = new Set(inc);
    // Incoming: they added me, I haven't added back (I choose to accept).
    const pending = inc.filter((id) => !outSet.has(id));
    // Outgoing: I added them, they haven't accepted yet (shows as "requested").
    const sentPending = out.filter((id) => !incSet.has(id));
    const requests = [];
    for (const id of pending) {
      const u = await getUser(id);
      if (u) requests.push(await serializeUser(u));
    }
    const sent = [];
    for (const id of sentPending) {
      const u = await getUser(id);
      if (u) sent.push(await serializeUser(u));
    }
    res.json({ requests, sent });
  }
);

/**
 * POST /api/friends/accept { userId }
 * Accept an incoming request — adds the return edge, making it mutual.
 */
friendsRouter.post(
  "/api/friends/accept",
  requireAuth,
  async (req: Request, res: Response) => {
    const meId = req.userId as string;
    const userId = cleanString((req.body || {}).userId);
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const inc = await incomingIds(meId);
    if (!inc.includes(userId)) {
      res.status(404).json({ error: "no pending request from that user" });
      return;
    }
    await addDirectedFriendship(meId, userId);
    const u = await getUser(userId);
    res.json({ friend: u ? await serializeUser(u) : null, status: "accepted" });
  }
);

/**
 * DELETE /api/friends/:friendUserId
 * Remove a friend (both directions).
 */
friendsRouter.delete(
  "/api/friends/:friendUserId",
  requireAuth,
  async (req: Request, res: Response) => {
    const meId = req.userId as string;
    const friendUserId = cleanString(req.params.friendUserId);

    if (!friendUserId) {
      res.status(400).json({ error: "Invalid friend id." });
      return;
    }

    await removeFriendship(meId, friendUserId);
    res.json({ ok: true });
  }
);
