/**
 * autonudge.selftest.ts — Offline due-date + auto-nudge tests. No network.
 *
 * GUARDRAILS under test: due-date validation (future only, ≤ 1 year, date-only
 * strings cover the whole day); cadence math (next-send timing per cadence);
 * every HARD RULE in decideAutoNudge (settled debt, pending settle-outside
 * claim, 24h floor, 10-send cap, self-nudge rejection, not-due-yet);
 * escalation capping at the existing 🦆 stage; and the CAS at-most-once send
 * claim staying safe across racing passes / a server restart replaying stale
 * state. Run with `npm test`.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Pin the shared db handle to a scratch file BEFORE loading the module under
// test (imports would hoist above the assignment, so this one uses require).
// Keeps the dev database untouched by the CAS tests' real writes.
const SCRATCH_DB = path.join(os.tmpdir(), `divvy-autonudge-selftest-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = SCRATCH_DB;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const an: typeof import("./autonudge") = require("./autonudge");

const {
  validateDueAt,
  decideAutoNudge,
  escalationStage,
  nextSendAt,
  CADENCE_DAYS,
  MIN_GAP_MS,
  MAX_AUTO_SENDS,
  ensureAutoNudgeSendRow,
  claimAutoNudgeSend,
  getAutoNudgeSendState,
} = an;

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

const NOW = new Date("2026-07-05T12:00:00.000Z").getTime();
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

// A decideAutoNudge input that SHOULD send; tests flip one field at a time.
function base(over?: Partial<Parameters<typeof decideAutoNudge>[0]>) {
  return {
    cadence: "standard",
    dueAt: null as string | null,
    lastSentAt: null as string | null,
    sendCount: 0,
    debtCents: 2300,
    claimPending: false,
    debtorUserId: "u-sam",
    creditorUserId: "u-me",
    nowMs: NOW,
    ...over,
  };
}

// ---- validateDueAt -----------------------------------------------------------

{
  const past = validateDueAt("2026-07-01T00:00:00.000Z", NOW);
  const tooFar = validateDueAt(iso(NOW + 400 * DAY), NOW);
  const fine = validateDueAt(iso(NOW + 3 * DAY), NOW);
  const junk = validateDueAt("not-a-date", NOW);
  ok(
    "dueAt: past rejected, >1yr rejected, junk rejected, valid future ok",
    !past.ok && !tooFar.ok && !junk.ok && fine.ok && fine.dueAt === iso(NOW + 3 * DAY)
  );
}
{
  const cleared = validateDueAt(null, NOW);
  const cleared2 = validateDueAt("", NOW);
  ok("dueAt: null/'' clears (ok, dueAt null)", cleared.ok && cleared.dueAt === null && cleared2.ok && cleared2.dueAt === null);
}
{
  // A bare date means "due that day" — normalize to END of the UTC day so the
  // chip doesn't flip coral at midnight the moment sunday starts.
  const day = validateDueAt("2026-07-12", NOW);
  ok(
    "dueAt: bare YYYY-MM-DD covers the whole day (23:59:59.999Z)",
    day.ok && day.dueAt === "2026-07-12T23:59:59.999Z",
    day.ok ? day.dueAt ?? "" : day.error
  );
  const today = validateDueAt("2026-07-05", NOW); // later today → still future → ok
  ok("dueAt: today (date-only) is still settable until midnight", today.ok);
}

// ---- cadence math (nextSendAt) -------------------------------------------------

{
  ok(
    "cadence: intervals gentle=5d standard=3d spicy=1d",
    CADENCE_DAYS.gentle === 5 && CADENCE_DAYS.standard === 3 && CADENCE_DAYS.spicy === 1
  );
  const off = nextSendAt("off", null, null, NOW);
  const now = nextSendAt("standard", null, null, NOW);
  const due = nextSendAt("standard", iso(NOW + 2 * DAY), null, NOW);
  const afterGentle = nextSendAt("gentle", null, iso(NOW - DAY), NOW);
  const afterSpicy = nextSendAt("spicy", null, iso(NOW - DAY), NOW);
  ok("cadence: off → null (never)", off === null);
  ok("cadence: on + no due date + never sent → now (start immediately)", now === iso(NOW));
  ok("cadence: future due date → first send at the due date", due === iso(NOW + 2 * DAY));
  ok(
    "cadence: sent → next = last + interval (gentle 5d, spicy 1d)",
    afterGentle === iso(NOW - DAY + 5 * DAY) && afterSpicy === iso(NOW - DAY + 1 * DAY)
  );
}

// ---- decideAutoNudge: the hard rules -------------------------------------------

{
  const d = decideAutoNudge(base());
  ok("rules: happy path sends at stage 1 (polite)", d.send === true && d.send && d.stage === 1);
}
{
  const zero = decideAutoNudge(base({ debtCents: 0 }));
  const neg = decideAutoNudge(base({ debtCents: -500 }));
  ok("rules: settled / zero / negative debt never nudges", !zero.send && !neg.send);
}
{
  const d = decideAutoNudge(base({ claimPending: true }));
  ok("rules: pending settle-outside claim pauses auto-nudges", !d.send);
}
{
  // 24h floor beats even spicy: last sent 23h ago → no.
  const floor = decideAutoNudge(base({ cadence: "spicy", lastSentAt: iso(NOW - 23 * 60 * 60 * 1000), sendCount: 1 }));
  const after = decideAutoNudge(base({ cadence: "spicy", lastSentAt: iso(NOW - MIN_GAP_MS - 1000), sendCount: 1 }));
  ok("rules: never twice within 24h regardless of cadence; ok after", !floor.send && after.send === true);
}
{
  // standard = every 3 days: 2 days since last → wait; 3 days → go.
  const wait = decideAutoNudge(base({ lastSentAt: iso(NOW - 2 * DAY), sendCount: 2 }));
  const go = decideAutoNudge(base({ lastSentAt: iso(NOW - 3 * DAY), sendCount: 2 }));
  ok("rules: cadence interval respected (standard: 2d wait, 3d go)", !wait.send && go.send === true);
}
{
  const capped = decideAutoNudge(base({ sendCount: MAX_AUTO_SENDS, lastSentAt: iso(NOW - 30 * DAY) }));
  const nearCap = decideAutoNudge(base({ sendCount: MAX_AUTO_SENDS - 1, lastSentAt: iso(NOW - 30 * DAY) }));
  ok("rules: stops after 10 sends (10th is the last)", !capped.send && nearCap.send === true);
}
{
  const d = decideAutoNudge(base({ debtorUserId: "u-me" })); // debtor == creditor
  ok("rules: a debtor can never be auto-nudged by themselves", !d.send);
}
{
  const early = decideAutoNudge(base({ dueAt: iso(NOW + DAY) }));
  const late = decideAutoNudge(base({ dueAt: iso(NOW - 1000) }));
  ok("rules: waits for the due date, fires once it passes", !early.send && late.send === true);
}
{
  const d = decideAutoNudge(base({ cadence: "off" }));
  const junk = decideAutoNudge(base({ cadence: "hourly" }));
  ok("rules: cadence off / unknown never sends", !d.send && !junk.send);
}

// ---- escalation: manual tone ladder, capped at the 🦆 ---------------------------

{
  ok(
    "escalation: 0→1 (polite), 1→2 (👀), 3→4 (🦆), 9→4 (capped at the duck)",
    escalationStage(0) === 1 && escalationStage(1) === 2 && escalationStage(3) === 4 && escalationStage(9) === 4
  );
  const d = decideAutoNudge(base({ sendCount: 7, lastSentAt: iso(NOW - 10 * DAY) }));
  ok("escalation: decision carries the capped stage", d.send === true && d.send && d.stage === 4);
}

// ---- CAS at-most-once send claim (DB-backed; restart safety) --------------------

async function casTests(): Promise<void> {
  const cfg = "tab:u-me:u-sam";
  const debtor = "u-sam";

  await ensureAutoNudgeSendRow(cfg, debtor);
  await ensureAutoNudgeSendRow(cfg, debtor); // idempotent
  const fresh = await getAutoNudgeSendState(cfg, debtor);
  ok("cas: ensure row is idempotent (count 0, never sent)", !!fresh && fresh.send_count === 0 && fresh.last_sent_at === null);

  // Two passes (or a restarted server replaying the same stale state) both try
  // to claim send #1 — exactly one may win.
  const t1 = iso(NOW);
  const winA = await claimAutoNudgeSend(cfg, debtor, null, 0, t1);
  const winB = await claimAutoNudgeSend(cfg, debtor, null, 0, iso(NOW + 5000));
  ok("cas: only one of two racing claims wins (restart-safe)", winA === true && winB === false);

  const st1 = await getAutoNudgeSendState(cfg, debtor);
  ok("cas: winner recorded last_sent_at + count 1", !!st1 && st1.send_count === 1 && st1.last_sent_at === t1);

  // The next claim must be based on the CURRENT state to win.
  const stale = await claimAutoNudgeSend(cfg, debtor, null, 0, iso(NOW + 4 * DAY));
  const current = await claimAutoNudgeSend(cfg, debtor, t1, 1, iso(NOW + 4 * DAY));
  ok("cas: stale state loses, current state wins", stale === false && current === true);

  // The DB layer re-enforces the send cap even if a caller's decision is buggy.
  const cfg2 = "tab:u-me:u-capped";
  await ensureAutoNudgeSendRow(cfg2, "u-capped");
  let prev: string | null = null;
  for (let i = 0; i < MAX_AUTO_SENDS; i++) {
    const t: string = iso(NOW + i * 2 * DAY);
    const won = await claimAutoNudgeSend(cfg2, "u-capped", prev, i, t);
    if (!won) { ok("cas: cap loop claim failed unexpectedly", false, `i=${i}`); break; }
    prev = t;
  }
  const overCap = await claimAutoNudgeSend(cfg2, "u-capped", prev, MAX_AUTO_SENDS, iso(NOW + 40 * DAY));
  const capped = await getAutoNudgeSendState(cfg2, "u-capped");
  ok(
    `cas: DB refuses send #${MAX_AUTO_SENDS + 1} (count stays ${MAX_AUTO_SENDS})`,
    overCap === false && !!capped && capped.send_count === MAX_AUTO_SENDS
  );
}

void casTests()
  .catch((e) => {
    failed++;
    console.log(`FAIL  cas: threw — ${(e as Error).message}`);
  })
  .finally(() => {
    // best-effort scratch-db cleanup (incl. WAL sidecars)
    for (const f of [SCRATCH_DB, `${SCRATCH_DB}-wal`, `${SCRATCH_DB}-shm`]) {
      try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
    }
    console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
    process.exit(failed === 0 ? 0 : 1);
  });
