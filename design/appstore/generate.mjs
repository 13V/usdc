#!/usr/bin/env node
/**
 * design/appstore/generate.mjs — App Store screenshot generator for Divvy.
 *
 * Two passes, fully self-contained:
 *   1) RAW  — boot the real Express server (ts-node, SQLite, temp DB) on a free
 *      port, drive a headless Chromium at iPhone 6.9" App Store resolution
 *      (viewport 440×956 @ deviceScaleFactor 3 → 1320×2868 px), sign in with a
 *      burner wallet, SEED a lively "tokyo trip 🗼" demo dataset via
 *      window.app.api, and screenshot six money screens into out/raw/*.png.
 *   2) FRAME — a second Chromium pass renders each raw PNG inside a journal-styled
 *      marketing frame (paper backdrop, washi tape, big lowercase caption, Divvy
 *      wordmark, ink-bordered device card with an offset shadow) and screenshots
 *      it at EXACTLY 1320×2868 into out/*.png.
 *
 * The six framed PNGs land in design/appstore/out/. Regenerate any time:
 *     node design/appstore/generate.mjs
 *
 * No new npm deps: playwright-core + better-sqlite3 are already in the project.
 * Chromium binary resolution mirrors e2e/happy-path.mjs (CHROME_PATH or the
 * local Playwright chromium under /opt/pw-browsers).
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const OUT = join(__dirname, "out");
const RAW = join(OUT, "raw");
const FONTS = join(REPO, "public", "fonts");

const FALLBACK_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const READY_TIMEOUT_MS = 90_000;
const STEP_TIMEOUT_MS = 30_000;

// iPhone 6.9" App Store slot: 1320×2868 px = 440×956 CSS px @ dsf 3.
const CSS_W = 440;
const CSS_H = 956;
const DSF = 3;
const PX_W = CSS_W * DSF; // 1320
const PX_H = CSS_H * DSF; // 2868

// ── tiny helpers ─────────────────────────────────────────────────────────────
const log = (m) => process.stdout.write(`  ${m}\n`);
const step = (m) => process.stdout.write(`\n▶ ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  throw new Error(`No Chrome found. Set CHROME_PATH or install the Playwright chromium at ${FALLBACK_CHROME}.`);
}

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
      SESSION_SECRET: "appstore-screenshot-session-secret-0123456789abcdef",
      DATA_BACKEND: "sqlite",
      CLUSTER: "devnet",
      TS_NODE_TRANSPILE_ONLY: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => {
    if (process.env.VERBOSE) process.stdout.write("[server] " + d.toString());
  });
  child.stderr.on("data", (d) => {
    if (process.env.VERBOSE) process.stderr.write("[server:err] " + d.toString());
  });
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

// Parse a PNG's IHDR width/height (big-endian u32 at byte offsets 16 and 20).
function pngSize(file) {
  const b = readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

// ── the six captures ─────────────────────────────────────────────────────────
// name → { caption, file } ; capture order matches SHOTS below.
const SHOTS = [
  { key: "home", caption: "split anything\nin seconds" },
  { key: "group", caption: "see who\nowes what" },
  { key: "itemized", caption: "tap who\nhad what" },
  { key: "settle", caption: "settle up\nin a tap" },
  { key: "recap", caption: "relive\nthe trip" },
  { key: "customize", caption: "make it\nyours" },
];

// Sign a page into a fresh burner account and set a display identity. Returns the
// account's { userId, wallet, handle } so trip members can be pre-linked to real
// accounts (dashboard balances + settle both need real userId + wallet).
async function signIn(pg, base, profile, friendOf) {
  await pg.goto(base + "/", { waitUntil: "load", timeout: STEP_TIMEOUT_MS });
  await pg.waitForFunction(
    () => !!(window.Auth && window.app && window.app.api && window.Auth.createWallet),
    null,
    { timeout: STEP_TIMEOUT_MS }
  );
  return pg.evaluate(async ({ profile, friendOf }) => {
    const api = window.app.api;
    await window.Auth.createWallet();
    await window.Auth.updateProfile(profile);
    let wallet = null;
    try { wallet = (await api.get("/api/me/wallet")).wallet; } catch (_) { /* ignore */ }
    if (friendOf) { try { await api.post("/api/friends", { handle: friendOf }); } catch (_) { /* ignore */ } }
    return { userId: window.Auth.user.id, wallet, handle: window.Auth.user.handle };
  }, { profile, friendOf });
}

async function seedDataset(page, base, browser) {
  step("sign in ava + seed the demo dataset");
  // ava = the signed-in founder (main context).
  const ava = await signIn(page, base, { displayName: "ava", handle: "ava", emoji: "m:doge", color: "#2775CA" });
  log(`ava userId=${ava.userId} wallet=${ava.wallet ? ava.wallet.slice(0, 8) + "…" : "none"}`);

  // Three friends, each in their own context, each adds ava back (→ mutual once
  // ava accepts). Their real userId + wallet get baked into the trip members.
  const friendProfiles = [
    { displayName: "kenji", handle: "kenji", emoji: "m:frog", color: "#8FD3B6" },
    { displayName: "mei", handle: "mei", emoji: "m:cat", color: "#E88C7D" },
    { displayName: "leo", handle: "leo", emoji: "m:chad", color: "#F5C15E" },
  ];
  const friends = {};
  for (const fp of friendProfiles) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    try {
      friends[fp.handle] = await signIn(p, base, fp, "ava");
    } catch (e) {
      log(`(note) friend ${fp.handle} seed failed: ${e.message}`);
      friends[fp.handle] = { userId: null, wallet: null };
    }
    await ctx.close();
  }

  // Build the trip in ava's context with ALL members pre-linked to real accounts.
  const seed = await page.evaluate(async ({ ava, friends }) => {
    const api = window.app.api;
    const trip = await api.post("/api/trips", {
      name: "tokyo trip 🗼",
      members: [
        { name: "ava", userId: ava.userId, wallet: ava.wallet || undefined },
        { name: "kenji", userId: friends.kenji.userId || undefined, wallet: friends.kenji.wallet || undefined },
        { name: "mei", userId: friends.mei.userId || undefined, wallet: friends.mei.wallet || undefined },
        { name: "leo", userId: friends.leo.userId || undefined, wallet: friends.leo.wallet || undefined },
      ],
    });
    const byName = (n) => trip.members.find((m) => m.name === n).id;
    const mAva = byName("ava"), mKenji = byName("kenji"), mMei = byName("mei"), mLeo = byName("leo");
    const all = [mAva, mKenji, mMei, mLeo];

    // 6 expenses with fun titles; friends front the big ones so ava nets a debt
    // (→ a lively settle screen with a real transfer to build).
    const exp = [
      { title: "sushi omakase 🍣", amountCents: 32000, paidBy: mKenji },
      { title: "shibuya karaoke 🎤", amountCents: 12000, paidBy: mMei },
      { title: "robot restaurant 🤖", amountCents: 24000, paidBy: mLeo },
      { title: "7-eleven midnight run 🍙", amountCents: 4000, paidBy: mAva },
      { title: "teamlab tickets 🎨", amountCents: 16000, paidBy: mKenji },
      { title: "shinkansen to kyoto 🚄", amountCents: 20000, paidBy: mMei },
    ];
    for (const e of exp) {
      await api.post(`/api/trips/${trip.id}/expenses`, {
        title: e.title, amountCents: e.amountCents, paidBy: e.paidBy, participants: all,
      });
    }

    // A standalone tab (shows on home under "your tabs"). Partial-paid is applied
    // out-of-band (chain-verified only) by the generator after seeding.
    const bill = await api.post("/api/bills", {
      title: "apartment wifi + utils 🏠",
      total: 120,
      names: ["ava", "kenji", "mei", "leo"],
    });

    // Accept any incoming friend requests so the friends are mutual.
    try {
      const reqs = await api.get("/api/friends/requests").catch(() => null);
      const list = (reqs && (reqs.requests || reqs.incoming || reqs)) || [];
      for (const r of Array.isArray(list) ? list : []) {
        const uid = r.userId || r.id || (r.user && r.user.id);
        if (uid) await api.post("/api/friends/accept", { userId: uid }).catch(() => {});
      }
    } catch (_) { /* non-fatal */ }

    return { tripId: trip.id, billId: bill.id };
  }, { ava, friends });

  log(`trip=${seed.tripId} bill=${seed.billId}`);
  return seed;
}

// Flip one share of the seeded bill to PAID directly in the SQLite store, so home
// shows a *partially paid* tab (paid is otherwise chain-verified only). Best-effort.
function markBillPartiallyPaid(dbPath, billId) {
  try {
    const sdb = new Database(dbPath);
    sdb.pragma("busy_timeout = 4000");
    const row = sdb.prepare("SELECT data FROM bills WHERE id = ?").get(billId);
    if (!row) { sdb.close(); return false; }
    const bill = JSON.parse(row.data);
    // Pay the first two non-creator shares to make progress visible.
    let flipped = 0;
    for (const p of bill.participants) {
      if (flipped >= 2) break;
      if (!p.paid) {
        p.paid = true;
        p.signature = "SEEDPAID" + Math.random().toString(36).slice(2, 10);
        flipped++;
      }
    }
    sdb.prepare("UPDATE bills SET data = ? WHERE id = ?").run(JSON.stringify(bill), billId);
    sdb.close();
    return flipped > 0;
  } catch (e) {
    log(`(note) partial-paid seed skipped: ${e.message}`);
    return false;
  }
}

// ── navigate + capture one raw screen ────────────────────────────────────────
async function captureRaw(page, key, seed, file, base) {
  const { tripId } = seed;
  if (key === "home") {
    // Home renders once at first load (before the dataset was seeded), and
    // re-setting the same hash won't re-fetch — so hard-reload to pull the fresh
    // seeded balances, and pre-dismiss the one-time "how it works" card so the
    // balance hero leads the shot.
    await page.evaluate(() => { try { localStorage.setItem("divvy.seenHowItWorks", "1"); location.hash = "#/home"; } catch (_) {} });
    await page.reload({ waitUntil: "load", timeout: STEP_TIMEOUT_MS }); // real reload → re-auth + fresh fetch
    await page.waitForFunction(
      () => !!(window.Auth && window.Auth.user),
      null,
      { timeout: STEP_TIMEOUT_MS }
    ).catch(() => {});
    await page.waitForFunction(() => {
      const t = document.body.innerText || "";
      return /tokyo trip/i.test(t) && !/skeleton|no tabs yet/i.test(t);
    }, null, { timeout: STEP_TIMEOUT_MS }).catch(() => {});
    await sleep(1600); // let the balance count-up settle
  } else if (key === "group") {
    await page.evaluate((id) => { location.hash = "#/group/" + id; }, tripId);
    await page.waitForFunction(() => /who owes who|sushi|omakase/i.test(document.body.innerText || ""), null, { timeout: STEP_TIMEOUT_MS }).catch(() => {});
    await sleep(700);
  } else if (key === "settle") {
    await page.evaluate((id) => { location.hash = "#/settle/" + id; }, tripId);
    await page.waitForFunction(() => {
      const t = document.body.innerText || "";
      if (/skeleton/i.test(t)) return false;
      return /settle|square|owe|\$/i.test(t);
    }, null, { timeout: STEP_TIMEOUT_MS }).catch(() => {});
    await sleep(700);
  } else if (key === "customize") {
    await page.evaluate(() => {
      const ov = document.getElementById("recapOverlay");
      if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
      location.hash = "#/customize";
    });
    await page.waitForFunction(() => /profile|avatar|pfp|color|pick|face|emoji/i.test(document.body.innerText || ""), null, { timeout: STEP_TIMEOUT_MS }).catch(() => {});
    await sleep(700);
  } else if (key === "recap") {
    await page.evaluate((id) => { location.hash = "#/group/" + id; }, tripId);
    await sleep(500);
    await page.evaluate((id) => { window.Recap.open(id); }, tripId);
    await page.waitForSelector("#recapOverlay canvas", { timeout: STEP_TIMEOUT_MS }).catch(() => {});
    await sleep(1600); // canvas draw + font/image load
  } else if (key === "itemized") {
    await page.evaluate(() => { location.hash = "#/new"; });
    await page.waitForFunction(() => !!window.__divvyItemTest, null, { timeout: STEP_TIMEOUT_MS });
    await page.evaluate(() => {
      const st = window.__divvyItemTest.state;
      const BGS = ["#F5C15E", "#8FD3B6", "#E88C7D", "#8FB7E8"];
      st.members = ["ava", "kenji", "mei", "leo"].map((n, i) => ({
        id: n, name: n, emoji: ["🦊", "🐸", "🐱", "🦁"][i], bg: BGS[i], included: true, you: i === 0,
      }));
      st.paidBy = "ava";
      window.__divvyItemTest.applyScan({
        total: 96.4,
        merchant: "izakaya nights",
        items: [
          { label: "grilled skewers 🍢", qty: 6, cents: 2400 },
          { label: "tuna sashimi 🐟", qty: 1, cents: 1800 },
          { label: "pork gyoza 🥟", qty: 2, cents: 1600 },
          { label: "cold sake 🍶", qty: 1, cents: 2200 },
          { label: "matcha soft serve 🍦", qty: 3, cents: 1440 },
        ],
      });
      const T = window.__divvyItemTest;
      T.assign(0, "ava"); T.assign(0, "kenji"); T.assign(0, "mei"); T.assign(0, "leo");
      T.assign(1, "ava"); T.assign(1, "mei");
      T.assign(2, "kenji"); T.assign(2, "leo");
      T.assign(3, "ava"); T.assign(3, "kenji"); T.assign(3, "mei"); T.assign(3, "leo");
      T.assign(4, "mei"); T.assign(4, "leo");
    });
    await sleep(700);
  }
  await page.screenshot({ path: file });
}

// ── journal-styled marketing frame (pass 2) ──────────────────────────────────
function fontFace(family, weight, fileName) {
  return `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:block;src:url('file://${join(FONTS, fileName)}') format('woff2');}`;
}

function frameHtml(caption, rawFile) {
  const dataUri = "data:image/png;base64," + readFileSync(rawFile).toString("base64");
  const fonts = [
    fontFace("Clash Display", 600, "Z3MGHFHX6DCTLQ55LJYRJ5MDCZPMFZU6.woff2"),
    fontFace("Clash Display", 700, "53RZKGODFYDW3QHTIL7IPOWTBCSUEZK7.woff2"),
    fontFace("General Sans", 500, "SB2OEB6IKZPRR6JT4GFJ2TFT6HBB6AZN.woff2"),
  ].join("");
  const caplines = caption.split("\n").map((l) => `<span>${l}</span>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fonts}
:root{ --ink:#2B2118; --paper:#F4EDDD; --paper2:#EFE6D2; --accent:#2775CA; --coral:#FF6B5E; --mint:#8FD3B6; }
*{ box-sizing:border-box; margin:0; padding:0; }
html,body{ width:${PX_W}px; height:${PX_H}px; }
body{
  position:relative; overflow:hidden;
  font-family:'Clash Display','General Sans',-apple-system,system-ui,sans-serif;
  color:var(--ink);
  background:
    radial-gradient(120% 90% at 50% -10%, #FBF5E7 0%, var(--paper) 46%, var(--paper2) 100%);
}
/* paper grain: two faint crosshatch gradients, fully self-contained */
body::before{
  content:""; position:absolute; inset:0; pointer-events:none; opacity:.5;
  background-image:
    repeating-linear-gradient(90deg, rgba(43,33,24,.030) 0 1px, transparent 1px 4px),
    repeating-linear-gradient(0deg, rgba(43,33,24,.030) 0 1px, transparent 1px 4px);
  mix-blend-mode:multiply;
}
/* soft vignette */
body::after{
  content:""; position:absolute; inset:0; pointer-events:none;
  box-shadow: inset 0 0 340px rgba(43,33,24,.10);
}
.wordmark{
  position:absolute; top:96px; left:132px; display:flex; align-items:center; gap:18px; z-index:5;
}
.wordmark .dot{ width:44px; height:44px; border-radius:14px; background:var(--accent);
  border:3px solid var(--ink); box-shadow:5px 5px 0 rgba(43,33,24,.85); }
.wordmark .name{ font-weight:700; font-size:52px; letter-spacing:-1px; }
.caption{
  position:absolute; top:176px; left:132px; right:132px; z-index:5;
  font-weight:700; font-size:132px; line-height:.92; letter-spacing:-3px;
}
.caption span{ display:block; }
.caption .u{ color:var(--accent); }
.stage{
  position:absolute; left:0; right:0; bottom:150px; display:flex; justify-content:center;
}
/* washi tape strips pinning the device card */
.tape{ position:absolute; width:280px; height:78px; z-index:8; opacity:.9;
  box-shadow:0 6px 18px rgba(43,33,24,.14);
  background:repeating-linear-gradient(45deg, rgba(255,255,255,.28) 0 14px, rgba(255,255,255,0) 14px 28px); }
.tape.a{ background-color:var(--mint); transform:rotate(-7deg); top:-30px; left:70px; }
.tape.b{ background-color:var(--coral); transform:rotate(6deg); top:-24px; right:70px; opacity:.85; }
.card{
  position:relative; width:1048px; border:6px solid var(--ink); border-radius:66px;
  background:#fff; box-shadow:26px 30px 0 rgba(43,33,24,.9); overflow:hidden;
}
.card img{ display:block; width:100%; height:auto; }
</style></head><body>
  <div class="wordmark"><div class="dot"></div><div class="name">divvy</div></div>
  <div class="caption">${caplines}</div>
  <div class="stage">
    <div class="card">
      <div class="tape a"></div>
      <div class="tape b"></div>
      <img src="${dataUri}" />
    </div>
  </div>
</body></html>`;
}

async function frameShot(browser, caption, rawFile, outFile) {
  const ctx = await browser.newContext({ viewport: { width: PX_W, height: PX_H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(frameHtml(caption, rawFile), { waitUntil: "load" });
  await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
  await sleep(300);
  await page.screenshot({ path: outFile, clip: { x: 0, y: 0, width: PX_W, height: PX_H } });
  await ctx.close();
}

// ── main ─────────────────────────────────────────────────────────────────────
async function run() {
  mkdirSync(RAW, { recursive: true });
  const port = await getFreePort();
  const tmp = mkdtempSync(join(tmpdir(), "divvy-appstore-"));
  const dbPath = join(tmp, "shots.db");
  const base = `http://127.0.0.1:${port}`;
  const chromePath = resolveChrome();

  step("boot server");
  log(`port=${port} db=${dbPath}`);
  const child = startServer(port, dbPath);
  let browser;
  try {
    await waitForServer(port);
    log("server ready");

    step("launch chromium (440×956 @3x → 1320×2868)");
    browser = await chromium.launch({ headless: true, executablePath: chromePath });
    const context = await browser.newContext({
      viewport: { width: CSS_W, height: CSS_H },
      deviceScaleFactor: DSF,
      reducedMotion: "reduce",
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    const seed = await seedDataset(page, base, browser);
    const paid = markBillPartiallyPaid(dbPath, seed.billId);
    log(`partial-paid bill seeded: ${paid}`);

    step("capture raw screens");
    const rawFiles = {};
    for (const s of SHOTS) {
      const f = join(RAW, `${s.key}.png`);
      await captureRaw(page, s.key, seed, f, base);
      const { width, height } = pngSize(f);
      log(`raw ${s.key.padEnd(10)} ${width}×${height}`);
      rawFiles[s.key] = f;
    }

    step("compose journal marketing frames (→ 1320×2868)");
    const results = [];
    for (const s of SHOTS) {
      const outFile = join(OUT, `${String(SHOTS.indexOf(s) + 1).padStart(2, "0")}-${s.key}.png`);
      await frameShot(browser, s.caption, rawFiles[s.key], outFile);
      const { width, height } = pngSize(outFile);
      const okDim = width === PX_W && height === PX_H;
      results.push({ file: outFile, width, height, okDim, caption: s.caption.replace(/\n/g, " ") });
      log(`${okDim ? "✓" : "✗"} ${outFile}  ${width}×${height}  “${s.caption.replace(/\n/g, " ")}”`);
    }

    const bad = results.filter((r) => !r.okDim);
    step("summary");
    for (const r of results) log(`${r.width}×${r.height}  ${r.file}`);
    if (bad.length) throw new Error(`${bad.length} framed PNG(s) are not ${PX_W}×${PX_H}`);
    log(`\nAll ${results.length} framed PNGs are ${PX_W}×${PX_H}. Done.`);
    return results;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await killServer(child);
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

run().then(
  () => {
    process.stdout.write("\n========================================\n  PASS — 6 App Store screenshots generated ✅\n========================================\n");
    process.exit(0);
  },
  (err) => {
    process.stderr.write("\n========================================\n  FAIL — " + (err && err.message ? err.message : err) + "\n");
    if (err && err.stack) process.stderr.write(err.stack + "\n");
    process.stderr.write("========================================\n");
    process.exit(1);
  }
);
