/**
 * auth.ts — Progressive identity: sessions, Sign-In-With-Solana (SIWS), Privy.
 *
 * ADDITIVE only. None of the existing anonymous/capability-link flows depend on
 * this. Auth ADDS identity-specific abilities (claim your spot, "my trips").
 *
 *   - Session tokens are stateless HMAC-signed blobs (no DB, no new dep).
 *   - SIWS proves wallet ownership with a single-use nonce + ed25519 signature.
 *   - Privy (gated by PRIVY_APP_ID) verifies a Privy JWT via remote JWKS.
 */

import * as crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import nacl from "tweetnacl";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { PublicKey } from "@solana/web3.js";
import { userExists } from "./users";
import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";

// Express Request augmentation: req.userId is set by authOptional.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// SESSION_SECRET signs stateless session tokens, so a KNOWN secret means anyone
// can forge a session for any user. We therefore never fall back to a hard-coded
// default. When unset we generate a RANDOM per-process secret: secure in every
// environment, zero config for local dev — the only cost is that sessions don't
// survive a restart (or span multiple instances) until SESSION_SECRET is set.
function resolveSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) return fromEnv;
  // In production a random per-process secret would silently log everyone out on
  // each restart and break multi-instance — fail fast instead so it's caught at
  // deploy time, not by confused users.
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production — set it in the environment.");
  }
  // eslint-disable-next-line no-console
  console.warn(
    "⚠  SESSION_SECRET not set — using a random per-process secret. Sessions will " +
      "reset on restart and won't work across multiple instances. Set SESSION_SECRET to fix."
  );
  return crypto.randomBytes(32).toString("hex");
}

const SESSION_SECRET = resolveSessionSecret();
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---- Base64url helpers -----------------------------------------------------

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

// ---- Session tokens (HMAC) -------------------------------------------------

function hmac(payload: string): Buffer {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest();
}

export function signSession(userId: string): string {
  const payload = b64url(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS }));
  const sig = b64url(hmac(payload));
  return `${payload}.${sig}`;
}

export function verifySession(token: string): string | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = b64url(hmac(payload));
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || typeof data.uid !== "string") return null;
    if (typeof data.exp !== "number" || Date.now() > data.exp) return null;
    return data.uid;
  } catch {
    return null;
  }
}

// ---- SIWS: nonce store + verify --------------------------------------------

const nonces = new Map<string, number>(); // nonce -> expiry epoch ms
const MAX_NONCES = 5000; // hard cap so the Map can't grow unbounded

function pruneNonces(): void {
  const now = Date.now();
  for (const [n, exp] of nonces) {
    if (exp < now) nonces.delete(n);
  }
}

export function issueNonce(): { nonce: string; message: string } {
  pruneNonces();
  // Beyond TTL pruning, evict the oldest entries (Map preserves insertion order)
  // if we're still over the cap — an attacker can't balloon memory by spamming.
  while (nonces.size >= MAX_NONCES) {
    const oldest = nonces.keys().next().value;
    if (oldest === undefined) break;
    nonces.delete(oldest);
  }
  const nonce = crypto.randomBytes(16).toString("hex");
  nonces.set(nonce, Date.now() + NONCE_TTL_MS);
  const issuedAt = new Date().toISOString();
  const message =
    `Divvy — sign in to prove you own this wallet.\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}`;
  return { nonce, message };
}

function parseNonce(message: string): string | null {
  const m = /Nonce:\s*(\S+)/.exec(message || "");
  return m ? m[1] : null;
}

/**
 * Pure, offline-testable ed25519 verification. Given the signed message string,
 * the raw signature bytes, and the signer's base58 pubkey, returns true iff the
 * signature is valid.
 */
export function verifySignature(
  message: string,
  signatureBytes: Uint8Array,
  pubkeyBase58: string
): boolean {
  try {
    const msgBytes = new TextEncoder().encode(message);
    const pubBytes = new PublicKey(pubkeyBase58).toBytes();
    return nacl.sign.detached.verify(msgBytes, signatureBytes, pubBytes);
  } catch {
    return false;
  }
}

export function verifySiws(input: {
  pubkey: string;
  signatureB64: string;
  message: string;
}): boolean {
  const { pubkey, signatureB64, message } = input;
  if (!pubkey || !signatureB64 || !message) return false;

  pruneNonces();
  const nonce = parseNonce(message);
  if (!nonce) return false;

  const exp = nonces.get(nonce);
  if (exp === undefined || exp < Date.now()) {
    nonces.delete(nonce);
    return false;
  }
  // Single-use: consume the nonce regardless of signature outcome.
  nonces.delete(nonce);

  let sigBytes: Uint8Array;
  try {
    sigBytes = new Uint8Array(Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
  return verifySignature(message, sigBytes, pubkey);
}

// ---- Native OAuth handoff codes (Capacitor shell) ---------------------------
// The iOS shell's WKWebView can't complete Google OAuth ("disallowed_useragent")
// and an OAuth session completed in the system browser lands in Safari's
// storage, not the shell's. The standard fix: the system browser finishes the
// login, then hands the session back to the shell via a SINGLE-USE, short-TTL
// code carried on a divvy:// deep link.
//
// Design (deliberately stateful): a stateless signed code cannot be PROVABLY
// single-use (nothing records that it was already redeemed), so codes live in
// the same dual sqlite/Supabase store as the other single-use money guards
// (see consumedSignatures.ts). Only SHA-256(code) is stored — a leaked DB row
// can't be replayed as a code — and the exchange looks rows up BY that hash, so
// no raw-code string comparison ever happens server-side (the hash lookup is
// the constant-time-compare equivalent: index timing can't leak code bytes
// without a preimage). Codes are never logged. Redemption is one atomic
// DELETE…RETURNING, so two concurrent exchanges can never both succeed.

const HANDOFF_CODE_BYTES = 16; // 128-bit crypto-random

// TTL is read per-call (not module-load) so the selftest can shrink it at
// runtime without a separate server process. Production default: 60 seconds.
function handoffTtlMs(): number {
  const v = Number(process.env.HANDOFF_TTL_MS);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
}

function hashHandoffCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// SQLite: create the table locally (Supabase is provisioned via schema.sql).
db.exec(`
  CREATE TABLE IF NOT EXISTS auth_handoff_codes (
    code_hash  TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

/**
 * Mint a single-use handoff code bound to `userId`. Returns the raw code (the
 * caller relays it to the client exactly once) or null if the store is
 * unavailable — fail CLOSED: no session handoff without proof of single-use.
 */
export async function mintHandoffCode(userId: string): Promise<string | null> {
  const code = crypto.randomBytes(HANDOFF_CODE_BYTES).toString("base64url");
  const codeHash = hashHandoffCode(code);
  const now = Date.now();
  const expiresAt = now + handoffTtlMs();
  const createdAt = new Date(now).toISOString();

  if (usingSupabase) {
    try {
      // Opportunistic prune of expired rows keeps the table tiny (mint is
      // authenticated + rate-limited, so growth is bounded anyway).
      await supabase().from("auth_handoff_codes").delete().lt("expires_at", now);
      const { error } = await supabase()
        .from("auth_handoff_codes")
        .insert([{ code_hash: codeHash, user_id: userId, expires_at: expiresAt, created_at: createdAt }]);
      return error ? null : code;
    } catch {
      return null;
    }
  }

  try {
    db.prepare("DELETE FROM auth_handoff_codes WHERE expires_at <= ?").run(now);
    db.prepare(
      "INSERT INTO auth_handoff_codes (code_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).run(codeHash, userId, expiresAt, createdAt);
    return code;
  } catch {
    return null;
  }
}

/**
 * Redeem a handoff code. Returns the bound userId on the FIRST valid use, null
 * otherwise (unknown, expired, already used, or store error — all fail closed).
 * The row is consumed atomically in the same statement that reads it, so a
 * replayed or concurrent exchange finds nothing.
 */
export async function exchangeHandoffCode(code: string): Promise<string | null> {
  // Cheap shape gate before any store work (codes are 22-char base64url).
  if (typeof code !== "string" || code.length < 16 || code.length > 64) return null;
  const codeHash = hashHandoffCode(code);
  const now = Date.now();

  if (usingSupabase) {
    try {
      // Single-statement DELETE with RETURNING (PostgREST return=representation)
      // — atomic: exactly one caller can ever see the row.
      const { data, error } = await supabase()
        .from("auth_handoff_codes")
        .delete()
        .eq("code_hash", codeHash)
        .select("user_id, expires_at");
      if (error || !data || data.length !== 1) return null;
      // Expired codes are rejected (and are now deleted either way).
      if (Number(data[0].expires_at) <= now) return null;
      return String(data[0].user_id);
    } catch {
      return null;
    }
  }

  try {
    const row = db
      .prepare("DELETE FROM auth_handoff_codes WHERE code_hash = ? RETURNING user_id, expires_at")
      .get(codeHash) as { user_id: string; expires_at: number } | undefined;
    if (!row) return null;
    if (Number(row.expires_at) <= now) return null;
    return row.user_id;
  } catch {
    return null;
  }
}

// ---- Privy (gated by PRIVY_APP_ID) -----------------------------------------

export function privyConfigured(): boolean {
  return !!process.env.PRIVY_APP_ID;
}

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedJwksAppId: string | null = null;

function privyJwks(appId: string) {
  if (!cachedJwks || cachedJwksAppId !== appId) {
    cachedJwks = createRemoteJWKSet(
      new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`)
    );
    cachedJwksAppId = appId;
  }
  return cachedJwks;
}

export async function verifyPrivyToken(token: string): Promise<{ subject: string } | null> {
  const appId = process.env.PRIVY_APP_ID;
  if (!appId) return null;
  try {
    const { payload } = await jwtVerify(token, privyJwks(appId), {
      issuer: "privy.io",
      audience: appId,
    });
    if (!payload.sub) return null;
    return { subject: String(payload.sub) };
  } catch {
    return null;
  }
}

/**
 * Authoritative wallet list for a Privy user, fetched from Privy's server API
 * with the app SECRET — the ONLY trustworthy source of which wallets a Privy
 * account owns. The access-token JWT does not prove wallet ownership, and the
 * client-supplied wallet must NEVER be trusted (an attacker can claim any
 * address). Returns the lowercased/base58 wallet addresses Privy confirms.
 *
 * Fails SAFE: if PRIVY_APP_SECRET is unset or the call errors, returns [] so the
 * caller links no wallet rather than a forged one. (Enabling Privy server-side
 * therefore REQUIRES PRIVY_APP_SECRET to get embedded wallets linked.)
 */
export async function fetchPrivyWallets(subject: string): Promise<string[]> {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) return [];
  try {
    const auth = Buffer.from(`${appId}:${appSecret}`).toString("base64");
    const r = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(subject)}`, {
      headers: { authorization: `Basic ${auth}`, "privy-app-id": appId },
    });
    if (!r.ok) return [];
    const data = (await r.json()) as { linked_accounts?: Array<Record<string, unknown>> };
    const accounts = Array.isArray(data.linked_accounts) ? data.linked_accounts : [];
    const wallets: string[] = [];
    for (const a of accounts) {
      // Solana embedded/external wallets surface as type "wallet" with an address.
      if ((a.type === "wallet" || a.type === "smart_wallet") && typeof a.address === "string") {
        const chain = String(a.chain_type || a.chainType || "");
        // Keep Solana addresses only (this app settles on Solana).
        if (!chain || chain === "solana") wallets.push(a.address);
      }
    }
    return wallets;
  } catch {
    return [];
  }
}

// ---- Express middleware ----------------------------------------------------

export async function authOptional(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (m) {
    const uid = verifySession(m[1]) || undefined;
    if (uid) {
      // Stateless tokens can't be individually revoked, so a deleted account's
      // token would otherwise stay live for its full 30-day TTL. Require the
      // user row to still exist (cached — one DB hit per user per process).
      // Fail OPEN on a store error: an outage degrades to "revocation delayed",
      // not "everyone signed out".
      try {
        req.userId = (await userExists(uid)) ? uid : undefined;
      } catch {
        req.userId = uid;
      }
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.status(401).json({ error: "sign in required" });
    return;
  }
  next();
}
