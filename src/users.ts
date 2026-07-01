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
import { usingSupabase, supabase } from "./supabase";

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

export async function getUser(id: string): Promise<User | undefined> {
  if (usingSupabase) {
    const { data, error } = await supabase().from("users").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`users.getUser: ${error.message}`);
    return data ? hydrateUser(data) : undefined;
  }
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  return row ? hydrateUser(row) : undefined;
}

export async function findByHandle(handle: string): Promise<User | undefined> {
  if (usingSupabase) {
    const { data, error } = await supabase().from("users").select("*").eq("handle", handle).maybeSingle();
    if (error) throw new Error(`users.findByHandle: ${error.message}`);
    return data ? hydrateUser(data) : undefined;
  }
  const row = db.prepare("SELECT * FROM users WHERE handle = ?").get(handle);
  return row ? hydrateUser(row) : undefined;
}

async function getIdentity(provider: string, subject: string): Promise<string | undefined> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("identities")
      .select("user_id")
      .eq("provider", provider)
      .eq("subject", subject)
      .maybeSingle();
    if (error) throw new Error(`users.getIdentity: ${error.message}`);
    return data ? (data as any).user_id : undefined;
  }
  const row: any = db
    .prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?")
    .get(provider, subject);
  return row ? row.user_id : undefined;
}

export async function getWallets(userId: string): Promise<string[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("user_wallets")
      .select("wallet")
      .eq("user_id", userId)
      .order("is_primary", { ascending: false });
    if (error) throw new Error(`users.getWallets: ${error.message}`);
    return (data ?? []).map((r: any) => r.wallet);
  }
  return db
    .prepare("SELECT wallet FROM user_wallets WHERE user_id = ? ORDER BY is_primary DESC, rowid ASC")
    .all(userId)
    .map((r: any) => r.wallet);
}

export async function getPrimaryWallet(userId: string): Promise<string | null> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("user_wallets")
      .select("wallet")
      .eq("user_id", userId)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`users.getPrimaryWallet: ${error.message}`);
    return data ? (data as any).wallet : null;
  }
  const row: any = db
    .prepare("SELECT wallet FROM user_wallets WHERE user_id = ? ORDER BY is_primary DESC, rowid ASC LIMIT 1")
    .get(userId);
  return row ? row.wallet : null;
}

// ---- Writes ----------------------------------------------------------------

async function createUser(): Promise<User> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  if (usingSupabase) {
    const { error } = await supabase()
      .from("users")
      .insert({ id, handle: null, display_name: null, created_at: createdAt });
    if (error) throw new Error(`users.createUser: ${error.message}`);
    return (await getUser(id)) as User;
  }
  db.prepare("INSERT INTO users (id, handle, display_name, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    null,
    null,
    createdAt
  );
  return (await getUser(id)) as User;
}

async function linkIdentity(provider: string, subject: string, userId: string): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase()
      .from("identities")
      .upsert(
        { provider, subject, user_id: userId },
        { onConflict: "provider,subject", ignoreDuplicates: true }
      );
    if (error) throw new Error(`users.linkIdentity: ${error.message}`);
    return;
  }
  db.prepare(
    "INSERT OR IGNORE INTO identities (provider, subject, user_id) VALUES (?, ?, ?)"
  ).run(provider, subject, userId);
}

export async function addWallet(userId: string, wallet: string, primary = false): Promise<void> {
  if (usingSupabase) {
    const { data: existsRows, error: existsErr } = await supabase()
      .from("user_wallets")
      .select("wallet")
      .eq("user_id", userId)
      .limit(1);
    if (existsErr) throw new Error(`users.addWallet: ${existsErr.message}`);
    const exists = (existsRows ?? []).length > 0;
    // First wallet on a user is implicitly primary, unless told otherwise.
    const isPrimary = primary || !exists ? 1 : 0;

    if (isPrimary) {
      const { error: clearErr } = await supabase()
        .from("user_wallets")
        .update({ is_primary: 0 })
        .eq("user_id", userId);
      if (clearErr) throw new Error(`users.addWallet: ${clearErr.message}`);
    }
    // Mirror ON CONFLICT DO UPDATE SET is_primary = MAX(is_primary, excluded.is_primary):
    // fetch any existing row's is_primary and take the max before upserting.
    const { data: cur, error: curErr } = await supabase()
      .from("user_wallets")
      .select("is_primary")
      .eq("user_id", userId)
      .eq("wallet", wallet)
      .maybeSingle();
    if (curErr) throw new Error(`users.addWallet: ${curErr.message}`);
    const finalPrimary = Math.max(isPrimary, cur ? (cur as any).is_primary : 0);
    const { error: upErr } = await supabase()
      .from("user_wallets")
      .upsert(
        { user_id: userId, wallet, is_primary: finalPrimary },
        { onConflict: "user_id,wallet" }
      );
    if (upErr) throw new Error(`users.addWallet: ${upErr.message}`);
    // A wallet is also an identity, so the same wallet always maps to this user.
    await linkIdentity("solana", wallet, userId);
    return;
  }

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
    // Run the insert synchronously INSIDE the transaction — calling the async
    // linkIdentity() here would leave a floating promise that resolves after the
    // transaction commits, so the identity could be missing immediately after
    // addWallet() returns (diverging from the awaited Supabase path).
    db.prepare(
      "INSERT OR IGNORE INTO identities (provider, subject, user_id) VALUES (?, ?, ?)"
    ).run("solana", wallet, userId);
  });
  tx();
}

export async function upsertUserByWallet(wallet: string): Promise<User> {
  const existing = await getIdentity("solana", wallet);
  if (existing) {
    const u = await getUser(existing);
    if (u) return u;
  }
  const user = await createUser();
  await addWallet(user.id, wallet, true);
  return user;
}

export async function upsertUserByIdentity(
  provider: string,
  subject: string,
  opts?: { wallet?: string }
): Promise<User> {
  const existing = await getIdentity(provider, subject);
  let user: User;
  if (existing) {
    user = (await getUser(existing)) as User;
  } else {
    user = await createUser();
    await linkIdentity(provider, subject, user.id);
  }
  if (opts && opts.wallet) {
    await addWallet(user.id, opts.wallet, true);
  }
  return user;
}

export async function setHandle(userId: string, handle: string): Promise<User> {
  const clean = String(handle || "").trim();
  if (!clean) throw new Error("setHandle: handle required");
  const taken = await findByHandle(clean);
  if (taken && taken.id !== userId) throw new Error("handle taken");
  if (usingSupabase) {
    const { error } = await supabase().from("users").update({ handle: clean }).eq("id", userId);
    if (error) throw new Error(`users.setHandle: ${error.message}`);
    return (await getUser(userId)) as User;
  }
  db.prepare("UPDATE users SET handle = ? WHERE id = ?").run(clean, userId);
  return (await getUser(userId)) as User;
}

export async function setDisplayName(userId: string, name: string): Promise<User> {
  const clean = String(name || "").trim();
  if (usingSupabase) {
    const { error } = await supabase()
      .from("users")
      .update({ display_name: clean || null })
      .eq("id", userId);
    if (error) throw new Error(`users.setDisplayName: ${error.message}`);
    return (await getUser(userId)) as User;
  }
  db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(clean || null, userId);
  return (await getUser(userId)) as User;
}

// ---- Serialization ---------------------------------------------------------

export async function serializeUser(user: User): Promise<SerializedUser> {
  return {
    id: user.id,
    handle: user.handle || null,
    displayName: user.displayName || null,
    emoji: user.emoji || null,
    color: user.color || null,
    wallets: await getWallets(user.id),
    primaryWallet: await getPrimaryWallet(user.id),
  };
}

/** Set the emoji + color avatar identity. Either field optional. */
export async function setIdentity(
  userId: string,
  patch: { emoji?: string; color?: string }
): Promise<User> {
  if (patch.emoji !== undefined) {
    const e = String(patch.emoji).slice(0, 8) || null;
    if (usingSupabase) {
      const { error } = await supabase().from("users").update({ emoji: e }).eq("id", userId);
      if (error) throw new Error(`users.setIdentity: ${error.message}`);
    } else {
      db.prepare("UPDATE users SET emoji = ? WHERE id = ?").run(e, userId);
    }
  }
  if (patch.color !== undefined) {
    const c = /^#[0-9a-fA-F]{3,8}$/.test(String(patch.color)) ? String(patch.color) : null;
    if (usingSupabase) {
      const { error } = await supabase().from("users").update({ color: c }).eq("id", userId);
      if (error) throw new Error(`users.setIdentity: ${error.message}`);
    } else {
      db.prepare("UPDATE users SET color = ? WHERE id = ?").run(c, userId);
    }
  }
  const u = await getUser(userId);
  if (!u) throw new Error("setIdentity: user not found");
  return u;
}

/**
 * Permanently delete a user account and its login/PII: the user row, all linked
 * identities (email/OAuth/wallet mappings), and wallet associations. Required for
 * App Store compliance (in-app account deletion). Does NOT touch on-chain funds —
 * those live in the user's own non-custodial wallet, which they keep. Trips/bills
 * the user shared with others are left intact (they belong to the shared group);
 * only this account's identity/PII is removed, unlinking them from it.
 */
export async function deleteUser(userId: string): Promise<void> {
  if (usingSupabase) {
    const sb = supabase();
    const w = await sb.from("user_wallets").delete().eq("user_id", userId);
    if (w.error) throw new Error(`users.deleteUser(wallets): ${w.error.message}`);
    const i = await sb.from("identities").delete().eq("user_id", userId);
    if (i.error) throw new Error(`users.deleteUser(identities): ${i.error.message}`);
    const u = await sb.from("users").delete().eq("id", userId);
    if (u.error) throw new Error(`users.deleteUser(user): ${u.error.message}`);
    return;
  }
  const tx = db.transaction((id: string) => {
    db.prepare("DELETE FROM user_wallets WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM identities WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
  });
  tx(userId);
}
