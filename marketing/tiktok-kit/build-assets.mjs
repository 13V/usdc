#!/usr/bin/env node
/**
 * marketing/tiktok-kit/build-assets.mjs — the ready-to-post TikTok/Reels assets.
 *
 * Renders every static asset in assets/ with headless Chromium (playwright-core,
 * system Chrome at /opt/pw-browsers/chromium-1194/chrome-linux/chrome):
 *
 *   • 7 Mochi scene cards, 1080×1920 — the REAL mascot rig (public/mascot.js,
 *     loaded verbatim via addScriptTag) over journal paper with big hook text.
 *   • 4 fake group-chat screenshots, 1080×1920 — iMessage-style owed-money drama.
 *   • 2 meme-lab outputs, 1080×1080 — boots the actual Express server and drives
 *     the public /memes generator headless (same path as design/launch-x).
 *   • pfp.png 1000×1000 (Mochi face on mint) + banner.png 1500×500.
 *
 * Brand fonts are embedded as base64 data-URIs from public/fonts so pages need
 * no network. Every PNG's dimensions are verified before PASS.
 *
 *   node marketing/tiktok-kit/build-assets.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const OUT = join(__dirname, "assets");
const MASCOT_JS = join(REPO, "public", "mascot.js");
const FALLBACK_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── brand palette (mirrors public/memes.js / the journal styleguide) ──────────
const INK = "#2B2118", MINT = "#3DE8C7", CORAL = "#FF6B5E", BLUE = "#2775CA", SUN = "#FFC65C";
const PAPER = "#F7F1E3";

// ── fonts, embedded (latin subsets from public/fonts) ─────────────────────────
function fontData(file) {
  return `data:font/woff2;base64,${readFileSync(join(REPO, "public", "fonts", file)).toString("base64")}`;
}
const FONT_CSS = `
@font-face{font-family:'Space Mono';font-weight:400;font-style:normal;src:url(${fontData("i7dPIFZifjKcF5UAWdDRYEF8RXi4EwQ.woff2")}) format('woff2');}
@font-face{font-family:'Space Mono';font-weight:700;font-style:normal;src:url(${fontData("i7dMIFZifjKcF5UAWdDRaPpZUFWaHi6WZ3Q.woff2")}) format('woff2');}
@font-face{font-family:'Clash Display';font-weight:700;font-style:normal;src:url(${fontData("53RZKGODFYDW3QHTIL7IPOWTBCSUEZK7.woff2")}) format('woff2');}
@font-face{font-family:'General Sans';font-weight:400;font-style:normal;src:url(${fontData("7YY3ZAAE3TRV2LANYOLXNHTPHLXVWTKH.woff2")}) format('woff2');}
@font-face{font-family:'General Sans';font-weight:500;font-style:normal;src:url(${fontData("SB2OEB6IKZPRR6JT4GFJ2TFT6HBB6AZN.woff2")}) format('woff2');}
@font-face{font-family:'General Sans';font-weight:600;font-style:normal;src:url(${fontData("3ZLMEXZEQPLTEPMHTQDAUXP5ZZXCZAEN.woff2")}) format('woff2');}
`;

// Freeze the rig's idle animations so screenshots are crisp mid-pose.
const FREEZE_CSS = `*,*::before,*::after{animation:none!important;transition:none!important;}`;

const TINTS = {
  paper: "transparent",
  mint: "rgba(61,232,199,0.14)",
  coral: "rgba(255,107,94,0.10)",
  sun: "rgba(255,198,92,0.16)",
};

// ── scene cards: journal paper + REAL Mochi rig + big hook text ───────────────
function tape(x, y, rot, w, color) {
  return `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:88px;transform:rotate(${rot}deg);background-color:${color};opacity:.82;box-shadow:0 8px 22px rgba(43,33,24,0.13);background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.26) 0 20px,rgba(255,255,255,0) 20px 40px)"></div>`;
}

function sceneShell({ tint = "paper", deco = "", body }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${FONT_CSS}${FREEZE_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px;height:1920px;overflow:hidden}
  body{
    background:${PAPER};
    background-image:
      linear-gradient(${TINTS[tint] || "transparent"},${TINTS[tint] || "transparent"}),
      repeating-linear-gradient(180deg,transparent 0 92px,rgba(39,117,202,0.11) 92px 94px);
    font-family:'Space Mono',monospace;color:${INK};position:relative;
  }
  /* coral margin rule */
  body::before{content:"";position:absolute;top:0;bottom:0;left:120px;width:5px;background:rgba(255,107,94,0.28)}
  .hook{position:absolute;left:90px;right:90px;top:170px;text-align:center;
    font-family:'Space Mono',monospace;font-weight:700;line-height:1.22;letter-spacing:-1px;
    transform:rotate(-1.2deg)}
  .hook .hl{background:linear-gradient(180deg,transparent 8%,rgba(61,232,199,0.55) 12%,rgba(61,232,199,0.55) 88%,transparent 92%);padding:0 8px;border-radius:6px}
  .hook .hlc{background:linear-gradient(180deg,transparent 8%,rgba(255,198,92,0.6) 12%,rgba(255,198,92,0.6) 88%,transparent 92%);padding:0 8px;border-radius:6px}
  .stage{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%) scale(4.1)}
  /* our own centered paper glow (the rig's glow centers itself via keyframes,
     which FREEZE_CSS disables — so we draw a static one behind the frog) */
  .glow{position:absolute;left:50%;top:52%;width:820px;height:820px;border-radius:50%;
    transform:translate(-50%,-50%);background:radial-gradient(circle,rgba(61,232,199,0.32) 0%,rgba(61,232,199,0) 65%)}
  .sub{position:absolute;left:110px;right:110px;bottom:300px;text-align:center;
    font-family:'Space Mono',monospace;font-weight:400;font-size:42px;line-height:1.45;color:rgba(43,33,24,0.72);
    transform:rotate(-0.6deg)}
  .wm{position:absolute;left:0;right:0;bottom:96px;text-align:center;
    font-family:'Space Mono',monospace;font-weight:700;font-size:34px;color:rgba(43,33,24,0.5);letter-spacing:2px}
  </style></head><body>
  ${tape(96, -18, -6, 320, "rgba(255,198,92,0.8)")}
  ${tape(680, -14, 5, 320, "rgba(61,232,199,0.72)")}
  ${deco}
  ${body}
  <div class="wm">divvy 🐸</div>
  </body></html>`;
}

// hand-scribble backdrop for the "doing the math" card
const MATH_DECO = `<svg style="position:absolute;left:80px;top:980px;opacity:0.5" width="920" height="560" viewBox="0 0 920 560">
  <g fill="none" stroke="rgba(43,33,24,0.55)" stroke-width="4" stroke-linecap="round"
     font-family="Space Mono" transform="rotate(-2 460 280)">
    <text x="40" y="70" font-size="52" fill="rgba(43,33,24,0.6)" stroke="none">$847.60 ÷ 5 = ???</text>
    <text x="120" y="170" font-size="46" fill="rgba(43,33,24,0.55)" stroke="none">em didn't drink…</text>
    <text x="60" y="270" font-size="46" fill="rgba(43,33,24,0.55)" stroke="none">+ tip? which tip??</text>
    <text x="150" y="380" font-size="46" fill="rgba(255,107,94,0.75)" stroke="none">liv × 2 desserts</text>
    <path d="M60,300 q120,40 260,10" stroke="rgba(255,107,94,0.6)" stroke-width="6"/>
    <path d="M520,420 q60,-90 180,-60 q90,20 60,90" stroke="rgba(39,117,202,0.5)" stroke-width="6"/>
    <text x="540" y="520" font-size="60" fill="rgba(43,33,24,0.6)" stroke="none">= ¯\\_(ツ)_/¯</text>
  </g></svg>`;

const CONFETTI_DECO = `<svg style="position:absolute;inset:0" width="1080" height="1920" viewBox="0 0 1080 1920">
  ${[[150, 560, SUN], [900, 520, CORAL], [240, 1380, BLUE], [860, 1350, MINT], [130, 980, CORAL], [950, 960, SUN], [420, 480, MINT], [700, 1480, BLUE]]
    .map(([x, y, c], i) => (i % 2
      ? `<rect x="${x}" y="${y}" width="34" height="22" rx="4" fill="${c}" stroke="rgba(43,33,24,0.5)" stroke-width="4" transform="rotate(${(i * 47) % 80 - 40} ${x} ${y})"/>`
      : `<circle cx="${x}" cy="${y}" r="16" fill="${c}" stroke="rgba(43,33,24,0.5)" stroke-width="4"/>`)).join("")}
</svg>`;

const SCENES = [
  {
    file: "scene-2019.png", mood: "watching", tint: "paper", hookSize: 96,
    hook: `“i'll get <span class="hl">you back</span>”`,
    sub: "— him, in 2019.<br>mochi remembers. mochi always remembers.",
  },
  {
    file: "scene-card-machine.png", mood: "worried", tint: "coral", hookSize: 84,
    hook: `when the waiter hands <span class="hlc">YOU</span> the card machine`,
    sub: "and the table goes suspiciously quiet",
  },
  {
    file: "scene-1am-math.png", mood: "worried", tint: "paper", hookSize: 88, deco: MATH_DECO,
    hook: `me at 1am doing the <span class="hl">trip math</span>`,
    sub: "receipts: 14 · brain cells: 0",
  },
  {
    file: "scene-my-12-dollars.png", mood: "sleepy", tint: "mint", hookSize: 92,
    hook: `still waiting on my <span class="hlc">$12</span>`,
    sub: "day 94. he posted from a rooftop bar yesterday.",
  },
  {
    file: "scene-everyone-paid.png", mood: "sparkle", tint: "mint", hookSize: 84, deco: CONFETTI_DECO,
    hook: `when everyone pays you back <span class="hl">the same day</span>`,
    sub: "friendship status: preserved ✓",
  },
  {
    file: "scene-girl-math.png", mood: "happy", tint: "sun", hookSize: 88,
    hook: `girl math is the <span class="hlc">$9</span> nobody paid back not counting`,
    sub: "it's basically a donation at this point",
  },
  {
    file: "scene-pov-adults.png", mood: "wave", tint: "paper", hookSize: 84,
    hook: `POV: your group finally splits bills <span class="hl">like adults</span>`,
    sub: "no fights. no spreadsheets. just vibes.",
  },
];

// ── fake iMessage chats, 1080×1920 ────────────────────────────────────────────
function chatShell({ title, subtitle, rows }) {
  const bubbles = rows.map((r) => {
    if (r.ts) return `<div class="ts">${r.ts}</div>`;
    if (r.typing) return `<div class="row left"><div class="who">${r.who || ""}</div><div class="bubble grey typing"><span></span><span></span><span></span></div></div>`;
    const side = r.me ? "right" : "left";
    const cls = r.me ? "blue" : "grey";
    const who = !r.me && r.who ? `<div class="who">${r.who}</div>` : "";
    const status = r.status ? `<div class="status">${r.status}</div>` : "";
    return `<div class="row ${side}">${who}<div class="bubble ${cls}">${r.text}</div>${status}</div>`;
  }).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${FONT_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px;height:1920px;overflow:hidden}
  body{background:#fff;font-family:'General Sans','Noto Color Emoji',sans-serif;color:#000;display:flex;flex-direction:column}
  header{flex:none;padding:56px 40px 26px;background:rgba(249,249,249,0.98);border-bottom:1px solid rgba(0,0,0,0.12);text-align:center;position:relative}
  header .back{position:absolute;left:44px;top:88px;font-size:56px;color:#007AFF;font-weight:400}
  header .av{width:120px;height:120px;border-radius:50%;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;
    font-family:'General Sans',sans-serif;font-weight:500;font-size:52px;color:#fff;background:linear-gradient(180deg,#A9B2BC,#8E97A1)}
  header .nm{font-weight:500;font-size:34px;letter-spacing:0.2px}
  header .nm small{color:rgba(0,0,0,0.35);font-size:30px;font-weight:400}
  header .sub{margin-top:4px;font-size:26px;color:rgba(0,0,0,0.4)}
  main{flex:1;padding:44px 44px 60px;display:flex;flex-direction:column;gap:10px;overflow:hidden}
  .ts{text-align:center;font-size:26px;color:rgba(0,0,0,0.4);font-weight:500;margin:26px 0 12px}
  .row{display:flex;flex-direction:column;max-width:76%}
  .row.left{align-self:flex-start;align-items:flex-start}
  .row.right{align-self:flex-end;align-items:flex-end}
  .who{font-size:24px;color:rgba(0,0,0,0.4);margin:14px 0 4px 26px}
  .bubble{padding:20px 30px;border-radius:40px;font-size:36px;line-height:1.32;letter-spacing:0.1px}
  .bubble.grey{background:#E9E9EB;color:#000;border-bottom-left-radius:10px}
  .bubble.blue{background:#007AFF;color:#fff;border-bottom-right-radius:10px}
  .status{font-size:24px;color:rgba(0,0,0,0.4);margin:8px 10px 0;font-weight:500}
  .typing{display:flex;gap:12px;align-items:center;padding:28px 34px}
  .typing span{width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.3)}
  footer{flex:none;padding:0 44px 54px}
  .inputbar{display:flex;align-items:center;gap:18px}
  .plus{width:70px;height:70px;border-radius:50%;background:#E9E9EB;color:rgba(0,0,0,0.45);font-size:44px;display:flex;align-items:center;justify-content:center}
  .field{flex:1;height:70px;border:2px solid rgba(0,0,0,0.16);border-radius:38px;display:flex;align-items:center;padding:0 28px;font-size:30px;color:rgba(0,0,0,0.35)}
  .wm{position:fixed;right:30px;bottom:8px;font-family:'Space Mono',monospace;font-weight:700;font-size:22px;color:rgba(0,0,0,0.22);letter-spacing:1px}
  </style></head><body>
  <header>
    <div class="back">‹</div>
    <div class="av">${title.replace(/[^A-Za-z ]/g, "").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "🐸"}</div>
    <div class="nm">${title} <small>›</small></div>
    ${subtitle ? `<div class="sub">${subtitle}</div>` : ""}
  </header>
  <main>${bubbles}</main>
  <footer><div class="inputbar"><div class="plus">＋</div><div class="field">iMessage</div></div></footer>
  <div class="wm">divvy 🐸</div>
  </body></html>`;
}

const CHATS = [
  {
    file: "chat-2019.png", title: "Dave", subtitle: null,
    rows: [
      { ts: "Mar 12, 2019, 11:48 PM" },
      { me: true, text: "yo you good for the $23 from the game?" },
      { text: "yeah yeah venmo's being weird, i'll get you back 👍" },
      { me: true, text: "all good 🤝" },
      { ts: "Today 8:03 PM" },
      { me: true, text: "so. about that $23" },
      { text: "new phone who dis" },
      { me: true, text: "DAVE" },
      { typing: true },
    ],
  },
  {
    file: "chat-roommates.png", title: "the apartment 🏠", subtitle: "4 people",
    rows: [
      { ts: "Today 10:12 PM" },
      { who: "Maya", text: "rent + wifi + the costco run = $312.40 each. i did the math twice" },
      { who: "Josh", text: "wait why is wifi $80 now" },
      { who: "Maya", text: "because SOMEONE upgraded it “for ranked”" },
      { me: true, text: "just pay her josh" },
      { who: "Josh", text: "i get paid friday" },
      { who: "Maya", text: "you said that last friday" },
      { who: "Josh", text: "there's a friday every week maya, be specific" },
      { typing: true, who: "Maya" },
    ],
  },
  {
    file: "chat-girls-trip.png", title: "girls trip 🌴", subtitle: "5 people",
    rows: [
      { ts: "Today 4:39 PM" },
      { who: "Sof", text: "ok so the villa was $840 and i paid all of it 🙃" },
      { who: "Em", text: "i got every single uber tho" },
      { who: "Liv", text: "i paid brunch AND the boat AND the little hats" },
      { me: true, text: "i genuinely have no idea who i owe anymore" },
      { who: "Sof", text: "should i make a spreadsheet" },
      { me: true, text: "NOT THE SPREADSHEET" },
      { who: "Em", text: "the spreadsheet ended the last trip 💀" },
    ],
  },
  {
    file: "chat-seen.png", title: "Jake", subtitle: null,
    rows: [
      { ts: "Today 2:41 PM" },
      { me: true, text: "hey did you see the $18 i sent you for the pizza" },
      { text: "yeah lol" },
      { me: true, text: "…and?" },
      { text: "😂😂" },
      { me: true, text: "jake it's been two weeks", status: "Read 2:47 PM" },
    ],
  },
];

// ── pfp + banner ──────────────────────────────────────────────────────────────
function pfpHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${FONT_CSS}${FREEZE_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1000px;height:1000px;overflow:hidden}
  body{background:linear-gradient(180deg,#D9F8EF,#BDF2E3);position:relative;
    background-image:repeating-linear-gradient(180deg,transparent 0 64px,rgba(39,117,202,0.07) 64px 66px),linear-gradient(180deg,#D9F8EF,#BDF2E3)}
  .stage{position:absolute;left:50%;top:54%;transform:translate(-50%,-50%) scale(4.6)}
  </style></head><body><div class="stage" id="stage"></div></body></html>`;
}
function bannerHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${FONT_CSS}${FREEZE_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1500px;height:500px;overflow:hidden}
  body{background:${PAPER};position:relative;font-family:'Space Mono',monospace;color:${INK};
    background-image:repeating-linear-gradient(180deg,transparent 0 58px,rgba(39,117,202,0.11) 58px 60px)}
  body::before{content:"";position:absolute;top:0;bottom:0;left:80px;width:4px;background:rgba(255,107,94,0.28)}
  .stage{position:absolute;left:250px;top:56%;transform:translate(-50%,-50%) scale(1.9)}
  .word{position:absolute;left:490px;top:130px;font-family:'Clash Display',sans-serif;font-weight:700;font-size:120px;letter-spacing:-4px}
  .word .dot{display:inline-block;width:64px;height:64px;border-radius:18px;background:${BLUE};border:5px solid ${INK};box-shadow:7px 7px 0 rgba(43,33,24,0.85);margin-right:26px}
  .tag{position:absolute;left:496px;top:296px;font-weight:700;font-size:44px;letter-spacing:0.5px;color:rgba(43,33,24,0.75)}
  .tag .hl{background:linear-gradient(180deg,transparent 10%,rgba(61,232,199,0.55) 14%,rgba(61,232,199,0.55) 86%,transparent 90%);padding:0 6px}
  </style></head><body>
  <div class="stage" id="stage"></div>
  <div class="word"><span class="dot"></span>divvy</div>
  <div class="tag">split the bill. <span class="hl">not the friendship.</span></div>
  </body></html>`;
}

// ── value carousels (1080×1350, 4:5) ──────────────────────────────────────────
// UNBRANDED niche-tip carousels: no logo, no mascot, no brand colors until the
// final slide, which does the soft reveal (Mochi + wordmark + one-liner, no CTA).
// Output: assets/carousels/<slug>/01.png … NN.png

const CAR_INK = "#221C15";
const CAR_PAPER = "#FAF6EC";

function carouselCss() {
  return `${FONT_CSS}${FREEZE_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px;height:1350px;overflow:hidden}
  body{background:${CAR_PAPER};color:${CAR_INK};font-family:'General Sans',sans-serif;position:relative;
    background-image:repeating-linear-gradient(180deg,transparent 0 96px,rgba(34,28,21,0.05) 96px 98px)}
  .pad{position:absolute;inset:0;padding:110px 96px 140px;display:flex;flex-direction:column}
  .kick{font-family:'Space Mono',monospace;font-weight:700;font-size:30px;letter-spacing:4px;text-transform:uppercase;color:rgba(34,28,21,0.45)}
  .cov-title{font-family:'Space Mono',monospace;font-weight:700;font-size:96px;line-height:1.14;letter-spacing:-2px;margin-top:44px}
  .cov-title .u{box-shadow:inset 0 -22px 0 rgba(34,28,21,0.14)}
  .cov-sub{font-size:40px;line-height:1.45;color:rgba(34,28,21,0.62);margin-top:44px;max-width:22ch}
  .cov-save{margin-top:auto;font-family:'Space Mono',monospace;font-weight:700;font-size:32px;color:rgba(34,28,21,0.55)}
  .num{font-family:'Space Mono',monospace;font-weight:700;font-size:150px;line-height:0.9;color:rgba(34,28,21,0.16)}
  .tip-h{font-family:'Space Mono',monospace;font-weight:700;font-size:66px;line-height:1.18;letter-spacing:-1px;margin-top:36px}
  .tip-b{font-size:42px;line-height:1.52;color:rgba(34,28,21,0.72);margin-top:40px}
  .tip-b b{color:${CAR_INK};font-weight:600}
  .tip-b .q{display:block;margin-top:34px;padding:30px 36px;border-left:6px solid rgba(34,28,21,0.35);
    font-family:'Space Mono',monospace;font-size:36px;line-height:1.45;color:rgba(34,28,21,0.8);background:rgba(34,28,21,0.04)}
  .pager{position:absolute;left:96px;bottom:74px;font-family:'Space Mono',monospace;font-weight:700;font-size:28px;color:rgba(34,28,21,0.4)}
  .arrow{position:absolute;right:96px;bottom:66px;font-size:44px;color:rgba(34,28,21,0.4)}
  /* final reveal slide */
  .rev{background:${PAPER};background-image:repeating-linear-gradient(180deg,transparent 0 96px,rgba(39,117,202,0.10) 96px 98px)}
  .rev-wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;text-align:center;padding:150px 90px}
  .rev-kick{font-family:'Space Mono',monospace;font-weight:700;font-size:30px;letter-spacing:4px;text-transform:uppercase;color:rgba(43,33,24,0.5)}
  .rev-stage{margin-top:8px;transform:scale(2.4);transform-origin:center;height:390px;display:flex;align-items:center;justify-content:center}
  .rev-word{display:flex;align-items:center;gap:20px;font-family:'Clash Display',sans-serif;font-weight:700;font-size:104px;letter-spacing:-3px;color:${INK};margin-top:40px}
  .rev-word .dot{width:56px;height:56px;border-radius:16px;background:${BLUE};border:4px solid ${INK};box-shadow:6px 6px 0 rgba(43,33,24,0.85)}
  .rev-line{font-family:'Space Mono',monospace;font-weight:700;font-size:44px;line-height:1.5;color:rgba(43,33,24,0.78);margin-top:40px;max-width:20ch}
  .rev-line .hl{background:linear-gradient(180deg,transparent 10%,rgba(61,232,199,0.5) 14%,rgba(61,232,199,0.5) 86%,transparent 90%);padding:0 6px}
  .rev-soft{margin-top:auto;font-family:'Space Mono',monospace;font-size:30px;color:rgba(43,33,24,0.45)}`;
}

function carouselSlideHtml(car, idx) {
  const s = car.slides[idx];
  const total = car.slides.length;
  let body;
  let bodyClass = "";
  if (s.kind === "cover") {
    body = `<div class="pad">
      <div class="kick">${car.kicker}</div>
      <div class="cov-title">${s.title}</div>
      <div class="cov-sub">${s.sub || ""}</div>
      <div class="cov-save">save this for the group chat ↓</div>
    </div><div class="arrow">→</div>`;
  } else if (s.kind === "reveal") {
    bodyClass = "rev";
    body = `<div class="rev-wrap">
      <div class="rev-kick">the part where we say hi</div>
      <div class="rev-stage" id="stage"></div>
      <div class="rev-word"><span class="dot"></span>divvy</div>
      <div class="rev-line">${s.line}</div>
      <div class="rev-soft">🐸 that's it. that's the reveal.</div>
    </div>`;
  } else {
    body = `<div class="pad">
      <div class="num">${String(s.n).padStart(2, "0")}</div>
      <div class="tip-h">${s.h}</div>
      <div class="tip-b">${s.b}</div>
    </div>
    <div class="pager">${idx + 1} / ${total}</div><div class="arrow">→</div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${carouselCss()}</style></head><body class="${bodyClass}">${body}</body></html>`;
}

const CAROUSELS = [
  {
    slug: "group-trips",
    kicker: "group trips · money edition",
    slides: [
      { kind: "cover", title: `5 ways to stop <span class="u">losing money</span> on group trips`, sub: "from someone who once fronted $900 and got back vibes." },
      { n: 1, h: "one fronter per category, not per moment", b: `Before the trip, assign lanes: one person books lodging, one covers food runs, one handles transport.<br><br>You end with <b>3 clean debts instead of 40 tiny ones</b> nobody remembers.` },
      { n: 2, h: "log it within 10 seconds or it never happened", b: `Memory inflation is real — everyone remembers paying <b>more</b> than they did.<br><br>The rule: whoever pays says the number out loud and it goes in the note/app <b>at the table</b>. Reconstructing a week from bank statements is how fights start.` },
      { n: 3, h: "agree the split BEFORE you leave", b: `Even split? By use? Do the non-drinkers subsidize the bar tab? Does the solo-room person pay more?<br><br>Any answer is fine. <b>Deciding after the money is spent is the only wrong answer.</b>` },
      { n: 4, h: "set a settle-up date, not “whenever”", b: `“We square up Sunday night” gets paid.<br>“No rush lol” becomes a 4-month loop of low-grade resentment.<br><br><b>Open money loops rot friendships.</b> Close them while the sunburn is still fresh.` },
      { n: 5, h: "net the debts before anyone pays", b: `Don't do A pays B, B pays C, C pays A.<br><br>Add up who's net up and net down — most groups collapse to <b>one or two transfers total</b>. Fewer payments, fewer “did you get it?” texts.` },
      { kind: "reveal", line: `we built divvy for this.<br>split anything. settle in seconds. <span class="hl">friendship intact.</span>` },
    ],
  },
  {
    slug: "rent-split",
    kicker: "roommates · rent math",
    slides: [
      { kind: "cover", title: `how to split rent when the rooms <span class="u">aren't equal</span>`, sub: "because the person in the closet-sized room is quietly furious." },
      { n: 1, h: "equal split for unequal rooms = slow resentment", b: `If one room has a private bath and one shares a wall with the elevator, a 50/50 split isn't “fair”, it's just <b>easy for the person with the good room</b>.<br><br>Fix it once, in one conversation.` },
      { n: 2, h: "start with square footage", b: `Base share = your room's sqft ÷ total bedroom sqft × rent.<br><span class="q">room A 140 sqft, room B 100 sqft, rent $2,400<br>→ A pays $1,400, B pays $1,000</span>` },
      { n: 3, h: "then price the perks, ±10%", b: `Private bathroom, big closet, real window, quiet side — each is worth a nudge.<br><br>Adjust the base share by <b>up to 10%</b> per big perk. Past that you're overthinking it.` },
      { n: 4, h: "can't agree? auction the good room", b: `Everyone writes a sealed number: what they'd actually pay for the big room. Highest bid wins it and pays it — <b>everyone else's rent drops</b> by the difference.<br><br>Nobody can complain about a price they set themselves.` },
      { n: 5, h: "common areas stay 50/50", b: `You're pricing <b>bedrooms</b>, not the kitchen. Living room, wifi, utilities: even split.<br><br>Exception: a couple sharing one room is 2 people on the utilities — most houses do <b>+25% on their utility share</b>.` },
      { n: 6, h: "re-split when life changes", b: `Partner basically moved in? Someone took over the garage? <b>The deal you made isn't sacred — the friendship is.</b><br><br>Re-run the math the week things change, not 6 months of sighs later.` },
      { kind: "reveal", line: `we built divvy for this.<br>recurring rent splits, zero chasing. <span class="hl">friendship intact.</span>` },
    ],
  },
  {
    slug: "get-paid-back",
    kicker: "copy-paste · owed money",
    slides: [
      { kind: "cover", title: `texts that get you <span class="u">paid back</span> (without it being weird)`, sub: "copy, paste, receive money. mostly." },
      { n: 1, h: "the soft open — send it same day", b: `<span class="q">“yo — friday came to $34 each, sending you my details so i don't forget”</span>Asking fast isn't rude. <b>Waiting 3 months and simmering is.</b>` },
      { n: 2, h: "always name the number and the thing", b: `“the $23 from the game” gets paid.<br>“that thing from that time” dies in the chat.<br><br><b>Specific debts feel real. Vague debts feel optional.</b>` },
      { n: 3, h: "give a date and a reason", b: `<span class="q">“could you get it to me by friday? rent's due”</span>People don't ignore you out of malice — they ignore <b>open-ended</b> requests. Structure gets action.` },
      { n: 4, h: "the humor nudge (for round 2)", b: `<span class="q">“update: your $12 is now old enough to walk”</span>A joke reopens a dead thread <b>without shaming anyone</b> — and it screenshots well, which is its own leverage.` },
      { n: 5, h: "the closure discount (for old debts)", b: `<span class="q">“let's call it $20 even and be done — cool?”</span>Losing $5 to <b>end</b> a $25 saga is a bargain. Resentment compounds worse than money.` },
      { n: 6, h: "the boundary (so there's no round 3)", b: `Next dinner: <span class="q">“i can't front it this time — can everyone pay as we order?”</span>If you're always the wallet, the group learned it from you. <b>Unlearn them gently.</b>` },
      { kind: "reveal", line: `or skip the chasing entirely.<br>we built divvy for this. <span class="hl">everyone pays their share.</span>` },
    ],
  },
  {
    slug: "dinner-bill",
    kicker: "dinner · bill etiquette",
    slides: [
      { kind: "cover", title: `how to split the dinner bill without being <span class="u">THAT person</span>`, sub: "the 5 rules that keep the table friends." },
      { n: 1, h: "the $10 rule", b: `If everyone's order landed within ~$10 of each other, <b>split evenly and move on</b>.<br><br>The itemized-math fight costs the table more (in time and vibes) than anyone's $6 difference.` },
      { n: 2, h: "big tickets self-report", b: `Steak? Three cocktails? The owner calls it: <span class="q">“i had the ribeye, i'll throw in 20 extra”</span><b>Self-reporting keeps it friendly.</b> Being audited by the salad person does not.` },
      { n: 3, h: "birthdays are decided before ordering", b: `The table covers the birthday person, split among everyone else — <b>agreed when you sit down</b>, not negotiated over the card machine.<br><br>Surprise generosity is lovely. Surprise math is not.` },
      { n: 4, h: "tip follows the bill", b: `Tip on the shared total and <b>split the tip the same way you split the food</b>.<br><br>The person who tips “for the table” every week is keeping a ledger in their head. That ledger has your name in it.` },
      { n: 5, h: "settle at the table, not “later”", b: `One card pays the restaurant; everyone else pays that person <b>before coats go on</b>.<br><br>“i'll get you back” is where money goes to die — you know this. you've BEEN this.` },
      { kind: "reveal", line: `we built divvy for this.<br>scan the receipt, everyone pays at the table. <span class="hl">friendship intact.</span>` },
    ],
  },
  {
    slug: "moving-in",
    kicker: "roommates · before the lease",
    slides: [
      { kind: "cover", title: `5 money talks to have <span class="u">before</span> moving in together`, sub: "10 awkward minutes now beats 12 awkward months later." },
      { n: 1, h: "the rent split (do the math, not the vibes)", b: `Unequal rooms → unequal rent. Use sqft as a base, adjust for perks, or auction the big room.<br><br><b>Write the final number down.</b> Future-you will “remember” it differently.` },
      { n: 2, h: "the boring-stuff fund", b: `Toilet paper, dish soap, trash bags — the $7 items nobody wants to be the only one buying.<br><br>Either a small monthly kitty (<b>$15–20 each</b>) or a strict rotation. “Whoever notices buys it” means one person always notices.` },
      { n: 3, h: "whose name is on the bills", b: `The name on the account eats the late fees and the credit hit.<br><br><b>Spread the accounts</b> (one takes wifi, one takes power) or compensate the name-holder. And autopay everything.` },
      { n: 4, h: "the partner clause", b: `A partner staying 4+ nights a week is a resident with no rent.<br><br>Agree the threshold NOW: <span class="q">“past 3 nights/week regularly, we talk utilities”</span>It's a much worse conversation once it's about a specific person.` },
      { n: 5, h: "the exit plan", b: `Deposit split, notice period, who finds the replacement — decide <b>while you still like each other</b>.<br><br>Every horror story you've heard skipped this slide.` },
      { kind: "reveal", line: `we built divvy for this.<br>rent, bills, the boring fund — <span class="hl">split on autopilot.</span>` },
    ],
  },
  {
    slug: "settle-up-etiquette",
    kicker: "unwritten rules · owed money",
    slides: [
      { kind: "cover", title: `7 unwritten rules of <span class="u">owing your friends</span> money`, sub: "everyone knows them. nobody says them. here they are." },
      { n: 1, h: "under $20 = same day", b: `Small debts aren't “whenever” debts — they're <b>while-you're-still-together</b> debts.<br><br>The longer a $9 lives, the weirder it gets for everyone.` },
      { n: 2, h: "the ower rounds up, the fronter rounds down", b: `They say “call it $15”, you send $16.<br>You fronted $47.50? “$47 is fine.”<br><br><b>Both directions are generosity signals.</b> Groups run on them.` },
      { n: 3, h: "never make anyone ask twice", b: `The first ask took courage. The second one costs the friendship a little.<br><br>If you can't pay yet, <b>say when you can</b> — “thursday, promise” is respect. Silence is not.` },
      { n: 4, h: "a request is not an accusation", b: `Getting a payment request from a friend is <b>logistics, not judgment</b>.<br><br>Reply-with-payment > reply-with-“lol”. You know which one you've sent.` },
      { n: 5, h: "don't spend visibly while owing invisibly", b: `Posting the rooftop bar while sitting on your roommate's $60 is a choice, and everyone saw you make it.<br><br><b>Debts to friends jump the queue in public.</b>` },
      { n: 6, h: "forgive down, never up", b: `Waive what's owed TO you whenever you feel like it — that's grace.<br><br>Deciding a debt you OWE is “basically forgiven” because it's been a while? <b>That's theft with extra steps.</b>` },
      { n: 7, h: "the fronter is doing you a favor", b: `Someone put a group dinner on their card so 9 people didn't queue at the till.<br><br>They're the group's <b>unpaid, unthanked bank</b>. Pay them like you'd want your bank to pay you: instantly.` },
      { kind: "reveal", line: `we built divvy so nobody has to be the bank.<br><span class="hl">split it, settle it, stay friends.</span>` },
    ],
  },
];

// ── meme-lab pair (boots the real server, drives /memes) ──────────────────────
const MEMES = [
  { file: "meme-waiting.png", pose: "watching", tint: "paper", top: "", bottom: "me waiting for my $12" },
  { file: "meme-send-tab.png", pose: "pain", tint: "coral", top: "", bottom: "the group chat after i send the tab" },
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
    try { const r = await fetch(`http://127.0.0.1:${port}/api/auth/config`); if (r.ok) return; } catch { }
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
    env: {
      ...process.env, PORT: String(port), DB_PATH: dbPath,
      SESSION_SECRET: "tiktok-kit-assets-0123456789abcdef", DATA_BACKEND: "sqlite", CLUSTER: "devnet", TS_NODE_TRANSPILE_ONLY: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function pngSize(buf) { return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }; }

async function shoot(browser, { html, width, height, mood, file }) {
  const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage();
  await page.setContent(html, { waitUntil: "load" });
  if (mood) {
    // load the REAL rig and drop a frozen frame of it into #stage
    await page.addScriptTag({ path: MASCOT_JS });
    await page.evaluate((m) => {
      const stage = document.getElementById("stage");
      // glow:false — the rig's glow centers itself inside its keyframes, which
      // FREEZE_CSS disables; pages draw their own static glow where wanted.
      stage.innerHTML = window.Mascot.html({ mood: m, size: 118, glow: false });
    }, mood);
  }
  await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
  await sleep(350);
  const buf = await page.screenshot({ type: "png" });
  const dim = pngSize(buf);
  if (dim.width !== width || dim.height !== height) {
    throw new Error(`${file}: got ${dim.width}×${dim.height}, wanted ${width}×${height}`);
  }
  const out = join(OUT, file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  process.stdout.write(`  ${String(dim.width).padStart(4)}×${dim.height}  ${file}\n`);
  await page.context().close();
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const chromePath = resolveChrome();
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  try {
    // 1) Mochi scene cards (real rig, journal paper, 1080×1920)
    for (const s of SCENES) {
      const html = sceneShell({
        tint: s.tint,
        deco: s.deco || "",
        body: `<div class="hook" style="font-size:${s.hookSize}px">${s.hook}</div>
               <div class="glow"></div>
               <div class="stage" id="stage"></div>
               ${s.sub ? `<div class="sub">${s.sub}</div>` : ""}`,
      });
      await shoot(browser, { html, width: 1080, height: 1920, mood: s.mood, file: s.file });
    }

    // 2) fake group-chat screenshots (1080×1920)
    for (const c of CHATS) {
      await shoot(browser, { html: chatShell(c), width: 1080, height: 1920, file: c.file });
    }

    // 3) value carousels (unbranded until the reveal slide) — 1080×1350
    for (const car of CAROUSELS) {
      for (let i = 0; i < car.slides.length; i++) {
        const isReveal = car.slides[i].kind === "reveal";
        await shoot(browser, {
          html: carouselSlideHtml(car, i),
          width: 1080, height: 1350,
          mood: isReveal ? "wave" : undefined, // Mochi appears ONLY on the reveal
          file: join("carousels", car.slug, `${String(i + 1).padStart(2, "0")}.png`),
        });
      }
    }

    // 4) pfp + banner
    await shoot(browser, { html: pfpHtml(), width: 1000, height: 1000, mood: "happy", file: "pfp.png" });
    await shoot(browser, { html: bannerHtml(), width: 1500, height: 500, mood: "wave", file: "banner.png" });
  } finally {
    await browser.close().catch(() => { });
  }

  // 5) meme-lab outputs (real server + public /memes, 1080×1080)
  const port = await getFreePort();
  const tmp = mkdtempSync(join(tmpdir(), "divvy-tiktok-kit-"));
  const child = startServer(port, join(tmp, "m.db"));
  let browser2;
  try {
    await waitForServer(port);
    browser2 = await chromium.launch({ headless: true, executablePath: chromePath });
    const page = await (await browser2.newContext({ viewport: { width: 640, height: 1200 }, deviceScaleFactor: 2 })).newPage();
    await page.goto(`http://127.0.0.1:${port}/memes`, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => !!(window.MemeLab && window.MemeLab.state && document.getElementById("memeCanvas")), null, { timeout: 30000 });
    await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
    await sleep(600);
    for (const m of MEMES) {
      const dataUrl = await page.evaluate(async (mm) => {
        const L = window.MemeLab;
        L.state.pose = mm.pose; L.state.tint = mm.tint; L.state.top = mm.top; L.state.bottom = mm.bottom;
        L.render();
        await new Promise((r) => setTimeout(r, 450));
        L.render();
        await new Promise((r) => setTimeout(r, 250));
        return L.toDataURL();
      }, m);
      const buf = Buffer.from(dataUrl.split(",")[1], "base64");
      const dim = pngSize(buf);
      if (dim.width !== 1080 || dim.height !== 1080) throw new Error(`${m.file}: meme is ${dim.width}×${dim.height}, wanted 1080×1080`);
      writeFileSync(join(OUT, m.file), buf);
      process.stdout.write(`  ${dim.width}×${dim.height}  ${m.file}\n`);
    }
  } finally {
    if (browser2) await browser2.close().catch(() => { });
    try { child.kill("SIGKILL"); } catch { }
    try { rmSync(tmp, { recursive: true, force: true }); } catch { }
  }
}

run().then(
  () => {
    const slideCount = CAROUSELS.reduce((n, c) => n + c.slides.length, 0);
    process.stdout.write(`=== PASS — ${SCENES.length + CHATS.length + MEMES.length + 2} assets + ${CAROUSELS.length} carousels (${slideCount} slides) in marketing/tiktok-kit/assets ===\n`);
    process.exit(0);
  },
  (err) => { process.stderr.write("=== FAIL — " + (err && err.message ? err.message : err) + "\n"); process.exit(1); }
);
