# Divvy — Pre-Public Security Sweep

Adversarial final pass before the X launch, focused on what public traffic + CT
attackers will poke. Scope: client bundle secrets, HTTP security headers + CSP,
ID/token entropy, authz spot-checks, dependency audit, DoS surface, error hygiene.

**Date:** 2026-07-03 · **Verification:** `tsc --noEmit` clean · `npm test` 52+11+split
green (14 new security assertions) · `npm run test:e2e` PASS · headless CSP walk
**zero violations** across landing / demo sign-in+walk / memes / guest pay / embedded.

---

## Findings table

| # | Area | Severity | Finding | Status |
|---|------|----------|---------|--------|
| 1 | Pay page | **High** | `<script>window.__PAY__=${JSON.stringify(payData)}` embedded user-controlled bill `title`/`name`; `JSON.stringify` does not escape `<`/`>`, so a title containing `</script>` breaks out of the script element → stored XSS on a public shareable page. CSP `unsafe-inline` would NOT block it. | **Fixed** |
| 2 | HTTP headers | Medium | No security response headers (no nosniff, framing, CSP, referrer, permissions). | **Fixed** |
| 3 | Error hygiene | Low | Final error middleware returned raw `err.message` on unexpected 500s (potential internal detail leak). Stack was already not leaked. | **Fixed** |
| 4 | Client secrets | — | Full scan of `public/` incl. vendored `public/embedded/assets/`: no `sk_`, service-role keys, private-key blocks, bearer tokens, or `.env` values. Only public identifiers exposed (see below). | **Clean** |
| 5 | ID / token entropy | — | No `Math.random` anywhere in `src/`. All ids `crypto.randomUUID()`; share tokens `crypto.randomBytes(8)`; nonces/sessions `randomBytes(16/32)`. | **Clean** |
| 6 | Trip authz | — | Read/patch/claim/delete spot-checks all safe (see below). Capability-link model is intentional and token-gated behind unguessable UUIDs. | **Clean (tests added)** |
| 7 | DoS: input caps | — | chat text ≤2000, image ≤1.5MB; telemetry name≤80/detail≤600/url≤200/batch≤20; bill+trip member/title caps. All server-side. | **Clean** |
| 8 | DoS: gzip buffering | Low | New gzip middleware buffers the full response body in memory before compressing. | **Documented** (bounded; see below) |
| 9 | npm audit (prod) | High×6 | 0 critical, 6 high, 21 moderate, 8 low — all require **major** bumps; all in the client wallet-build tree. | **Documented / deferred** |

---

## 1. Client bundle secrets scan (Clean)

Scanned every file under `public/` including the vendored Privy/Reown/WalletConnect
bundles in `public/embedded/assets/`. Checked `.env` **key names only** (values
never read/printed).

**Nothing sensitive exposed.** The only client-visible values are legitimately public:

- MoonPay **publishable** keys `pk_live_…` / `pk_test_…` (in `index-BtCUSfYQ.js`) — publishable by design.
- WalletConnect/Reown **projectId** `34357d3c…` — a public client identifier.
- Privy **app id** (public client identifier; the real secret `PRIVY_APP_SECRET` stays server-side).
- The 64-hex constants in the bundle are secp256k1/ed25519 **curve constants**, not secrets.

No `sk_live/test`, no `SUPABASE_SERVICE_ROLE_KEY`, no `MOONPAY_SECRET_KEY`, no
`MINT_AUTHORITY_SECRET`, no `VAPID_PRIVATE_KEY`, no PEM private-key blocks, no
hardcoded bearer tokens. `.env` is git-ignored.

## 2. HTTP response headers + CSP (Fixed — `src/headers.ts`)

New `securityHeaders` middleware, registered first. On **every** response:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), microphone=(), geolocation=()
```

`X-Frame-Options: DENY` is safe app-wide: the SPA never iframes `/embedded` (it
navigates via `window.location`/`window.open`) and MoonPay opens in a new tab.

**Enforced CSP shipped (first-party surface — everything except `/embedded`):**

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none';
form-action 'self'; img-src 'self' data: blob: https://api.qrserver.com;
style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';
connect-src 'self'; frame-src 'self'
```

- `style-src 'unsafe-inline'` — inline styles are used pervasively; unavoidable.
- `script-src 'unsafe-inline'` — the `/pay` page injects an inline `window.__PAY__`
  data island and `index.html` registers the SW inline. The data island is
  XSS-hardened at the source (finding #1) rather than relying on CSP.
- `img-src` adds `https://api.qrserver.com` (client renders `<img>` QR codes) + `data:`/`blob:` (canvas memes, inline SVG frogs).
- `connect-src 'self'` — verified the first-party client only ever `fetch`es
  same-origin `/api/*`. External hosts (mainnet RPC, solscan, MoonPay) are only
  reached via `window.open` navigations (not governed by connect-src) or from the
  `/embedded` bundle.

**`/embedded` is intentionally CSP-exempt.** It hosts the vendored Privy +
Reown/WalletConnect stack, which connects to many third-party origins (privy.io,
WalletConnect wss relays, RPC, wallet-logo CDNs) and frames privy.io for the
embedded wallet. A first-party `default-src 'self'` CSP would break sign-in and
settlement. It still carries the baseline headers (nosniff, DENY framing,
referrer, permissions); its safety rests on Privy's own hardening and the fact
that it hosts no first-party user-generated content.

**Proof:** headless Chromium walk over `/` landing, demo sign-in + seeded trip
walk (home/group/settle/activity/friends/you/new), `/memes` generate+download,
guest `/pay/:id/:name`, and `/embedded/` shell — listening for
`securitypolicyviolation` events + CSP console errors → **0 first-party
violations, 0 embedded violations, 0 CSP console errors.**

## 3. Share-token + ID entropy (Clean)

`grep` for `Math.random` in `src/` → **none**. Every security-relevant identifier
uses Node `crypto`: bill/trip/member/expense/chat/referral/recurring ids =
`crypto.randomUUID()`; `shareToken` = `crypto.randomBytes(8)` (64-bit hex);
SIWS nonce = `randomBytes(16)`; session material = `randomBytes(32)` + HMAC. No fix needed.

## 4. Authz spot-checks (Clean — 5 new selftests)

Trips use a capability-link model: access requires the trip's `shareToken` OR an
owner/claimed-member session. Money-sensitive actions layer a session-identity
check on top of the token. IDs are unguessable UUIDv4.

| Attack | Result |
|--------|--------|
| B GET A's trip by raw id (no token/membership) | **403** — blocked (id-path requires authz; token-path is the intended shareable-by-link read) |
| B PATCH A's owned trip | **403** — `canAdminTrip` (owner/claimed-member only) |
| B read telemetry/admin | **404** — `/api/telemetry/recent` gated by `ADMIN_TOKEN`, hidden 404 when unset/wrong |
| B claim an already-claimed / creditor slot | **403** — creditor-slot guard + atomic `WHERE user_id IS NULL` claim |
| B DELETE A's expense | **403** — `canMutateExpense` (owner or payer-slot claimer) |

New assertions added to `src/security.selftest.ts` (headers, pay-XSS escaping,
foreign trip read/patch, telemetry admin gate). No real holes found.

## 5. Dependency audit — `npm audit --omit=dev`

**0 critical, 6 high, 21 moderate, 8 low.** No fixes applied — **all 6 highs
require major-version bumps** (`isSemVerMajor: true`), which HARD RULES forbid
overnight, and `npm audit fix` would pull in 46 new packages.

| Advisory | Package | Path | Runtime exposure | Fix |
|----------|---------|------|------------------|-----|
| ws: uninitialized memory disclosure + fragment DoS | `ws` | via `@privy-io/react-auth` → viem/walletconnect | **Client build only.** `ws` is Node-only and does not ship to the browser bundle (browser uses native WebSocket). Not in server runtime. | `@privy-io/react-auth` v3 (major) |
| Prototype pollution | `viem` | via `@privy-io/react-auth` | Client build only; not in server runtime. | `@privy-io/react-auth` v3 (major) |
| `bigint-buffer` toBigIntLE buffer overflow | `bigint-buffer` | `@solana/spl-token` → `@solana/buffer-layout-utils` | **Server runtime** (`verify.ts`, `funding.ts`). Only fed trusted/derived buffers (PDA derivation, transfer builders) — not attacker-supplied buffers. Low real-world reach. | `@solana/spl-token` 0.1.8 (breaking downgrade; no clean patch exists — bigint-buffer is unmaintained) |
| `@reown/appkit*` chain (moderate/high) | reown/walletconnect | via `@privy-io/react-auth` | Client build only; the `/embedded` bundle is already pre-built/vendored. | major |

**Recommendation (post-launch):** schedule the `@privy-io/react-auth` v3 upgrade
(clears ws/viem/reown) and evaluate an `overrides` pin for `bigint-buffer` on a
day with time to regression-test the settlement path. None are launch blockers.

## 6. DoS surface

- **12mb JSON body limit** is global; `POST /api/scan` (base64 receipt) is the
  only intentionally-large-body route — `requireAuth` + `scanRateLimit` (10/min/IP). Confirmed.
- **No unbounded-response endpoint:** no CSV/export/download server route (CSV
  export is client-side), list endpoints are owner-scoped and bounded by the
  member/participant input caps.
- **Length caps confirmed server-side:** chat text ≤2000 / image ≤1.5MB;
  telemetry name≤80 / detail≤600 / url≤200 / batch≤20.
- **gzip buffering (Documented, low):** the new gzip middleware buffers each
  response fully in memory before compressing. Acceptable because all response
  bodies are bounded (largest is the ~740KB static shell; API JSON is capped).
  *Future hardening:* stop buffering + passthrough once accumulated bytes exceed
  a cap (e.g. 5MB). Not required for launch.

## 7. Error hygiene (Fixed)

The final error middleware already logged the stack **server-side only** and never
sent it to clients. Tightened so an unexpected **500** now returns a generic
`{ error: "something went wrong" }` instead of the raw exception message (4xx
validation feedback and the controlled 502 "RPC unavailable" message are
preserved). `process.on('unhandledRejection'|'uncaughtException')` backstops keep
the server up.

---

## Deferred (with reasoning)

1. **6 high npm advisories** — all require major bumps (forbidden overnight); 5 of
   6 are client-build-only and not in the server runtime; the 1 runtime one
   (`bigint-buffer`) is only fed trusted buffers. Schedule `@privy-io/react-auth`
   v3 + `bigint-buffer` override post-launch.
2. **gzip full-body buffering** — bounded response sizes make this low-risk;
   add a buffer-size cap opportunistically.
3. **Unsalted telemetry userId hash** (`sha256(userId).slice(0,16)`) — exposes no
   cross-user data and is admin-token-gated to read; a salt would make the
   fingerprint non-guessable but is not launch-critical.

## Note for deploy

The fixes live in `src/` (`headers.ts` new, `server.ts`, `security.selftest.ts`).
Production runs `dist/src/server.js`; the deploy must **rebuild** (`tsc`) so the
new headers middleware + XSS fix ship. No new npm dependencies were added.
