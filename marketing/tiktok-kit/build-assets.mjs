#!/usr/bin/env node
/**
 * marketing/tiktok-kit/build-assets.mjs — the ready-to-post TikTok/Reels assets.
 *
 * Renders every static asset in assets/ with headless Chromium (playwright-core,
 * system Chrome at /opt/pw-browsers/chromium-1194/chrome-linux/chrome):
 *
 *   • 7 Mochi scene cards, 1080×1920 — the REAL mascot rig (public/mascot.js,
 *     loaded verbatim via addScriptTag) over journal paper with big hook text.
 *   • fake group-chat screenshots, 1080×1920 — iMessage-style owed-money drama.
 *     chat-girls-trip.png + chat-rent.png use the v3 renderer: status bar,
 *     gradient monogram avatars (header cluster + per-sender), grouped bubbles
 *     with real tails, corner-overlapping tapbacks, read receipt, input bar +
 *     home indicator, closing typing indicator, SF-adjacent Inter — the reveal
 *     is a divvy pay-request link-preview card INSIDE the thread (diegetic).
 *   • value carousels, 1080×1350 — get-paid-back/ is rendered as authentic
 *     Apple-Notes screenshots (one tall note, 8 scroll-position captures);
 *     the rest still use the v1 "designed" look until they're converted.
 *   • 2 meme-lab outputs, 1080×1080 — boots the actual Express server and drives
 *     the public /memes generator headless (same path as design/launch-x).
 *   • pfp.png 1000×1000 (Mochi face on mint) + banner.png 1500×500.
 *
 * Brand fonts are embedded as base64 data-URIs from public/fonts (plus Inter,
 * vendored in marketing/tiktok-kit/fonts, standing in for SF Pro) so pages need
 * no network. Every PNG's dimensions are verified before PASS.
 *
 *   node marketing/tiktok-kit/build-assets.mjs
 *   node marketing/tiktok-kit/build-assets.mjs --only get-paid-back,chat-girls-trip
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

// Inter (vendored latin variable font) stands in for SF Pro in the "native iOS
// screenshot" renderers — closest metrics to Apple's system font we can ship.
const INTER_CSS = `
@font-face{font-family:'Inter';font-weight:100 900;font-style:normal;src:url(data:font/woff2;base64,${readFileSync(join(__dirname, "fonts", "Inter-latin-var.woff2")).toString("base64")}) format('woff2');}
`;
const SF = `'Inter','SF Pro Text',-apple-system,'Helvetica Neue','Noto Color Emoji',sans-serif`;

// Freeze the rig's idle animations so screenshots are crisp mid-pose.
const FREEZE_CSS = `*,*::before,*::after{animation:none!important;transition:none!important;}`;

// ── iOS chrome bits shared by the "native screenshot" renderers ───────────────
// Status bar (time left, signal/wifi/battery right) — no dynamic island: real
// iPhone screenshots don't capture the cutout.
function statusBarHtml(time) {
  return `<div class="sbar">
    <div class="sbar-time">${time}</div>
    <div class="sbar-icons">
      <svg width="52" height="34" viewBox="0 0 26 17"><g fill="#000">
        <rect x="0" y="10.5" width="4.6" height="6.5" rx="1.4"/><rect x="7" y="7.5" width="4.6" height="9.5" rx="1.4"/>
        <rect x="14" y="4" width="4.6" height="13" rx="1.4"/><rect x="21" y="0.5" width="4.6" height="16.5" rx="1.4"/>
      </g></svg>
      <svg width="50" height="34" viewBox="0 0 25 17"><g stroke="#000" stroke-width="2.5" fill="none" stroke-linecap="round">
        <path d="M2 6.4 Q12.5 -2.6 23 6.4"/><path d="M5.6 9.9 Q12.5 4.2 19.4 9.9"/><path d="M9.2 13.2 Q12.5 10.5 15.8 13.2"/>
      </g><circle cx="12.5" cy="15.5" r="1.9" fill="#000"/></svg>
      <svg width="60" height="34" viewBox="0 0 30 17">
        <rect x="1" y="2.5" width="23" height="12" rx="3.8" stroke="rgba(0,0,0,0.35)" stroke-width="1.5" fill="none"/>
        <rect x="3" y="4.5" width="11.6" height="8" rx="2" fill="#000"/>
        <rect x="25.6" y="6" width="2.6" height="5" rx="1.3" fill="rgba(0,0,0,0.4)"/>
      </svg>
    </div>
  </div>`;
}
const SBAR_CSS = `
  .sbar{position:absolute;top:0;left:0;right:0;height:118px;display:flex;align-items:flex-end;justify-content:space-between;padding:0 72px 12px 100px;z-index:50}
  .sbar-time{font-family:${SF};font-weight:600;font-size:44px;color:#000;letter-spacing:0.4px}
  .sbar-icons{display:flex;align-items:center;gap:16px}
`;
// Home indicator, drawn over content like the real one.
const HOME_BAR = `<div style="position:fixed;left:50%;bottom:14px;transform:translateX(-50%);width:420px;height:13px;border-radius:9px;background:rgba(0,0,0,0.88);z-index:40"></div>`;

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

// ── fake iMessage chats v3 — forensic iOS fidelity, diegetic reveal ───────────
// Everything a real group-chat screenshot has: status bar (61% battery), group
// avatar cluster with per-letter gradient monograms (front circle overlapping
// the back two), per-sender monogram avatars beside received bubble runs,
// grouped bubbles with real tails, tapbacks OVERLAPPING the bubble's top corner
// (with the little tail dots, and a count when 2+ reacted), a "Read h:mm PM"
// receipt under the last outgoing bubble before the time gap, an iMessage
// input bar + home indicator at the bottom, and a closing typing indicator.
// NO watermark: the reveal is a divvy pay-request rendered as a real iMessage
// small link preview (bold title, gray lowercase domain inside the card, app
// icon as a rounded square on the right).
function chatV3Html({ title, members, time, rows }) {
  const grad = (m) => `linear-gradient(180deg,${m.g[0]},${m.g[1]})`;
  const byName = (who) => members.find((m) => m.n === who) || { i: (who || "?")[0], g: ["#AAB3BD", "#8E97A1"] };
  const mav = (who) => { const m = byName(who); return `<div class="mav" style="background:${grad(m)}">${m.i}</div>`; };
  const tb = (t) => !t ? "" : `<div class="tb-b"><span class="e">${t.e}</span>${t.n ? `<span class="n">${t.n}</span>` : ""}</div>`;

  const out = [];
  const same = (a, b) => a && b && !a.ts && !b.ts && !!a.me === !!b.me && (a.who || "") === (b.who || "");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.ts) { out.push(`<div class="ts">${r.ts.replace(/^Today /, "<b>Today</b> ")}</div>`); continue; }
    const samePrev = same(rows[i - 1], r), sameNext = same(r, rows[i + 1]);
    const cls = ["row", r.me ? "right" : "left"];
    if (samePrev) cls.push("tight");
    if (r.tapback) cls.push("hastb");
    const who = !r.me && r.who && !samePrev ? `<div class="who">${r.who}</div>` : "";
    const avatar = !r.me && !sameNext ? mav(r.who) : ""; // avatar sits by the LAST bubble of a run
    if (r.typing) {
      out.push(`<div class="${cls.join(" ")}"><div class="bwrap">${avatar}<div class="typing"><i></i><i></i><i></i></div></div></div>`);
      continue;
    }
    if (r.card) {
      out.push(`<div class="${cls.join(" ")}">${who}<div class="bwrap">${avatar}<div class="card">
          <div class="card-txt">
            <div class="card-title">${r.card.title}</div>
            <div class="card-sub">${r.card.sub}</div>
            <div class="card-dom">${r.card.domain}</div>
          </div>
          <div class="card-icon"><div class="appic" id="stage"></div></div>
        </div>${tb(r.tapback)}</div></div>`);
      continue;
    }
    const status = r.me && r.status ? `<div class="status">${r.status}</div>` : "";
    out.push(`<div class="${cls.join(" ")}">${who}<div class="bwrap">${avatar}<div class="bubble ${r.me ? "blue" : "grey"}${sameNext ? "" : " tail"}">${r.text}</div>${tb(r.tapback)}</div>${status}</div>`);
  }

  // header cluster: two back circles, front circle overlapping both
  const avs = members.slice(0, 3).map((m, i) =>
    `<div class="av av${i}" style="background:${grad(m)}">${m.i}</div>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${INTER_CSS}${FREEZE_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px;height:1920px;overflow:hidden}
  body{background:#fff;font-family:${SF};color:#000;display:flex;flex-direction:column;position:relative}
  ${SBAR_CSS}
  header{flex:none;padding:118px 40px 14px;background:rgba(248,248,248,0.94);border-bottom:1px solid rgba(0,0,0,0.10);text-align:center;position:relative}
  .back{position:absolute;left:42px;top:150px}
  .facetime{position:absolute;right:46px;top:162px}
  .avs{position:relative;height:116px}
  .av{position:absolute;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:500}
  .av0{width:88px;height:88px;left:calc(50% - 114px);top:0;font-size:38px;z-index:1}
  .av1{width:98px;height:98px;left:calc(50% - 49px);top:30px;font-size:42px;z-index:3;box-shadow:0 0 0 6px rgba(248,248,248,0.94)}
  .av2{width:88px;height:88px;left:calc(50% + 26px);top:0;font-size:38px;z-index:2}
  .nm{font-size:29px;font-weight:400;color:#000;margin-top:4px}
  .nm span{color:rgba(0,0,0,0.3);font-size:25px;margin-left:6px}
  main{flex:1;padding:2px 40px 12px;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden}
  .ts{text-align:center;font-size:24px;color:rgba(0,0,0,0.38);margin:14px 0 0}
  .ts b{font-weight:600}
  .row{display:flex;flex-direction:column;max-width:81%;margin-top:10px}
  .row.tight{margin-top:4px}
  .row.hastb{margin-top:46px}
  .row.hastb .bubble{padding-right:96px}
  .row.left{align-self:flex-start;align-items:flex-start;padding-left:70px}
  .row.right{align-self:flex-end;align-items:flex-end}
  .who{font-size:22px;color:rgba(0,0,0,0.4);margin:0 0 4px 26px}
  .bwrap{position:relative;max-width:100%}
  .mav{position:absolute;left:-70px;bottom:2px;width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:500;font-size:25px;z-index:6}
  .bubble{position:relative;padding:13px 24px;border-radius:34px;font-size:33px;line-height:1.3;letter-spacing:0.1px}
  .bubble.grey{background:#E9E9EB;color:#000}
  .bubble.blue{background:#007AFF;color:#fff}
  .bubble.tail.grey::before{content:"";position:absolute;bottom:-3px;left:-15px;height:42px;width:42px;background:#E9E9EB;border-bottom-right-radius:32px 28px}
  .bubble.tail.grey::after{content:"";position:absolute;bottom:-3px;left:-39px;width:40px;height:46px;background:#fff;border-bottom-right-radius:24px}
  .bubble.tail.blue::before{content:"";position:absolute;bottom:-3px;right:-15px;height:42px;width:42px;background:#007AFF;border-bottom-left-radius:32px 28px}
  .bubble.tail.blue::after{content:"";position:absolute;bottom:-3px;right:-39px;width:40px;height:46px;background:#fff;border-bottom-left-radius:24px}
  .status{font-size:24px;color:rgba(0,0,0,0.42);font-weight:500;margin:6px 8px 0}
  /* typing indicator (three dots + trailing tail circles) */
  .typing{position:relative;display:flex;gap:11px;align-items:center;background:#E9E9EB;border-radius:34px;padding:20px 26px}
  .typing i{width:17px;height:17px;border-radius:50%;background:rgba(0,0,0,0.28)}
  .typing::before{content:"";position:absolute;left:-4px;bottom:-7px;width:22px;height:22px;border-radius:50%;background:#E9E9EB}
  .typing::after{content:"";position:absolute;left:-19px;bottom:-22px;width:12px;height:12px;border-radius:50%;background:#E9E9EB}
  /* tapback balloon: overlaps the bubble's top corner, tail dots toward it */
  .tb-b{position:absolute;top:-58px;right:-26px;height:78px;min-width:78px;padding:0 18px;border-radius:44px;background:#E9E9EB;box-shadow:0 0 0 6px #fff;display:flex;align-items:center;justify-content:center;gap:8px;z-index:5}
  .tb-b .e{font-size:42px;line-height:1}
  .tb-b .n{font-size:27px;font-weight:600;color:rgba(0,0,0,0.55)}
  .tb-b::before{content:"";position:absolute;left:1px;bottom:-2px;width:22px;height:22px;border-radius:50%;background:#E9E9EB;box-shadow:0 0 0 5px #fff}
  .tb-b::after{content:"";position:absolute;left:-13px;bottom:-15px;width:12px;height:12px;border-radius:50%;background:#E9E9EB;box-shadow:0 0 0 4px #fff}
  /* divvy pay-request as an iMessage SMALL link preview: text left (bold title,
     gray lowercase domain at the bottom, inside the card), app icon right */
  .card{width:660px;border-radius:34px;overflow:hidden;background:#E9E9EB;display:flex;align-items:stretch}
  .card-txt{flex:1;min-width:0;padding:18px 6px 15px 28px;display:flex;flex-direction:column}
  .card-title{font-size:31px;font-weight:600;line-height:1.28;color:#111}
  .card-sub{font-size:27px;color:rgba(0,0,0,0.5);margin-top:6px}
  .card-dom{font-size:26px;color:rgba(0,0,0,0.42);margin-top:auto;padding-top:12px;text-transform:lowercase}
  .card-icon{flex:none;width:152px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.035);border-left:1px solid rgba(0,0,0,0.07)}
  .appic{width:106px;height:106px;border-radius:26px;background:linear-gradient(180deg,#D9F8EF,#AFF0DE);display:flex;align-items:center;justify-content:center;border:1px solid rgba(0,0,0,0.07)}
  /* iMessage input bar + home indicator */
  footer{flex:none;background:#fff;padding:8px 34px 54px;display:flex;align-items:center;gap:20px}
  .plus{width:76px;height:76px;border-radius:50%;background:#E9E9EB;flex:none;display:flex;align-items:center;justify-content:center}
  .field{flex:1;height:76px;border:2px solid rgba(0,0,0,0.13);border-radius:44px;display:flex;align-items:center;justify-content:space-between;padding:0 22px 0 30px;font-size:31px;color:rgba(0,0,0,0.3)}
  </style></head><body>
  ${statusBarHtml(time)}
  <header>
    <div class="back"><svg width="30" height="52" viewBox="0 0 15 26"><path d="M13 2 L3 13 L13 24" stroke="#007AFF" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <div class="avs">${avs}</div>
    <div class="nm">${title}<span>›</span></div>
    <div class="facetime"><svg width="64" height="44" viewBox="0 0 32 22"><rect x="1" y="3" width="20" height="16" rx="5" fill="#007AFF"/><path d="M22 9 L29 4.5 a1.4 1.4 0 0 1 2 1.2 v10.6 a1.4 1.4 0 0 1 -2 1.2 L22 13 Z" fill="#007AFF"/></svg></div>
  </header>
  <main>${out.join("\n")}</main>
  <footer>
    <div class="plus"><svg width="38" height="38" viewBox="0 0 19 19"><path d="M9.5 3.2v12.6 M3.2 9.5h12.6" stroke="rgba(0,0,0,0.5)" stroke-width="1.9" stroke-linecap="round"/></svg></div>
    <div class="field"><span>iMessage</span><svg width="34" height="52" viewBox="0 0 17 26"><g stroke="rgba(0,0,0,0.33)" stroke-width="1.5" fill="none" stroke-linecap="round"><rect x="5.4" y="1.4" width="6.2" height="12.2" rx="3.1"/><path d="M2.4 10.8a6.1 6.1 0 0 0 12.2 0M8.5 17.6v3.6M5.6 23.8h5.8"/></g></svg></div>
  </footer>
  ${HOME_BAR}
  </body></html>`;
}

const CHATS_V2 = [
  {
    file: "chat-girls-trip.png",
    title: "girls trip 🌴",
    time: "5:09",
    members: [
      { n: "Em", i: "E", g: ["#6EB7F7", "#3D8DEB"] },
      { n: "Sof", i: "S", g: ["#C08CF5", "#985FDE"] },
      { n: "Liv", i: "L", g: ["#7ED88F", "#43B75C"] },
    ],
    rows: [
      { who: "Sof", text: "the villa was $840 and i paid all of it 🙃" },
      { who: "Liv", text: "i paid brunch and the boat and the little hats" },
      { who: "Em", text: "lol not the hats" },
      { me: true, text: "i don't even know who i owe anymore" },
      { who: "Sof", text: "should i make a spreadsheet" },
      { me: true, text: "NOT THE SPREADSHEET", status: "Read 4:41 PM" },
      { who: "Em", text: "the spreadsheet ended the last trip", tapback: { e: "💀", n: 2 } },
      { ts: "Today 5:02 PM" },
      { who: "Sof", text: "wiat." },
      { who: "Sof", text: "ok try this instead" },
      { who: "Sof", card: { title: "girls trip 🌴 — your share is $168", sub: "pay in one tap", domain: "divvysol.com" }, tapback: { e: "❤️" } },
      { who: "Liv", text: "WAIT this is so much better" },
      { typing: true, who: "Em" },
    ],
  },
  {
    file: "chat-rent.png",
    title: "apt 4b 🏠",
    time: "9:44",
    members: [
      { n: "Maya", i: "M", g: ["#F6B356", "#EE8B2E"] },
      { n: "Josh", i: "J", g: ["#5CC6F2", "#2E9BD6"] },
      { n: "Priya", i: "P", g: ["#F58FB1", "#E85D8A"] },
    ],
    rows: [
      { who: "Maya", text: "lanlord email just dropped" },
      { who: "Maya", text: "rent is $2,600 starting october 🙃" },
      { who: "Josh", text: "he can't just do that??" },
      { me: true, text: "are we still doing even quarters bc my room fits a bed and one (1) plant" },
      { who: "Priya", text: "the plant doesn't pay rent so" },
      { me: true, text: "neither does jake and he's here 6 nights a week", status: "Read 9:18 PM" },
      { who: "Josh", text: "LEAVE JAKE OUT OF THIS" },
      { who: "Priya", text: "jake finished my oat milk. jake is in this", tapback: { e: "😂", n: 2 } },
      { ts: "Today 9:41 PM" },
      { who: "Maya", text: "ok i did the math by room size" },
      { who: "Maya", card: { title: "october rent — your share is $612", sub: "pay in one tap", domain: "divvysol.com" }, tapback: { e: "‼️" } },
      { who: "Josh", text: "finally" },
      { typing: true, who: "Priya" },
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

// ── notes-style carousels (1080×1350) — authentic Apple Notes screenshots ─────
// One tall note (status bar + nav chrome fixed on top), captured at N scroll
// positions. Slide 1 is the note title + first lines; middle slides continue
// the note (lines cut mid-scroll like a real screenshot); the final slide is
// the soft reveal written INTO the note ("btw the app that automates all of
// this: divvy") above a pasted-in Mochi/wordmark image attachment.

const NOTES_GOLD = "#C7A22B";
const NOTES_CHROME_H = 236;

function notesNoteHtml(car) {
  const secs = car.sections.map((s, i) => {
    const lines = (s.lines || []).map((l) => `<div class="ln">${l}</div>`).join("");
    if (s.kind === "cover") {
      return `<div class="sec" id="s${i}" style="margin-top:0">
        <div class="ndate">${car.date}</div>
        <div class="ntitle">${s.title}</div>
        ${lines}
      </div>`;
    }
    if (s.kind === "reveal") {
      return `<div class="sec" id="s${i}">
        ${lines}
        <div class="att">
          <div class="att-glow"></div>
          <div class="att-stage" id="stage"></div>
          <div class="att-word"><span class="dot"></span>divvy</div>
          <div class="att-tag">split the bill. not the friendship.</div>
        </div>
      </div>`;
    }
    return `<div class="sec" id="s${i}"><div class="nh">${s.h}</div>${lines}</div>`;
  }).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${INTER_CSS}${FONT_CSS}${FREEZE_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px}
  body{background:#FBF8EF;font-family:${SF};color:#1C1C1C;padding-top:${NOTES_CHROME_H}px}
  ${SBAR_CSS}
  .chrome{position:fixed;top:0;left:0;right:0;height:${NOTES_CHROME_H}px;background:#FBF8EF;z-index:30}
  .chrome.scrolled{border-bottom:1px solid rgba(0,0,0,0.10);box-shadow:0 1px 0 rgba(0,0,0,0.03)}
  .nav{position:absolute;top:118px;left:0;right:0;height:110px;display:flex;align-items:center;padding:0 46px}
  .back{display:flex;align-items:center;gap:14px;color:${NOTES_GOLD};font-size:42px}
  .nav-right{margin-left:auto;display:flex;align-items:center;gap:52px}
  .note{padding:34px 78px 150px}
  .ndate{text-align:center;font-size:29px;color:rgba(0,0,0,0.33);margin-bottom:36px}
  .ntitle{font-size:70px;font-weight:700;letter-spacing:-0.8px;line-height:1.18;color:#111;margin-bottom:14px}
  .nh{font-size:53px;font-weight:700;letter-spacing:-0.3px;color:#111;margin-bottom:10px}
  .ln{font-size:45px;line-height:1.5;color:#222;margin-top:8px;letter-spacing:-0.1px}
  .sec{margin-top:74px}
  .att{margin-top:46px;width:100%;height:620px;border-radius:22px;position:relative;overflow:hidden;
    background:linear-gradient(180deg,#DCF9F0,#BDF2E3);
    background-image:repeating-linear-gradient(180deg,transparent 0 64px,rgba(39,117,202,0.08) 64px 66px),linear-gradient(180deg,#DCF9F0,#BDF2E3);
    display:flex;flex-direction:column;align-items:center;justify-content:center}
  .att-glow{position:absolute;left:50%;top:38%;width:560px;height:560px;border-radius:50%;transform:translate(-50%,-50%);
    background:radial-gradient(circle,rgba(61,232,199,0.5) 0%,rgba(61,232,199,0) 65%)}
  .att-stage{position:relative;transform:scale(1.8);height:280px;display:flex;align-items:center;justify-content:center}
  .att-word{position:relative;display:flex;align-items:center;gap:18px;font-family:'Clash Display',sans-serif;font-weight:700;font-size:86px;letter-spacing:-2.5px;color:${INK};margin-top:10px}
  .att-word .dot{width:46px;height:46px;border-radius:14px;background:${BLUE};border:4px solid ${INK};box-shadow:5px 5px 0 rgba(43,33,24,0.85)}
  .att-tag{position:relative;font-family:'Space Mono',monospace;font-weight:700;font-size:31px;color:rgba(43,33,24,0.72);margin-top:16px}
  </style></head><body>
  <div class="chrome" id="chrome">
    ${statusBarHtml(car.time)}
    <div class="nav">
      <div class="back">
        <svg width="28" height="50" viewBox="0 0 14 25"><path d="M12 2 L3 12.5 L12 23" stroke="${NOTES_GOLD}" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Folders
      </div>
      <div class="nav-right">
        <svg width="52" height="66" viewBox="0 0 26 33"><g stroke="${NOTES_GOLD}" stroke-width="2.1" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3.5" y="12" width="19" height="17.5" rx="3"/><path d="M13 2.5 v16 M8.5 7 L13 2.5 L17.5 7"/>
        </g></svg>
        <svg width="58" height="58" viewBox="0 0 29 29"><circle cx="14.5" cy="14.5" r="12.8" stroke="${NOTES_GOLD}" stroke-width="2.1" fill="none"/>
          <g fill="${NOTES_GOLD}"><circle cx="8.6" cy="14.5" r="1.9"/><circle cx="14.5" cy="14.5" r="1.9"/><circle cx="20.4" cy="14.5" r="1.9"/></g></svg>
      </div>
    </div>
  </div>
  <div class="note">${secs}</div>
  ${HOME_BAR}
  </body></html>`;
}

const NOTES_CAROUSELS = [
  {
    slug: "get-paid-back",
    date: "July 7, 2026 at 10:43 AM",
    time: "10:47",
    sections: [
      { kind: "cover", title: "texts that get you paid back", lines: [
        "(without it being weird)",
        "- copy, paste, receive money. mostly.",
      ] },
      { h: "1. the soft open — send it same day", lines: [
        "“yo — friday came to $34 each, sending you my details so i don't forget”",
        "- asking fast isn't rude. waiting 3 months and simmering is.",
      ] },
      { h: "2. name the number and the thing", lines: [
        "- “the $23 from the game” gets paid",
        "- “that thing from that time” dies in the chat",
        "- specific debts feel real. vague debts feel optional.",
      ] },
      { h: "3. give a date and a reason", lines: [
        "“could you get it to me by friday? rent's due”",
        "- nobody ignores you out of malice. they ignore open-ended requests. structure gets action.",
      ] },
      { h: "4. the humor nudge (for round 2)", lines: [
        "“update: your $12 is now old enough to walk”",
        "- a joke reopens a dead thread without shaming anyone",
        "- also it screenshots well. which is leverage.",
      ] },
      { h: "5. the closure discount (old debts)", lines: [
        "“let's call it $20 even and be done — cool?”",
        "- losing $5 to END a $25 saga is a bargain. resentment compounds worse than money.",
      ] },
      { h: "6. the boundary (so there's no round 3)", lines: [
        "next dinner: “i can't front it this time — can everyone pay as we order?”",
        "- if you're always the wallet, the group learned it from you. unlearn them gently.",
      ] },
      { kind: "reveal", lines: [
        "&nbsp;",
        "btw the app that automates all of this: divvy 🐸",
      ] },
    ],
  },
];

async function shootNotesCarousel(browser, car) {
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(notesNoteHtml(car), { waitUntil: "load" });
  await page.addScriptTag({ path: MASCOT_JS });
  await page.evaluate(() => {
    const stage = document.getElementById("stage");
    if (stage) stage.innerHTML = window.Mascot.html({ mood: "wave", size: 118, glow: false });
  });
  await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
  await sleep(350);

  const offsets = await page.evaluate(({ n, chromeH }) => {
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const ys = [];
    for (let i = 0; i < n; i++) {
      if (i === 0) { ys.push(0); continue; }
      if (i === n - 1) { ys.push(max); continue; }
      const el = document.getElementById("s" + i);
      const top = el.getBoundingClientRect().top + window.scrollY;
      ys.push(Math.max(0, Math.min(max, Math.round(top - chromeH - 104))));
    }
    return ys;
  }, { n: car.sections.length, chromeH: NOTES_CHROME_H });

  for (let i = 0; i < offsets.length; i++) {
    await page.evaluate((y) => {
      window.scrollTo(0, y);
      document.getElementById("chrome").classList.toggle("scrolled", y > 4);
    }, offsets[i]);
    await sleep(90);
    const buf = await page.screenshot({ type: "png" });
    const dim = pngSize(buf);
    if (dim.width !== 1080 || dim.height !== 1350) throw new Error(`${car.slug}/${i + 1}: got ${dim.width}×${dim.height}`);
    const file = join("carousels", car.slug, `${String(i + 1).padStart(2, "0")}.png`);
    const out = join(OUT, file);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, buf);
    process.stdout.write(`  ${dim.width}×${dim.height}  ${file}\n`);
  }
  await ctx.close();
}

// ── mochi-illustrated listicle carousels (1080×1350) — branded throughout ─────
// The "Scratch AI" slideshow formula adapted to the divvy journal brand:
// cover = big title + composed Mochi scene; one numbered rule per slide with a
// Mochi accent; final slide is the charming hard-CTA (pre-launch: waitlist at
// divvysol.com + a real app screenshot, no store badge yet).

const APP_SHOT = `data:image/png;base64,${readFileSync(join(REPO, "public", "screenshots", "shot-new.png")).toString("base64")}`;

function receiptHtml(x, y, rot, title, rows, w = 330) {
  return `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;transform:rotate(${rot}deg);background:#FFFDF6;border:3px solid rgba(43,33,24,0.3);box-shadow:8px 10px 0 rgba(43,33,24,0.12);padding:24px 26px 28px;font-family:'Space Mono',monospace;font-size:25px;color:rgba(43,33,24,0.78)">
    <div style="font-weight:700;letter-spacing:3px;text-align:center;border-bottom:3px dashed rgba(43,33,24,0.3);padding-bottom:10px;margin-bottom:12px">${title}</div>
    ${rows.map(([k, v]) => `<div style="display:flex;justify-content:space-between;margin-top:8px"><span>${k}</span><span>${v}</span></div>`).join("")}
  </div>`;
}

function listicleCss() {
  return `${FONT_CSS}${FREEZE_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px;height:1350px;overflow:hidden}
  body{background:${PAPER};color:${INK};font-family:'Space Mono',monospace;position:relative;
    background-image:repeating-linear-gradient(180deg,transparent 0 88px,rgba(39,117,202,0.10) 88px 90px)}
  body::before{content:"";position:absolute;top:0;bottom:0;left:96px;width:5px;background:rgba(255,107,94,0.26)}
  .kick{position:absolute;left:0;right:0;top:96px;text-align:center;font-weight:700;font-size:30px;letter-spacing:5px;text-transform:uppercase;color:rgba(43,33,24,0.45)}
  .cov-title{position:absolute;left:110px;right:110px;top:180px;text-align:center;font-weight:700;font-size:88px;line-height:1.2;letter-spacing:-2px;transform:rotate(-1deg)}
  .hl{background:linear-gradient(180deg,transparent 8%,rgba(61,232,199,0.55) 12%,rgba(61,232,199,0.55) 88%,transparent 92%);padding:0 8px;border-radius:6px}
  .hlc{background:linear-gradient(180deg,transparent 8%,rgba(255,198,92,0.6) 12%,rgba(255,198,92,0.6) 88%,transparent 92%);padding:0 8px;border-radius:6px}
  .scene{position:absolute;left:0;right:0;top:620px;height:560px}
  .scene-stage{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%) scale(2.9);z-index:3}
  .scene-glow{position:absolute;left:50%;top:52%;width:640px;height:640px;border-radius:50%;transform:translate(-50%,-50%);
    background:radial-gradient(circle,rgba(61,232,199,0.32) 0%,rgba(61,232,199,0) 65%)}
  .cov-save{position:absolute;left:320px;right:280px;bottom:92px;text-align:center;font-weight:700;font-size:28px;color:rgba(43,33,24,0.55)}
  .num{position:absolute;left:110px;top:130px;font-weight:700;font-size:230px;line-height:1;letter-spacing:-8px;text-shadow:9px 9px 0 rgba(43,33,24,0.16)}
  .rule-h{position:absolute;left:114px;right:100px;top:430px;font-weight:700;font-size:66px;line-height:1.22;letter-spacing:-1.5px}
  .rule-b{position:absolute;left:114px;right:400px;top:660px;font-family:'General Sans',sans-serif;font-size:43px;line-height:1.55;color:rgba(43,33,24,0.78)}
  .rule-b b{font-weight:600;color:${INK}}
  .acc{position:absolute;right:130px;bottom:200px}
  .acc-stage{position:relative;transform:scale(1.9);transform-origin:bottom right;z-index:3}
  .acc-glow{position:absolute;right:-80px;bottom:-60px;width:420px;height:420px;border-radius:50%;
    background:radial-gradient(circle,rgba(61,232,199,0.3) 0%,rgba(61,232,199,0) 65%)}
  .brand{position:absolute;left:110px;bottom:82px;display:flex;align-items:center;gap:14px;font-family:'Clash Display',sans-serif;font-weight:700;font-size:44px;letter-spacing:-1px;color:rgba(43,33,24,0.85)}
  .brand .dot{width:26px;height:26px;border-radius:8px;background:${BLUE};border:3px solid ${INK};box-shadow:3px 3px 0 rgba(43,33,24,0.8)}
  .pager{position:absolute;right:110px;bottom:88px;font-weight:700;font-size:30px;color:rgba(43,33,24,0.42)}
  /* CTA slide */
  .cta-num{position:absolute;left:110px;top:112px;font-weight:700;font-size:150px;line-height:1;letter-spacing:-5px;color:${CORAL};text-shadow:7px 7px 0 rgba(43,33,24,0.16)}
  .cta-h{position:absolute;left:114px;right:100px;top:300px;font-weight:700;font-size:74px;line-height:1.22;letter-spacing:-2px}
  .cta-pill{position:absolute;left:114px;top:560px;display:inline-block;background:rgba(61,232,199,0.35);border:4px solid ${INK};border-radius:60px;
    box-shadow:7px 7px 0 rgba(43,33,24,0.85);padding:26px 44px;font-weight:700;font-size:40px}
  .cta-note{position:absolute;left:118px;top:700px;font-size:30px;color:rgba(43,33,24,0.55)}
  .phone{position:absolute;left:50%;transform:translateX(-50%);top:800px;width:520px;height:640px;border:12px solid ${INK};border-bottom:none;
    border-radius:64px 64px 0 0;overflow:hidden;box-shadow:16px 10px 0 rgba(43,33,24,0.18);background:#0B1220}
  .phone img{width:100%;display:block}
  .cta-stage{position:absolute;right:44px;top:1020px;transform:scale(1.8);z-index:5}
  </style>`;
}

function listicleSlideHtml(car, idx) {
  const s = car.slides[idx];
  const total = car.slides.length;
  let body;
  if (s.kind === "cover") {
    body = `
    <div class="kick">${car.kicker}</div>
    <div class="cov-title">${s.title}</div>
    <div class="scene">
      <div class="scene-glow"></div>
      ${(s.receipts || []).map((r) => receiptHtml(...r)).join("")}
      <div class="scene-stage" id="stage"></div>
    </div>
    <div class="cov-save">${s.save} →</div>
    <div class="brand"><span class="dot"></span>divvy</div>
    <div class="pager">1 / ${total}</div>`;
  } else if (s.kind === "cta") {
    body = `
    <div class="cta-num">${s.n}.</div>
    <div class="cta-h">${s.h}</div>
    <div class="cta-pill">get early access → <span class="hlc">divvysol.com</span></div>
    <div class="cta-note">${s.note}</div>
    <div class="phone"><img src="${APP_SHOT}"></div>
    <div class="cta-stage" id="stage"></div>
    <div class="brand"><span class="dot"></span>divvy</div>
    <div class="pager">${idx + 1} / ${total}</div>`;
  } else {
    body = `
    <div class="num" style="color:${s.c}">${s.n}.</div>
    <div class="rule-h">${s.h}</div>
    <div class="rule-b">${s.b}</div>
    <div class="acc"><div class="acc-glow"></div><div class="acc-stage" id="stage"></div></div>
    <div class="brand"><span class="dot"></span>divvy</div>
    <div class="pager">${idx + 1} / ${total}</div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${listicleCss()}</style></head><body>${body}</body></html>`;
}

const LISTICLES = [
  {
    slug: "group-trips-listicle",
    kicker: "mochi's field notes · no. 1",
    slides: [
      {
        kind: "cover", mood: "worried",
        title: `7 rules for group trips that <span class="hl">don't end friendships</span>`,
        save: "save this for the trip chat",
        receipts: [
          [120, 40, -7, "VILLA", [["7 nights", "$840.00"], ["paid by", "sofia 🙃"]]],
          [640, 70, 6, "BRUNCH", [["bottomless", "$184.00"], ["paid by", "liv"]]],
          [90, 330, 5, "UBERS", [["x 14", "$163.40"], ["paid by", "em"]]],
          [660, 340, -5, "THE BOAT", [["+ lil hats", "$255.00"], ["paid by", "liv again"]]],
        ],
      },
      { n: 1, c: CORAL, mood: "happy", h: `one fronter per lane, <span class="hl">not per moment</span>`, b: `one person books the villa, one covers food, one does the ubers.<br><br>you end the week with <b>3 clean debts</b> instead of 40 tiny mysteries nobody remembers.` },
      { n: 2, c: BLUE, mood: "watching", h: `say the number <span class="hlc">out loud</span>`, b: `whoever pays announces it at the table and it gets written down within 10 seconds.<br><br><b>memory inflation is real</b> — everyone remembers paying more than they did.` },
      { n: 3, c: "#E09E2F", mood: "sparkle", h: `agree the split <span class="hl">before you leave</span>`, b: `even split? by use? do the non-drinkers subsidize the bar tab?<br><br>any answer is fine. <b>deciding after the money is spent is the only wrong answer.</b>` },
      { n: 4, c: CORAL, mood: "sleepy", h: `set a settle-up date, not <span class="hlc">“whenever”</span>`, b: `“we square up sunday night” gets paid.<br><br>“no rush lol” becomes a <b>4-month loop of low-grade resentment</b>. close the loop while the sunburn is fresh.` },
      { n: 5, c: BLUE, mood: "happy", h: `net the debts <span class="hl">before anyone pays</span>`, b: `don't do A pays B, B pays C, C pays A.<br><br>add up who's net up and net down — most trips collapse to <b>one or two transfers total</b>.` },
      { n: 6, c: "#1FA98C", mood: "worried", h: `don't post the rooftop while <span class="hlc">owing the villa</span>`, b: `everyone saw the story. everyone did the math. 💀<br><br><b>debts to friends jump the queue in public.</b> settle up, then post.` },
      { kind: "cta", n: 7, mood: "wave", h: `let divvy do <span class="hl">all of this</span> for you`, note: "🐸 splits, nudges, and settling — automatic. app store soon." },
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

async function shoot(browser, { html, width, height, mood, mascot, file }) {
  const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage();
  await page.setContent(html, { waitUntil: "load" });
  if (mood || mascot) {
    // load the REAL rig and drop a frozen frame of it into #stage
    await page.addScriptTag({ path: MASCOT_JS });
    await page.evaluate((cfg) => {
      const stage = document.getElementById("stage");
      // glow:false — the rig's glow centers itself inside its keyframes, which
      // FREEZE_CSS disables; pages draw their own static glow where wanted.
      stage.innerHTML = cfg.kind === "mini"
        ? window.Mascot.mini(cfg.px || 64)
        : window.Mascot.html({ mood: cfg.mood, size: cfg.size || 118, glow: false });
    }, mascot || { mood });
  }
  await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
  await sleep(350);
  // chat pages: main is justify-content:flex-end + overflow:hidden, so extra
  // content silently clips off the TOP. Fail loudly instead.
  const clipped = await page.evaluate(() => {
    const m = document.querySelector("main");
    if (!m) return 0;
    const first = m.firstElementChild;
    if (!first) return 0;
    const pad = parseFloat(getComputedStyle(m).paddingTop) || 0;
    return Math.max(0, Math.round(m.getBoundingClientRect().top + pad - first.getBoundingClientRect().top));
  });
  if (clipped > 0) throw new Error(`${file}: chat content overflows the top by ${clipped}px — trim the thread`);
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

// `--only a,b,c` renders just the assets whose file path / slug contains one of
// the given keys (e.g. `--only get-paid-back,chat-girls-trip`). Everything else
// on disk is left untouched.
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx >= 0 ? (process.argv[onlyIdx + 1] || "").split(",").map((s) => s.trim()).filter(Boolean) : null;
const want = (key) => !ONLY || ONLY.some((k) => key.includes(k));

async function run() {
  mkdirSync(OUT, { recursive: true });
  const chromePath = resolveChrome();
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  try {
    // 1) Mochi scene cards (real rig, journal paper, 1080×1920)
    for (const s of SCENES) {
      if (!want(s.file)) continue;
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

    // 2) fake group-chat screenshots (1080×1920) — v1 + v2 renderers
    for (const c of CHATS) {
      if (!want(c.file)) continue;
      await shoot(browser, { html: chatShell(c), width: 1080, height: 1920, file: c.file });
    }
    for (const c of CHATS_V2) {
      if (!want(c.file)) continue;
      // mini head-only Mochi in the pay-request card's app icon (#stage)
      await shoot(browser, { html: chatV3Html(c), width: 1080, height: 1920, mascot: { kind: "mini", px: 72 }, file: c.file });
    }

    // 3) value carousels (unbranded until the reveal slide) — 1080×1350
    for (const car of CAROUSELS) {
      if (!want(car.slug)) continue;
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

    // 3b) notes-style carousels (authentic Apple Notes screenshots) — 1080×1350
    for (const car of NOTES_CAROUSELS) {
      if (!want(car.slug)) continue;
      await shootNotesCarousel(browser, car);
    }

    // 3c) mochi-illustrated listicle carousels (branded throughout) — 1080×1350
    for (const car of LISTICLES) {
      if (!want(car.slug)) continue;
      for (let i = 0; i < car.slides.length; i++) {
        await shoot(browser, {
          html: listicleSlideHtml(car, i),
          width: 1080, height: 1350,
          mood: car.slides[i].mood,
          file: join("carousels", car.slug, `${String(i + 1).padStart(2, "0")}.png`),
        });
      }
    }

    // 4) pfp + banner
    if (want("pfp.png")) await shoot(browser, { html: pfpHtml(), width: 1000, height: 1000, mood: "happy", file: "pfp.png" });
    if (want("banner.png")) await shoot(browser, { html: bannerHtml(), width: 1500, height: 500, mood: "wave", file: "banner.png" });
  } finally {
    await browser.close().catch(() => { });
  }

  // 5) meme-lab outputs (real server + public /memes, 1080×1080)
  if (!MEMES.some((m) => want(m.file))) return;
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
      if (!want(m.file)) continue;
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
    const slideCount = CAROUSELS.reduce((n, c) => n + c.slides.length, 0)
      + NOTES_CAROUSELS.reduce((n, c) => n + c.sections.length, 0)
      + LISTICLES.reduce((n, c) => n + c.slides.length, 0);
    const carCount = CAROUSELS.length + NOTES_CAROUSELS.length + LISTICLES.length;
    process.stdout.write(ONLY
      ? `=== PASS — rendered only [${ONLY.join(", ")}] in marketing/tiktok-kit/assets ===\n`
      : `=== PASS — ${SCENES.length + CHATS.length + CHATS_V2.length + MEMES.length + 2} assets + ${carCount} carousels (${slideCount} slides) in marketing/tiktok-kit/assets ===\n`);
    process.exit(0);
  },
  (err) => { process.stderr.write("=== FAIL — " + (err && err.message ? err.message : err) + "\n"); process.exit(1); }
);
