/**
 * telemetry.ts — first-party error + product-analytics capture.
 *
 * Useful from day one with NO third-party account: the browser batches errors
 * and funnel events to POST /api/telemetry, we scrub obvious PII server-side and
 * store them in a small ring-buffered table (14-day retention). An admin can
 * read them back via GET /api/telemetry/recent (gated by ADMIN_TOKEN).
 *
 * When keys appear later we ALSO forward — errors to Sentry (SENTRY_DSN) and
 * events to PostHog (POSTHOG_KEY) — fire-and-forget, never blocking the response
 * and never adding an npm dependency (plain fetch, envelopes built by hand).
 *
 * Privacy: no PII, no wallet addresses, no amounts. The signed-in user's id is
 * never stored — only a sha256 hex slice (16) so the store holds no identity.
 *
 * Dual-store (SQLite + Supabase), like reactions.ts / referrals.ts. The Supabase
 * mirror table lives in supabase/schema.sql.
 *
 * Mount with (one import + one mount in server.ts):
 *   import { telemetryRouter } from "./telemetry";
 *   app.use(telemetryRouter(rateLimit(12, 60_000)));
 */

import * as crypto from "crypto";
import { Router, Request, Response, RequestHandler } from "express";
import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";

// ---- Schema (idempotent, dual-store) --------------------------------------
// Ring buffer: rows older than 14 days are deleted on insert (see pruneOld).
// The Supabase mirror lives in supabase/schema.sql.
db.exec(`
  CREATE TABLE IF NOT EXISTS telemetry (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    name       TEXT NOT NULL,
    detail     TEXT,
    url        TEXT,
    uhash      TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS telemetry_created_idx ON telemetry (created_at);
  CREATE INDEX IF NOT EXISTS telemetry_kind_idx ON telemetry (kind);
`);

// ---- Limits ----------------------------------------------------------------

const MAX_BATCH = 20;
const NAME_MAX = 80;
const DETAIL_MAX = 600;
const URL_MAX = 200;
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// ---- Types -----------------------------------------------------------------

interface TelemetryRow {
  id: string;
  kind: "error" | "event";
  name: string;
  detail: string | null;
  url: string | null;
  uhash: string | null;
  created_at: string;
}

// ---- Scrubbing -------------------------------------------------------------

/**
 * One-way, unsalted (per privacy design) fingerprint of the user id so the store
 * holds a stable-per-user token but no identity. sha256 hex, first 16 chars.
 */
function uhashOf(userId: string | undefined): string | null {
  if (!userId) return null;
  return crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 16);
}

/**
 * Strip obvious PII from a free-text detail before it is stored/forwarded:
 *   • base58 wallet-like runs (Solana address alphabet, 32–44 chars)
 *   • long hex runs (16+ — signatures, tokens, ids)
 * then collapse whitespace and cap the length. Defensive: the client already
 * avoids sending PII, this is the server-side backstop.
 */
function scrub(input: unknown): string {
  return String(input == null ? "" : input)
    .replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, "[addr]") // base58 (no 0 O I l)
    .replace(/[0-9a-fA-F]{16,}/g, "[hex]") // long hex
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DETAIL_MAX);
}

/** Coerce + length-cap a short string field (name / url). Collapses whitespace. */
function capField(input: unknown, max: number): string {
  return String(input == null ? "" : input).replace(/\s+/g, " ").trim().slice(0, max);
}

// ---- Ring-buffer prune (at most once a minute) -----------------------------

let lastPruneAt = 0;

async function pruneOld(): Promise<void> {
  const now = Date.now();
  if (now - lastPruneAt < 60_000) return; // cheap: run at most once a minute
  lastPruneAt = now;
  const cutoff = new Date(now - RETENTION_MS).toISOString();
  try {
    if (usingSupabase) {
      await supabase().from("telemetry").delete().lt("created_at", cutoff);
    } else {
      db.prepare("DELETE FROM telemetry WHERE created_at < ?").run(cutoff);
    }
  } catch {
    // Prune is best-effort housekeeping — never surface it to the caller.
  }
}

// ---- Store I/O -------------------------------------------------------------

async function insertRows(rows: TelemetryRow[]): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase().from("telemetry").insert(rows);
    if (error) throw new Error(`telemetry.insert: ${error.message}`);
    return;
  }
  const stmt = db.prepare(
    "INSERT INTO telemetry (id, kind, name, detail, url, uhash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const tx = db.transaction((rs: TelemetryRow[]) => {
    for (const r of rs) stmt.run(r.id, r.kind, r.name, r.detail, r.url, r.uhash, r.created_at);
  });
  tx(rows);
}

async function recentRows(limit: number): Promise<TelemetryRow[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("telemetry")
      .select("id, kind, name, detail, url, uhash, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`telemetry.recent: ${error.message}`);
    return (data || []) as TelemetryRow[];
  }
  return db
    .prepare(
      "SELECT id, kind, name, detail, url, uhash, created_at FROM telemetry ORDER BY created_at DESC LIMIT ?"
    )
    .all(limit) as TelemetryRow[];
}

// ---- Forwarders (fire-and-forget, both optional) ---------------------------

interface SentryDsn {
  publicKey: string;
  projectId: string;
  storeUrl: string;
}

/**
 * Parse a Sentry DSN (https://<publicKey>@<host>/<projectId>) into the store
 * endpoint. The store API accepts a plain JSON event with an X-Sentry-Auth
 * header — no @sentry package needed.
 */
function parseSentryDsn(dsn: string): SentryDsn | null {
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\/+/, "");
    if (!publicKey || !projectId) return null;
    return {
      publicKey,
      projectId,
      storeUrl: `${u.protocol}//${u.host}/api/${projectId}/store/`,
    };
  } catch {
    return null;
  }
}

/** POST one error to Sentry's /api/<project>/store/ endpoint. Best-effort. */
async function forwardSentry(row: TelemetryRow): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return;
  const payload = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: new Date(row.created_at).toISOString(),
    platform: "javascript",
    level: "error",
    logger: "divvy.telemetry",
    message: row.detail ? `${row.name} — ${row.detail}` : row.name,
    tags: { kind: row.kind, url: row.url || "", uhash: row.uhash || "" },
  };
  try {
    await fetch(parsed.storeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=divvy-telemetry/1.0, sentry_key=${parsed.publicKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // never let a forwarder failure surface
  }
}

/** POST one row to PostHog's /capture/ endpoint. Best-effort. */
async function forwardPostHog(row: TelemetryRow): Promise<void> {
  const key = process.env.POSTHOG_KEY;
  if (!key) return;
  const host = (process.env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/+$/, "");
  const payload = {
    api_key: key,
    event: row.name,
    distinct_id: row.uhash || "anon",
    timestamp: row.created_at,
    properties: {
      kind: row.kind,
      url: row.url || undefined,
      detail: row.detail || undefined,
      $lib: "divvy-telemetry",
    },
  };
  try {
    await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // never let a forwarder failure surface
  }
}

/** Kick off the (optional) forwarders without awaiting — never blocks a request. */
function forward(rows: TelemetryRow[]): void {
  for (const r of rows) {
    if (r.kind === "error") void forwardSentry(r);
    void forwardPostHog(r); // PostHog captures both errors and events
  }
}

// ---- Router ----------------------------------------------------------------

/**
 * Build the telemetry router. Pass the shared rateLimit() middleware from
 * server.ts so the ingest endpoint reuses the app's IP limiter.
 */
export function telemetryRouter(rateLimitMw: RequestHandler): Router {
  const router = Router();

  /**
   * POST /api/telemetry — ingest a small batch of client events.
   * Body: { events: [{ kind:"error"|"event", name, detail?, url?, at }] }
   * authOptional (global) sets req.userId; we store only its hash. Always 200s
   * (telemetry must never break the app), with { ok, stored }.
   */
  router.post(
    "/api/telemetry",
    rateLimitMw,
    async (req: Request, res: Response): Promise<void> => {
      const body = (req.body || {}) as { events?: unknown };
      const events = Array.isArray(body.events) ? body.events : [];
      const uhash = uhashOf(req.userId);
      const createdAt = new Date().toISOString();

      const rows: TelemetryRow[] = [];
      for (const raw of events.slice(0, MAX_BATCH)) {
        if (!raw || typeof raw !== "object") continue;
        const ev = raw as { kind?: unknown; name?: unknown; detail?: unknown; url?: unknown };
        const name = capField(ev.name, NAME_MAX);
        if (!name) continue;
        const kind: "error" | "event" = ev.kind === "error" ? "error" : "event";
        rows.push({
          id: crypto.randomUUID(),
          kind,
          name,
          detail: ev.detail != null ? scrub(ev.detail) : null,
          url: ev.url != null ? capField(ev.url, URL_MAX) : null,
          uhash,
          created_at: createdAt,
        });
      }

      if (!rows.length) {
        res.json({ ok: true, stored: 0 });
        return;
      }

      try {
        await insertRows(rows);
      } catch {
        // Storage hiccup must not break the client; report soft-fail.
        res.status(200).json({ ok: false, stored: 0 });
        return;
      }
      void pruneOld(); // ring-buffer housekeeping, non-blocking
      forward(rows); // optional Sentry/PostHog, non-blocking
      res.json({ ok: true, stored: rows.length });
    }
  );

  /**
   * GET /api/telemetry/recent?limit=100 — admin read-back. Gated by ADMIN_TOKEN
   * (Bearer or ?token=). 404s (hidden) when ADMIN_TOKEN is unset OR the token is
   * missing/wrong. Errors first, then events, plus a top-list grouped by name.
   */
  router.get(
    "/api/telemetry/recent",
    async (req: Request, res: Response): Promise<void> => {
      const admin = process.env.ADMIN_TOKEN;
      const bearer = (/^Bearer\s+(.+)$/i.exec(req.header("authorization") || "") || [])[1];
      const token = (bearer || String(req.query.token || "")).trim();
      // Hidden endpoint: indistinguishable 404 whether unset, missing, or wrong.
      if (!admin || token !== admin) {
        res.status(404).json({ error: "not found" });
        return;
      }
      let limit = Number(req.query.limit);
      if (!Number.isFinite(limit) || limit <= 0) limit = 100;
      limit = Math.min(Math.max(Math.floor(limit), 1), 500);

      const rows = await recentRows(limit);
      const errors = rows.filter((r) => r.kind === "error");
      const events = rows.filter((r) => r.kind === "event");
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.name] = (counts[r.name] || 0) + 1;
      const top = Object.keys(counts)
        .map((name) => ({ name, count: counts[name] }))
        .sort((a, b) => b.count - a.count);

      res.json({
        total: rows.length,
        errorCount: errors.length,
        eventCount: events.length,
        top,
        recent: [...errors, ...events], // errors first, then events
      });
    }
  );

  return router;
}
