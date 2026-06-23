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

// Express Request augmentation: req.userId is set by authOptional.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// SESSION_SECRET must be set in production. In dev we fall back to a known
// insecure default but warn loudly (once) so it's never shipped silently.
function resolveSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is required in production — set SESSION_SECRET in the environment."
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    "⚠  using insecure default SESSION_SECRET — set SESSION_SECRET in production"
  );
  return "divvy-dev-secret-change-me";
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

function pruneNonces(): void {
  const now = Date.now();
  for (const [n, exp] of nonces) {
    if (exp < now) nonces.delete(n);
  }
}

export function issueNonce(): { nonce: string; message: string } {
  pruneNonces();
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

// ---- Express middleware ----------------------------------------------------

export function authOptional(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (m) {
    req.userId = verifySession(m[1]) || undefined;
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
