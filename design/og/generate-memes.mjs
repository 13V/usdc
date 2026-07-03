#!/usr/bin/env node
/**
 * design/og/generate-memes.mjs — render design/og/memes.html → public/og/memes.png.
 *
 * Screenshots the /memes share-card HTML at exactly 1200x630 using the local
 * playwright-core Chromium. Re-run whenever memes.html changes:
 *   node design/og/generate-memes.mjs
 */
import { chromium } from "playwright-core";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = resolve(__dirname, "memes.html");
const OUT = resolve(__dirname, "../../public/og/memes.png");
const CHROME =
  process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(HTML).href, { waitUntil: "networkidle" });
  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  process.stdout.write(`wrote ${OUT}\n`);
} finally {
  await browser.close();
}
