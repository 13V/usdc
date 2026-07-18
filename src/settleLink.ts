/**
 * settleLink.ts — public, no-login settle pages for 1:1 debts.
 *
 * A tab settlement / IOU money request already carries a throwaway base58
 * reference pubkey. That reference is an unguessable capability token (same
 * trust model as a /pay/:id bill link), so it can safely back a shareable
 * page the debtor opens with zero sign-in:
 *
 *   GET  /s/:reference              journal-styled pay page: Solana Pay QR +
 *                                   "open in wallet", plus a collapsed
 *                                   exchange-transfer block (address + rules).
 *   GET  /api/s/:reference/status   cheap DB-only poll: {state:"pending"|"paid"}.
 *   POST /api/s/:reference/verify   public verify — runs the EXACT authed verify
 *                                   cores (tabs.settleVerifyCore / ious.iouVerifyCore)
 *                                   so the atomic signature dedupe and ledger
 *                                   effects are never duplicated here.
 *
 * Guardrails: the recipient is always the creditor's own stored pay_wallet
 * (never an operator address); QRs render via first-party /api/qr only; a row
 * stamped on another cluster is refused (409 API / closed page) exactly like
 * the existing B4/H1 guards; references are never logged.
 *
 * Mount (integrator):
 *   import { settleLinkRouter } from "./settleLink";
 *   app.use(settleLinkRouter);
 */

import { Router, Request, Response } from "express";

import { CLUSTER, clusterMismatchError } from "./cluster";
import { fmt } from "./split";
import { getUser } from "./users";
import { rateLimit, moneyRateLimit } from "./ratelimit";
import {
  TabSettlementRow,
  getSettlementByReference,
  settlementUrl,
  settleVerifyCore,
  rowCluster as tabRowCluster,
} from "./tabs";
import {
  IouRow,
  getIouByReference,
  rebuildUrl as iouUrl,
  iouVerifyCore,
  rowCluster as iouRowCluster,
} from "./ious";

// ---- Lookup -----------------------------------------------------------------

const BASE58_REF = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Hit =
  | { kind: "tab"; row: TabSettlementRow }
  | { kind: "iou"; row: IouRow };

/**
 * Resolve a reference to the settlement it belongs to. IOUs only resolve for
 * "they_owe" (a money REQUEST — the link's "you owe <creditor>" framing); an
 * "i_owe" IOU is the owner paying out and has no public audience.
 */
async function resolveReference(reference: string): Promise<Hit | null> {
  const tab = await getSettlementByReference(reference);
  if (tab) return { kind: "tab", row: tab };
  const iou = await getIouByReference(reference);
  if (iou && iou.direction === "they_owe") return { kind: "iou", row: iou };
  return null;
}

type LinkState = "pending" | "paid" | "closed" | "cross_cluster";

function stateOf(hit: Hit): LinkState {
  const { row } = hit;
  if (row.status === "paid") return "paid";
  const open =
    hit.kind === "tab" ? row.status === "open" || row.status === "open_partial" : row.status === "open";
  if (!open) return "closed"; // cancelled / anything else — nothing payable
  const rc = hit.kind === "tab" ? tabRowCluster(row) : iouRowCluster(row);
  if (rc !== CLUSTER) return "cross_cluster";
  if (!row.reference || !row.pay_wallet) return "closed";
  return "pending";
}

/** The creditor's display label — best-effort, never blocks the page. */
async function creditorLabel(hit: Hit): Promise<string> {
  const id = hit.kind === "tab" ? hit.row.payee_user_id : hit.row.owner_user_id;
  try {
    const u = await getUser(id);
    if (u) return u.displayName || u.handle || "your friend";
  } catch {
    /* generic label */
  }
  return "your friend";
}

// ---- HTML helpers (mirrors server.ts — kept local to avoid an import cycle) --

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** JSON safe for an inline <script> (see server.ts#jsonForScript). */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// ---- Renderers (journal theme — same paper/ink language as renderPayPage) ----

const PAGE_CSS = `
  @font-face { font-family:'Space Mono'; font-style:normal; font-weight:700;
    font-display:swap; src:url(/fonts/i7dMIFZifjKcF5UAWdDRaPpZUFWaHi6WZ3Q.woff2) format('woff2');
    unicode-range:U+0000-00FF; }
  :root { color-scheme: light; --paper:#F7F1E3; --card:#FFFDF7; --ink:#2B2118;
          --blue:#2775CA; --mint:#3DE8C7; --coral:#FF6B5E; --sun:#FFC65C; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html,body { margin:0; }
  body { font-family:-apple-system,system-ui,"Segoe UI",sans-serif; background:var(--paper);
         color:var(--ink); line-height:1.5; padding:22px 18px 48px; max-width:440px;
         margin-inline:auto; -webkit-font-smoothing:antialiased; }
  .brand { display:flex; align-items:center; gap:8px; margin:0 2px 20px; }
  .mark { width:30px; height:30px; border:2px solid var(--ink); border-radius:9px; background:var(--sun);
          display:flex; align-items:center; justify-content:center; font-weight:800; box-shadow:3px 3px 0 var(--ink); }
  .word { font-weight:800; font-size:1.15rem; letter-spacing:-.5px; }
  .hero { background:var(--card); border:2px solid var(--ink); border-radius:20px; padding:24px 22px 26px;
          box-shadow:6px 6px 0 var(--ink); text-align:center; }
  .asker { display:inline-block; font-weight:700; font-size:.95rem; background:var(--mint);
           border:2px solid var(--ink); border-radius:999px; padding:4px 12px; box-shadow:2px 2px 0 var(--ink); }
  .muted { color:#7c7266; font-size:.9rem; }
  .amount { font-family:'Space Mono',ui-monospace,monospace; font-weight:700; font-size:3.5rem;
            letter-spacing:-2px; margin:14px 0 6px; line-height:1; }
  img.qr { width:220px; height:220px; image-rendering:pixelated; border:2px solid var(--ink);
           border-radius:12px; background:#fff; padding:6px; margin-top:14px; }
  a.primary { display:block; width:100%; border:2px solid var(--ink); text-decoration:none;
            background:var(--blue); color:#fff; font-weight:800; font-size:1.15rem; padding:17px;
            border-radius:15px; box-shadow:5px 5px 0 var(--ink); letter-spacing:-.2px; margin-top:16px;
            transition:transform .06s ease, box-shadow .06s ease; }
  a.primary:active { transform:translate(3px,3px); box-shadow:2px 2px 0 var(--ink); }
  a.ghost { display:inline-block; margin-top:12px; color:var(--blue); font-weight:700; text-decoration:none; }
  details.exch { margin-top:22px; border-top:2px dashed #d8cdb6; padding-top:14px; text-align:center; }
  details.exch summary { list-style:none; cursor:pointer; color:#7c7266; font-size:.85rem; font-weight:700; }
  details.exch summary::-webkit-details-marker { display:none; }
  .addr { font-family:'Space Mono',ui-monospace,monospace; font-size:.78rem; word-break:break-all;
          background:var(--card); border:2px solid var(--ink); border-radius:13px; padding:12px 14px;
          box-shadow:3px 3px 0 var(--ink); margin:14px 0 0; user-select:all; -webkit-user-select:all; }
  button.copy { appearance:none; border:2px solid var(--ink); cursor:pointer; background:var(--sun);
          color:var(--ink); font-weight:700; font-size:.85rem; padding:9px 16px; border-radius:999px;
          box-shadow:2px 2px 0 var(--ink); margin-top:10px; font-family:inherit; }
  .rules { background:var(--sun); border:2px solid var(--ink); border-radius:13px; padding:11px 13px;
           margin-top:14px; font-size:.84rem; font-weight:600; box-shadow:3px 3px 0 var(--ink); text-align:left; }
  .rules p { margin:4px 0; }
  .watch { margin-top:16px; font-family:'Space Mono',ui-monospace,monospace; font-size:.68rem;
           letter-spacing:.5px; color:#7c7266; }
  .again { display:none; margin-top:8px; color:var(--blue); font-weight:700; cursor:pointer;
           text-decoration:underline; font-size:.85rem; }
  .settled .tick { width:56px; height:56px; margin:6px auto 10px; border:2px solid var(--ink);
          border-radius:50%; background:var(--mint); display:flex; align-items:center; justify-content:center;
          font-size:1.8rem; font-weight:800; box-shadow:3px 3px 0 var(--ink); }
  h1 { font-size:1.35rem; margin:14px 0 2px; letter-spacing:-.4px; }
  h2 { font-size:1.25rem; margin:6px 0; }
  .foot { text-align:center; margin-top:22px; }
`;

function pageShell(title: string, body: string, script = ""): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#F7F1E3" />
<meta name="robots" content="noindex" />
<title>${esc(title)}</title>
<style>${PAGE_CSS}</style>
</head><body>
  <div class="brand"><span class="mark">/</span><span class="word">divvy</span></div>
  ${body}
  <p class="foot muted">settles instantly in dollars. friends split, divvy handles the rest.</p>
${script}</body></html>`;
}

/** Friendly closed page for a paid-elsewhere / cancelled / unknown reference. */
function renderLinkClosed(note: string): string {
  const body = `
  <div class="hero">
    <h2>nothing owed here</h2>
    <p class="muted">${esc(note)}</p>
    <p class="muted">if this is still live, ask for a fresh link.</p>
    <a class="ghost" href="/">open divvy →</a>
  </div>`;
  return pageShell("divvy — link closed", body);
}

/** Static settled page (also what the live page swaps to when the poll flips). */
function renderLinkPaid(creditor: string, amountFmt: string): string {
  const body = `
  <div class="hero settled">
    <div class="tick">✓</div>
    <h2>settled 🫡</h2>
    <p class="muted">${esc(creditor)}'s ${amountFmt} is paid. nothing to do.</p>
    <a class="ghost" href="/">keep divvy for next time →</a>
  </div>`;
  return pageShell("paid ✓ — divvy", body);
}

function renderLinkLive(input: {
  reference: string;
  creditor: string;
  amountCents: number;
  note: string | null;
  payUrl: string;
  payWallet: string;
}): string {
  const amountFmt = fmt(input.amountCents);
  const qrSrc = `/api/qr?data=${encodeURIComponent(input.payUrl)}`;
  const noteLine = input.note ? `<div class="muted">${esc(input.note)}</div>` : "";
  const data = {
    reference: input.reference,
    payWallet: input.payWallet,
    // Pre-escaped server-side: the poll script injects this via innerHTML.
    paidLine: `${esc(input.creditor)}&#39;s ${amountFmt} is paid. nothing to do.`,
  };
  const body = `
  <div class="hero">
    <span class="asker">${esc(input.creditor)} says you owe</span>
    <div class="amount">${amountFmt}</div>
    ${noteLine}
    <div id="live">
      <img class="qr" src="${esc(qrSrc)}" alt="payment qr" />
      <div class="muted" style="margin-top:8px">scan with any solana wallet — it's already tagged to this debt.</div>
      <a class="primary" href="${esc(input.payUrl)}">open in wallet</a>
      <div class="watch" id="watch">watching for your payment…</div>
      <span class="again" id="again" role="button" tabindex="0">paid? check again</span>
    </div>
    <details class="exch" id="exch">
      <summary>sending from an exchange? ▾</summary>
      <div class="addr" id="addr">${esc(input.payWallet)}</div>
      <button class="copy" id="copyAddr" type="button">copy address</button>
      <div class="rules">
        <p>usdc on solana only · exact amount (${amountFmt}) · no memo needed</p>
        <p>exchange transfers can't auto-confirm — after you send, ${esc(input.creditor)} marks it settled in the app.</p>
      </div>
    </details>
  </div>`;
  const script = `<script>window.__SETTLE__=${jsonForScript(data)};</script>
<script>
(function () {
  "use strict";
  var S = window.__SETTLE__;
  if (!S) return;
  var timer = null, tick = 0;
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function settled() {
    stop();
    var hero = document.querySelector(".hero");
    if (!hero) return;
    hero.className = "hero settled";
    hero.innerHTML = '<div class="tick">✓</div><h2>settled 🫡</h2>' +
      '<p class="muted">' + S.paidLine + '</p>' +
      '<a class="ghost" href="/">keep divvy for next time →</a>';
  }
  function checkStatus() {
    fetch("/api/s/" + S.reference + "/status")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.state === "paid") settled(); })
      .catch(function () { /* transient — keep polling */ });
  }
  function verify() {
    fetch("/api/s/" + S.reference + "/verify", { method: "POST" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && (d.verified || d.state === "paid")) settled(); })
      .catch(function () { /* transient */ });
  }
  var again = document.getElementById("again");
  function start() {
    stop(); tick = 0;
    if (again) again.style.display = "none";
    var w = document.getElementById("watch");
    if (w) w.style.display = "block";
    // status is a cheap DB read every 4s; every 3rd tick runs the real
    // on-chain verify (~12s cadence — modest, mirrors public/pay.js polling).
    timer = setInterval(function () {
      tick++;
      if (tick > 45) { // ~3 min, then rest — the "check again" link rearms it
        stop();
        if (w) w.style.display = "none";
        if (again) again.style.display = "inline-block";
        return;
      }
      if (tick % 3 === 0) verify(); else checkStatus();
    }, 4000);
  }
  if (again) {
    again.onclick = function () { verify(); start(); };
    again.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); verify(); start(); } };
  }
  var copyBtn = document.getElementById("copyAddr");
  if (copyBtn) copyBtn.onclick = function () {
    var p = (navigator.clipboard && navigator.clipboard.writeText)
      ? navigator.clipboard.writeText(S.payWallet) : Promise.reject();
    p.then(function () {
      copyBtn.textContent = "copied ✓";
      setTimeout(function () { copyBtn.textContent = "copy address"; }, 1600);
    }).catch(function () { /* address is visible + selectable above */ });
  };
  verify(); // the payment may already be mid-flight when the page opens
  start();
})();
</script>`;
  return pageShell(`you owe ${amountFmt} — divvy`, body, script);
}

// ---- Router -----------------------------------------------------------------

export const settleLinkRouter = Router();

// Status polls are cheap DB reads; same tier as /api/qr. Verify shares the
// global money limiter with every other settle/verify endpoint.
const statusRateLimit = rateLimit(60, 60_000);

const CLOSED_NOTE = "this payment link is closed — it may have been paid, replaced, or cancelled.";

/** GET /s/:reference — the public, no-login settle page. */
settleLinkRouter.get("/s/:reference", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store"); // live payment state — never cache
  const ref = req.params.reference;
  if (!BASE58_REF.test(ref)) return res.status(404).type("html").send(renderLinkClosed(CLOSED_NOTE));
  const hit = await resolveReference(ref);
  if (!hit) return res.status(404).type("html").send(renderLinkClosed(CLOSED_NOTE));

  const state = stateOf(hit);
  if (state === "cross_cluster") {
    // Same posture as /pay/:id for a cross-cluster bill (B4/H1): closed, honest.
    return res.status(410).type("html").send(renderLinkClosed(clusterMismatchError(hit.row.cluster)));
  }
  const creditor = await creditorLabel(hit);
  if (state === "paid") {
    return res.type("html").send(renderLinkPaid(creditor, fmt(hit.row.amount_cents)));
  }
  if (state === "closed") {
    return res.status(410).type("html").send(renderLinkClosed(CLOSED_NOTE));
  }

  const payUrl = hit.kind === "tab" ? settlementUrl(hit.row) : iouUrl(hit.row);
  if (!payUrl) return res.status(410).type("html").send(renderLinkClosed(CLOSED_NOTE));
  return res.type("html").send(
    renderLinkLive({
      reference: ref,
      creditor,
      amountCents: hit.row.amount_cents,
      note: hit.kind === "iou" ? hit.row.note : null,
      payUrl,
      payWallet: hit.row.pay_wallet as string,
    })
  );
});

/**
 * GET /api/s/:reference/status — cheap poll for the page. DB-only, and returns
 * nothing beyond the pending/paid bit the page already shows.
 */
settleLinkRouter.get("/api/s/:reference/status", statusRateLimit, async (req: Request, res: Response) => {
  const ref = req.params.reference;
  if (!BASE58_REF.test(ref)) return res.status(404).json({ error: "not found" });
  const hit = await resolveReference(ref);
  if (!hit) return res.status(404).json({ error: "not found" });
  const state = stateOf(hit);
  if (state === "cross_cluster") {
    return res.status(409).json({ error: clusterMismatchError(hit.row.cluster), crossCluster: true });
  }
  if (state === "closed") return res.status(410).json({ error: "closed" });
  return res.json({ state });
});

/**
 * POST /api/s/:reference/verify — public verify. Runs the SAME core as the
 * authed endpoints (settleVerifyCore / iouVerifyCore): finalized-commitment
 * validatePayment, exact amount, reference-bound, and the global one-signature-
 * one-debt claim. For a tab the actor is the PAYER (the person this page asks
 * to pay), so pushes land on the creditor exactly as if the payer had verified
 * from inside the app.
 */
settleLinkRouter.post("/api/s/:reference/verify", moneyRateLimit, async (req: Request, res: Response) => {
  const ref = req.params.reference;
  if (!BASE58_REF.test(ref)) return res.status(404).json({ error: "not found" });
  const hit = await resolveReference(ref);
  if (!hit) return res.status(404).json({ error: "not found" });

  const state = stateOf(hit);
  if (state === "cross_cluster") {
    // B4/H1: never verify a row stamped on a different cluster — this server's
    // chain check would stall forever or match the wrong network's transfer.
    return res.status(409).json({ error: clusterMismatchError(hit.row.cluster), crossCluster: true });
  }
  if (state === "paid") return res.json({ state: "paid", verified: true });
  if (state === "closed") return res.status(410).json({ error: "closed" });

  const out =
    hit.kind === "tab"
      ? await settleVerifyCore(hit.row, hit.row.payer_user_id)
      : await iouVerifyCore(hit.row);
  return res.json({
    state: out.verified ? "paid" : "pending",
    verified: out.verified,
    reason: out.reason,
  });
});
