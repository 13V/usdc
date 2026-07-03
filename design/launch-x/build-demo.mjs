#!/usr/bin/env node
/**
 * design/launch-x/build-demo.mjs — the launch HERO demo video (demo.webm).
 *
 * Boots the real Express server (ts-node, SQLite, temp DB) on a free port exactly
 * like design/appstore/generate.mjs, then drives a headless Chromium through the
 * REAL "try it first" demo flow (burner wallet → seeded "tokyo trip" world) and
 * records a smooth, social-paced walk through the money screens:
 *
 *   landing → try-demo → home w/ balances → group (who-owes-who) →
 *   itemized "who had what" → settle → recap card
 *
 * Playwright records the whole context to a .webm (vertical-ish 800×1000). ~1.2s
 * pauses between beats so it reads at social speed; total kept under ~45s.
 *
 * Side output: pay-from-text.png — a crisp still of the signed-out landing's
 * "friends pay from a text" vignette (used as a thread still).
 *
 * No new npm deps (playwright-core + better-sqlite3 already present). No app
 * source is modified — the server boots read-only against a throwaway DB.
 *
 *   node design/launch-x/build-demo.mjs
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, existsSync, mkdirSync, renameSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const OUT = __dirname;
const VIDDIR = join(OUT, ".vidtmp");

const FALLBACK_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const READY_TIMEOUT_MS = 90_000;
const STEP_TIMEOUT_MS = 30_000;

// vertical-ish social frame.
const VW = 800, VH = 1000;

const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1) + "s";
const log = (m) => process.stdout.write(`  ${m}\n`);
const step = (m) => process.stdout.write(`\n▶ [${el()}] ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BEAT = 1100; // pause between beats (social pacing, ~1.2s)

function getFreePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => res(port)); });
  });
}
function resolveChrome() {
  const fromEnv = process.env.CHROME_PATH && process.env.CHROME_PATH.trim();
  if (fromEnv) { if (!existsSync(fromEnv)) throw new Error(`CHROME_PATH not found: ${fromEnv}`); return fromEnv; }
  if (existsSync(FALLBACK_CHROME)) return FALLBACK_CHROME;
  throw new Error(`No Chrome. Set CHROME_PATH or install chromium at ${FALLBACK_CHROME}.`);
}
async function waitForServer(port) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const url = `http://127.0.0.1:${port}/api/auth/config`;
  let lastErr;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return; lastErr = new Error(`status ${r.status}`); }
    catch (e) { lastErr = e; }
    await sleep(300);
  }
  throw new Error(`server never ready on :${port} — ${lastErr && lastErr.message}`);
}
function startServer(port, dbPath) {
  const tsNode = join(REPO, "node_modules", ".bin", "ts-node");
  const bin = existsSync(tsNode) ? tsNode : "npx";
  const args = existsSync(tsNode) ? ["src/server.ts"] : ["ts-node", "src/server.ts"];
  const child = spawn(bin, args, {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(port), DB_PATH: dbPath,
      SESSION_SECRET: "launchx-demo-video-session-secret-0123456789abcdef",
      DATA_BACKEND: "sqlite", CLUSTER: "devnet", TS_NODE_TRANSPILE_ONLY: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => { if (process.env.VERBOSE) process.stdout.write("[server] " + d); });
  child.stderr.on("data", (d) => { if (process.env.VERBOSE) process.stderr.write("[server:err] " + d); });
  return child;
}
function killServer(child) {
  return new Promise((res) => {
    if (!child || child.killed || child.exitCode != null) return res();
    child.once("exit", () => res());
    child.kill("SIGKILL");
    setTimeout(res, 2000);
  });
}

// on-brand surround: paper background + faint rule lines behind the phone column,
// so the 800px frame reads as journal paper, not dead black. Injected at runtime;
// no source file is touched.
const SURROUND_CSS = `
  html, body { background: #F7F1E3 !important; }
  body::after { content:""; position:fixed; inset:0; z-index:0; pointer-events:none;
    background-image: repeating-linear-gradient(180deg, transparent 0 27px, rgba(39,117,202,0.08) 27px 28px); }
  #app { box-shadow: 0 24px 70px rgba(43,33,24,0.30), 0 0 0 1px rgba(43,33,24,0.08);
    border-radius: 30px; overflow: hidden; height: 96% !important; margin-top: 2% !important; }
`;

async function inject(page) {
  await page.addStyleTag({ content: SURROUND_CSS }).catch(() => {});
}

// Sign a fresh page into a burner account with a real wallet (so it can be a
// pre-linked settle counterparty). Mirrors design/appstore/generate.mjs.
async function signInFriend(pg, base, profile) {
  await pg.goto(base + "/", { waitUntil: "load", timeout: STEP_TIMEOUT_MS });
  await pg.waitForFunction(() => !!(window.Auth && window.app && window.app.api && window.Auth.createWallet), null, { timeout: STEP_TIMEOUT_MS });
  return pg.evaluate(async ({ profile }) => {
    const api = window.app.api;
    await window.Auth.createWallet();
    await window.Auth.updateProfile(profile);
    let wallet = null;
    try { wallet = (await api.get("/api/me/wallet")).wallet; } catch (_) {}
    return { userId: window.Auth.user.id, wallet, handle: window.Auth.user.handle };
  }, { profile });
}

async function run() {
  mkdirSync(VIDDIR, { recursive: true });
  const port = await getFreePort();
  const tmp = mkdtempSync(join(tmpdir(), "divvy-launchx-"));
  const dbPath = join(tmp, "demo.db");
  const base = `http://127.0.0.1:${port}`;
  const chromePath = resolveChrome();

  step("boot server");
  log(`port=${port} db=${dbPath}`);
  const child = startServer(port, dbPath);
  let browser;
  try {
    await waitForServer(port);
    log("server ready");

    step("launch chromium + start recording (800×1000)");
    browser = await chromium.launch({ headless: true, executablePath: chromePath });
    const context = await browser.newContext({
      viewport: { width: VW, height: VH },
      deviceScaleFactor: 1,
      recordVideo: { dir: VIDDIR, size: { width: VW, height: VH } },
    });
    const page = await context.newPage();

    // ── beat 0: landing ──────────────────────────────────────────────────────
    step("landing");
    await page.goto(base + "/", { waitUntil: "load", timeout: STEP_TIMEOUT_MS });
    await page.waitForFunction(() => !!(window.Auth && window.app), null, { timeout: STEP_TIMEOUT_MS });
    await inject(page);
    await page.waitForFunction(() => /try it first|split bills/i.test(document.body.innerText || ""), null, { timeout: STEP_TIMEOUT_MS }).catch(() => {});
    await sleep(2500); // let the waving Mochi + headline read

    // ── beat 1: tap "try it first" → seeded demo home ────────────────────────
    step("tap try-it-first → seed demo world");
    await page.evaluate(() => { const b = document.getElementById("hTry"); if (b) b.click(); });
    // seedDemoWorld posts a trip + bill via the real API; wait for the seeded home.
    await page.waitForFunction(() => {
      const t = document.body.innerText || "";
      return /tokyo trip/i.test(t) && !/setting up your demo/i.test(t);
    }, null, { timeout: STEP_TIMEOUT_MS });
    await inject(page); // re-inject after render swap
    await sleep(400);
    // dismiss the how-it-works card if present so the balance hero leads.
    await page.evaluate(() => { try { localStorage.setItem("divvy.seenHowItWorks", "1"); } catch (_) {} const c = document.getElementById("howCard"); if (c) c.remove(); });
    await sleep(1600); // balance count-up + read the hero
    // reveal the who-owes-who / people rows below the balance hero
    await page.evaluate(() => { const v = document.getElementById("view"); if (v) v.scrollTo({ top: 320, behavior: "smooth" }); });
    await sleep(2100);

    // grab the trip id for the group/settle/recap beats.
    const tripId = await page.evaluate(async () => {
      try { const d = await window.app.api.get("/api/me/balances"); const g = (d.trips || [])[0]; return g && (g.tripId || g.id); } catch (_) { return null; }
    });
    log(`trip=${tripId}`);

    // ── beat 2: open group → who-owes-who ────────────────────────────────────
    step("open group (who-owes-who)");
    await page.evaluate((id) => { location.hash = "#/group/" + id; }, tripId);
    await page.waitForFunction(() => /who owes|sushi|omakase|karaoke/i.test(document.body.innerText || ""), null, { timeout: STEP_TIMEOUT_MS }).catch(() => {});
    await inject(page);
    await sleep(1300);
    await page.evaluate(() => { const v = document.getElementById("view"); if (v) v.scrollTo({ top: 300, behavior: "smooth" }); });
    await sleep(2100);

    // ── beat 3: itemized "who had what" (receipt scan state) ─────────────────
    step("itemized — tap who had what");
    await page.evaluate(() => { location.hash = "#/new"; });
    await page.waitForFunction(() => !!window.__divvyItemTest, null, { timeout: STEP_TIMEOUT_MS });
    await inject(page);
    await page.evaluate(() => {
      const st = window.__divvyItemTest.state;
      const BGS = ["#F5C15E", "#8FD3B6", "#E88C7D", "#8FB7E8"];
      st.members = ["you", "kenji", "mei", "leo"].map((n, i) => ({
        id: n, name: n, emoji: ["🦊", "🐸", "🐱", "🦁"][i], bg: BGS[i], included: true, you: i === 0,
      }));
      st.paidBy = "you";
      window.__divvyItemTest.applyScan({
        total: 96.4, merchant: "izakaya nights",
        items: [
          { label: "grilled skewers 🍢", qty: 6, cents: 2400 },
          { label: "tuna sashimi 🐟", qty: 1, cents: 1800 },
          { label: "pork gyoza 🥟", qty: 2, cents: 1600 },
          { label: "cold sake 🍶", qty: 1, cents: 2200 },
          { label: "matcha soft serve 🍦", qty: 3, cents: 1440 },
        ],
      });
      const T = window.__divvyItemTest;
      T.assign(0, "you"); T.assign(0, "kenji"); T.assign(0, "mei"); T.assign(0, "leo");
      T.assign(1, "you"); T.assign(1, "mei");
    });
    await sleep(900);
    // scroll down to reveal the "who had what" item rows, then assign the rest
    // live so the video shows tapping people onto items (the hero feature — dwell).
    await page.evaluate(() => { const v = document.getElementById("view"); if (v) v.scrollTo({ top: 340, behavior: "smooth" }); });
    await sleep(1600);
    await page.evaluate(() => {
      const T = window.__divvyItemTest;
      T.assign(2, "kenji"); T.assign(2, "leo");
      T.assign(3, "you"); T.assign(3, "kenji"); T.assign(3, "mei"); T.assign(3, "leo");
      T.assign(4, "mei"); T.assign(4, "leo");
    });
    await sleep(1000);
    await page.evaluate(() => { const v = document.getElementById("view"); if (v) v.scrollTo({ top: 620, behavior: "smooth" }); });
    await sleep(2000);

    // ── beat 4: settle screen ────────────────────────────────────────────────
    // The seeded demo leaves YOU owed money (nothing to settle). To show the real
    // "settle up → pay instantly" flow, spin up a friend WITH a wallet and a small
    // group where you owe them, then settle THAT. (Uses the public API only; the
    // seeded tokyo trip stays untouched for the group + recap beats.)
    step("build a 'you owe' group (friend w/ wallet)");
    const fctx = await browser.newContext();
    const fp = await fctx.newPage();
    let jordan = { userId: null, wallet: null };
    try { jordan = await signInFriend(fp, base, { displayName: "jordan", handle: "jordan", emoji: "m:chad", color: "#F5C15E" }); }
    catch (e) { log(`(note) friend seed failed: ${e.message}`); }
    await fctx.close();
    const settleTripId = await page.evaluate(async ({ jordan }) => {
      const api = window.app.api;
      const trip = await api.post("/api/trips", {
        name: "ski cabin 🎿",
        members: [{ name: "you" }, { name: "jordan", userId: jordan.userId || undefined, wallet: jordan.wallet || undefined }],
      });
      const byName = (n) => trip.members.find((m) => m.name === n).id;
      // jordan fronts the cabin; split 2 → you owe jordan half.
      await api.post(`/api/trips/${trip.id}/expenses`, {
        title: "cabin + lift passes 🎿", total: 480, paidBy: byName("jordan"),
        participants: [byName("you"), byName("jordan")],
      });
      return trip.id;
    }, { jordan });
    log(`settleTrip=${settleTripId}`);

    step("settle (pay flow)");
    await page.evaluate((id) => { location.hash = "#/settle/" + id; }, settleTripId);
    await page.waitForFunction(() => {
      const t = document.body.innerText || "";
      if (/skeleton/i.test(t)) return false;
      return /pay .* with my wallet|pay with phantom|settle up in|\$240|scan to pay/i.test(t) || /pay \$/i.test(t);
    }, null, { timeout: STEP_TIMEOUT_MS }).catch(() => {});
    await inject(page);
    await sleep(1500);
    await page.evaluate(() => { const v = document.getElementById("view"); if (v) v.scrollTo({ top: 240, behavior: "smooth" }); });
    await sleep(2200);

    // ── beat 5: recap card ───────────────────────────────────────────────────
    step("recap card");
    await page.evaluate((id) => { location.hash = "#/group/" + id; }, tripId);
    // wait for the real group content (not the loading skeleton) so the recap
    // opens over a painted backdrop — no skeleton flash.
    await page.waitForFunction(() => {
      const t = document.body.innerText || "";
      return (/who owes|sushi|omakase|group total/i.test(t)) && !/skeleton/i.test(t);
    }, null, { timeout: STEP_TIMEOUT_MS }).catch(() => {});
    await inject(page);
    await sleep(1400);
    await page.evaluate((id) => { if (window.Recap && window.Recap.open) window.Recap.open(id); }, tripId);
    // recap renders an <img id="recapImg"> (canvas → dataURL), not a live <canvas>.
    await page.waitForFunction(() => { const im = document.querySelector("#recapImg"); return !!(im && im.getAttribute("src")); }, null, { timeout: STEP_TIMEOUT_MS }).catch(() => {});
    await sleep(3000); // hold on the award card (final beat)

    step("finalize video");
    const vpath = await page.video().path();
    await context.close(); // flush the webm
    const outFile = join(OUT, "demo.webm");
    try { rmSync(outFile, { force: true }); } catch {}
    renameSync(vpath, outFile);
    log(`wrote ${outFile}`);

    // ── side still: "friends pay from a text" (signed-out landing vignette) ───
    step("capture pay-from-text still (crisp mobile context)");
    const sctx = await browser.newContext({
      viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: "reduce",
    });
    const sp = await sctx.newPage();
    await sp.goto(base + "/", { waitUntil: "load", timeout: STEP_TIMEOUT_MS });
    await sp.waitForFunction(() => /step two|pay from a text/i.test(document.body.innerText || ""), null, { timeout: STEP_TIMEOUT_MS }).catch(() => {});
    // scroll the STEP TWO vignette (the iMessage pay bubble) into view and clip it.
    const clip = await sp.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("div"));
      const kick = nodes.find((n) => (n.textContent || "").trim() === "STEP TWO");
      const card = kick && kick.closest("div[style*='border']");
      const target = card || null;
      if (!target) return null;
      target.scrollIntoView({ block: "center" });
      const r = target.getBoundingClientRect();
      return { x: Math.max(0, r.x - 14), y: Math.max(0, r.y - 14), width: Math.min(440, r.width + 28), height: r.height + 28 };
    });
    await sleep(400);
    const stillPath = join(OUT, "pay-from-text.png");
    if (clip) await sp.screenshot({ path: stillPath, clip });
    else await sp.screenshot({ path: stillPath });
    await sctx.close();
    log(`wrote ${stillPath}`);

    return { outFile };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await killServer(child);
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    try { rmSync(VIDDIR, { recursive: true, force: true }); } catch {}
  }
}

run().then(
  () => { process.stdout.write("\n=== PASS — demo.webm generated ===\n"); process.exit(0); },
  (err) => { process.stderr.write("\n=== FAIL — " + (err && err.message ? err.message : err) + "\n"); if (err && err.stack) process.stderr.write(err.stack + "\n"); process.exit(1); }
);
