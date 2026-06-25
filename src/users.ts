/**
 * users.ts — Progressive identity: users, identities (auth providers), wallets.
 *
 * ADDITIVE only. Anonymous/capability-link flows never touch these tables; they
 * exist purely to let a person OPTIONALLY claim a durable identity (a wallet via
 * Sign-In-With-Solana, or a Privy account) and find "my trips".
 *
 * A user can have many identities (provider+subject) and many wallets. A wallet
 * is itself an identity ("solana", <address>), and may also be marked primary so
 * settle-up can auto-route to it.
 */

import * as crypto from "crypto";
import { db } from "./db";

// ---- Types ----------------------------------------------------------------

export interface User {
  id: string;
  handle?: string;
  displayName?: string;
  emoji?: string;
  color?: string;
  createdAt: string;
}

export interface SerializedUser {
  id: string;
  handle: string | null;
  displayName: string | null;
  emoji: string | null;
  color: string | null;
  wallets: string[];
  primaryWallet: string | null;
}

// ---- Schema (idempotent) ---------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    handle TEXT UNIQUE,
    display_name TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS identities (
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (provider, subject)
  );

  CREATE TABLE IF NOT EXISTS user_wallets (
    user_id TEXT NOT NULL,
    wallet TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, wallet)
  );
`);

// Idempotent identity columns (emoji + color avatar). Additive: existing rows
// simply have NULL here.
function hasUserColumn(column: string): boolean {
  const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  return cols.some((c) => c.name === column);
}
if (!hasUserColumn("emoji")) db.exec("ALTER TABLE users ADD COLUMN emoji TEXT");
if (!hasUserColumn("color")) db.exec("ALTER TABLE users ADD COLUMN color TEXT");

// ---- Hydration -------------------------------------------------------------

function hydrateUser(row: any): User {
  return {
    id: row.id,
    handle: row.handle ?? undefined,
    displayName: row.display_name ?? undefined,
    emoji: row.emoji ?? undefined,
    color: row.color ?? undefined,
    createdAt: row.created_at,
  };
}

// ---- Reads -----------------------------------------------------------------

export function getUser(id: string): User | undefined {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  return row ? hydrateUser(row) : undefined;
}

export function findByHandle(handle: string): User | undefined {
  const row = db.prepare("SELECT * FROM users WHERE handle = ?").get(handle);
  return row ? hydrateUser(row) : undefined;
}

function getIdentity(provider: string, subject: string): string | undefined {
  const row: any = db
    .prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?")
    .get(provider, subject);
  return row ? row.user_id : undefined;
}

export function getWallets(userId: string): string[] {
  return db
    .prepare("SELECT wallet FROM user_wallets WHERE user_id = ? ORDER BY is_primary DESC, rowid ASC")
    .all(userId)
    .map((r: any) => r.wallet);
}

export function getPrimaryWallet(userId: string): string | null {
  const row: any = db
    .prepare("SELECT wallet FROM user_wallets WHERE user_id = ? ORDER BY is_primary DESC, rowid ASC LIMIT 1")
    .get(userId);
  return row ? row.wallet : null;
}

// ---- Writes ----------------------------------------------------------------

function createUser(): User {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO users (id, handle, display_name, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    null,
    null,
    createdAt
  );
  return getUser(id) as User;
}

function linkIdentity(provider: string, subject: string, userId: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO identities (provider, subject, user_id) VALUES (?, ?, ?)"
  ).run(provider, subject, userId);
}

export function addWallet(userId: string, wallet: string, primary = false): void {
  const exists = db
    .prepare("SELECT 1 FROM user_wallets WHERE user_id = ? LIMIT 1")
    .get(userId);
  // First wallet on a user is implicitly primary, unless told otherwise.
  const isPrimary = primary || !exists ? 1 : 0;

  const tx = db.transaction(() => {
    if (isPrimary) {
      db.prepare("UPDATE user_wallets SET is_primary = 0 WHERE user_id = ?").run(userId);
    }
    db.prepare(
      `INSERT INTO user_wallets (user_id, wallet, is_primary) VALUES (?, ?, ?)
       ON CONFLICT(user_id, wallet) DO UPDATE SET is_primary = MAX(is_primary, excluded.is_primary)`
    ).run(userId, wallet, isPrimary);
    // A wallet is also an identity, so the same wallet always maps to this user.
    linkIdentity("solana", wallet, userId);
  });
  tx();
}

export function upsertUserByWallet(wallet: string): User {
  const existing = getIdentity("solana", wallet);
  if (existing) {
    const u = getUser(existing);
    if (u) return u;
  }
  const user = createUser();
  addWallet(user.id, wallet, true);
  return user;
}

export function upsertUserByIdentity(
  provider: string,
  subject: string,
  opts?: { wallet?: string }
): User {
  const existing = getIdentity(provider, subject);
  let user: User;
  if (existing) {
    user = getUser(existing) as User;
  } else {
    user = createUser();
    linkIdentity(provider, subject, user.id);
  }
  if (opts && opts.wallet) {
    addWallet(user.id, opts.wallet, true);
  }
  return user;
}

export function setHandle(userId: string, handle: string): User {
  const clean = String(handle || "").trim();
  if (!clean) throw new Error("setHandle: handle required");
  const taken = findByHandle(clean);
  if (taken && taken.id !== userId) throw new Error("handle taken");
  db.prepare("UPDATE users SET handle = ? WHERE id = ?").run(clean, userId);
  return getUser(userId) as User;
}

export function setDisplayName(userId: string, name: string): User {
  const clean = String(name || "").trim();
  db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(clean || null, userId);
  return getUser(userId) as User;
}

// ---- Serialization ---------------------------------------------------------

export function serializeUser(user: User): SerializedUser {
  return {
    id: user.id,
    handle: user.handle || null,
    displayName: user.displayName || null,
    emoji: user.emoji || null,
    color: user.color || null,
    wallets: getWallets(user.id),
    primaryWallet: getPrimaryWallet(user.id),
  };
}

/** Set the emoji + color avatar identity. Either field optional. */
export function setIdentity(
  userId: string,
  patch: { emoji?: string; color?: string }
): User {
  if (patch.emoji !== undefined) {
    const e = String(patch.emoji).slice(0, 8) || null;
    db.prepare("UPDATE users SET emoji = ? WHERE id = ?").run(e, userId);
  }
  if (patch.color !== undefined) {
    const c = /^#[0-9a-fA-F]{3,8}$/.test(String(patch.color)) ? String(patch.color) : null;
    db.prepare("UPDATE users SET color = ? WHERE id = ?").run(c, userId);
  }
  const u = getUser(userId);
  if (!u) throw new Error("setIdentity: user not found");
  return u;
}
