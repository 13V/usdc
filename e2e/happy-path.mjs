#!/usr/bin/env node
/**
 * e2e/happy-path.mjs — Divvy end-to-end happy-path smoke test.
 *
 * Guards the core loop so a deploy can't silently break it:
 *   sign in (burner wallet + SIWS) → create a group → add an expense →
 *   balances are correct → group detail renders who-owes-who → settle screen
 *   renders without a page error.
 *
 * Self-contained: boots the real Express server (ts-node, SQLite, temp DB) on a
 * random free port, drives a headless Chromium via playwright-core, asserts, and
 * always tears the server down. Exits 0 on PASS, 1 on FAIL.
 *
 * Browser binary resolution (in order):
 *   1. $CHROME_PATH               (CI: browser-actions/setup-chrome exposes this)
 *   2. the local Playwright chromium at /opt/pw-browsers/chromium-1194/...
 * No npm dependencies beyond playwright-core (already installed) + a system Chrome.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

const FALLBACK_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const READY_TIMEOUT_MS = 90_000;
const STEP_TIMEOUT_MS = 30_000;

// ── tiny helpers ─────────────────────────────────────────────────────────────
function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}
function step(name) {
  process.stdout.write(`\n▶ ${name}\n`);
}
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  log(`✓ ${msg}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Grab a free TCP port by binding to 0, reading it, then releasing it.
function getFreePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

function resolveChrome() {
  const fromEnv = process.env.CHROME_PATH && process.env.CHROME_PATH.trim();
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Error(`CHROME_PATH set but not found: ${fromEnv}`);
    return fromEnv;
  }
  if (existsSync(FALLBACK_CHROME)) return FALLBACK_CHROME;
  throw new Error(
    `No Chrome found. Set CHROME_PATH or install the Playwright chromium at ${FALLBACK_CHROME}.`
  );
}

// Poll the server's HTTP surface until it answers (or time out).
async function waitForServer(port) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const url = `http://127.0.0.1:${port}/api/auth/config`;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
      lastErr = new Error(`status ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(300);
  }
  throw new Error(`server never became ready on :${port} — ${lastErr && lastErr.message}`);
}

// ── boot the server ──────────────────────────────────────────────────────────
function startServer(port, dbPath) {
  const tsNode = join(REPO, "node_modules", ".bin", "ts-node");
  const bin = existsSync(tsNode) ? tsNode : "npx";
  const args = existsSync(tsNode) ? ["src/server.ts"] : ["ts-node", "src/server.ts"];
  const child = spawn(bin, args, {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      SESSION_SECRET: "e2e-happy-path-session-secret-0123456789abcdef",
      DATA_BACKEND: "sqlite",
      CLUSTER: "devnet",
      // keep the server quiet-ish; ts-node in transpile-only for speed
      TS_NODE_TRANSPILE_ONLY: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ready = false;
  child.stdout.on("data", (d) => {
    const s = d.toString();
    if (s.includes("Divvy web app on")) ready = true;
    if (process.env.E2E_VERBOSE) process.stdout.write("[server] " + s);
  });
  child.stderr.on("data", (d) => {
    if (process.env.E2E_VERBOSE) process.stderr.write("[server:err] " + d.toString());
  });
  return { child, isReadyLogSeen: () => ready };
}

function killServer(child) {
  return new Promise((res) => {
    if (!child || child.killed || child.exitCode != null) return res();
    child.once("exit", () => res());
    child.kill("SIGKILL");
    setTimeout(res, 2000); // never hang teardown
  });
}

// ── the test ─────────────────────────────────────────────────────────────────
async function run() {
  const port = await getFreePort();
  const tmp = mkdtempSync(join(tmpdir(), "divvy-e2e-"));
  const dbPath = join(tmp, "e2e.db");
  const base = `http://127.0.0.1:${port}`;
  const chromePath = resolveChrome();

  step("boot server");
  log(`port=${port} db=${dbPath}`);
  const { child } = startServer(port, dbPath);
  let browser;

  try {
    await waitForServer(port);
    log("server is ready");

    step("launch chromium");
    log(`chrome=${chromePath}`);
    browser = await chromium.launch({ headless: true, executablePath: chromePath });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Collect errors. A pageerror (uncaught exception in app code) fails the run.
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });

    step("load app + wait for runtime");
    await page.goto(base + "/", { waitUntil: "load", timeout: STEP_TIMEOUT_MS });
    await page.waitForFunction(
      () => !!(window.Auth && window.app && window.app.api && window.Auth.createWallet),
      null,
      { timeout: STEP_TIMEOUT_MS }
    );
    log("window.Auth + window.app.api present");

    step("sign in (createWallet → SIWS)");
    const user = await page.evaluate(async () => {
      const u = await window.Auth.createWallet();
      return u || (window.Auth && window.Auth.user);
    });
    assert(user && user.id, "signed in, got a user id");

    step("create group (you + maya)");
    const trip = await page.evaluate(async () => {
      return window.app.api.post("/api/trips", {
        name: "E2E Dinner",
        members: [{ name: "you" }, { name: "maya" }],
      });
    });
    assert(trip && trip.id, "group created with id " + (trip && trip.id));
    const you = trip.members.find((m) => m.name === "you");
    const maya = trip.members.find((m) => m.name === "maya");
    assert(you && maya, "both members present (you + maya)");

    step("add expense ($60 paid by you, split 2 ways)");
    const withExpense = await page.evaluate(
      async ({ id, payer, participants }) => {
        return window.app.api.post(`/api/trips/${id}/expenses`, {
          title: "dinner",
          total: 60,
          paidBy: payer,
          participants,
        });
      },
      { id: trip.id, payer: you.id, participants: [you.id, maya.id] }
    );
    assert(withExpense.expenses.length === 1, "one expense recorded");
    assert(withExpense.expenses[0].amountCents === 6000, "expense is 6000 cents ($60)");

    step("verify balances via GET trip");
    const fetched = await page.evaluate(
      (id) => window.app.api.get(`/api/trips/${id}`),
      trip.id
    );
    const mayaBal = fetched.balances.find((b) => b.memberId === maya.id);
    const youBal = fetched.balances.find((b) => b.memberId === you.id);
    assert(mayaBal, "maya has a balance entry");
    assert(mayaBal.cents === -3000, `maya owes 3000 cents (got ${mayaBal.cents})`);
    assert(mayaBal.direction === "owes", 'maya direction is "owes"');
    assert(youBal.cents === 3000, `you are owed 3000 cents (got ${youBal.cents})`);

    step("cross-trip balances via GET /api/me/balances");
    const me = await page.evaluate(() => window.app.api.get("/api/me/balances"));
    assert(me != null, "GET /api/me/balances responded");

    step("render group detail (#/group/<id>) + who-owes-who");
    await page.evaluate((id) => {
      location.hash = "#/group/" + encodeURIComponent(id);
    }, trip.id);
    // Wait until the who-owes-who section paints with the settle-down amount.
    const wowText = await page.waitForFunction(
      () => {
        const labels = Array.from(document.querySelectorAll("div")).filter(
          (d) => d.textContent && d.textContent.trim() === "WHO OWES WHO"
        );
        if (!labels.length) return null;
        const rows = labels[0].nextElementSibling;
        const txt = rows && rows.innerText;
        return txt && /\$30\.00/.test(txt) ? txt : null;
      },
      null,
      { timeout: STEP_TIMEOUT_MS }
    );
    const rowText = (await wowText.jsonValue()) || "";
    assert(/\$30\.00/.test(rowText), "who-owes-who row shows $30.00");
    assert(/maya/i.test(rowText), "who-owes-who row names maya");
    log("row text: " + rowText.replace(/\s+/g, " ").trim());

    step("render settle screen (#/settle/<id>)");
    const errBefore = pageErrors.length;
    await page.evaluate((id) => {
      location.hash = "#/settle/" + encodeURIComponent(id);
    }, trip.id);
    // The settle screen resolves out of its loading skeleton into a real state.
    // "you" is the creditor here, so the honest happy-path outcome is the
    // "all square / nothing to settle" state — it must render, not crash.
    await page.waitForFunction(
      () => {
        const t = document.body.innerText || "";
        if (/skeleton/i.test(t)) return false;
        return /square|nothing to settle|settle your|\$30\.00/i.test(t);
      },
      null,
      { timeout: STEP_TIMEOUT_MS }
    );
    const settleText = await page.evaluate(() => document.body.innerText || "");
    log("settle state: " + settleText.replace(/\s+/g, " ").trim().slice(0, 90));
    assert(pageErrors.length === errBefore, "settle screen rendered with no new page error");

    step("final error sweep");
    if (consoleErrors.length) {
      log(`(note) ${consoleErrors.length} console error(s):`);
      for (const c of consoleErrors.slice(0, 5)) log("   • " + c);
    }
    assert(pageErrors.length === 0, `zero uncaught page errors (saw ${pageErrors.length})`);

    return { ok: true };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await killServer(child);
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
run()
  .then(() => {
    process.stdout.write("\n============================================\n");
    process.stdout.write("  PASS — Divvy happy path is intact ✅\n");
    process.stdout.write("============================================\n");
    process.exit(0);
  })
  .catch((err) => {
    process.stderr.write("\n============================================\n");
    process.stderr.write("  FAIL — " + (err && err.message ? err.message : err) + "\n");
    if (err && err.stack) process.stderr.write(err.stack + "\n");
    process.stderr.write("============================================\n");
    process.exit(1);
  });
