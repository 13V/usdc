/**
 * telemetry.selftest.ts — regression guard for the error-rate alert hook.
 *
 * The alerter (src/telemetry.ts → makeErrorAlerter) keeps a 10-minute rolling
 * count of client `error` rows and pages ONCE when the count crosses a threshold,
 * then stays quiet for a cooldown. This exercises that state machine with a
 * stubbed poster/pusher and an injected clock — no network, fully deterministic —
 * and asserts the two properties that matter operationally:
 *   • the threshold crossing fires EXACTLY ONE alert (webhook + founder push), and
 *   • a second spike inside the cooldown is suppressed (one page, not a storm),
 *   • but a fresh spike AFTER the cooldown pages again.
 *
 * Style mirrors src/security.selftest.ts. Run via `npm test`.
 */

import { makeErrorAlerter } from "./telemetry";

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

function main(): void {
  const WINDOW = 10 * 60 * 1000;
  const COOLDOWN = 60 * 60 * 1000;

  // ── deterministic clock + stubbed sinks (dependency injection) ──────────────
  let clock = 1_700_000_000_000;
  const posts: { url: string; body: string }[] = [];
  const pushes: { userId: string; payload: { title: string; body: string; url?: string; tag?: string } }[] = [];

  const alerter = makeErrorAlerter({
    now: () => clock,
    post: (url, body) => {
      posts.push({ url, body });
    },
    push: (userId, payload) => {
      pushes.push({ userId, payload });
    },
    webhookUrl: "https://hooks.example/divvy-alerts",
    pushUserId: "founder-123",
    threshold: 5,
    windowMs: WINDOW,
    cooldownMs: COOLDOWN,
  });

  // 4 errors — below the threshold of 5 → nothing fires.
  let r = alerter.record(["Boom", "Boom", "Kaput", "Boom"]);
  ok("below threshold: no alert", r.fired === false && posts.length === 0 && pushes.length === 0, JSON.stringify(r));

  // 1 more error → count reaches 5 → EXACTLY ONE alert.
  r = alerter.record(["Boom"]);
  ok("crossing threshold fires exactly one webhook alert", r.fired === true && posts.length === 1, `posts=${posts.length}`);
  ok("crossing threshold fires exactly one founder push", pushes.length === 1 && pushes[0].userId === "founder-123");

  // Webhook body is the generic { text } shape with the count and the top name.
  let text = "";
  try {
    text = JSON.parse(posts[0].body).text;
  } catch {
    /* leave empty → assertion fails below */
  }
  ok(
    'webhook body is { text: "divvy: 5 errors in 10m — top: Boom (4)" }',
    text === "divvy: 5 errors in 10m — top: Boom (4)",
    JSON.stringify(text)
  );
  ok("founder push carries the same summary text", pushes[0].payload.body === text && pushes[0].payload.tag === "alert:errors");

  // A second spike INSIDE the cooldown must be suppressed — still exactly one page.
  clock += 5 * 60 * 1000; // +5m: inside both the 10m window and the 60m cooldown
  r = alerter.record(["Boom", "Boom", "Boom", "Boom", "Boom", "Boom"]);
  ok("cooldown suppresses the second alert", r.fired === false, JSON.stringify(r));
  ok("still exactly one webhook + one push after the suppressed spike", posts.length === 1 && pushes.length === 1);

  // After the cooldown elapses, a FRESH spike pages again (proves it's time-based,
  // not a permanent latch). +61m ages every earlier hit out of the 10m window too.
  clock += 61 * 60 * 1000;
  r = alerter.record(["Kaput", "Kaput", "Kaput", "Kaput", "Kaput"]);
  ok("a fresh spike after the cooldown pages again", r.fired === true && posts.length === 2, `posts=${posts.length}`);
  let text2 = "";
  try {
    text2 = JSON.parse(posts[1].body).text;
  } catch {
    /* ignore */
  }
  ok("the second page reflects the new top error", text2 === "divvy: 5 errors in 10m — top: Kaput (5)", JSON.stringify(text2));

  // ── inert when sinks are unconfigured: it still counts/`fired`, delivers nothing.
  const posts2: string[] = [];
  const pushes2: unknown[] = [];
  const inert = makeErrorAlerter({
    now: () => clock,
    post: (_u, b) => {
      posts2.push(b);
    },
    push: (_u, p) => {
      pushes2.push(p);
    },
    webhookUrl: "",
    pushUserId: "",
    threshold: 3,
    windowMs: WINDOW,
    cooldownMs: COOLDOWN,
  });
  r = inert.record(["A", "B", "C"]);
  ok("unconfigured sinks deliver nothing even when the threshold is crossed", r.fired === true && posts2.length === 0 && pushes2.length === 0);

  // ── env wiring: ALERT_ERROR_THRESHOLD is honored when no override is passed.
  process.env.ALERT_ERROR_THRESHOLD = "2";
  const postsEnv: string[] = [];
  const envAlerter = makeErrorAlerter({
    now: () => clock,
    post: (_u, b) => {
      postsEnv.push(b);
    },
    webhookUrl: "https://hooks.example/env",
    windowMs: WINDOW,
    cooldownMs: COOLDOWN,
  });
  const rEnv = envAlerter.record(["X", "X"]);
  ok("ALERT_ERROR_THRESHOLD env is honored (fires at 2)", rEnv.fired === true && postsEnv.length === 1);
  delete process.env.ALERT_ERROR_THRESHOLD;

  console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
  if (failed > 0) process.exit(1);
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error("telemetry.selftest crashed:", e);
  process.exit(1);
}
