#!/usr/bin/env node
// Probe a .webm via a real <video> element: report duration + dump frames.
// Usage: node design/launch-x/probe-video.mjs <file.webm> [t1,t2,...]
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FALLBACK_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const file = resolve(process.argv[2]);
const stamps = (process.argv[3] || "").split(",").map(Number).filter((n) => !Number.isNaN(n));
const OUT = join(__dirname, ".frames");
mkdirSync(OUT, { recursive: true });

const chromePath = process.env.CHROME_PATH || FALLBACK_CHROME;
if (!existsSync(file)) { console.error("no file", file); process.exit(1); }

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
const buf = (await import("node:fs")).readFileSync(file);
const dataUri = "data:video/webm;base64," + buf.toString("base64");
await page.setContent(`<video id="v" src="${dataUri}" muted></video>`);
const dur = await page.evaluate(async () => {
  const v = document.getElementById("v");
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error("decode error")); setTimeout(res, 8000); });
  // duration may be Infinity until seeked in some webm; force it.
  if (!isFinite(v.duration)) { v.currentTime = 1e6; await new Promise((r) => { v.ontimeupdate = () => { v.ontimeupdate = null; r(); }; setTimeout(r, 3000); }); }
  return v.duration;
});
console.log("DURATION", dur, "sec");
const base = basename(file, ".webm");
for (const t of stamps) {
  const p = join(OUT, `${base}-${t}s.png`);
  await page.evaluate(async (t) => {
    const v = document.getElementById("v");
    v.currentTime = t;
    await new Promise((r) => { v.onseeked = () => { v.onseeked = null; r(); }; setTimeout(r, 3000); });
  }, t);
  // draw current frame to a canvas and screenshot the canvas.
  await page.evaluate(() => {
    const v = document.getElementById("v");
    let c = document.getElementById("c");
    if (!c) { c = document.createElement("canvas"); c.id = "c"; document.body.appendChild(c); document.getElementById("v").style.display = "none"; }
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
  });
  const el = await page.$("#c");
  await el.screenshot({ path: p });
  console.log("frame", t + "s ->", p);
}
await browser.close();
