/**
 * memes.ts — the public Mochi Meme Generator page (GET /memes).
 *
 * A standalone, no-account, mobile-first page where anyone can turn Divvy's
 * mascot Mochi into a shareable meme in ~10 seconds. Every meme is organic
 * marketing: a big Mochi on journal paper, top/bottom captions, a tasteful
 * watermark, and one-tap share to X.
 *
 * This module is a *shell only*: it server-renders the journal-styled HTML
 * chrome + OG/Twitter meta (so the link unfurls into a sample meme) and loads
 * ONE static client script, public/memes.js, which does all the canvas work.
 * Pure client after load — no uploads, no API calls, nothing sent to the server.
 *
 * Mount (integrator — ONE line in server.ts):
 *   import { memesRouter } from "./memes";
 *   app.use(memesRouter);
 *
 * Follows src/legal.ts for structure and src/og.ts for the meta block. Absolute
 * URLs come from publicOrigin(req) (PUBLIC_ORIGIN or the request host).
 */

import { Router, Request, Response } from "express";
import { ogMeta } from "./og";
import { publicOrigin } from "./legal";

/** Canonical path to the dedicated meme OG card (a sample meme, 1200x630). */
export const MEMES_OG_PATH = "/og/memes.png";

function shell(origin: string): string {
  const meta = ogMeta({
    title: "make a mochi meme 🐸 — divvy",
    description:
      "turn Mochi into your next post. 8 poses, one-tap captions, share to 𝕏 in 10 seconds. no account, no sign-up.",
    imageUrl: `${origin}${MEMES_OG_PATH}`,
    url: `${origin}/memes`,
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
${meta}
<meta name="theme-color" content="#F7F1E3" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="${origin}/memes" />
<link rel="icon" href="/icon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="/fonts.css" />
<style>
  :root{
    --paper:#F7F1E3; --card:#FFFDF7; --ink:#2B2118;
    --blue:#2775CA; --mint:#3DE8C7; --coral:#FF6B5E; --sun:#FFC65C;
    --muted:rgba(43,33,24,0.55); --faint:rgba(43,33,24,0.4);
    --line:rgba(43,33,24,0.12);
    --sans:'General Sans',-apple-system,system-ui,'Segoe UI',Roboto,sans-serif;
    --mono:'Space Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:var(--paper);}
  body{
    font-family:var(--sans); color:var(--ink);
    -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
    /* subtle ruled-paper texture behind everything */
    background-image:repeating-linear-gradient(to bottom, transparent 0 46px, rgba(43,33,24,0.045) 46px 47px);
  }
  .wrap{max-width:560px; margin:0 auto; padding:18px 16px 64px;}
  header.wm{display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:6px;}
  .wordmark{display:inline-flex; align-items:center; gap:8px; text-decoration:none; color:var(--ink);
    font-weight:800; font-size:19px; letter-spacing:-0.4px;}
  .mark{width:26px; height:26px; border:2px solid var(--ink); border-radius:7px; background:var(--sun);
    display:flex; align-items:center; justify-content:center; font-weight:800; box-shadow:2px 2px 0 var(--ink);}
  .eyebrow{font-family:var(--mono); font-weight:700; font-size:10px; letter-spacing:1.6px;
    text-transform:uppercase; color:var(--muted);}
  h1{font-size:clamp(24px,7vw,32px); line-height:1.08; letter-spacing:-0.6px; margin:12px 0 2px; font-weight:800;}
  .sub{font-family:var(--mono); font-size:12px; letter-spacing:.3px; color:var(--muted); margin:0 0 16px;}

  .stage{position:relative; margin:0 auto 6px; width:100%;}
  #memeCanvas{display:block; width:100%; height:auto; border:3px solid var(--ink); border-radius:18px;
    box-shadow:5px 6px 0 rgba(43,33,24,0.85); background:var(--paper); transform:rotate(-0.5deg);
    image-rendering:auto;}

  .card{background:var(--card); border:2px solid var(--ink); border-radius:16px; padding:14px;
    margin:14px 0; box-shadow:3px 4px 0 rgba(43,33,24,0.85);}
  .lbl{font-family:var(--mono); font-weight:700; font-size:10px; letter-spacing:1.4px; text-transform:uppercase;
    color:var(--muted); margin:0 0 9px;}

  input[type=text]{width:100%; font-family:var(--mono); font-weight:700; font-size:15px; color:var(--ink);
    background:var(--paper); border:2px solid var(--ink); border-radius:11px; padding:11px 12px; outline:none;}
  input[type=text]::placeholder{color:rgba(43,33,24,0.35); font-weight:400;}
  input[type=text]+input[type=text]{margin-top:9px;}

  .chips{display:flex; flex-wrap:wrap; gap:8px;}
  .chip{font-family:var(--mono); font-weight:700; font-size:12px; letter-spacing:.2px; color:var(--ink);
    background:var(--paper); border:2px solid var(--ink); border-radius:999px; padding:8px 13px; cursor:pointer;
    box-shadow:2px 2px 0 rgba(43,33,24,0.8); transition:transform .06s ease;}
  .chip:active{transform:translate(1px,1px); box-shadow:1px 1px 0 rgba(43,33,24,0.8);}

  .poses{display:grid; grid-template-columns:repeat(4,1fr); gap:9px;}
  .pose{position:relative; border:2px solid var(--ink); border-radius:13px; background:var(--paper);
    padding:6px 4px 5px; cursor:pointer; text-align:center; box-shadow:2px 2px 0 rgba(43,33,24,0.75);
    transition:transform .06s ease;}
  .pose:active{transform:translate(1px,1px);}
  .pose img{width:100%; height:44px; object-fit:contain; display:block; pointer-events:none;}
  .pose .pn{font-family:var(--mono); font-weight:700; font-size:8.5px; letter-spacing:.2px; color:var(--muted);
    margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .pose.sel{background:linear-gradient(180deg,#f2fbf8,var(--card)); box-shadow:2px 2px 0 var(--blue); border-color:var(--blue);}
  .pose.sel .pn{color:var(--blue);}

  .swatches{display:flex; gap:11px;}
  .swatch{width:42px; height:42px; border-radius:12px; border:2px solid var(--ink); cursor:pointer;
    box-shadow:2px 2px 0 rgba(43,33,24,0.75); position:relative;}
  .swatch.sel::after{content:"✓"; position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    font-weight:800; color:var(--ink); font-size:18px;}

  .rowbtns{display:flex; gap:9px; margin-top:4px;}
  .btn{flex:1; font-family:var(--sans); font-weight:700; font-size:15px; cursor:pointer;
    border:2px solid var(--ink); border-radius:999px; padding:14px 10px; text-align:center; text-decoration:none;
    box-shadow:3px 3px 0 rgba(43,33,24,0.85); transition:transform .06s ease; display:flex; align-items:center;
    justify-content:center; gap:7px; color:var(--ink); background:var(--card); -webkit-user-select:none; user-select:none;}
  .btn:active{transform:translate(2px,2px); box-shadow:1px 1px 0 rgba(43,33,24,0.85);}
  .btn.primary{background:var(--blue); color:#fff;}
  .btn.x{background:var(--ink); color:#fff;}
  .btn.wide{width:100%;}
  .btn.ghost{background:transparent; box-shadow:none; border-style:dashed; font-weight:600; font-size:13px; padding:11px;}

  .hint{font-family:var(--mono); font-size:11px; letter-spacing:.2px; color:var(--muted); text-align:center;
    margin:10px 2px 0; line-height:1.5;}
  .hint b{color:var(--coral);}
  footer{margin-top:26px; text-align:center; font-family:var(--mono); font-size:10.5px; letter-spacing:.4px;
    color:var(--faint);}
  footer a{color:var(--muted); text-decoration:none;}
  @media (prefers-reduced-motion:reduce){ #memeCanvas{transform:none;} .chip,.pose,.btn{transition:none;} }
</style>
</head>
<body>
  <div class="wrap">
    <header class="wm">
      <a class="wordmark" href="/"><span class="mark">/</span>divvy</a>
      <span class="eyebrow">meme lab</span>
    </header>
    <h1>make a mochi meme 🐸</h1>
    <p class="sub">pick a pose, add a caption, share to 𝕏. no account. 10 seconds.</p>
    <div id="memeRoot"><!-- built by /memes.js --></div>
    <footer>
      made with divvy · <a href="/">split the bill, settle in seconds</a><br/>
      no sign-up · nothing uploaded · your meme stays on your device
    </footer>
  </div>
  <script src="/mascot.js"></script>
  <script src="/memes.js"></script>
</body>
</html>`;
}

export const memesRouter = Router();

memesRouter.get("/memes", (req: Request, res: Response) => {
  res.type("html").send(shell(publicOrigin(req)));
});
