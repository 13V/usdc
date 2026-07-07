/**
 * waitlist.ts — pre-launch "get early access" email capture.
 *
 * ONE public endpoint, POST /api/waitlist { email }, called cross-origin by the
 * static marketing site (site/ on Vercel → divvysol.com). No auth, no session:
 * the whole point is catching people before they have an account.
 *
 * Design constraints (deliberate, keep them):
 *   • Validation is pragmatic: trim, lowercase, cap at 254 chars (RFC 5321
 *     practical max), and a shape check (local@domain.tld, no whitespace).
 *     We're storing an address to email later, not certifying deliverability.
 *   • Dedupe by email: signing up twice is a silent success ({ ok:true } both
 *     times) so the endpoint can't be used to probe who's already on the list.
 *   • Rate limit: the shared spam tier (10/min/IP) — mass creation is the abuse.
 *   • CORS: a NARROW allowance for the marketing-site origins only, and only on
 *     this route. Everything else on the API stays same-origin (no global cors()).
 *   • Dual backend like every other store: SQLite locally, Supabase in prod
 *     (waitlist table — see supabase/schema.sql).
 *
 * Mount (one line in server.ts): app.use(waitlistRouter);
 */

import { Router, Request, Response } from "express";
import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { spamRateLimit } from "./ratelimit";

/** RFC 5321 practical maximum for an address; anything longer is junk. */
export const WAITLIST_EMAIL_MAX = 254;

/**
 * Normalize + validate a raw email value from an untrusted JSON body.
 * Returns the canonical (trimmed, lowercased) address, or null when invalid.
 * Shape check only: exactly one @, non-empty local part, domain with a dot and
 * a 2+ char TLD, no whitespace/control characters anywhere.
 */
export function normalizeWaitlistEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > WAITLIST_EMAIL_MAX) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(email)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

// ---- storage (dual-backed, same pattern as store.ts) ------------------------

// SQLite table lives here (module-local, additive) — schema.sql mirrors it for
// the Supabase/Postgres side.
db.exec(`
  CREATE TABLE IF NOT EXISTS waitlist (
    email      TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    source     TEXT
  );
`);

const insertStmt = db.prepare(
  "INSERT OR IGNORE INTO waitlist (email, created_at, source) VALUES (?, ?, ?)"
);

/**
 * Add a (pre-normalized) email to the waitlist. Returns true when the row is
 * new, false when it already existed — callers respond identically either way.
 */
export async function addToWaitlist(email: string, source = "site"): Promise<boolean> {
  const createdAt = new Date().toISOString();
  if (usingSupabase) {
    const { error, count } = await supabase()
      .from("waitlist")
      .upsert(
        { email, created_at: createdAt, source },
        { onConflict: "email", ignoreDuplicates: true, count: "exact" }
      );
    if (error) throw new Error(`waitlist.add: ${error.message}`);
    return (count || 0) > 0;
  }
  return insertStmt.run(email, createdAt, source).changes > 0;
}

// ---- the route ---------------------------------------------------------------

/**
 * Marketing-site origins allowed to call THIS endpoint cross-origin. Keep this
 * list to the static site only — the app itself is same-origin and needs none.
 */
export const WAITLIST_CORS_ORIGINS = new Set([
  "https://divvysol.com",
  "https://www.divvysol.com",
]);

function corsForSite(req: Request, res: Response): void {
  const origin = req.get("origin") || "";
  if (WAITLIST_CORS_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    // Response differs by Origin; keep caches honest (gzip appends Accept-Encoding).
    res.setHeader("Vary", "Origin");
  }
}

export const waitlistRouter = Router();

// Preflight: the site sends Content-Type: application/json, which is not a
// "simple" request, so the browser asks first.
waitlistRouter.options("/api/waitlist", (req: Request, res: Response) => {
  corsForSite(req, res);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.status(204).end();
});

waitlistRouter.post("/api/waitlist", spamRateLimit, async (req: Request, res: Response) => {
  corsForSite(req, res);
  const email = normalizeWaitlistEmail((req.body || {}).email);
  if (!email) {
    res.status(400).json({ error: "that doesn't look like an email" });
    return;
  }
  try {
    await addToWaitlist(email, "site");
  } catch (e) {
    console.error("waitlist insert failed:", e);
    res.status(500).json({ error: "could not save right now — try again in a minute" });
    return;
  }
  // Duplicate signups are a silent success (no enumeration oracle).
  res.json({ ok: true });
});
