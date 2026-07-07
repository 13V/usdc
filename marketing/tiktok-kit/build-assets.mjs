#!/usr/bin/env node
/**
 * marketing/tiktok-kit/build-assets.mjs — the ready-to-post TikTok/Reels assets.
 *
 * Renders every static asset in assets/ with headless Chromium (playwright-core,
 * system Chrome at /opt/pw-browsers/chromium-1194/chrome-linux/chrome):
 *
 *   • 7 Mochi scene cards, 1080×1920 — the REAL mascot rig (public/mascot.js,
 *     loaded verbatim via addScriptTag) over journal paper with big hook text.
 *   • fake iMessage chats (scenarios/*.json → still PNG + fake-text VIDEO).
 *     v3 renderer: status bar, gradient monogram avatars (group cluster or
 *     single 1:1 avatar), grouped bubbles with real tails, corner-overlapping
 *     tapbacks, read receipts, input bar + home indicator, closing typing
 *     indicator, SF-adjacent Inter — the reveal is a divvy pay-request
 *     link-preview card INSIDE the thread (diegetic). Videos are the same
 *     thread played out beat-by-beat (typing → pop-in → tapbacks → card),
 *     recorded at 1080×1920 to assets/videos/<slug>.webm (+ .mp4 when an
 *     mp4-capable ffmpeg exists). `--stills-only` skips videos. GENERATOR.md
 *     documents the scenario format.
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
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
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

// ── fake iMessage chats v3 — forensic iOS fidelity, diegetic reveal ───────────
// Everything a real iMessage screenshot has: status bar, gradient monogram
// avatars (group header cluster, or a single centered avatar for 1:1 "dm"
// threads), grouped bubbles with real tails, corner-overlapping tapbacks
// (mirrored onto the top-LEFT corner for outgoing bubbles, like the real
// thing), bare oversized emoji-only messages (no bubble), "Delivered" /
// "Read h:mm PM" receipts under outgoing bubbles (max one per thread — iOS
// only shows the latest), an iMessage input bar + home indicator, and a
// closing typing indicator. NO watermark: the reveal is a divvy pay-request
// rendered as a real iMessage small link preview (bold title, gray lowercase
// domain inside the card, app icon as a rounded square on the right).
//
// Scenarios are DATA — marketing/tiktok-kit/scenarios/*.json (cast, avatar
// gradients, messages with tapbacks/receipts/pause beats, the pay-card
// payload, "group" vs "dm"). Each scenario renders BOTH a still PNG
// (assets/<file>) and a script-player VIDEO (assets/videos/<slug>.webm):
// typing bubbles (0.8–1.5s, length-varied), bubble pop-ins, tapbacks landing
// ~0.5s late, receipts fading in, the pay card arriving on a longer dramatic
// beat, closing typing indicator held ~2s. See GENERATOR.md.

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|[\u200D\uFE0F\s]|[\u{1F3FB}-\u{1F3FF}])+$/u;

function chatV3Parts(scen, { animate = false } = {}) {
  const { title, members, time, rows } = scen;
  const dm = scen.kind === "dm";
  const grad = (m) => `linear-gradient(180deg,${m.g[0]},${m.g[1]})`;
  const byName = (who) => members.find((m) => m.n === who) || members[0] || { i: (who || "?")[0], g: ["#AAB3BD", "#8E97A1"] };
  const mav = (who) => { if (dm) return ""; const m = byName(who); return `<div class="mav" style="background:${grad(m)}">${m.i}</div>`; };
  const tbHtml = (t) => !t ? "" : `<div class="tb-b"><span class="e">${t.e}</span>${t.n ? `<span class="n">${t.n}</span>` : ""}</div>`;
  const same = (a, b) => !!(a && b && !a.ts && !b.ts && !a.typing && !b.typing && !!a.me === !!b.me && (a.who || "") === (b.who || ""));
  // "Today 8:03 PM" → bold "Today"; "Mar 12, 2019 at 11:48 PM" → bold the date
  // (matches how Messages weights its date separators)
  const tsHtml = (r) => {
    const fmt = r.ts.startsWith("Today ")
      ? r.ts.replace(/^Today /, "<b>Today</b> ")
      : r.ts.replace(/^(.*?)( at .*)$/, "<b>$1</b>$2");
    return `<div class="ts">${fmt}</div>`;
  };

  // one message row, rendered as if `last` says whether it closes its run
  // (tail + avatar live on the LAST bubble of a same-sender run)
  const rowHtml = (r, samePrev, last) => {
    const cls = ["row", r.me ? "right" : "left"];
    if (samePrev) cls.push("tight");
    if (r.tapback) cls.push("hastb");
    const who = !dm && !r.me && r.who && !samePrev ? `<div class="who">${r.who}</div>` : "";
    const avatar = !r.me && last ? mav(r.who) : "";
    if (r.typing) return `<div class="${cls.join(" ")}"><div class="bwrap">${avatar}<div class="typing"><i></i><i></i><i></i></div></div></div>`;
    const status = r.me && r.status ? `<div class="status">${r.status}</div>` : "";
    if (r.card) {
      return `<div class="${cls.join(" ")}">${who}<div class="bwrap">${avatar}<div class="card">
          <div class="card-txt">
            <div class="card-title">${r.card.title}</div>
            <div class="card-sub">${r.card.sub}</div>
            <div class="card-dom">${r.card.domain}</div>
          </div>
          <div class="card-icon"><div class="appic"></div></div>
        </div>${tbHtml(r.tapback)}</div>${status}</div>`;
    }
    const bare = EMOJI_ONLY.test(r.text || "");
    const bcls = bare ? "bubble bare" : `bubble ${r.me ? "blue" : "grey"}${last ? " tail" : ""}`;
    return `<div class="${cls.join(" ")}">${who}<div class="bwrap">${avatar}<div class="${bcls}">${r.text}</div>${tbHtml(r.tapback)}</div>${status}</div>`;
  };
  const withV = (html, v) => html.replace(/^<div class="/, `<div class="${v} hidden `);

  let mainHtml = "";
  const steps = [];
  let total = 0;
  if (!animate) {
    mainHtml = rows.map((r, i) => r.ts ? tsHtml(r) : rowHtml(r, same(rows[i - 1], r), !same(r, rows[i + 1]))).join("\n");
  } else {
    // script-player mode: every row is pre-rendered (typing / provisional
    // run-ender / final variants) and revealed on a server-computed schedule.
    // Deterministic jitter (seeded on the slug) so re-renders time identically.
    let seed = 2166136261;
    for (const ch of scen.slug || title) seed = ((seed * 16777619) ^ ch.charCodeAt(0)) >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

    const wraps = [];
    let t = 900;
    rows.forEach((r, i) => {
      const wid = `w${i}`;
      const samePrev = same(rows[i - 1], r), sameNext = same(r, rows[i + 1]);
      const vs = [];
      if (r.ts) {
        vs.push(withV(tsHtml(r), "v-fin"));
      } else {
        if (!r.me && !r.typing) vs.push(withV(rowHtml({ typing: true, who: r.who }, samePrev, true), "v-typ"));
        if (sameNext) vs.push(withV(rowHtml(r, samePrev, true), "v-prov"));
        vs.push(withV(rowHtml(r, samePrev, !sameNext), "v-fin"));
      }
      wraps.push(`<div id="${wid}" class="wrap">${vs.join("")}</div>`);

      // ── timing ──
      if (r.beat) t += r.beat;                                   // authored pause
      if (r.ts) { steps.push([t, "show", wid, "fin"]); t += 1150; return; }
      if (r.typing) { steps.push([t, "show", wid, "fin"]); t += (r.hold || 2100); return; }
      if (!r.me) {
        if (r.card) t += 1100;                                   // beat before the reveal
        if (samePrev) steps.push([t, "fix", `w${i - 1}`]);       // tail migrates to typing bubble
        steps.push([t, "show", wid, "typ"]);
        const len = r.card ? 64 : (r.text || "").length;
        t += Math.min(Math.max(780 + len * 16 + rnd() * 320, 820), r.card ? 1900 : 1550);
        steps.push([t, "show", wid, sameNext ? "prov" : "fin"]);
      } else {
        t += 430 + rnd() * 400;                                  // "reading" pause
        if (r.card) t += 1200;                                   // dramatic beat before the pay card
        if (samePrev) steps.push([t, "fix", `w${i - 1}`]);
        steps.push([t, "show", wid, sameNext ? "prov" : "fin"]);
      }
      if (r.tapback) { steps.push([t + 520, "tb", wid]); t += 280; }
      if (r.status) { steps.push([t + 650, "st", wid]); t += 200; }
      t += r.card ? 1650 : 440 + rnd() * 380;                    // gap to the next message
    });
    steps.push([t + 700, "done"]);
    total = t + 1500;
    mainHtml = wraps.join("\n");
  }

  const avs = dm
    ? `<div class="av dmav" style="background:${grad(members[0])}">${members[0].i}</div>`
    : members.slice(0, 3).map((m, i) => `<div class="av av${i}" style="background:${grad(m)}">${m.i}</div>`).join("");

  const animCss = !animate ? "" : `
  .wrap{display:contents}
  .hidden{display:none!important}
  .fx-pop{animation:bpop .3s cubic-bezier(.18,1.2,.35,1) both}
  .row.left.fx-pop{transform-origin:0 100%}
  .row.right.fx-pop{transform-origin:100% 100%}
  @keyframes bpop{0%{opacity:0;transform:scale(.6) translateY(18px)}100%{opacity:1;transform:none}}
  .fx-fade{animation:tsf .5s ease both}
  @keyframes tsf{from{opacity:0}to{opacity:1}}
  .wrap .tb-b{opacity:0;transform:scale(.2);transition:transform .26s cubic-bezier(.2,1.5,.4,1),opacity .16s}
  .row.left .tb-b{transform-origin:15% 92%}
  .row.right .tb-b{transform-origin:85% 92%}
  .wrap.tb-on .tb-b{opacity:1;transform:none}
  .wrap .status{opacity:0;transition:opacity .55s ease}
  .wrap.st-on .status{opacity:1}
  @keyframes tdot{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:.85;transform:translateY(-5px)}}
  .typing i{animation:tdot 1.15s ease-in-out infinite}
  .typing i:nth-child(2){animation-delay:.14s}
  .typing i:nth-child(3){animation-delay:.28s}
  .appic *{animation:none!important;transition:none!important}`;

  const playerJs = !animate ? "" : `<script>
  window.__STEPS = ${JSON.stringify(steps)};
  window.__play = () => new Promise((resolve) => {
    for (const [t, op, a, b] of window.__STEPS) {
      setTimeout(() => {
        if (op === "done") { resolve(); return; }
        const w = document.getElementById(a);
        if (!w) return;
        if (op === "show") {
          for (const el of w.children) el.classList.add("hidden");
          const v = w.querySelector(".v-" + b) || w.querySelector(".v-fin");
          v.classList.remove("hidden");
          v.classList.add(v.classList.contains("ts") ? "fx-fade" : "fx-pop");
        } else if (op === "fix") {
          const p = w.querySelector(".v-prov"), f = w.querySelector(".v-fin");
          if (p && !p.classList.contains("hidden")) { p.classList.add("hidden"); f.classList.remove("hidden"); }
        } else if (op === "tb") { w.classList.add("tb-on"); }
        else if (op === "st") { w.classList.add("st-on"); }
      }, t);
    }
  });
  </script>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${INTER_CSS}${animate ? "" : FREEZE_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px;height:1920px;overflow:hidden}
  body{background:#fff;font-family:${SF};color:#000;display:flex;flex-direction:column;position:relative}
  ${SBAR_CSS}
  header{flex:none;padding:118px 40px 14px;background:rgba(248,248,248,0.94);border-bottom:1px solid rgba(0,0,0,0.10);text-align:center;position:relative}
  .back{position:absolute;left:42px;top:150px}
  .facetime{position:absolute;right:46px;top:162px}
  /* 142px tall so the title clears the front avatar + its 6px backdrop ring —
     at 116px the ring painted over the ascenders of the name ("tʀip"/"4ƅ") */
  .avs{position:relative;height:142px}
  .av{position:absolute;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:500}
  .av0{width:88px;height:88px;left:calc(50% - 114px);top:0;font-size:38px;z-index:1}
  .av1{width:98px;height:98px;left:calc(50% - 49px);top:30px;font-size:42px;z-index:3;box-shadow:0 0 0 6px rgba(248,248,248,0.94)}
  .av2{width:88px;height:88px;left:calc(50% + 26px);top:0;font-size:38px;z-index:2}
  .dmav{width:116px;height:116px;left:calc(50% - 58px);top:8px;font-size:50px}
  .nm{font-family:${SF};font-size:29px;font-weight:400;color:#000;margin-top:2px}
  .nm span{color:rgba(0,0,0,0.3);font-size:25px;margin-left:6px}
  main{flex:1;padding:2px 40px 12px;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden}
  .ts{text-align:center;font-size:24px;color:rgba(0,0,0,0.38);margin:14px 0 0}
  .ts b{font-weight:600}
  .row{display:flex;flex-direction:column;max-width:81%;margin-top:10px}
  .row.tight{margin-top:4px}
  .row.hastb{margin-top:46px}
  .row.left.hastb .bubble{padding-right:96px}
  .row.right.hastb .bubble{padding-left:96px}
  .row.left{align-self:flex-start;align-items:flex-start;padding-left:${dm ? 0 : 70}px}
  .row.right{align-self:flex-end;align-items:flex-end}
  .who{font-size:22px;color:rgba(0,0,0,0.4);margin:0 0 4px 26px}
  .bwrap{position:relative;max-width:100%}
  .mav{position:absolute;left:-70px;bottom:2px;width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:500;font-size:25px;z-index:6}
  .bubble{position:relative;padding:13px 24px;border-radius:34px;font-size:33px;line-height:1.3;letter-spacing:0.1px}
  .bubble.grey{background:#E9E9EB;color:#000}
  .bubble.blue{background:#007AFF;color:#fff}
  .bubble.bare{background:transparent;padding:4px 6px;font-size:64px;line-height:1.15}
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
  /* tapback balloon: overlaps the bubble's top corner, tail dots toward it.
     On outgoing (right) bubbles it mirrors to the top-LEFT corner. */
  .tb-b{position:absolute;top:-58px;right:-26px;height:78px;min-width:78px;padding:0 18px;border-radius:44px;background:#E9E9EB;box-shadow:0 0 0 6px #fff;display:flex;align-items:center;justify-content:center;gap:8px;z-index:5}
  .tb-b .e{font-size:42px;line-height:1}
  .tb-b .n{font-size:27px;font-weight:600;color:rgba(0,0,0,0.55)}
  .tb-b::before{content:"";position:absolute;left:1px;bottom:-2px;width:22px;height:22px;border-radius:50%;background:#E9E9EB;box-shadow:0 0 0 5px #fff}
  .tb-b::after{content:"";position:absolute;left:-13px;bottom:-15px;width:12px;height:12px;border-radius:50%;background:#E9E9EB;box-shadow:0 0 0 4px #fff}
  .row.right .tb-b{right:auto;left:-26px}
  .row.right .tb-b::before{left:auto;right:1px}
  .row.right .tb-b::after{left:auto;right:-13px}
  /* divvy pay-request as an iMessage SMALL link preview: text left (bold title,
     gray lowercase domain at the bottom, inside the card), app icon right */
  .card{width:660px;max-width:100%;border-radius:34px;overflow:hidden;background:#E9E9EB;display:flex;align-items:stretch}
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
  ${animCss}
  </style></head><body class="${dm ? "dm" : ""}">
  ${statusBarHtml(time)}
  <header>
    <div class="back"><svg width="30" height="52" viewBox="0 0 15 26"><path d="M13 2 L3 13 L13 24" stroke="#007AFF" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <div class="avs">${avs}</div>
    <div class="nm">${title}<span>›</span></div>
    <div class="facetime"><svg width="64" height="44" viewBox="0 0 32 22"><rect x="1" y="3" width="20" height="16" rx="5" fill="#007AFF"/><path d="M22 9 L29 4.5 a1.4 1.4 0 0 1 2 1.2 v10.6 a1.4 1.4 0 0 1 -2 1.2 L22 13 Z" fill="#007AFF"/></svg></div>
  </header>
  <main>${mainHtml}</main>
  <footer>
    <div class="plus"><svg width="38" height="38" viewBox="0 0 19 19"><path d="M9.5 3.2v12.6 M3.2 9.5h12.6" stroke="rgba(0,0,0,0.5)" stroke-width="1.9" stroke-linecap="round"/></svg></div>
    <div class="field"><span>iMessage</span><svg width="34" height="52" viewBox="0 0 17 26"><g stroke="rgba(0,0,0,0.33)" stroke-width="1.5" fill="none" stroke-linecap="round"><rect x="5.4" y="1.4" width="6.2" height="12.2" rx="3.1"/><path d="M2.4 10.8a6.1 6.1 0 0 0 12.2 0M8.5 17.6v3.6M5.6 23.8h5.8"/></g></svg></div>
  </footer>
  ${HOME_BAR}
  ${playerJs}
  </body></html>`;

  return { html, steps, total };
}

const chatV3Html = (scen) => chatV3Parts(scen).html;

// scenario configs: marketing/tiktok-kit/scenarios/<slug>.json (see GENERATOR.md)
const SCENARIO_DIR = join(__dirname, "scenarios");
const CHAT_SCENARIOS = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith(".json")).sort()
  .map((f) => ({ slug: f.replace(/\.json$/, ""), ...JSON.parse(readFileSync(join(SCENARIO_DIR, f), "utf8")) }));

// ── fake-text videos: Playwright recordVideo + the script player ─────────────
const PW_FFMPEG = "/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux";

function ffmpegBins() {
  const bins = [];
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) bins.push(process.env.FFMPEG_PATH);
  bins.push("ffmpeg"); // whatever is on PATH, if anything
  if (existsSync(PW_FFMPEG)) bins.push(PW_FFMPEG);
  return bins;
}
function videoDuration(file) {
  for (const bin of ffmpegBins()) {
    const r = spawnSync(bin, ["-hide_banner", "-i", file], { encoding: "utf8" });
    const m = ((r.stderr || "") + (r.stdout || "")).match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
  }
  return null;
}
// mp4 is what TikTok/IG want natively. Playwright's bundled ffmpeg encodes
// VP8/webm ONLY (no libx264, no vp9, no mp4 muxer) — so we try, in order,
// $FFMPEG_PATH, any real ffmpeg on PATH, then the bundled one, with libx264
// first and VP9-in-mp4 as the fallback. If none can do it we ship .webm and
// say so loudly (see GENERATOR.md for the one-time conversion command).
function tryMp4(webm, mp4) {
  for (const bin of ffmpegBins()) {
    for (const codec of ["libx264", "libvpx-vp9"]) {
      const args = codec === "libx264"
        ? ["-y", "-hide_banner", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", "-an", mp4]
        : ["-y", "-hide_banner", "-loglevel", "error", "-i", webm, "-c:v", "libvpx-vp9", "-b:v", "5M", "-an", mp4];
      let r;
      try { r = spawnSync(bin, args, { encoding: "utf8" }); } catch { continue; }
      if (r.status === 0 && existsSync(mp4)) return `${bin === PW_FFMPEG ? "playwright-ffmpeg" : bin}+${codec}`;
      try { rmSync(mp4, { force: true }); } catch { }
    }
  }
  return null;
}

async function recordChatVideo(browser, scen) {
  const { html, total } = chatV3Parts(scen, { animate: true });
  const tmp = mkdtempSync(join(tmpdir(), "divvy-vid-"));
  const ctx = await browser.newContext({
    viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1,
    recordVideo: { dir: tmp, size: { width: 1080, height: 1920 } },
  });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.addScriptTag({ path: MASCOT_JS });
  await page.evaluate(() => {
    document.querySelectorAll(".appic").forEach((el) => { el.innerHTML = window.Mascot.mini(72); });
  });
  await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
  await page.evaluate(() => window.__play()); // resolves after the "done" step
  await sleep(800); // hold the closing typing indicator
  const video = page.video();
  await page.close();
  await ctx.close();
  const dest = join(OUT, "videos", `${scen.slug}.webm`);
  mkdirSync(dirname(dest), { recursive: true });
  await video.saveAs(dest);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { }
  const size = statSync(dest).size;
  if (!size) throw new Error(`videos/${scen.slug}.webm is empty`);
  const secs = videoDuration(dest);
  if (secs != null && (secs < 20 || secs > 55)) {
    throw new Error(`videos/${scen.slug}.webm: ${secs.toFixed(1)}s is outside the 20–55s envelope (planned ${(total / 1000).toFixed(1)}s)`);
  }
  const mp4 = dest.replace(/\.webm$/, ".mp4");
  const how = tryMp4(dest, mp4);
  process.stdout.write(`  ${String(Math.round(size / 1024)).padStart(5)}kB ${(secs != null ? secs.toFixed(1) : "?")}s  videos/${scen.slug}.webm${how ? ` (+ .mp4 via ${how})` : ""}\n`);
  return { mp4: !!how };
}

// ── mascot films: scripted "found footage" videos (1080×1920) ─────────────────
// The scroll-stopper tier: motion + story + absurdity in the first second,
// instead of static tip decks. Each film is a self-contained HTML page with a
// JS timeline (window.__play resolves when the cut ends) recorded by the same
// harness as the chat videos. Silent — post with a trending suspense/true-crime
// sound. First film: COLD CASE Nº 047 — a true-crime parody about the $23 from
// 2019, using the real dave-2019 chat still as EXHIBIT A.

const GRAIN_URI = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0'/></filter><rect width='240' height='240' filter='url(%23n)'/></svg>`);

function coldCaseHtml() {
  const evidence = readFileSync(join(OUT, "chat-2019.png")).toString("base64");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${FONT_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px;height:1920px;overflow:hidden;background:#0B0908}
  body{font-family:'Space Mono',monospace;color:#EDE6D6}
  .scene{position:absolute;inset:0;opacity:0;transition:opacity .55s ease;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .scene.on{opacity:1}
  .grain{position:fixed;inset:-60px;background-image:url("${GRAIN_URI}");opacity:.09;z-index:60;pointer-events:none;animation:jit .28s steps(2) infinite}
  @keyframes jit{0%{transform:translate(0,0)}50%{transform:translate(-26px,18px)}100%{transform:translate(14px,-22px)}}
  .vig{position:fixed;inset:0;background:radial-gradient(ellipse at center,transparent 46%,rgba(0,0,0,0.62) 100%);z-index:55;pointer-events:none}
  .topbar{position:fixed;top:64px;left:70px;right:70px;display:flex;justify-content:space-between;z-index:50;font-size:26px;letter-spacing:5px;color:rgba(237,230,214,0.55)}
  .rec{color:#D2372E;animation:blink 1.1s steps(1) infinite}
  @keyframes blink{50%{opacity:0}}
  .cap{position:fixed;left:60px;right:60px;bottom:200px;text-align:center;z-index:50;font-family:'Clash Display',sans-serif;font-weight:700;font-size:58px;line-height:1.2;color:#fff;text-shadow:0 3px 0 #000,0 0 26px rgba(0,0,0,0.9);opacity:0;transition:opacity .3s}
  .cap.on{opacity:1}
  .type{font-size:38px;letter-spacing:3px;color:#EDE6D6;min-height:56px}
  .stamp{position:absolute;font-family:'Clash Display',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:6px;color:#D2372E;border:9px solid #D2372E;border-radius:10px;padding:14px 40px;transform:rotate(-12deg) scale(2.8);opacity:0}
  .stamp.green{color:#1FA355;border-color:#1FA355}
  .stamp.slam{animation:slam .38s cubic-bezier(.2,1.8,.4,1) forwards}
  @keyframes slam{from{transform:rotate(-12deg) scale(2.8);opacity:0}60%{opacity:1}to{transform:rotate(-12deg) scale(1);opacity:.94}}
  .h-title{font-family:'Clash Display',sans-serif;font-weight:700;font-size:104px;letter-spacing:2px;color:#EDE6D6}
  .exhibit{background:#F5F0E4;padding:26px 26px 66px;box-shadow:0 40px 90px rgba(0,0,0,0.7);position:relative}
  .exhibit img{display:block;width:640px}
  .etag{position:absolute;bottom:18px;left:26px;font-size:24px;letter-spacing:3px;color:#5B4A33}
  .zoomwrap{width:1080px;height:1920px;display:flex;align-items:center;justify-content:center;transform:scale(1);transition:transform 6.4s linear}
  .quote{font-family:'Clash Display',sans-serif;font-weight:700;font-size:96px;line-height:1.22;color:#fff;text-align:center;padding:0 90px}
  .quote .ul{position:relative;white-space:nowrap}
  .quote .ul::after{content:"";position:absolute;left:0;bottom:-14px;height:9px;width:0;background:#D2372E;transition:width 1.1s ease}
  .quote.mark .ul::after{width:100%}
  .attrib{margin-top:44px;font-size:30px;letter-spacing:4px;color:rgba(237,230,214,0.55)}
  .board{position:absolute;inset:0;background:linear-gradient(180deg,#8B6A46,#77573A);}
  .board::after{content:"";position:absolute;inset:0;background-image:url("${GRAIN_URI}");opacity:.35}
  .pola{position:absolute;background:#F5F0E4;padding:18px 18px 58px;box-shadow:0 24px 50px rgba(0,0,0,0.55);opacity:0;z-index:5}
  .pola .ph{width:340px;height:300px;background:#1B150F;display:flex;align-items:center;justify-content:center;font-size:96px}
  .pola .pcap{position:absolute;bottom:14px;left:18px;right:18px;font-size:22px;letter-spacing:1px;color:#3A2E1E;text-align:center}
  .pola .pin{position:absolute;top:-14px;left:50%;width:28px;height:28px;border-radius:50%;background:#D2372E;box-shadow:0 4px 8px rgba(0,0,0,0.5)}
  .pola.drop{animation:drop .4s cubic-bezier(.2,1.6,.4,1) forwards}
  @keyframes drop{from{opacity:0;transform:scale(1.7) rotate(0deg)}to{opacity:1;transform:scale(1) rotate(var(--rot))}}
  .string{position:absolute;height:5px;background:#C4302B;transform-origin:0 50%;opacity:0;transition:opacity .5s;z-index:6;box-shadow:0 2px 4px rgba(0,0,0,0.4)}
  .paycard{width:760px;background:#E9E9EB;border-radius:26px;overflow:hidden;display:flex;box-shadow:0 40px 90px rgba(0,0,0,0.7);transform:translateY(320px);opacity:0;transition:transform .6s cubic-bezier(.2,1.4,.4,1),opacity .4s}
  .paycard.up{transform:translateY(0);opacity:1}
  .paycard .txt{flex:1;padding:36px 30px;font-family:'Inter',sans-serif;color:#111}
  .paycard .t1{font-weight:700;font-size:34px}
  .paycard .t2{font-size:28px;color:#555;margin-top:10px}
  .paycard .t3{font-size:26px;color:#8A8A8E;margin-top:8px}
  .paycard .appic-box{width:210px;background:#DCDCE0;display:flex;align-items:center;justify-content:center}
  .appic{width:120px;height:120px;border-radius:30px;background:linear-gradient(180deg,#CFF6EA,#9FEFD8);display:flex;align-items:center;justify-content:center;border:1px solid rgba(0,0,0,0.08)}
  .wordrow{display:flex;align-items:center;gap:20px;font-family:'Clash Display',sans-serif;font-weight:700;font-size:96px;letter-spacing:-2.5px;color:#EDE6D6}
  .wordrow .dot{width:46px;height:46px;border-radius:15px;background:${BLUE};border:4px solid rgba(237,230,214,0.9)}
  .pill{margin-top:44px;background:${MINT};color:#0B0908;border-radius:999px;padding:26px 54px;font-weight:700;font-size:32px}
  </style></head><body>
  <div class="grain"></div><div class="vig"></div>
  <div class="topbar"><span>CASE FILE Nº 047</span><span class="rec">● REC</span></div>
  <div class="cap" id="cap"></div>

  <div class="scene on" id="s1">
    <div class="h-title">COLD CASE</div>
    <div class="type" id="t1" style="margin-top:38px"></div>
    <div class="stamp" id="st1" style="margin-top:90px;position:static">reopened</div>
  </div>

  <div class="scene" id="s2">
    <div class="zoomwrap" id="zoom">
      <div class="exhibit" style="transform:rotate(-1.6deg)">
        <img src="data:image/png;base64,${evidence}">
        <div class="etag">EXHIBIT A — THE THREAD</div>
      </div>
    </div>
  </div>

  <div class="scene" id="s3">
    <div class="quote" id="q">“yeah yeah venmo's being weird,<br><span class="ul">i'll get you back</span> 👍”</div>
    <div class="attrib">— D., MARCH 12, 2019. 11:48 PM.</div>
  </div>

  <div class="scene" id="s4">
    <div class="board"></div>
    <div class="pola" id="p1" style="--rot:-6deg;left:90px;top:420px"><span class="pin"></span><div class="ph">📵</div><div class="pcap">the request — ignored</div></div>
    <div class="pola" id="p2" style="--rot:4deg;right:100px;top:640px"><span class="pin"></span><div class="ph">👟</div><div class="pcap">new kicks. $180.</div></div>
    <div class="pola" id="p3" style="--rot:-3deg;left:250px;top:1030px"><span class="pin"></span><div class="ph">📱</div><div class="pcap">“new phone who dis”</div></div>
    <div class="string" id="l1" style="left:430px;top:600px;width:300px;transform:rotate(34deg)"></div>
    <div class="string" id="l2" style="left:520px;top:1080px;width:360px;transform:rotate(-24deg)"></div>
  </div>

  <div class="scene" id="s5"><div class="type" id="t5" style="font-size:44px;padding:0 100px;text-align:center;line-height:1.7"></div></div>

  <div class="scene" id="s6">
    <div class="paycard" id="pc">
      <div class="txt">
        <div class="t1">the $23 from the game — est. 2019</div>
        <div class="t2">pay in one tap</div>
        <div class="t3">divvysol.com</div>
      </div>
      <div class="appic-box"><div class="appic"></div></div>
    </div>
    <div class="stamp green" id="st2" style="top:44%;left:50%;margin-left:-190px">paid</div>
    <div class="stamp" id="st3" style="top:56%;left:50%;margin-left:-330px;font-size:74px">case closed</div>
  </div>

  <div class="scene" id="s7">
    <div id="stage" style="height:190px;display:flex;align-items:center;justify-content:center"></div>
    <div class="wordrow" style="margin-top:20px"><span class="dot"></span>divvy</div>
    <div style="font-size:30px;letter-spacing:2px;color:rgba(237,230,214,0.6);margin-top:26px">split the bill. not the friendship.</div>
    <div class="pill">divvysol.com</div>
    <div style="font-size:24px;letter-spacing:4px;color:rgba(237,230,214,0.35);margin-top:60px">CASE Nº 047: CLOSED</div>
  </div>

  <script>
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function type(el, text, cps) {
    for (const ch of text) { el.textContent += ch; await wait(1000 / (cps || 16)); }
  }
  function scene(n) {
    document.querySelectorAll(".scene").forEach((s) => s.classList.remove("on"));
    $("s" + n).classList.add("on");
  }
  async function cap(text, ms) {
    const c = $("cap"); c.textContent = text; c.classList.add("on");
    await wait(ms); c.classList.remove("on"); await wait(320);
  }
  window.__play = async () => {
    // S1 — title card
    await wait(700);
    await type($("t1"), "case nº 047 — the twenty-three dollars", 22);
    await wait(500); $("st1").classList.add("slam");
    await wait(1600);
    // S2 — exhibit A slow zoom
    scene(2); await wait(400);
    $("zoom").style.transform = "scale(1.45) translateY(120px)";
    await cap("march 12, 2019. 11:48 pm.", 2400);
    await cap("a man borrows $23 at the game.", 2600);
    // S3 — the quote
    scene(3); await wait(800); $("q").classList.add("mark");
    await cap("he said — and i quote:", 3200);
    // S4 — evidence board
    scene(4); await wait(300);
    $("p1").classList.add("drop"); await wait(650);
    $("p2").classList.add("drop"); await wait(650);
    $("p3").classList.add("drop"); await wait(500);
    $("l1").style.opacity = 1; $("l2").style.opacity = 1;
    await cap("the evidence mounted for seven years.", 3400);
    await wait(400);
    // S5 — the turn
    scene(5); await wait(500);
    await type($("t5"), "then, on july 7, 2026...", 18); await wait(700);
    $("t5").textContent += "\\n"; await type($("t5"), "the suspect received a link.", 18);
    await wait(1100);
    // S6 — resolution
    scene(6); await wait(500); $("pc").classList.add("up");
    await wait(1400); $("st2").classList.add("slam");
    await wait(1200); $("st3").classList.add("slam");
    await cap("paid in one tap. after 7 years.", 3000);
    await wait(500);
    // S7 — closer
    scene(7); await wait(2800);
  };
  </script>
  </body></html>`;
}

const FILMS = [
  { slug: "cold-case-23", make: coldCaseHtml },
];

async function recordFilm(browser, film) {
  const tmp = mkdtempSync(join(tmpdir(), "divvy-film-"));
  const ctx = await browser.newContext({
    viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1,
    recordVideo: { dir: tmp, size: { width: 1080, height: 1920 } },
  });
  const page = await ctx.newPage();
  await page.setContent(film.make(), { waitUntil: "load" });
  await page.addScriptTag({ path: MASCOT_JS });
  await page.evaluate(() => {
    document.querySelectorAll(".appic").forEach((el) => { el.innerHTML = window.Mascot.mini(84); });
    const stage = document.getElementById("stage");
    if (stage) stage.innerHTML = window.Mascot.html({ mood: "wave", size: 170, glow: false });
  });
  await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
  await page.evaluate(() => window.__play());
  await sleep(600);
  const video = page.video();
  await page.close();
  await ctx.close();
  const dest = join(OUT, "videos", `${film.slug}.webm`);
  mkdirSync(dirname(dest), { recursive: true });
  await video.saveAs(dest);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { }
  const size = statSync(dest).size;
  if (!size) throw new Error(`videos/${film.slug}.webm is empty`);
  const secs = videoDuration(dest);
  if (secs != null && (secs < 15 || secs > 60)) throw new Error(`videos/${film.slug}.webm: ${secs.toFixed(1)}s is outside the 15–60s envelope`);
  const mp4 = dest.replace(/\.webm$/, ".mp4");
  const how = tryMp4(dest, mp4);
  process.stdout.write(`  ${String(Math.round(size / 1024)).padStart(5)}kB ${(secs != null ? secs.toFixed(1) : "?")}s  videos/${film.slug}.webm${how ? ` (+ .mp4 via ${how})` : ""}\n`);
  return { mp4: !!how };
}

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
        ${s.h ? `<div class="nh">${s.h}</div>` : ""}
        ${lines}
        <div class="att">
          <div class="att-glow"></div>
          <div class="att-stage" id="stage"></div>
          <div class="att-word"><span class="dot"></span>divvy</div>
          <div class="att-tag">split the bill. not the friendship.</div>
        </div>
      </div>`;
    }
    // two dense tips per slide (the founder's hybrid deck shape)
    if (s.kind === "tips2") {
      return `<div class="sec" id="s${i}">${s.tips.map((tp, j) =>
        `<div${j ? ` class="sub-sec"` : ""}><div class="nh">${tp.h}</div>${(tp.lines || []).map((l) => `<div class="ln">${l}</div>`).join("")}</div>`).join("")}</div>`;
    }
    // an embedded screenshot "pasted into the note" (read lazily so it picks
    // up the freshly-rendered chat asset from this same run)
    if (s.kind === "shot") {
      const b64 = readFileSync(join(OUT, s.img)).toString("base64");
      return `<div class="sec" id="s${i}">
        ${lines}
        <div class="shot-wrap"><img class="shot" src="data:image/png;base64,${b64}"></div>
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
  .sub-sec{margin-top:64px}
  .shot-wrap{margin-top:28px;text-align:center}
  .shot{height:896px;border-radius:26px;border:1px solid rgba(0,0,0,0.16);box-shadow:0 12px 34px rgba(0,0,0,0.12)}
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
      { h: "7. the group-chat assist (public, but gentle)", lines: [
        "move it from DM to the scene of the crime:",
        "“ok who do i chase for friday's $34 🫡”",
        "- public asks resolve faster. nobody wants to be the reason the chat went quiet — and you never named names.",
      ] },
      { h: "8. the installment out (broke-friend edition)", lines: [
        "“no stress — $30 on the next three fridays?”",
        "- people dodge the whole number, not the money.",
        "- small chunks get paid. big scary totals get avoided.",
      ] },
      { kind: "reveal", h: "9. the app that does 1–8 for you", lines: [
        "it's called divvy 🐸 — it splits the bill, writes the nudge, and everyone pays their share in one tap.",
        "early access → divvysol.com",
      ] },
    ],
  },
  // the founder-designed FLAGSHIP hybrid deck: 8 slides, Notes skin, two dense
  // tips per slide, the girls-trip chat screenshot as the slide-7 payoff beat,
  // CTA in the note's own idiom on slide 8.
  {
    slug: "travel-with-friends",
    date: "July 7, 2026 at 9:12 AM",
    time: "9:14",
    sections: [
      { kind: "cover", title: "things i wish i knew before my first girls trip", lines: [
        "- number 6 saved a friendship. not exaggerating.",
      ] },
      { kind: "tips2", tips: [
        { h: "1. one fronter per lane, not per moment", lines: [
          "one person books the villa, one covers food runs, one does transport.",
          "- you come home to 3 clean debts instead of 40 tiny mysteries nobody remembers.",
        ] },
        { h: "2. say the number out loud", lines: [
          "whoever pays announces it at the table and it's written down within 10 seconds.",
          "- everyone remembers paying MORE than they did. memory inflation is real.",
        ] },
      ] },
      { kind: "tips2", tips: [
        { h: "3. agree the split before you leave", lines: [
          "even split? by use? do the non-drinkers subsidize the bar tab?",
          "- any answer works. deciding AFTER the money is spent is the only wrong one.",
        ] },
        { h: "4. money asks are same-day asks", lines: [
          "“villa came to $168 each” lands fine on day one.",
          "- it lands weird in month three. ask fast, stay friends.",
        ] },
      ] },
      { kind: "tips2", tips: [
        { h: "5. price the rooms like rent", lines: [
          "the master with the ensuite is not the same price as the pull-out couch.",
          "- can't agree? sealed bids for the big room — the winner pays a number they chose themselves.",
        ] },
        { h: "6. kill the spreadsheet — send pay links", lines: [
          "one link where everyone sees their exact share and taps once to settle.",
          "- the spreadsheet dies in the chat. the link gets paid the same night.",
        ] },
      ] },
      { kind: "tips2", tips: [
        { h: "7. set the no-show rule at booking", lines: [
          "drop out after the villa's booked? your bed is still your share, unless someone fills it.",
          "- agree it the day you book, while it's still about nobody.",
        ] },
        { h: "8. run a day-one kitty for the small stuff", lines: [
          "$50 each into a pot: tolls, ice, snacks, the 3am pizza.",
          "- micro-debts are where trips go to die. the kitty eats them.",
        ] },
      ] },
      { kind: "tips2", tips: [
        { h: "9. net the debts before anyone pays", lines: [
          "don't do A pays B, B pays C, C pays A.",
          "- total up who's net up and net down — most trips collapse to one or two transfers.",
        ] },
        { h: "10. settle before the airport", lines: [
          "square up while the sunburn is still fresh — at the gate at the latest.",
          "- “no rush lol” is a 4-month resentment loop wearing a friendly face.",
        ] },
      ] },
      { kind: "shot", lines: ["tip 6 in the wild:"], img: "chat-girls-trip.png" },
      { kind: "reveal", lines: [
        "the app from that screenshot is divvy 🐸",
        "scan the receipt, everyone pays their share in one tap.",
        "get early access → divvysol.com",
      ] },
    ],
  },
  // the BRO version of the flagship for TikTok/IG: same proven Notes-app
  // camouflage + identity-call-out hook, boys-trip voice (plain language, no
  // CT slang — that stays on X), the boys chat as the slide-7 payoff.
  {
    slug: "boys-trip-notes",
    date: "July 7, 2026 at 1:52 AM",
    time: "1:58",
    sections: [
      { kind: "cover", title: "if you're the one who always books the airbnb", lines: [
        "- 10 rules so the boys actually pay you back.",
      ] },
      { kind: "tips2", tips: [
        { h: "1. everyone owes the day you book", lines: [
          "not after the trip. not “when i get paid.” booking day.",
          "- “i'll get you back” has a half-life of about 72 hours.",
        ] },
        { h: "2. say the number in the chat, not in person", lines: [
          "texts are receipts. conversations are vibes.",
          "- “$480 each for the house” in writing gets paid. a nod at the gym does not.",
        ] },
      ] },
      { kind: "tips2", tips: [
        { h: "3. you're not the group's bank", lines: [
          "if you front the house, someone else fronts the car, someone else food.",
          "- one guy carrying everything is how resentment compounds.",
        ] },
        { h: "4. rooms aren't equal. prices aren't either.", lines: [
          "master with the ensuite ≠ the air mattress by the AC unit.",
          "- price the rooms before you land, or auction the big one.",
        ] },
      ] },
      { kind: "tips2", tips: [
        { h: "5. the no-show rule gets set at booking", lines: [
          "dropping out two weeks before doesn't delete your share.",
          "- agree it the day you book, while it's about nobody.",
        ] },
        { h: "6. send a pay link, not a reminder speech", lines: [
          "one tap beats “yo did you ever see my request.”",
          "- links get paid the same night. speeches get “my bad, monday.”",
        ] },
      ] },
      { kind: "tips2", tips: [
        { h: "7. day-one pot for the small stuff", lines: [
          "$50 each: gas, ice, tolls, the 2am food run.",
          "- the $7 debts are the ones that actually end friendships.",
        ] },
        { h: "8. net it out at the end", lines: [
          "don't do six transfers in a circle.",
          "- total up who's up and who's down — most trips collapse to one payment.",
        ] },
      ] },
      { kind: "tips2", tips: [
        { h: "9. settle at the airport, not “next week”", lines: [
          "square up at the gate while everyone's still there.",
          "- “no rush” is how $38 follows a friendship around for a year.",
        ] },
        { h: "10. keep score somewhere neutral", lines: [
          "the guy who remembers every debt becomes the villain. don't be the ledger.",
          "- let an app be the bad guy. it never forgets and nobody argues with it.",
        ] },
      ] },
      { kind: "shot", lines: ["rule 6 in the wild:"], img: "chat-boys-trip.png" },
      { kind: "reveal", lines: [
        "the app from that screenshot is divvy 🐸",
        "scan the receipt, the boys pay their share in one tap.",
        "get early access → divvysol.com",
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
        title: `9 rules for group trips that <span class="hl">don't end friendships</span>`,
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
      { n: 7, c: "#985FDE", mood: "watching", h: `price the no-show <span class="hl">at booking</span>`, b: `if someone drops out after the villa's booked, their share doesn't.<br><br>agree it the day you book: <b>cancel = you still owe your bed</b>, unless someone fills it.` },
      { n: 8, c: "#E09E2F", mood: "sparkle", h: `run a day-one <span class="hlc">kitty</span> for the small stuff`, b: `everyone puts $50 in a pot on day one — tolls, ice, snacks, the 3am pizza come out of it.<br><br><b>micro-debts are where group trips go to die.</b> the kitty eats them.` },
      { kind: "cta", n: 9, mood: "wave", h: `let divvy do <span class="hl">all of this</span> for you`, note: "🐸 splits, nudges, and settling — automatic. app store soon." },
    ],
  },
];

// ── six-tips journal cards (1080×1350) — the Pinterest-pretty etiquette set ───
// Six researched money-etiquette tips, one per slide, art-directed as journal
// pages: cream paper + ruled lines + grain, Clash Display headline, General
// Sans support line, Space Mono kicker ("money etiquette · 01"), ONE accent
// element per slide (washi tape / highlighter swipe / hand-drawn underline)
// rotating through a warm→cool rainbow (coral, amber, mint, teal, blue,
// purple) so the grid reads as a set. Mochi is SMALL — a margin doodle with a
// tiny pencil note, different mood + corner per slide. 07.png is a separately
// numbered soft CTA so the founder can post 6 or 7.
// Sources for each tip are footnoted in CONCEPTS.md (concept 28).

const TIP_PURPLE = "#985FDE", TIP_TEAL = "#1FA98C";

// hand-drawn underline as an inline-SVG background (kept on short phrases so
// the stroke never has to wrap)
function underCss(color) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 26' preserveAspectRatio='none'><path d='M5 15 C 58 6, 118 21, 178 11 S 268 9, 295 15' fill='none' stroke='${color}' stroke-width='10' stroke-linecap='round'/></svg>`;
  return `background-image:url("data:image/svg+xml,${encodeURIComponent(svg)}");background-repeat:no-repeat;background-position:0 100%;background-size:100% 26px;padding-bottom:16px`;
}
// fine paper grain, tiled (multiply, very low alpha)
const GRAIN_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='240' height='240' filter='url(%23n)'/></svg>`;

const SIX_TIPS = {
  slug: "six-tips",
  kicker: "money etiquette",
  slides: [
    {
      c: CORAL, accent: "mark", mood: "watching", corner: "right",
      h: `ask within <span class="mark">24 hours</span>. not month three.`,
      s: `the same-day ask is the polite one — 72% agree. waiting is what makes it weird.`,
      note: "mochi counts the hours",
    },
    {
      c: SUN, accent: "tape", mood: "happy", corner: "left", hz: 98,
      h: `you invited? you're the host. hosts pay.`,
      s: `planned it together instead? then split — but say how before anyone orders.`,
      note: "his party, his tab",
    },
    {
      c: MINT, accent: "under", mood: "worried", corner: "right",
      h: `never lend money you <span class="under">can't lose</span>`,
      s: `nearly half of friend loans end badly. budget it as a gift — repayment becomes a bonus.`,
      note: "prepared for the worst",
    },
    {
      c: TIP_TEAL, accent: "mark", mood: "sparkle", corner: "left",
      h: `can't agree on the big room? <span class="mark">auction it</span>`,
      s: `sealed bids — highest number takes the room and pays that number. nobody argues with their own price.`,
      note: "math frog strikes again",
    },
    {
      c: BLUE, accent: "tape", mood: "wave", corner: "right", hz: 98,
      h: `collect trip budgets in dms, never the chat`,
      s: `people inflate what they can afford in public. private asks get honest numbers — before anything is booked.`,
      note: "sliding in politely",
    },
    {
      c: TIP_PURPLE, accent: "under", mood: "sleepy", corner: "left",
      h: `under $5? <span class="under">let it ride</span>`,
      s: `tiny requests read petty — fold it into the next round. anything bigger deserves a same-day ask.`,
      note: "not worth losing sleep",
    },
  ],
};

// highlighter swipe / tape tints per accent color
function tipMarkBg(c) {
  const a = c === BLUE ? 0.28 : c === TIP_TEAL ? 0.34 : 0.45;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  return `linear-gradient(180deg,transparent 6%,rgba(${r},${g},${b},${a}) 12%,rgba(${r},${g},${b},${a}) 90%,transparent 96%)`;
}
function tipTape(c) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  return `<div style="position:absolute;right:-64px;top:84px;width:400px;height:80px;transform:rotate(6deg);
    background-color:rgba(${r},${g},${b},0.62);opacity:.92;box-shadow:0 10px 24px rgba(43,33,24,0.14);
    background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.28) 0 20px,rgba(255,255,255,0) 20px 40px)"></div>`;
}

function sixTipsSlideHtml(idx) {
  const s = SIX_TIPS.slides[idx];
  const num = String(idx + 1).padStart(2, "0");
  const doodleSide = s.corner === "left"
    ? "left:132px;align-items:flex-start" : "right:120px;align-items:flex-end";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${FONT_CSS}${FREEZE_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px;height:1350px;overflow:hidden}
  body{background:${PAPER};color:${INK};position:relative;font-family:'General Sans',sans-serif;
    background-image:repeating-linear-gradient(180deg,transparent 0 94px,rgba(39,117,202,0.10) 94px 96px)}
  body::before{content:"";position:absolute;top:0;bottom:0;left:88px;width:4px;background:rgba(255,107,94,0.18)}
  .grain{position:absolute;inset:0;opacity:0.05;mix-blend-mode:multiply;pointer-events:none;
    background-image:url("data:image/svg+xml,${encodeURIComponent(GRAIN_SVG)}")}
  .pad{position:absolute;inset:0;padding:118px 118px 120px 128px;display:flex;flex-direction:column}
  .kick{font-family:'Space Mono',monospace;font-weight:700;font-size:29px;letter-spacing:6px;
    text-transform:uppercase;color:rgba(43,33,24,0.42)}
  .kick b{color:${s.c};font-weight:700}
  .head{font-family:'Clash Display',sans-serif;font-weight:700;font-size:${s.hz || 104}px;line-height:1.12;
    letter-spacing:-2px;word-spacing:0.24em;margin-top:172px;max-width:${s.hz ? 13 : 12}ch}
  .head .mark{background:${tipMarkBg(s.c)};padding:0 14px;margin:0 -6px;border-radius:10px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
  .head .under{${underCss(s.c)}}
  .sub{font-size:42px;font-weight:500;line-height:1.55;color:rgba(43,33,24,0.72);margin-top:64px;max-width:23ch}
  .doodle{position:absolute;bottom:100px;${doodleSide};display:flex;flex-direction:column;gap:10px}
  .stage{transform:scale(1.15);transform-origin:bottom ${s.corner};height:150px;display:flex;align-items:flex-end}
  .note{font-family:'Space Mono',monospace;font-size:25px;color:rgba(43,33,24,0.48);transform:rotate(-4deg)}
  </style></head><body>
  <div class="grain"></div>
  ${s.accent === "tape" ? tipTape(s.c) : ""}
  <div class="pad">
    <div class="kick">${SIX_TIPS.kicker} · <b>${num}</b></div>
    <div class="head">${s.h}</div>
    <div class="sub">${s.s}</div>
  </div>
  <div class="doodle"><div class="stage" id="stage"></div><div class="note">${s.note}</div></div>
  </body></html>`;
}

// slide 07 — soft CTA, same paper, Mochi + wordmark, numbered separately
function sixTipsCtaHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${FONT_CSS}${FREEZE_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px;height:1350px;overflow:hidden}
  body{background:${PAPER};color:${INK};position:relative;font-family:'General Sans',sans-serif;
    background-image:linear-gradient(rgba(61,232,199,0.10),rgba(61,232,199,0.10)),
      repeating-linear-gradient(180deg,transparent 0 94px,rgba(39,117,202,0.10) 94px 96px)}
  body::before{content:"";position:absolute;top:0;bottom:0;left:88px;width:4px;background:rgba(255,107,94,0.18)}
  .grain{position:absolute;inset:0;opacity:0.05;mix-blend-mode:multiply;pointer-events:none;
    background-image:url("data:image/svg+xml,${encodeURIComponent(GRAIN_SVG)}")}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;text-align:center;padding:150px 100px 120px}
  .kick{font-family:'Space Mono',monospace;font-weight:700;font-size:29px;letter-spacing:6px;text-transform:uppercase;color:rgba(43,33,24,0.42)}
  .head{font-family:'Clash Display',sans-serif;font-weight:700;font-size:128px;letter-spacing:-4px;word-spacing:0.24em;margin-top:120px}
  .glow{position:absolute;left:50%;top:565px;width:560px;height:560px;border-radius:50%;transform:translate(-50%,-50%);
    background:radial-gradient(circle,rgba(61,232,199,0.35) 0%,rgba(61,232,199,0) 65%)}
  .stage{position:relative;margin-top:64px;transform:scale(2.1);transform-origin:top center;height:300px}
  .word{display:flex;align-items:center;gap:20px;font-family:'Clash Display',sans-serif;font-weight:700;font-size:96px;letter-spacing:-3px;margin-top:6px}
  .word .dot{width:52px;height:52px;border-radius:15px;background:${BLUE};border:4px solid ${INK};box-shadow:6px 6px 0 rgba(43,33,24,0.85)}
  .line{font-family:'Space Mono',monospace;font-weight:700;font-size:41px;line-height:1.55;color:rgba(43,33,24,0.78);margin-top:52px;max-width:21ch}
  .line .hl{background:linear-gradient(180deg,transparent 10%,rgba(61,232,199,0.5) 14%,rgba(61,232,199,0.5) 86%,transparent 90%);padding:0 8px}
  .soft{margin-top:auto;font-family:'Space Mono',monospace;font-size:28px;color:rgba(43,33,24,0.45)}
  </style></head><body>
  <div class="grain"></div>
  <div class="wrap">
    <div class="kick">money etiquette · the margin note</div>
    <div class="head">saved these?</div>
    <div class="glow"></div>
    <div class="stage" id="stage"></div>
    <div class="word"><span class="dot"></span>divvy</div>
    <div class="line">divvy remembers who owes what — <span class="hl">divvysol.com</span></div>
    <div class="soft">🐸 mochi remembers. mochi always remembers.</div>
  </div>
  </body></html>`;
}

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

// ── photo-editorial travel deck (1080×1350) — full-bleed photography theme ────
// The "aesthetic travel page" take on the flagship: licensed photos
// (assets-src/photos/, see CREDITS.md) under Fraunces editorial serif. Cover is
// the villa hero; tip slides are photo-over-cream-panel (two tips each, same 10
// tips as the Notes deck, tightened); slide 7 floats the girls-trip chat still
// over the blurred villa; slide 8 is the CTA card over the sunset.

function srcAsset(...p) { return join(__dirname, "assets-src", ...p); }
function photoData(file) {
  return `data:image/jpeg;base64,${readFileSync(srcAsset("photos", file)).toString("base64")}`;
}
// Fraunces variable font (SIL OFL, vendored by the sourcing step) — ttf or woff2.
function frauncesFace(base, style) {
  for (const [ext, mime, fmt] of [["ttf", "font/ttf", "truetype"], ["woff2", "font/woff2", "woff2"]]) {
    const p = srcAsset("fonts", `${base}.${ext}`);
    if (existsSync(p)) return `@font-face{font-family:'Fraunces';font-weight:100 900;font-style:${style};src:url(data:${mime};base64,${readFileSync(p).toString("base64")}) format('${fmt}');}`;
  }
  throw new Error(`missing assets-src/fonts/${base}.(ttf|woff2) — vendor Fraunces first (see HOOKS.md)`);
}
const FRAUNCES = `'Fraunces',Georgia,serif`;
const CREAM = "#FBF3E4";

const PHOTO_DECK = {
  slug: "travel-photo",
  kicker: "the group-trip notebook",
  cover: {
    img: "cover-villa.jpg",
    title: `things i wish<br>i knew before my<br>first <em>girls trip</em>`,
    sub: "number 6 saved a friendship. not exaggerating.",
  },
  // five photo slides × two tips — same 10 tips as the Notes deck, tightened
  // to one breath each so they read over photography.
  tipSlides: [
    { img: "pool.jpg", tips: [
      { h: "one fronter per lane, not per moment", b: "one books the villa, one covers food, one does transport — you come home to 3 clean debts, not 40 tiny mysteries." },
      { h: "say the number out loud", b: "whoever pays announces it at the table and it's written down in 10 seconds. everyone remembers paying MORE than they did." },
    ] },
    { img: "scooter.jpg", tips: [
      { h: "agree the split before you leave", b: "even? by use? do non-drinkers subsidize the bar tab? any answer works — deciding after the money is spent is the only wrong one." },
      { h: "money asks are same-day asks", b: "“villa came to $168 each” lands fine on day one. it lands weird in month three. ask fast, stay friends." },
    ] },
    { img: "dinner.jpg", tips: [
      { h: "price the rooms like rent", b: "the ensuite master is not the pull-out couch. can't agree? sealed bids — the winner pays a number they chose themselves." },
      { h: "kill the spreadsheet — send pay links", b: "one link where everyone sees their exact share and taps once. the spreadsheet dies in the chat; the link gets paid that night." },
    ] },
    { img: "beach.jpg", tips: [
      { h: "set the no-show rule at booking", b: "drop out after the villa's booked? your bed is still your share, unless someone fills it. agree it while it's still about nobody." },
      { h: "run a day-one kitty for the small stuff", b: "$50 each into a pot: tolls, ice, the 3am pizza. micro-debts are where trips go to die — the kitty eats them." },
    ] },
    { img: "airport.jpg", tips: [
      { h: "net the debts before anyone pays", b: "don't do A pays B, B pays C, C pays A. total who's net up and net down — most trips collapse to one or two transfers." },
      { h: "settle before the airport", b: "square up while the sunburn is still fresh — at the gate at the latest. “no rush lol” is a resentment loop wearing a friendly face." },
    ] },
  ],
  shot: { img: "cover-villa.jpg", chat: "chat-girls-trip.png", h: "tip 6, in the wild:" },
  cta: { img: "sunset.jpg" },
};
const PHOTO_ACCENTS = [CORAL, "#E09E2F", "#1FA98C", BLUE, "#985FDE"];
const PHOTO_SLIDES_N = 2 + PHOTO_DECK.tipSlides.length + 1; // cover + tips + shot + cta

function photoShell(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${FONT_CSS}${frauncesFace("Fraunces-VF", "normal")}${frauncesFace("Fraunces-Italic-VF", "italic")}${FREEZE_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px;height:1350px;overflow:hidden}
  body{position:relative;background:${CREAM};font-family:'General Sans',sans-serif;color:${INK}}
  .ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .kick{font-family:'Space Mono',monospace;font-size:25px;letter-spacing:7px;text-transform:uppercase}
  em{font-style:italic;font-weight:560}
  </style></head><body>${body}</body></html>`;
}

function photoCoverHtml() {
  const c = PHOTO_DECK.cover;
  return photoShell(`
    <img class="ph" src="${photoData(c.img)}">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(22,15,9,0.34) 0%,rgba(22,15,9,0.02) 34%,rgba(22,15,9,0.10) 58%,rgba(22,15,9,0.66) 100%)"></div>
    <div class="kick" style="position:absolute;top:74px;left:0;right:0;text-align:center;color:rgba(251,243,228,0.92)">${PHOTO_DECK.kicker}</div>
    <div style="position:absolute;left:84px;right:84px;bottom:96px">
      <div style="font-family:${FRAUNCES};font-weight:430;font-size:97px;line-height:1.09;letter-spacing:-1px;color:${CREAM}">${c.title}</div>
      <div style="width:104px;height:3px;background:rgba(251,243,228,0.55);margin:36px 0 30px"></div>
      <div style="font-size:31px;font-weight:500;color:rgba(251,243,228,0.90)">${c.sub}</div>
    </div>`);
}

function photoTipHtml(idx) {
  const s = PHOTO_DECK.tipSlides[idx];
  const accent = PHOTO_ACCENTS[idx % PHOTO_ACCENTS.length];
  const nums = [idx * 2 + 1, idx * 2 + 2];
  const tips = s.tips.map((t, j) => `
    <div style="display:flex;gap:34px;${j ? "margin-top:44px;padding-top:44px;border-top:1px solid rgba(43,33,24,0.13)" : ""}">
      <div style="font-family:${FRAUNCES};font-style:italic;font-weight:520;font-size:64px;line-height:1;color:${accent};min-width:74px;text-align:right">${nums[j]}</div>
      <div>
        <div style="font-family:${FRAUNCES};font-weight:600;font-size:41px;letter-spacing:-0.4px;line-height:1.16">${t.h}</div>
        <div style="font-size:27.5px;line-height:1.5;color:rgba(43,33,24,0.66);margin-top:14px">${t.b}</div>
      </div>
    </div>`).join("");
  return photoShell(`
    <div style="position:absolute;left:0;top:0;right:0;height:600px;overflow:hidden">
      <img class="ph" src="${photoData(s.img)}" style="height:600px">
      <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(22,15,9,0.16),rgba(22,15,9,0) 30%)"></div>
      <div class="kick" style="position:absolute;top:56px;right:70px;color:rgba(251,243,228,0.95);letter-spacing:5px">${String(idx + 2).padStart(2, "0")} / ${String(PHOTO_SLIDES_N).padStart(2, "0")}</div>
    </div>
    <div style="position:absolute;left:0;right:0;top:600px;bottom:0;background:${CREAM};padding:66px 84px 0">${tips}</div>`);
}

function photoShotHtml() {
  const s = PHOTO_DECK.shot;
  const chat = readFileSync(join(OUT, s.chat)).toString("base64");
  return photoShell(`
    <img class="ph" src="${photoData(s.img)}" style="filter:blur(16px) saturate(1.05);transform:scale(1.14)">
    <div style="position:absolute;inset:0;background:rgba(20,13,8,0.52)"></div>
    <div style="position:absolute;top:88px;left:0;right:0;text-align:center;font-family:${FRAUNCES};font-style:italic;font-weight:480;font-size:58px;color:${CREAM}">${s.h}</div>
    <div style="position:absolute;top:206px;left:0;right:0;text-align:center">
      <img src="data:image/png;base64,${chat}" style="height:1044px;border-radius:30px;border:1px solid rgba(251,243,228,0.28);box-shadow:0 34px 90px rgba(0,0,0,0.55)">
    </div>`);
}

function photoCtaHtml() {
  return photoShell(`
    <img class="ph" src="${photoData(PHOTO_DECK.cta.img)}">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(22,15,9,0.18),rgba(22,15,9,0.5))"></div>
    <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:780px;background:${CREAM};border-radius:36px;box-shadow:0 40px 110px rgba(0,0,0,0.5);padding:64px 64px 58px;text-align:center">
      <div id="stage" style="height:150px;display:flex;align-items:center;justify-content:center"></div>
      <div style="display:flex;align-items:center;justify-content:center;gap:16px;font-family:'Clash Display',sans-serif;font-weight:700;font-size:80px;letter-spacing:-2.4px;color:${INK};margin-top:6px">
        <span style="width:42px;height:42px;border-radius:13px;background:${BLUE};border:4px solid ${INK};box-shadow:5px 5px 0 rgba(43,33,24,0.85)"></span>divvy
      </div>
      <div style="font-family:'Space Mono',monospace;font-weight:700;font-size:27px;color:rgba(43,33,24,0.72);margin-top:14px">split the bill. not the friendship.</div>
      <div style="font-size:28px;line-height:1.5;color:rgba(43,33,24,0.66);margin-top:30px">the app from tip 6 — scan the receipt,<br>everyone pays their share in one tap.</div>
      <div style="display:inline-block;margin-top:34px;background:${INK};color:${CREAM};border-radius:999px;padding:24px 46px;font-family:'Clash Display',sans-serif;font-weight:600;font-size:30px">get early access → divvysol.com</div>
    </div>`);
}

// ── CT settle-receipt "PnL cards" (1600×900, X-native) ───────────────────────
// The crypto-twitter kit's flagship format (see marketing/ct-kit/STRATEGY.md):
// a parody of the trading-PnL flex card, except the "position" is the group
// trip and the win is getting paid back. Dark trenches-terminal aesthetic,
// Space Mono, mint as the profit color, Mochi in the corner. NEVER fake
// trading gains — the format is the joke, the contents are the product.

const CT_RECEIPTS = [
  {
    file: join("ct", "receipt-breakpoint.png"),
    tag: "POSITION CLOSED",
    pair: "BREAKPOINT VILLA / USDC",
    pnl: "+474.50 USDC",
    sub: "recovered from the boys",
    stats: [["position", "1 villa · 4 anons"], ["held", "4 days"], ["settled in", "3.1s"], ["network fee", "$0.0004"]],
  },
  {
    file: join("ct", "receipt-dinner.png"),
    tag: "POSITION CLOSED",
    pair: "DEGEN DINNER / USDC",
    pnl: "+86.20 USDC",
    sub: "jake paid before the food arrived. unprecedented.",
    stats: [["position", "1 omakase · 5 anons"], ["held", "0 days"], ["settled in", "2.4s"], ["network fee", "$0.0004"]],
  },
];

function ctReceiptHtml(r) {
  const statRows = r.stats.map(([k, v]) =>
    `<div style="display:flex;flex-direction:column;gap:10px"><span style="color:rgba(243,234,217,0.34);font-size:20px;letter-spacing:3px;text-transform:uppercase">${k}</span><span style="color:rgba(243,234,217,0.88);font-size:27px;font-weight:700">${v}</span></div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${FONT_CSS}${FREEZE_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1600px;height:900px;overflow:hidden}
  body{position:relative;background:#100D09;font-family:'Space Mono',monospace;color:#F3EAD9;
    background-image:linear-gradient(rgba(61,232,199,0.045) 1px,transparent 1px),linear-gradient(90deg,rgba(61,232,199,0.045) 1px,transparent 1px);
    background-size:44px 44px}
  </style></head><body>
  <div style="position:absolute;left:50%;top:38%;width:900px;height:620px;border-radius:50%;transform:translate(-50%,-50%);background:radial-gradient(ellipse,rgba(61,232,199,0.10) 0%,rgba(61,232,199,0) 62%)"></div>
  <div style="position:absolute;inset:70px;border:2px solid rgba(61,232,199,0.30);border-radius:26px;background:rgba(16,13,9,0.72);padding:58px 78px">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:14px;font-family:'Clash Display',sans-serif;font-weight:700;font-size:42px;letter-spacing:-1px">
        <span style="width:24px;height:24px;border-radius:8px;background:${BLUE};border:3px solid rgba(243,234,217,0.9)"></span>divvy
      </div>
      <div class="mmini" style="width:76px;height:76px"></div>
    </div>
    <div style="margin-top:44px;font-size:23px;letter-spacing:6px;color:${MINT}">● ${r.tag}</div>
    <div style="margin-top:16px;font-size:30px;color:rgba(243,234,217,0.55);letter-spacing:2px">${r.pair}</div>
    <div style="margin-top:22px;font-weight:700;font-size:118px;letter-spacing:-3px;color:${MINT};text-shadow:0 0 34px rgba(61,232,199,0.35)">${r.pnl}</div>
    <div style="margin-top:10px;font-family:'General Sans',sans-serif;font-size:29px;color:rgba(243,234,217,0.62)">${r.sub}</div>
    <div style="margin-top:44px;display:flex;gap:74px">${statRows}</div>
  </div>
  <div style="position:absolute;left:148px;bottom:34px;font-size:21px;letter-spacing:2px;color:rgba(243,234,217,0.38)">no token. just settled tabs. → divvysol.com</div>
  </body></html>`;
}

// ── CT carousel: "your worst bags aren't onchain" (8×1080×1350) ───────────────
// The crypto-twitter deck (marketing/ct-kit/STRATEGY.md): same proven shape as
// the flagship (hook cover → rules → artifact payoff on 7 → hard CTA on 8) but
// in the trenches-terminal skin: dark, mono, mint grid, coral losses. Voice:
// lowercase, deadpan, degen-literate, zero rockets. Mochi appears small on the
// cover and big on the CTA only — cute art, dry words.

const CT_DECK = {
  slug: "worst-bags",
  dir: join("ct", "deck-worst-bags"),
  rules: [
    { n: "01", h: "name the number, same day", lines: [
      `“<b>the $38 from the airbnb</b>” gets paid.`,
      `“that thing from breakpoint” becomes a donation.`,
      `unnamed debts trend to zero. every time.`,
    ] },
    { n: "02", h: "mark your friend debt to market", lines: [
      `90+ days unpaid is not a loan anymore. it's <span class="red">unrealized loss</span>.`,
      `you're not lending, ser. you're providing exit liquidity.`,
    ], chart: true },
    { n: "03", h: "split at booking, not at checkout", lines: [
      `the villa share is agreed <b>the day it's booked</b>, while it's still about nobody.`,
      `deciding after the money is spent is how PvE becomes PvP.`,
    ] },
    { n: "04", h: "net the debts before anyone sends", lines: [
      `A owes B owes C owes A is three transfers of pure gas.`,
      `net it down — most trips collapse to <b>one transfer</b>.`,
    ] },
    { n: "05", h: "settle before the flight home", lines: [
      `square up at the gate at the latest.`,
      `“no rush ser” compounds worse than any funding rate.`,
    ] },
  ],
};

function ctShell(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${FONT_CSS}${FREEZE_CSS}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px;height:1350px;overflow:hidden}
  body{position:relative;background:#100D09;color:#F3EAD9;font-family:'Space Mono',monospace;
    background-image:linear-gradient(rgba(61,232,199,0.045) 1px,transparent 1px),linear-gradient(90deg,rgba(61,232,199,0.045) 1px,transparent 1px);
    background-size:44px 44px}
  .wm{display:flex;align-items:center;gap:12px;font-family:'Clash Display',sans-serif;font-weight:700;font-size:34px;letter-spacing:-0.8px}
  .wm .dot{width:20px;height:20px;border-radius:7px;background:${BLUE};border:3px solid rgba(243,234,217,0.9)}
  .eyebrow{font-size:19px;letter-spacing:5px;color:rgba(243,234,217,0.35);text-transform:uppercase}
  .tag{font-weight:700;font-size:22px;letter-spacing:5px;color:${MINT}}
  .red{color:${CORAL}}  b{color:#FFFDF7}
  .h{font-family:'Clash Display',sans-serif;font-weight:700;color:#FBF3E4}
  .ln{font-size:31px;line-height:1.62;color:rgba(243,234,217,0.66);margin-top:26px}
  .foot{position:absolute;left:84px;bottom:52px;font-size:19px;letter-spacing:2px;color:rgba(243,234,217,0.35)}
  </style></head><body>${body}</body></html>`;
}

function ctTopBar(idx) {
  return `<div style="position:absolute;top:64px;left:84px;right:84px;display:flex;align-items:center;justify-content:space-between">
    <div class="wm"><span class="dot"></span>divvy</div>
    <div class="eyebrow">${String(idx).padStart(2, "0")} / 08</div>
  </div>`;
}

function ctCoverHtml() {
  return ctShell(`
    ${ctTopBar(1)}
    <div style="position:absolute;left:84px;right:84px;top:300px">
      <div class="tag">● RECOVERY PROTOCOL — FRIEND DEBT</div>
      <div class="h" style="font-size:104px;line-height:1.06;letter-spacing:-2.5px;margin-top:34px">your worst bags aren't onchain 💀</div>
      <div class="ln" style="font-size:33px;margin-top:42px">6 rules for the money side of the group chat.<br>from the frog who always settles up.</div>
    </div>
    <div style="position:absolute;left:84px;right:84px;bottom:170px;border:1px solid rgba(61,232,199,0.25);border-radius:18px;background:rgba(16,13,9,0.7);padding:34px 40px">
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:29px"><span>JAKE/USDC</span><span class="red">-$38.00</span><span style="color:rgba(243,234,217,0.4)">held 247 days</span><span class="red">▼ DOWN BAD</span></div>
    </div>
    <div class="foot">no token. just settled tabs.</div>
    <div id="stage" style="position:absolute;right:84px;top:190px;width:96px;height:92px"></div>`);
}

function ctRuleHtml(i) {
  const r = CT_DECK.rules[i];
  const chart = r.chart ? `
    <svg width="912" height="330" viewBox="0 0 912 330" style="margin-top:56px">
      <g stroke="rgba(243,234,217,0.14)" stroke-width="1">${[60, 130, 200, 270].map((y) => `<line x1="70" y1="${y}" x2="892" y2="${y}"/>`).join("")}</g>
      <line x1="70" y1="20" x2="70" y2="290" stroke="rgba(243,234,217,0.4)" stroke-width="2"/>
      <line x1="70" y1="290" x2="892" y2="290" stroke="rgba(243,234,217,0.4)" stroke-width="2"/>
      <path d="M70 40 C 240 50, 320 120, 430 200 S 700 282, 892 286" fill="none" stroke="${CORAL}" stroke-width="6" stroke-linecap="round"/>
      <text x="70" y="326" fill="rgba(243,234,217,0.45)" font-family="Space Mono" font-size="21">day 0</text>
      <text x="806" y="326" fill="rgba(243,234,217,0.45)" font-family="Space Mono" font-size="21">day 90</text>
      <text x="84" y="44" fill="rgba(243,234,217,0.45)" font-family="Space Mono" font-size="21">odds of repayment</text>
      <text x="600" y="250" fill="${CORAL}" font-family="Space Mono" font-size="23" font-weight="700">▼ your $40</text>
    </svg>` : "";
  return ctShell(`
    ${ctTopBar(i + 2)}
    <div style="position:absolute;left:84px;right:84px;top:250px">
      <div class="tag" style="font-size:27px">RULE_${r.n}</div>
      <div class="h" style="font-size:72px;line-height:1.12;letter-spacing:-1.5px;margin-top:30px">${r.h}</div>
      <div style="width:110px;height:3px;background:rgba(61,232,199,0.5);margin-top:40px"></div>
      <div style="margin-top:22px">${r.lines.map((l) => `<div class="ln">${l}</div>`).join("")}</div>
      ${chart}
    </div>
    <div class="foot">divvy — no token. just settled tabs.</div>`);
}

function ctShotHtml() {
  const b64 = readFileSync(join(OUT, "chat-boys-trip.png")).toString("base64");
  return ctShell(`
    ${ctTopBar(7)}
    <div class="tag" style="position:absolute;top:196px;left:84px;font-size:27px">&gt; THE PROTOCOL IN THE WILD:</div>
    <div style="position:absolute;top:270px;left:0;right:0;text-align:center">
      <img src="data:image/png;base64,${b64}" style="height:960px;border-radius:26px;border:1px solid rgba(61,232,199,0.35);box-shadow:0 30px 80px rgba(0,0,0,0.6)">
    </div>
    <div class="foot" style="left:0;right:0;text-align:center">six figures of chat history. one message of money talk.</div>`);
}

function ctCtaHtml() {
  return ctShell(`
    ${ctTopBar(8)}
    <div style="position:absolute;left:84px;right:84px;top:236px;text-align:center">
      <div class="tag" style="font-size:27px">RULE_06</div>
      <div class="h" style="font-size:78px;letter-spacing:-1.5px;margin-top:26px">automate rules 1–5</div>
      <div id="stage" style="height:190px;display:flex;align-items:center;justify-content:center;margin-top:40px"></div>
      <div class="wm" style="justify-content:center;font-size:78px;gap:18px;margin-top:6px"><span class="dot" style="width:40px;height:40px;border-radius:13px;border-width:4px"></span>divvy</div>
      <div style="font-weight:700;font-size:27px;color:rgba(243,234,217,0.72);margin-top:18px">split the bill. not the friendship.</div>
      <div class="ln" style="margin-top:36px">scan the receipt. the boys pay their share in one tap.<br>settles in seconds. network fee: <b>$0.0004</b>.</div>
      <div style="display:inline-block;margin-top:48px;background:${MINT};color:#100D09;border-radius:999px;padding:26px 52px;font-weight:700;font-size:31px">get early access → divvysol.com</div>
    </div>
    <div class="foot" style="left:0;right:0;text-align:center">no token. just settled tabs. 🫡</div>`);
}

async function shoot(browser, { html, width, height, mood, mascot, file }) {
  const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage();
  await page.setContent(html, { waitUntil: "load" });
  if (mood || mascot) {
    // load the REAL rig and drop a frozen frame of it into #stage
    await page.addScriptTag({ path: MASCOT_JS });
    await page.evaluate((cfg) => {
      // glow:false — the rig's glow centers itself inside its keyframes, which
      // FREEZE_CSS disables; pages draw their own static glow where wanted.
      const fill = (el) => {
        el.innerHTML = cfg.kind === "mini"
          ? window.Mascot.mini(cfg.px || 64)
          : window.Mascot.html({ mood: cfg.mood, size: cfg.size || 118, glow: false });
      };
      if (cfg.all) document.querySelectorAll(cfg.all).forEach(fill);
      else fill(document.getElementById("stage"));
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

    // 2) fake iMessage screenshots + fake-text videos (1080×1920) — every
    //    scenarios/*.json renders a still AND a script-player video
    const stillsOnly = process.argv.includes("--stills-only");
    let mp4Missing = false;
    for (const c of CHAT_SCENARIOS) {
      if (!want(`${c.slug} ${c.file}`)) continue;
      // mini head-only Mochi inside the pay-request card's app icon (.appic)
      await shoot(browser, { html: chatV3Html(c), width: 1080, height: 1920, mascot: { kind: "mini", px: 72, all: ".appic" }, file: c.file });
      if (!stillsOnly) {
        const v = await recordChatVideo(browser, c);
        if (!v.mp4) mp4Missing = true;
      }
    }
    if (mp4Missing) process.stdout.write(
      "  NOTE: no mp4-capable ffmpeg here (playwright's bundle is webm-only) — videos ship as VP8 .webm.\n" +
      "  One-time conversion on any machine with real ffmpeg (see GENERATOR.md):\n" +
      "    ffmpeg -i videos/<slug>.webm -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart videos/<slug>.mp4\n");

    // 2b) mascot films — scripted "found footage" videos (1080×1920)
    if (!stillsOnly) {
      for (const f of FILMS) {
        if (!want(f.slug)) continue;
        await recordFilm(browser, f);
      }
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

    // 3d) six-tips journal cards (Clash Display, one accent per slide) — 1080×1350
    if (want(SIX_TIPS.slug)) {
      for (let i = 0; i < SIX_TIPS.slides.length; i++) {
        await shoot(browser, {
          html: sixTipsSlideHtml(i),
          width: 1080, height: 1350,
          mood: SIX_TIPS.slides[i].mood,
          file: join("carousels", SIX_TIPS.slug, `${String(i + 1).padStart(2, "0")}.png`),
        });
      }
      await shoot(browser, {
        html: sixTipsCtaHtml(),
        width: 1080, height: 1350,
        mood: "wave",
        file: join("carousels", SIX_TIPS.slug, "07.png"),
      });
    }

    // 3e) photo-editorial travel deck (licensed photography + Fraunces) — 1080×1350
    if (want(PHOTO_DECK.slug)) {
      if (!existsSync(srcAsset("photos", "cover-villa.jpg"))) {
        process.stdout.write("  NOTE: skipping travel-photo — assets-src/photos/ not vendored on this machine.\n");
      } else {
        const dir = join("carousels", PHOTO_DECK.slug);
        await shoot(browser, { html: photoCoverHtml(), width: 1080, height: 1350, file: join(dir, "01.png") });
        for (let i = 0; i < PHOTO_DECK.tipSlides.length; i++) {
          await shoot(browser, { html: photoTipHtml(i), width: 1080, height: 1350, file: join(dir, `${String(i + 2).padStart(2, "0")}.png`) });
        }
        await shoot(browser, { html: photoShotHtml(), width: 1080, height: 1350, file: join(dir, `${String(PHOTO_SLIDES_N - 1).padStart(2, "0")}.png`) });
        await shoot(browser, { html: photoCtaHtml(), width: 1080, height: 1350, mood: "wave", file: join(dir, `${String(PHOTO_SLIDES_N).padStart(2, "0")}.png`) });
      }
    }

    // 3e2) CT carousel "your worst bags aren't onchain" — 8×1080×1350
    if (want(CT_DECK.slug)) {
      await shoot(browser, { html: ctCoverHtml(), width: 1080, height: 1350, mascot: { kind: "mini", px: 92 , all: "#stage" }, file: join(CT_DECK.dir, "01.png") });
      for (let i = 0; i < CT_DECK.rules.length; i++) {
        await shoot(browser, { html: ctRuleHtml(i), width: 1080, height: 1350, file: join(CT_DECK.dir, `${String(i + 2).padStart(2, "0")}.png`) });
      }
      await shoot(browser, { html: ctShotHtml(), width: 1080, height: 1350, file: join(CT_DECK.dir, "07.png") });
      await shoot(browser, { html: ctCtaHtml(), width: 1080, height: 1350, mood: "wave", file: join(CT_DECK.dir, "08.png") });
    }

    // 3f) CT settle-receipt PnL cards — 1600×900 (X-native)
    for (const r of CT_RECEIPTS) {
      if (!want(r.file)) continue;
      await shoot(browser, { html: ctReceiptHtml(r), width: 1600, height: 900, mascot: { kind: "mini", px: 76, all: ".mmini" }, file: r.file });
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
    const photoOk = existsSync(srcAsset("photos", "cover-villa.jpg"));
    const slideCount = CAROUSELS.reduce((n, c) => n + c.slides.length, 0)
      + NOTES_CAROUSELS.reduce((n, c) => n + c.sections.length, 0)
      + LISTICLES.reduce((n, c) => n + c.slides.length, 0)
      + SIX_TIPS.slides.length + 1 + (photoOk ? PHOTO_SLIDES_N : 0);
    const carCount = CAROUSELS.length + NOTES_CAROUSELS.length + LISTICLES.length + 1 + (photoOk ? 1 : 0);
    process.stdout.write(ONLY
      ? `=== PASS — rendered only [${ONLY.join(", ")}] in marketing/tiktok-kit/assets ===\n`
      : `=== PASS — ${SCENES.length + CHAT_SCENARIOS.length + MEMES.length + 2} stills + ${CHAT_SCENARIOS.length} videos + ${carCount} carousels (${slideCount} slides) in marketing/tiktok-kit/assets ===\n`);
    process.exit(0);
  },
  (err) => { process.stderr.write("=== FAIL — " + (err && err.message ? err.message : err) + "\n"); process.exit(1); }
);
