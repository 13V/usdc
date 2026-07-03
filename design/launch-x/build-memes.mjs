#!/usr/bin/env node
/**
 * design/launch-x/build-memes.mjs — two launch-day Mochi memes (1080×1080 PNG).
 *
 * Boots the real Express server (ts-node, SQLite, temp DB) like generate.mjs,
 * drives the public /memes lab headless, sets state on window.MemeLab, renders,
 * and saves each canvas via toDataURL → PNG. No uploads, no new deps.
 *
 *   node design/launch-x/build-memes.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const OUT = __dirname;
const FALLBACK_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MEMES = [
  { file: "meme-settle-gm.png",  pose: "party",   tint: "mint",  top: "", bottom: "gm to everyone who settles up" },
  { file: "meme-paid-back.png",  pose: "pain",    tint: "paper", top: "", bottom: "when they say they'll pay you back" },
];

function getFreePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => res(port)); });
  });
}
function resolveChrome() {
  const e = process.env.CHROME_PATH && process.env.CHROME_PATH.trim();
  if (e) { if (!existsSync(e)) throw new Error(`CHROME_PATH not found: ${e}`); return e; }
  if (existsSync(FALLBACK_CHROME)) return FALLBACK_CHROME;
  throw new Error(`No Chrome at ${FALLBACK_CHROME}`);
}
async function waitForServer(port) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/auth/config`); if (r.ok) return; } catch {}
    await sleep(300);
  }
  throw new Error("server never ready");
}
function startServer(port, dbPath) {
  const tsNode = join(REPO, "node_modules", ".bin", "ts-node");
  const bin = existsSync(tsNode) ? tsNode : "npx";
  const args = existsSync(tsNode) ? ["src/server.ts"] : ["ts-node", "src/server.ts"];
  return spawn(bin, args, {
    cwd: REPO,
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath,
      SESSION_SECRET: "launchx-memes-secret-0123456789abcdef", DATA_BACKEND: "sqlite", CLUSTER: "devnet", TS_NODE_TRANSPILE_ONLY: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Parse a PNG IHDR (big-endian u32 @ 16/20).
function pngSize(buf) { return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }; }

async function run() {
  const port = await getFreePort();
  const tmp = mkdtempSync(join(tmpdir(), "divvy-memes-"));
  const dbPath = join(tmp, "m.db");
  const chromePath = resolveChrome();
  const child = startServer(port, dbPath);
  let browser;
  try {
    await waitForServer(port);
    browser = await chromium.launch({ headless: true, executablePath: chromePath });
    const page = await (await browser.newContext({ viewport: { width: 640, height: 1200 }, deviceScaleFactor: 2 })).newPage();
    await page.goto(`http://127.0.0.1:${port}/memes`, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => !!(window.MemeLab && window.MemeLab.state && document.getElementById("memeCanvas")), null, { timeout: 30000 });
    await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
    await sleep(600);

    const results = [];
    for (const m of MEMES) {
      const dataUrl = await page.evaluate(async (m) => {
        const L = window.MemeLab;
        L.state.pose = m.pose; L.state.tint = m.tint; L.state.top = m.top; L.state.bottom = m.bottom;
        L.render();
        await new Promise((r) => setTimeout(r, 450)); // frog raster + compose
        L.render();
        await new Promise((r) => setTimeout(r, 250));
        return L.toDataURL();
      }, m);
      const buf = Buffer.from(dataUrl.split(",")[1], "base64");
      const { width, height } = pngSize(buf);
      const outFile = join(OUT, m.file);
      writeFileSync(outFile, buf);
      results.push({ file: outFile, width, height });
      process.stdout.write(`  ${width}×${height}  ${outFile}\n`);
    }
    const bad = results.filter((r) => r.width !== 1080 || r.height !== 1080);
    if (bad.length) throw new Error(`${bad.length} meme(s) are not 1080×1080`);
    return results;
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { child.kill("SIGKILL"); } catch {}
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}
run().then(
  () => { process.stdout.write("=== PASS — 2 memes generated (1080×1080) ===\n"); process.exit(0); },
  (err) => { process.stderr.write("=== FAIL — " + (err && err.message ? err.message : err) + "\n"); process.exit(1); }
);
