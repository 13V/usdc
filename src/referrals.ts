/**
 * referrals.ts — Invite attribution (the "who brought whom" growth loop).
 *
 * When a signed-in user shares a trip/pay link, the server stamps their id onto
 * the URL (`?ref=<inviterUserId>`). When a visitor opens that link, the share/pay
 * page renderer drops a first-party `divvy_ref` cookie (30d, SameSite=Lax). At an
 * identity moment (claiming a trip member slot / signing up), we read the cookie
 * and record ONE attribution for that new user — first inviter wins, never a
 * self-referral.
 *
 * STRICT SCOPE: this file owns the `referrals` table + the invites router + the
 * cookie/attribution helpers only. It reuses identity from users.ts and auth from
 * auth.ts. Follows the dual-store (SQLite + Supabase) pattern in friends.ts.
 *
 * Mount with:
 *   import { referralsRouter } from "./referrals";
 *   app.use(referralsRouter);
 */

import * as crypto from "crypto";
import { Router, Request, Response } from "express";
import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { requireAuth } from "./auth";
import { getUser } from "./users";

// ---- Schema (idempotent, dual-store) --------------------------------------
// One attribution per invited user: invited_user_id is UNIQUE so "first wins"
// falls out of an INSERT OR IGNORE. The Supabase mirror lives in
// supabase/schema.sql. Separate table from trips — no trips-schema edits.

db.exec(`
  CREATE TABLE IF NOT EXISTS referrals (
    id TEXT PRIMARY KEY,
    inviter_user_id TEXT NOT NULL,
    invited_user_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    source TEXT
  );
  CREATE INDEX IF NOT EXISTS referrals_inviter_idx ON referrals (inviter_user_id);
`);

// ---- Cookie helpers --------------------------------------------------------

const REF_COOKIE = "divvy_ref";
const REF_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Set the first-party ref cookie from a `?ref=` value. HttpOnly (server-only,
 * used at signup/claim), SameSite=Lax so it survives the click-through from a
 * messenger, 30-day life. No-op when there's no ref. Bounded length so a hostile
 * link can't stuff a giant cookie.
 */
export function setRefCookie(res: Response, ref: unknown): void {
  const clean = String(ref == null ? "" : ref).trim().slice(0, 64);
  if (!clean) return;
  res.cookie(REF_COOKIE, clean, {
    maxAge: REF_MAX_AGE_MS,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

/** Read the ref value out of the incoming Cookie header (no cookie-parser dep). */
export function readRefCookie(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== REF_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    } catch {
      return part.slice(eq + 1).trim() || null;
    }
  }
  return null;
}

// ---- Attribution write -----------------------------------------------------

interface ReferralRow {
  inviter_user_id: string;
  invited_user_id: string;
  created_at: string;
  source: string | null;
}

async function existingAttribution(invitedUserId: string): Promise<boolean> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("referrals")
      .select("invited_user_id")
      .eq("invited_user_id", invitedUserId)
      .maybeSingle();
    if (error) throw new Error(`referrals.existing: ${error.message}`);
    return !!data;
  }
  return !!db.prepare("SELECT 1 FROM referrals WHERE invited_user_id = ?").get(invitedUserId);
}

/**
 * Record that `inviterUserId` brought `invitedUserId`. First inviter wins (the
 * UNIQUE invited_user_id makes a later attribution a no-op); never a
 * self-referral; the inviter must be a real user. Best-effort by design — the
 * caller treats any throw as "no attribution" and never fails the user's action.
 */
export async function recordReferral(
  inviterUserId: string | null | undefined,
  invitedUserId: string,
  source: string
): Promise<boolean> {
  const inviter = String(inviterUserId || "").trim();
  if (!inviter || !invitedUserId) return false;
  if (inviter === invitedUserId) return false; // no self-referral
  if (!(await getUser(inviter))) return false; // inviter must exist
  if (await existingAttribution(invitedUserId)) return false; // first wins

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  if (usingSupabase) {
    const { error } = await supabase()
      .from("referrals")
      .insert({ id, inviter_user_id: inviter, invited_user_id: invitedUserId, created_at: createdAt, source });
    // A concurrent insert can still lose the unique race — treat that as "already
    // attributed" rather than an error.
    if (error && !/duplicate|unique|conflict/i.test(error.message)) {
      throw new Error(`referrals.record: ${error.message}`);
    }
    return !error;
  }
  const res = db
    .prepare(
      "INSERT OR IGNORE INTO referrals (id, inviter_user_id, invited_user_id, created_at, source) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, inviter, invitedUserId, createdAt, source);
  return res.changes > 0;
}

// ---- Reads -----------------------------------------------------------------

async function listByInviter(inviterUserId: string): Promise<ReferralRow[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("referrals")
      .select("*")
      .eq("inviter_user_id", inviterUserId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`referrals.listByInviter: ${error.message}`);
    return (data || []) as ReferralRow[];
  }
  return db
    .prepare("SELECT * FROM referrals WHERE inviter_user_id = ? ORDER BY created_at DESC")
    .all(inviterUserId) as ReferralRow[];
}

// ---- Router ----------------------------------------------------------------

export const referralsRouter = Router();

/**
 * GET /api/me/invites → { count, recent: [{ name, handle, at }] }
 * Friends this user has brought to Divvy, newest first (recent capped at 5).
 */
referralsRouter.get("/api/me/invites", requireAuth, async (req: Request, res: Response) => {
  const meId = req.userId as string;
  const rows = await listByInviter(meId);
  const recent: { name: string; handle: string | null; at: string }[] = [];
  for (const r of rows.slice(0, 5)) {
    const u = await getUser(r.invited_user_id);
    const handle = (u && u.handle) || null;
    const name = (u && u.displayName) || (handle ? `@${handle}` : "a new friend");
    recent.push({ name, handle, at: r.created_at });
  }
  res.json({ count: rows.length, recent });
});
