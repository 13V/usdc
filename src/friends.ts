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
function resolveUserByWallet(wallet: string): User | null {
  const idRow: any = db
    .prepare(
      "SELECT user_id FROM identities WHERE provider = 'solana' AND subject = ?"
    )
    .get(wallet);
  if (idRow && idRow.user_id) {
    const u = getUser(idRow.user_id);
    if (u) return u;
  }

  const wRow: any = db
    .prepare("SELECT user_id FROM user_wallets WHERE wallet = ? LIMIT 1")
    .get(wallet);
  if (wRow && wRow.user_id) {
    const u = getUser(wRow.user_id);
    if (u) return u;
  }

  return null;
}

/**
 * Resolve a target user by handle or wallet. Returns the user or null.
 */
function resolveUserByHandleOrWallet(input: {
  handle?: string;
  wallet?: string;
}): User | null {
  if (input.handle) {
    return findByHandle(input.handle) || null;
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

function addFriendship(meId: string, themId: string): void {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    insertFriendship.run(meId, themId, now);
    insertFriendship.run(themId, meId, now);
  });
  tx();
}

function removeFriendship(meId: string, themId: string): void {
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
  (req: Request, res: Response) => {
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

    const target = resolveUserByHandleOrWallet({
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

    addFriendship(meId, target.id);
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
  (req: Request, res: Response) => {
    const meId = req.userId as string;

    const rows = db
      .prepare(
        `SELECT friend_user_id FROM friendships
         WHERE user_id = ?
         ORDER BY created_at DESC, rowid DESC`
      )
      .all(meId) as Array<{ friend_user_id: string }>;

    const friends = [];
    for (const row of rows) {
      const u = getUser(row.friend_user_id);
      if (u) friends.push(serializeUser(u));
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
  (req: Request, res: Response) => {
    const meId = req.userId as string;
    const friendUserId = cleanString(req.params.friendUserId);

    if (!friendUserId) {
      res.status(400).json({ error: "Invalid friend id." });
      return;
    }

    removeFriendship(meId, friendUserId);
    res.json({ ok: true });
  }
);
