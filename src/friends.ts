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

async function addFriendship(meId: string, themId: string): Promise<void> {
  const now = new Date().toISOString();
  if (usingSupabase) {
    // INSERT OR IGNORE semantics: upsert on the (user_id, friend_user_id) PK so
    // re-adding an existing friendship is a no-op rather than an error.
    const { error } = await supabase()
      .from("friendships")
      .upsert(
        [
          { user_id: meId, friend_user_id: themId, created_at: now },
          { user_id: themId, friend_user_id: meId, created_at: now },
        ],
        { onConflict: "user_id,friend_user_id", ignoreDuplicates: true }
      );
    if (error) throw new Error(`friends.addFriendship: ${error.message}`);
    return;
  }

  const tx = db.transaction(() => {
    insertFriendship.run(meId, themId, now);
    insertFriendship.run(themId, meId, now);
  });
  tx();
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

    await addFriendship(meId, target.id);
    res.json({ friend: serializeUser(target) });
  }
);

/**
 * GET /api/friends
 * List my friends, most recent first.
 */
friendsRouter.get(
  "/api/friends",
  requireAuth,
  async (req: Request, res: Response) => {
    const meId = req.userId as string;

    let rows: Array<{ friend_user_id: string }>;
    if (usingSupabase) {
      const { data, error } = await supabase()
        .from("friendships")
        .select("friend_user_id")
        .eq("user_id", meId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(`friends.list: ${error.message}`);
      rows = (data || []) as Array<{ friend_user_id: string }>;
    } else {
      rows = db
        .prepare(
          `SELECT friend_user_id FROM friendships
           WHERE user_id = ?
           ORDER BY created_at DESC, rowid DESC`
        )
        .all(meId) as Array<{ friend_user_id: string }>;
    }

    const friends = [];
    for (const row of rows) {
      const u = await getUser(row.friend_user_id);
      if (u) friends.push(await serializeUser(u));
    }

    res.json({ friends });
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
