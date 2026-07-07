/**
 * bags.ts — the public Friend Debt Portfolio generator (GET /bags).
 *
 * The CT-pivot growth toy (marketing/ct-kit/STRATEGY.md): anyone on crypto
 * twitter can type in who owes them what and for how long and get a shareable
 * trenches-terminal "portfolio card" of their unpaid friend debt — no account,
 * no wallet, nothing sent to the server. Every shared card is organic
 * marketing with divvy as the "recovery protocol".
 *
 * Same architecture as src/memes.ts: this module is a shell only — it
 * server-renders the page chrome + OG/Twitter meta and loads ONE static
 * client script, public/bags.js, which does all the canvas work client-side.
 *
 * Mount (integrator — ONE line in server.ts next to memesRouter):
 *   import { bagsRouter } from "./bags";
 *   app.use(bagsRouter);
 */

import { Router, Request, Response } from "express";
import { ogMeta } from "./og";
import { publicOrigin } from "./legal";

/** Canonical path to the OG card (a sample portfolio, rendered offline). */
export const BAGS_OG_PATH = "/og/bags.png";

function shell(origin: string): string {
  const meta = ogMeta({
    title: "friend debt portfolio 💀 — divvy",
    description:
      "your worst bags aren't onchain. type in what the boys owe you, get the portfolio card, post it. no account, no wallet, nothing leaves your phone.",
    imageUrl: `${origin}${BAGS_OG_PATH}`,
    url: `${origin}/bags`,
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
${meta}
<meta name="theme-color" content="#100D09" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="${origin}/bags" />
<link rel="icon" href="/icon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="/fonts.css" />
<style>
  :root{
    --bg:#100D09; --panel:#1A150F; --cream:#F3EAD9; --mint:#3DE8C7;
    --coral:#FF6B5E; --blue:#2775CA;
    --muted:rgba(243,234,217,0.55); --faint:rgba(243,234,217,0.35);
    --line:rgba(61,232,199,0.22);
    --sans:'General Sans',-apple-system,system-ui,'Segoe UI',Roboto,sans-serif;
    --mono:'Space Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:var(--bg);}
  body{
    font-family:var(--mono); color:var(--cream);
    -webkit-font-smoothing:antialiased;
    background-image:linear-gradient(rgba(61,232,199,0.04) 1px,transparent 1px),
      linear-gradient(90deg,rgba(61,232,199,0.04) 1px,transparent 1px);
    background-size:34px 34px;
  }
  .wrap{max-width:600px; margin:0 auto; padding:20px 16px 64px;}
  header.wm{display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;}
  .wordmark{display:inline-flex; align-items:center; gap:9px; text-decoration:none; color:var(--cream);
    font-family:'Clash Display',var(--sans); font-weight:700; font-size:20px; letter-spacing:-0.4px;}
  .mark{width:22px; height:22px; border-radius:7px; background:var(--blue); border:2px solid var(--cream);}
  .eyebrow{font-size:10px; letter-spacing:2px; text-transform:uppercase; color:var(--faint);}
  h1{font-family:'Clash Display',var(--sans); font-size:clamp(24px,7vw,34px); line-height:1.1;
    letter-spacing:-0.6px; margin:14px 0 4px; font-weight:700;}
  .sub{font-size:12px; line-height:1.6; color:var(--muted); margin:0 0 18px;}
  .stage{margin:0 0 14px;}
  #bagCanvas{display:block; width:100%; height:auto; border:1px solid var(--line); border-radius:14px;
    box-shadow:0 18px 60px rgba(0,0,0,0.5);}
  .rows{display:flex; flex-direction:column; gap:8px; margin:14px 0 10px;}
  .row{display:grid; grid-template-columns:1fr 92px 92px 34px; gap:8px;}
  .row input{width:100%; background:var(--panel); border:1px solid var(--line); border-radius:9px;
    color:var(--cream); font-family:var(--mono); font-size:13px; padding:10px 10px; outline:none;}
  .row input:focus{border-color:var(--mint);}
  .row .x{background:none; border:none; color:var(--faint); font-size:16px; cursor:pointer; padding:0;}
  .lbl{display:grid; grid-template-columns:1fr 92px 92px 34px; gap:8px; font-size:9px;
    letter-spacing:1.5px; text-transform:uppercase; color:var(--faint); padding:0 2px;}
  .btns{display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;}
  button.btn{appearance:none; cursor:pointer; border-radius:999px; border:1px solid var(--line);
    background:var(--panel); color:var(--cream); font-family:var(--mono); font-weight:700;
    font-size:13px; padding:12px 18px;}
  button.btn.primary{background:var(--mint); color:#100D09; border-color:var(--mint);}
  .hint{font-size:10.5px; line-height:1.6; color:var(--faint); margin-top:10px;}
  .footer{margin-top:26px; font-size:11px; line-height:1.7; color:var(--muted);}
  .footer a{color:var(--mint); text-decoration:none;}
</style>
</head>
<body>
<div class="wrap">
  <header class="wm">
    <a class="wordmark" href="/"><span class="mark"></span>divvy</a>
    <span class="eyebrow">friend debt terminal</span>
  </header>
  <h1>your worst bags aren't onchain 💀</h1>
  <p class="sub">type in what the boys owe you. get the portfolio card. post it.<br>
  nothing leaves your phone — no account, no wallet, no uploads.</p>

  <div class="stage"><canvas id="bagCanvas" width="1600" height="900"></canvas></div>

  <div class="lbl"><span>who</span><span>owes you $</span><span>days held</span><span></span></div>
  <div class="rows" id="rows"></div>
  <div class="btns">
    <button class="btn" type="button" id="addRow">+ add bag</button>
    <button class="btn primary" type="button" id="render">update card</button>
  </div>
  <div class="btns">
    <button class="btn" type="button" id="download">⬇ download</button>
    <button class="btn" type="button" id="share">share</button>
    <button class="btn" type="button" id="tweet">post on 𝕏</button>
  </div>
  <p class="hint">posting on 𝕏 opens a tweet — <b>attach your card</b> (download it first, then add it to the post).</p>

  <p class="footer">tired of holding these? divvy splits the bill and the boys pay their share in one tap —
  <a href="https://divvysol.com">get early access →</a><br>no token. just settled tabs.</p>
</div>
<script defer src="/bags.js"></script>
</body>
</html>`;
}

export const bagsRouter = Router();

bagsRouter.get("/bags", (req: Request, res: Response) => {
  res.set("Cache-Control", "public, max-age=300");
  res.type("html").send(shell(publicOrigin(req)));
});
