#!/usr/bin/env node
/**
 * design/launch-x/build-mochi.mjs — the Mochi loop clip (mochi.webm).
 *
 * Records ~9s of one BIG animated Mochi cycling moods on journal paper
 * (idle → wave → hop → party) from the self-contained page mochi-loop.html.
 * Square 800×800 — community-pfp / avatar energy. No server, no deps beyond
 * playwright-core.
 *
 *   node design/launch-x/build-mochi.mjs
 */
import { existsSync, mkdirSync, renameSync, rmSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const VIDDIR = join(OUT, ".vidtmp-mochi");
const FALLBACK_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const chromePath = process.env.CHROME_PATH || FALLBACK_CHROME;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZE = 800;
const HOLD_MS = 8200; // ~1 full 4-beat cycle; recorded ≈ 9s (target 8–10s)

async function run() {
  if (!existsSync(chromePath)) throw new Error(`No Chrome at ${chromePath}`);
  mkdirSync(VIDDIR, { recursive: true });
  const html = readFileSync(join(OUT, "mochi-loop.html"), "utf8");
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  try {
    const context = await browser.newContext({
      viewport: { width: SIZE, height: SIZE },
      deviceScaleFactor: 1,
      recordVideo: { dir: VIDDIR, size: { width: SIZE, height: SIZE } },
    });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForFunction(() => window.__mochiReady === true, null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
    await sleep(HOLD_MS);
    const vpath = await page.video().path();
    await context.close();
    const outFile = join(OUT, "mochi.webm");
    try { rmSync(outFile, { force: true }); } catch {}
    renameSync(vpath, outFile);
    process.stdout.write(`wrote ${outFile}\n`);
  } finally {
    await browser.close().catch(() => {});
    try { rmSync(VIDDIR, { recursive: true, force: true }); } catch {}
  }
}
run().then(
  () => { process.stdout.write("=== PASS — mochi.webm generated ===\n"); process.exit(0); },
  (err) => { process.stderr.write("=== FAIL — " + (err && err.message ? err.message : err) + "\n"); process.exit(1); }
);
