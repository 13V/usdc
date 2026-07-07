/**
 * waitlist.selftest.ts — validation + dedupe guards for POST /api/waitlist.
 *
 * The waitlist endpoint is the only unauthenticated cross-origin write on the
 * API, so what it accepts and what it stores must stay boring and predictable:
 *   • normalizeWaitlistEmail: trims, lowercases, caps at 254, rejects anything
 *     that isn't local@domain.tld-shaped (no whitespace/control chars, no
 *     missing parts, no bare domains) — and never throws on junk types.
 *   • addToWaitlist (SQLite path): first insert returns true, the same email —
 *     in any casing/padding once normalized — returns false and stays ONE row.
 *
 * Uses a scratch DB_PATH (set before the module require, like
 * autonudge.selftest.ts) so the dev database is untouched. Run via `npm test`.
 */

import * as os from "os";
import * as path from "path";
import * as fs from "fs";

// Point the shared db handle at a scratch file BEFORE the module loads (imports
// would hoist above the assignment, so the module under test uses require).
const SCRATCH_DB = path.join(os.tmpdir(), `divvy-waitlist-selftest-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = SCRATCH_DB;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const wl: typeof import("./waitlist") = require("./waitlist");

const { normalizeWaitlistEmail, addToWaitlist, WAITLIST_EMAIL_MAX, WAITLIST_CORS_ORIGINS } = wl;

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  // ── validation: the good ────────────────────────────────────────────────────
  ok("plain address passes", normalizeWaitlistEmail("mochi@divvysol.com") === "mochi@divvysol.com");
  ok(
    "trims + lowercases to a canonical form",
    normalizeWaitlistEmail("  Mochi@DivvySol.COM \n") === "mochi@divvysol.com"
  );
  ok("plus-tag and dots in local part pass", normalizeWaitlistEmail("a.b+tiktok@gmail.com") === "a.b+tiktok@gmail.com");
  ok("subdomain passes", normalizeWaitlistEmail("x@mail.uni-berlin.de") === "x@mail.uni-berlin.de");

  // ── validation: the junk ────────────────────────────────────────────────────
  ok("non-string types are null, never a throw", [null, undefined, 42, {}, ["a@b.co"]].every((v) => normalizeWaitlistEmail(v) === null));
  ok("empty / whitespace-only is null", normalizeWaitlistEmail("") === null && normalizeWaitlistEmail("   ") === null);
  ok("missing @ is null", normalizeWaitlistEmail("mochi.divvysol.com") === null);
  ok("missing local part is null", normalizeWaitlistEmail("@divvysol.com") === null);
  ok("missing domain is null", normalizeWaitlistEmail("mochi@") === null);
  ok("domain without a dot is null", normalizeWaitlistEmail("mochi@localhost") === null);
  ok("one-char TLD is null", normalizeWaitlistEmail("a@b.c") === null);
  ok("two @s are null", normalizeWaitlistEmail("a@b@c.com") === null);
  ok("inner whitespace is null", normalizeWaitlistEmail("mo chi@divvysol.com") === null);
  ok("control chars are null", normalizeWaitlistEmail("mochi\x00@divvysol.com") === null);
  const long = "a".repeat(WAITLIST_EMAIL_MAX) + "@divvysol.com";
  ok(`over ${WAITLIST_EMAIL_MAX} chars is null (length cap)`, normalizeWaitlistEmail(long) === null);
  const atCap = "a".repeat(WAITLIST_EMAIL_MAX - "@divvysol.com".length) + "@divvysol.com";
  ok("exactly at the cap still passes", normalizeWaitlistEmail(atCap) === atCap);

  // ── storage: dedupe by email (SQLite path, scratch DB) ──────────────────────
  const first = await addToWaitlist("mochi@divvysol.com");
  ok("first insert is new (true)", first === true);
  const dup = await addToWaitlist("mochi@divvysol.com");
  ok("second insert of the same email is a no-op (false)", dup === false);
  const other = await addToWaitlist("frog@divvysol.com");
  ok("a different email still inserts", other === true);

  // Normalization happens BEFORE storage, so a re-cased signup dedupes too.
  const recased = normalizeWaitlistEmail("  MOCHI@divvysol.com ");
  ok("re-cased signup normalizes to the stored key", recased === "mochi@divvysol.com");
  const dup2 = await addToWaitlist(recased as string);
  ok("…and is deduped by the primary key", dup2 === false);

  // Row-count ground truth straight from the scratch DB.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { db } = require("./db") as typeof import("./db");
  const n = (db.prepare("SELECT COUNT(*) AS n FROM waitlist").get() as { n: number }).n;
  ok("exactly 2 rows stored after 4 attempts", n === 2, `rows=${n}`);

  // ── CORS allowlist stays narrow ─────────────────────────────────────────────
  ok(
    "CORS allowlist is exactly the two site origins",
    WAITLIST_CORS_ORIGINS.size === 2 &&
      WAITLIST_CORS_ORIGINS.has("https://divvysol.com") &&
      WAITLIST_CORS_ORIGINS.has("https://www.divvysol.com")
  );
  ok("no wildcard / http origins allowed", ![...WAITLIST_CORS_ORIGINS].some((o) => o === "*" || o.startsWith("http:")));

  console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
  if (failed > 0) process.exit(1);
}

main()
  .then(() => {
    try {
      fs.rmSync(SCRATCH_DB, { force: true });
      fs.rmSync(SCRATCH_DB + "-wal", { force: true });
      fs.rmSync(SCRATCH_DB + "-shm", { force: true });
    } catch {
      /* scratch cleanup is best-effort */
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error("waitlist.selftest crashed:", e);
    process.exit(1);
  });
