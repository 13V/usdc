/**
 * headers.ts — baseline HTTP security headers + a pragmatic Content-Security-Policy.
 *
 * Applied as the first middleware so every response (pages, API JSON, static
 * assets) carries the hardening headers. Two audiences:
 *
 *  1. First-party surface (landing, /pay pages, /memes, the SPA shell, static
 *     JS/CSS) — gets an ENFORCED CSP. It's permissive where it must be (inline
 *     styles are used everywhere; the /pay page injects an inline data <script>,
 *     so 'unsafe-inline' is required) but meaningful where it counts:
 *       - default-src 'self'  → no third-party script/style/font/etc. by default
 *       - connect-src 'self'  → the client only ever calls same-origin /api/*
 *                               (the mainnet RPC + Privy calls live in /embedded)
 *       - object-src 'none', base-uri 'self', frame-ancestors 'none',
 *         form-action 'self' → shut down plugin/base-tag/clickjack/exfil vectors
 *       - img-src adds the QR-code image host the client renders <img> from
 *
 *  2. The /embedded surface hosts the VENDORED Privy + Reown/WalletConnect wallet
 *     stack. It legitimately connects to many third-party origins (privy.io,
 *     WalletConnect relays over wss, RPC endpoints, wallet-logo CDNs) and frames
 *     privy.io for the embedded-wallet iframe. A first-party default-src 'self'
 *     CSP would break sign-in and settlement. So /embedded ships the baseline
 *     headers (nosniff, DENY framing, referrer, permissions) WITHOUT an enforced
 *     CSP — its safety rests on Privy's own hardening and the fact that it hosts
 *     no first-party user-generated content. This carve-out is deliberate; see
 *     SECURITY-SWEEP.md.
 *
 * Framing: the SPA never iframes /embedded (it navigates to it via
 * window.location / window.open), and MoonPay opens in a new tab — so
 * X-Frame-Options: DENY (and frame-ancestors 'none') is safe everywhere and
 * gives clickjacking protection for the whole app, including /embedded.
 */

import { Request, Response, NextFunction } from "express";

// Image host the client renders QR codes from (see public/app.js, settle.js).
const QR_IMG_HOST = "https://api.qrserver.com";

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `img-src 'self' data: blob: ${QR_IMG_HOST}`,
  // Inline styles are used pervasively across the SPA and server-rendered pages.
  "style-src 'self' 'unsafe-inline'",
  // The /pay page injects an inline <script>window.__PAY__=…</script> data island
  // (safely serialized — see jsonForScript in server.ts), and index.html registers
  // the service worker inline. 'unsafe-inline' is therefore required; the JSON
  // data island is XSS-hardened at the source rather than relying on CSP here.
  "script-src 'self' 'unsafe-inline'",
  // The client only talks to same-origin /api/*. External hosts (RPC, Privy) are
  // reached exclusively from the /embedded bundle, which is CSP-exempt above.
  "connect-src 'self'",
  "frame-src 'self'",
].join("; ");

/**
 * Set baseline security headers on every response, plus the enforced CSP on all
 * routes except /embedded. Registered before route handlers so it can't be
 * skipped; individual handlers may still add their own headers (e.g. caching).
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Minimal Permissions-Policy: deny geolocation + microphone outright; allow
  // camera only same-origin (wallet QR-scan flows on /embedded may request it —
  // the first-party app itself uses a plain file input, no camera API).
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  if (!req.path.startsWith("/embedded")) {
    res.setHeader("Content-Security-Policy", CSP);
  }
  next();
}
