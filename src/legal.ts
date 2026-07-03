/**
 * legal.ts — server-rendered Terms, Privacy, and Support pages.
 *
 * These are plain, static, journal-styled HTML pages (no SPA, no client JS).
 * They exist so Divvy reads as a legitimate product to normal users and to
 * Apple's App Review: real Terms, a real Privacy Policy, and a real support
 * page live at stable, linkable URLs.
 *
 *   GET /terms    — Terms of Service
 *   GET /privacy  — Privacy Policy
 *   GET /support  — Support / FAQ + contact (also used as the App Store support URL)
 *
 * Mount (integrator — ONE line in server.ts):
 *   import { legalRouter } from "./legal";
 *   app.use(legalRouter);
 *
 * All absolute references are built from PUBLIC_ORIGIN when set, else the request
 * host — never hardcoded. In-page links are relative (/terms, /privacy, /support,
 * mailto:) so they are inherently host-correct.
 */

import { Router, Request, Response } from "express";

// One shared "last updated" date for all three pages. Bump when the content
// materially changes (and, for Terms/Privacy, note it in-app where appropriate).
export const LAST_UPDATED = "2026-07-03";

// Support contact — the one address a user (or an App reviewer) can reach.
const SUPPORT_EMAIL = "support@divvysol.com";

/**
 * The public origin for absolute URLs (canonical tags, etc.). Configurable via
 * PUBLIC_ORIGIN (e.g. "https://app.divvysol.com"); otherwise the request's own
 * scheme+host. Never hardcoded to a specific domain.
 */
export function publicOrigin(req: Request): string {
  const env = (process.env.PUBLIC_ORIGIN || "").trim().replace(/\/+$/, "");
  if (env) return env;
  return `${req.protocol}://${req.get("host")}`;
}

// ---- Shared journal layout -------------------------------------------------

/** Escape a string for HTML text / attribute context. */
function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

interface LayoutOpts {
  title: string; // <title> + h1
  metaDescription: string;
  canonical: string; // absolute URL
  /** Rendered inside <main>, after the h1 + updated line. */
  body: string;
  /** Optional "last updated" line under the h1 (Terms/Privacy show it; Support doesn't). */
  updated?: boolean;
}

/**
 * The shared page chrome: warm paper, card stock, ink. 16px readable body, a
 * 640px measure, lowercase display headings, and a muted "terms · privacy ·
 * support" footer. Self-contained (inlined CSS, no external requests).
 */
function layout(o: LayoutOpts): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(o.title)} — Divvy</title>
<meta name="theme-color" content="#F7F1E3" />
<meta name="description" content="${esc(o.metaDescription)}" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="${esc(o.canonical)}" />
<style>
  :root {
    --paper:#F7F1E3; --card:#FFFDF7; --ink:#2B2118;
    --blue:#2775CA; --mint:#3DE8C7; --coral:#FF6B5E; --sun:#FFC65C;
    --muted:#6b6055; --faint:#8a7f72; --line:rgba(43,33,24,0.12);
  }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:var(--paper); }
  body {
    font-family:-apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
    color:var(--ink); font-size:16px; line-height:1.62;
    -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  }
  header.wm { max-width:640px; margin:0 auto; padding:26px 22px 6px; display:flex; align-items:center; gap:10px; }
  .wordmark { display:inline-flex; align-items:center; gap:9px; text-decoration:none; color:var(--ink);
    font-weight:800; font-size:20px; letter-spacing:-0.4px; }
  .mark { width:28px; height:28px; border:2px solid var(--ink); border-radius:8px; background:var(--sun);
    display:flex; align-items:center; justify-content:center; font-weight:800; box-shadow:2px 2px 0 var(--ink); }
  main { max-width:640px; margin:0 auto; padding:8px 22px 56px; }
  h1 { font-size:clamp(28px,7vw,38px); letter-spacing:-0.6px; line-height:1.1; margin:18px 0 6px; font-weight:800; }
  .updated { font-size:13px; color:var(--faint); letter-spacing:0.02em; margin:0 0 6px; }
  .lede { font-size:17px; color:var(--muted); margin:14px 0 24px; }
  h2 { font-size:20px; letter-spacing:-0.2px; margin:32px 0 10px; font-weight:700; }
  h2 .num { color:var(--blue); font-weight:800; font-size:14px; margin-right:8px; vertical-align:2px;
    font-variant-numeric:tabular-nums; }
  h3 { font-size:16px; margin:18px 0 6px; font-weight:700; }
  p { margin:0 0 14px; }
  ul { margin:0 0 14px; padding-left:20px; }
  li { margin:0 0 8px; }
  strong { font-weight:700; }
  a { color:var(--blue); text-decoration:none; border-bottom:1px solid rgba(39,117,202,0.35); }
  a:hover { border-bottom-color:var(--blue); }
  .card { background:var(--card); border:2px solid var(--ink); border-radius:16px; padding:18px 20px;
    margin:18px 0; box-shadow:4px 4px 0 var(--ink); }
  .card h2, .card h3 { margin-top:0; }
  .card.mint { background:linear-gradient(180deg,#f2fbf8,var(--card)); }
  .card.warn { background:linear-gradient(180deg,#fff4f2,var(--card)); }
  .legal { color:var(--muted); font-size:14px; }
  .contact { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:15px; }
  footer { max-width:640px; margin:0 auto; padding:22px 22px 48px; border-top:1px solid var(--line);
    display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center; justify-content:space-between;
    font-size:13px; color:var(--faint); }
  footer .links { display:flex; gap:12px; align-items:center; }
  footer a { color:var(--muted); border:none; }
  footer .sep { color:var(--line); }
</style>
</head>
<body>
  <header class="wm">
    <a class="wordmark" href="/"><span class="mark">/</span>divvy</a>
  </header>
  <main>
    <h1>${esc(o.title)}</h1>
    ${o.updated ? `<p class="updated">last updated: ${esc(LAST_UPDATED)}</p>` : ""}
    ${o.body}
  </main>
  <footer>
    <div class="links">
      <a href="/terms">terms</a><span class="sep">·</span>
      <a href="/privacy">privacy</a><span class="sep">·</span>
      <a href="/support">support</a>
    </div>
    <span>© 2026 Divvy · <a href="/">back to divvy</a></span>
  </footer>
</body>
</html>`;
}

// ---- Terms of Service ------------------------------------------------------

function termsBody(): string {
  return `
    <p class="lede">these are the rules for using Divvy. by using the app you agree to them. we've kept the language plain, but this is still a binding agreement.</p>

    <div class="card mint">
      <h2>the short version</h2>
      <ul>
        <li>Divvy is a <strong>tool for splitting bills</strong> and settling up in USDC, a digital dollar. it is <strong>not a bank, money transmitter, or custodian</strong>.</li>
        <li><strong>you control your own wallet and keys.</strong> Divvy never holds your funds or your keys, and we can't move, freeze, or reverse your money.</li>
        <li>settlements happen on the <strong>Solana</strong> blockchain and are <strong>irreversible</strong> — double-check who and how much before you send.</li>
        <li>adding or cashing out dollars is handled by a <strong>licensed payment partner</strong> under their own terms.</li>
      </ul>
    </div>

    <h2><span class="num">01</span>what Divvy is (and isn't)</h2>
    <p>Divvy is a <strong>software tool</strong> that helps you split bills with friends and settle up. Settlement uses <strong>USDC — a digital dollar</strong> (a US-dollar-backed stablecoin) on the <strong>Solana</strong> network. For your convenience we present amounts in plain dollars.</p>
    <div class="card warn">
      <p style="margin:0;"><strong>Divvy is non-custodial.</strong> we are <strong>not a bank, money services business, money transmitter, broker, exchange, or custodian</strong>. we do not hold, control, or have access to your funds or your private keys. your USDC lives in a wallet <strong>you</strong> control. every settlement moves directly between users' wallets on the public Solana blockchain — Divvy only helps you calculate splits and initiate transfers that <strong>you</strong> authorize.</p>
    </div>

    <h2><span class="num">02</span>eligibility</h2>
    <p>you must be at least <strong>18 years old</strong> and legally able to enter into this agreement to use Divvy to move funds. by using the app you represent that you meet these requirements. our payment partner may impose additional eligibility and identity-verification requirements.</p>

    <h2><span class="num">03</span>on-chain transactions are final</h2>
    <p>blockchain transactions are <strong>final and cannot be undone, reversed, or refunded</strong> by Divvy or anyone else. you are solely responsible for confirming the <strong>correct recipient</strong>, the <strong>correct amount</strong>, and the <strong>correct network</strong> before you send. if you send to the wrong address or in the wrong amount, we cannot recover it.</p>

    <h2><span class="num">04</span>fees</h2>
    <p>splitting bills and tracking who owes what is free. two kinds of fees can apply when money actually moves:</p>
    <ul>
      <li><strong>network fees.</strong> settling on Solana costs a tiny network fee — typically a fraction of a cent — paid to the network, not to Divvy.</li>
      <li><strong>card / cash-out fees.</strong> when you add dollars with a card or cash out to a card or bank, that is handled by our payment partner <strong>MoonPay</strong>, who charges their own fee. that fee is shown to you before you confirm, and is collected by them, not by Divvy.</li>
    </ul>

    <h2><span class="num">05</span>adding &amp; cashing out dollars</h2>
    <p>to convert between US dollars and USDC, Divvy connects you to a <strong>licensed third-party partner (MoonPay)</strong>. that service is provided <strong>by them, not by Divvy</strong>, and is subject to <strong>their own terms, privacy policy, fees, limits, and identity-verification (KYC) requirements</strong>. Divvy is not a party to those transactions. any dispute about a purchase or payout is between you and the partner who processed it.</p>

    <h2><span class="num">06</span>no financial, legal, or tax advice</h2>
    <p>Divvy does not provide financial, investment, legal, accounting, or tax advice. digital dollars and other crypto assets carry risk, including the risk that a stablecoin may not hold its value. you are responsible for understanding the tax and legal consequences of your transactions. consult a professional if you're unsure.</p>

    <h2><span class="num">07</span>acceptable use</h2>
    <p>you agree <strong>not</strong> to use Divvy to:</p>
    <ul>
      <li>break any law, or facilitate money laundering, terrorist financing, fraud, or sanctions evasion;</li>
      <li>infringe anyone's rights, or send unlawful, abusive, or harassing content;</li>
      <li>access accounts or data that aren't yours, or attempt to breach security;</li>
      <li>reverse-engineer, scrape, overload, or interfere with the app or its infrastructure;</li>
      <li>use the app on behalf of someone else without authorization, or misrepresent who you are.</li>
    </ul>
    <p>we may suspend or terminate access that violates these Terms. because Divvy is non-custodial, suspending your Divvy account does <strong>not</strong> affect your ownership of the funds in your wallet.</p>

    <h2><span class="num">08</span>your account &amp; responsibilities</h2>
    <p>you are responsible for your login credentials, your device, and all activity under your account. because you control your own keys, <strong>you are responsible for safeguarding access to your wallet</strong>. if you lose access to your login and recovery methods, you may permanently lose access to your funds, and we may be unable to help you recover them.</p>

    <h2><span class="num">09</span>disclaimer of warranties</h2>
    <p class="legal">THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE APP WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, OR THAT THE SOLANA NETWORK OR ANY THIRD-PARTY SERVICE WILL FUNCTION AS EXPECTED. YOU USE THE APP AT YOUR OWN RISK.</p>

    <h2><span class="num">10</span>limitation of liability</h2>
    <p class="legal">TO THE MAXIMUM EXTENT PERMITTED BY LAW, DIVVY AND ITS OFFICERS, EMPLOYEES, AND AGENTS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF FUNDS, PROFITS, DATA, OR GOODWILL, ARISING FROM OR RELATED TO YOUR USE OF THE APP, THE SOLANA NETWORK, OR ANY THIRD-PARTY SERVICE — INCLUDING LOSSES FROM IRREVERSIBLE TRANSACTIONS, LOST KEYS, OR STABLECOIN VALUE FLUCTUATIONS. TO THE EXTENT ANY LIABILITY IS NOT DISCLAIMED, OUR TOTAL LIABILITY WILL NOT EXCEED ONE HUNDRED US DOLLARS ($100). SOME JURISDICTIONS DO NOT ALLOW CERTAIN LIMITATIONS, SO SOME OF THE ABOVE MAY NOT APPLY TO YOU.</p>

    <h2><span class="num">11</span>indemnification</h2>
    <p class="legal">you agree to indemnify and hold harmless Divvy and its affiliates, officers, employees, and agents from any claims, losses, liabilities, and expenses (including reasonable attorneys' fees) arising out of your use of the app, your violation of these Terms, your violation of any law, or your infringement of any third party's rights.</p>

    <h2><span class="num">12</span>changes to these Terms</h2>
    <p>we may update these Terms from time to time. when we make material changes we'll update the "last updated" date and, where appropriate, notify you in the app. if you keep using Divvy after changes take effect, you accept the updated Terms.</p>

    <h2><span class="num">13</span>governing law</h2>
    <p>these Terms are governed by the laws of <strong>[YOUR JURISDICTION]</strong>, without regard to its conflict-of-laws rules. you agree to the exclusive jurisdiction of the courts located in <strong>[YOUR JURISDICTION]</strong> for any dispute not subject to arbitration, to the extent permitted by law.</p>
    <p class="legal"><strong>[YOUR JURISDICTION]</strong> is a placeholder — Divvy's counsel must set the governing jurisdiction and any dispute-resolution / arbitration terms before publishing.</p>

    <h2><span class="num">14</span>contact</h2>
    <p>questions about these Terms, or a dispute? reach us at:</p>
    <p class="contact"><a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a></p>
  `;
}

// ---- Privacy Policy --------------------------------------------------------

function privacyBody(): string {
  return `
    <p class="lede">Divvy helps you split bills with friends and settle up in seconds. this page explains, in plain English, what we collect, what we don't, and what you can do about it.</p>

    <div class="card mint">
      <h2>the short version</h2>
      <ul>
        <li>Divvy is <strong>non-custodial</strong> — you hold your own keys, and we never hold your money or your private keys.</li>
        <li>we collect only what we need to run the app: your login identity, your wallet's public address, and the bills and groups you create.</li>
        <li>we <strong>don't</strong> upload your contacts, track you across other apps, or sell your data.</li>
        <li>adding or cashing out dollars goes through our <strong>licensed payment partner (MoonPay)</strong>, who handles card details and identity checks under their own policy.</li>
      </ul>
    </div>

    <h2><span class="num">01</span>who we are</h2>
    <p>Divvy ("Divvy," "we," "us") provides a bill-splitting app that lets you divide expenses with friends and settle up in <strong>USDC, a digital dollar</strong> (a US-dollar-backed stablecoin), on the Solana network. we present balances in plain dollars, but under the hood transfers move USDC between wallets <strong>you</strong> control. questions? email <a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a>.</p>

    <h2><span class="num">02</span>what we collect</h2>
    <ul>
      <li><strong>account &amp; login info.</strong> when you sign in, our login provider <strong>Privy</strong> handles authentication. depending on how you log in this may include your <strong>email address, phone number, or an OAuth identifier</strong> (for example a Google or Apple sign-in). this is how we know it's you.</li>
      <li><strong>wallet public address.</strong> we store your wallet's <strong>public address</strong> so we can show your balance and route payments. a public address is like an account number others can send to — it is not a password and not your private key.</li>
      <li><strong>bill &amp; settlement data.</strong> the expenses, groups, splits, amounts, notes, who-owes-whom, and settlement records you create in the app.</li>
      <li><strong>anonymized telemetry.</strong> to fix bugs and understand which features get used, the app sends a small stream of error and usage events. by design this data carries <strong>no amounts, no wallet addresses, and no personal identity</strong>: your user id is never stored — only a one-way hashed fingerprint of it — and free-text fields are scrubbed of wallet-like strings before storage. telemetry is kept for <strong>14 days</strong>, then automatically deleted.</li>
    </ul>

    <h2><span class="num">03</span>what we do <em>not</em> collect or hold</h2>
    <ul>
      <li><strong>your private keys.</strong> Divvy is non-custodial. your keys live in your wallet, controlled by you. we cannot see them, move your funds, or transact on your behalf.</li>
      <li><strong>your money.</strong> we never take custody of your funds. balances move directly between wallets on-chain.</li>
      <li><strong>your contacts.</strong> Divvy does not upload or read your phone or email contacts.</li>
      <li><strong>ad-tracking / cross-app tracking.</strong> we do not use advertising trackers and we do not track you across other companies' apps or websites.</li>
      <li><strong>card numbers or bank details.</strong> when you add cash or cash out, <strong>MoonPay</strong> processes the payment and collects any card / bank and identity (KYC) information directly under their own policy. Divvy does not receive or store your full card number or bank credentials.</li>
    </ul>
    <p>and we <strong>do not sell</strong> your personal information.</p>

    <h2><span class="num">04</span>how we use your data</h2>
    <ul>
      <li>to create your account and keep you signed in;</li>
      <li>to calculate splits, show balances, and route settlements between wallets;</li>
      <li>to let group members see shared bills and who has paid;</li>
      <li>to detect abuse, keep the service secure, and prevent fraud;</li>
      <li>to fix bugs, measure performance, and improve features (via the anonymized telemetry above);</li>
      <li>to respond to your support requests.</li>
    </ul>

    <h2><span class="num">05</span>who processes data for us</h2>
    <p>we rely on a small set of service providers to run Divvy:</p>
    <ul>
      <li><strong>Privy</strong> — authentication and embedded-wallet infrastructure (your email / phone / OAuth login).</li>
      <li><strong>MoonPay</strong> — our licensed fiat on-ramp / off-ramp partner. when you buy or sell USDC with dollars, they process the transaction and perform identity verification (KYC) under their own policy.</li>
      <li><strong>Supabase</strong> — database hosting for your account and bill data.</li>
      <li><strong>Railway</strong> — application hosting / infrastructure.</li>
      <li><strong>Apple</strong> — App Store distribution and, if you enable them, push notifications.</li>
      <li><strong>the Solana public blockchain</strong> — the network your USDC settlements run on.</li>
    </ul>
    <div class="card">
      <p style="margin:0;"><strong>on-chain data is public and permanent.</strong> any transaction you make settles on Solana, a <strong>public blockchain</strong>. wallet addresses, amounts, and timestamps are visible to anyone and generally <strong>cannot be edited or deleted</strong>. deleting your Divvy account does not, and cannot, erase transactions already on-chain.</p>
    </div>

    <h2><span class="num">06</span>data retention</h2>
    <p>we keep your <strong>account and bill data until you delete your account</strong> (and briefly afterward where needed to meet legal, security, and dispute-resolution obligations). <strong>anonymized telemetry is kept for 14 days</strong> and then deleted automatically. on-chain transaction data lives on the public blockchain permanently and is outside our control.</p>

    <h2><span class="num">07</span>deleting your account</h2>
    <p>you can <strong>delete your account from inside the app</strong> at any time — open the <strong>you</strong> screen and tap <strong>delete account</strong> (this calls our <span class="contact">DELETE /api/me</span> endpoint). that permanently removes your login and off-chain profile / account data. because Divvy is non-custodial, your wallet and any USDC in it stay yours — deletion only unlinks the Divvy account. you can also email <a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a> for help. (on-chain records cannot be deleted — see above.)</p>

    <h2><span class="num">08</span>your rights &amp; choices</h2>
    <p>depending on where you live (for example California or the EU / UK), you may have the right to access, correct, delete, or export the personal data we hold about you. you can delete your account and export your history (settings → export my history) directly in the app, or contact us and we'll help. we won't discriminate against you for exercising your rights.</p>

    <h2><span class="num">09</span>children</h2>
    <p>Divvy is not directed to children, and moving real funds requires you to be <strong>18+</strong> (see our Terms). we do not knowingly collect data from children. if you believe a child has given us personal information, email <a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a> and we'll delete it.</p>

    <h2><span class="num">10</span>security</h2>
    <p>we use industry-standard measures — encryption in transit, access controls, and reputable infrastructure providers — to protect your data. your wallet keys are secured by your wallet provider and controlled by you. no system is perfectly secure, so please protect your login and your device.</p>

    <h2><span class="num">11</span>changes to this policy</h2>
    <p>we may update this policy as the app evolves. when we make meaningful changes we'll update the "last updated" date above and, where appropriate, notify you in the app.</p>

    <h2><span class="num">12</span>contact</h2>
    <p class="contact"><a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a></p>
  `;
}

// ---- Support ---------------------------------------------------------------

function faq(q: string, a: string): string {
  return `<div style="margin:0 0 4px;"><h3 style="margin:16px 0 4px;">${q}</h3><p style="margin:0 0 4px;">${a}</p></div>`;
}

function supportBody(): string {
  return `
    <p class="lede">need a hand? here are the quick answers — and a real person is one email away.</p>

    <div class="card">
      <h2>where's my money?</h2>
      <p style="margin:0;">your money lives in <strong>your own wallet</strong>, not with Divvy. every balance is <strong>USDC — a digital dollar</strong> — sitting in a wallet only you control. Divvy never holds your funds or your keys; we just do the math and help you send. you can spend it with any card, cash out to your bank, or send it to a friend, any time.</p>
    </div>

    <h2>frequently asked</h2>
    ${faq("where does my money live?",
      "in your own wallet — never with Divvy. we're non-custodial, which means we never hold your funds or your keys. your balance is USDC, a digital dollar, and only you can move it.")}
    ${faq("how do i get paid?",
      "when a friend settles up, the money lands straight in your wallet on Solana, usually within seconds. your balance on the <strong>you</strong> screen updates automatically. cash out to your bank or card whenever you like.")}
    ${faq("what does it cost?",
      "splitting and settling is free. the Solana network fee is a fraction of a cent. if you add or cash out money with a card, our payment partner MoonPay charges a small fee that's shown before you confirm.")}
    ${faq("is this a bank?",
      "no. Divvy isn't a bank and doesn't hold your money. it's a tool for splitting bills and settling up in USDC, a digital dollar, that stays in your own wallet the whole time.")}
    ${faq("how do i delete my account?",
      "open the <strong>you</strong> screen and tap <strong>delete account</strong> at the bottom. that removes your login and profile. your wallet and any money in it stay yours — deletion only unlinks the Divvy account.")}
    ${faq("what is USDC?",
      "USDC is a digital dollar — one USDC is always meant to be worth one US dollar. it moves on the Solana network, which is why settling up is fast and nearly free.")}

    <div class="card mint">
      <h2>still stuck?</h2>
      <p style="margin:0;">email us and we'll get back to you. tell us what happened and, if you can, the group or expense involved.</p>
      <p class="contact" style="margin:12px 0 0;"><a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a></p>
    </div>

    <p style="margin-top:20px;">see also our <a href="/terms">terms of service</a> and <a href="/privacy">privacy policy</a>.</p>
  `;
}

// ---- Router ----------------------------------------------------------------

export const legalRouter = Router();

legalRouter.get("/terms", (req: Request, res: Response) => {
  res.type("html").send(
    layout({
      title: "terms of service",
      metaDescription: "The rules for using Divvy — plain-English terms for splitting bills and settling in USDC on Solana.",
      canonical: `${publicOrigin(req)}/terms`,
      updated: true,
      body: termsBody(),
    })
  );
});

legalRouter.get("/privacy", (req: Request, res: Response) => {
  res.type("html").send(
    layout({
      title: "privacy policy",
      metaDescription: "How Divvy handles your data — what we collect, what we don't, and how to delete your account.",
      canonical: `${publicOrigin(req)}/privacy`,
      updated: true,
      body: privacyBody(),
    })
  );
});

legalRouter.get("/support", (req: Request, res: Response) => {
  res.type("html").send(
    layout({
      title: "help & support",
      metaDescription: "Divvy help — where your money lives, how to get paid, fees, and how to reach support.",
      canonical: `${publicOrigin(req)}/support`,
      body: supportBody(),
    })
  );
});
