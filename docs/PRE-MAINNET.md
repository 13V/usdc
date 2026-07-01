# Pre-mainnet hardening & checklist

Divvy currently runs on **Solana devnet** with **test-USDC** (freely minted, no
real value). Nothing in this app should touch real money until the items below
are closed. This file tracks that state honestly — it is not a claim that the
app is "safe"; it is the list of what must be true before it can be.

## Status of the 5 pre-mainnet items

| # | Item | Status |
|---|------|--------|
| 1 | Third-party security audit | ❌ Not done — **required** before mainnet. An internal adversarial audit ran (findings below) but a third-party audit is still mandatory. |
| 2 | Payment-verification hardening | ✅ Cross-context double-credit closed (global, fail-closed consumed-signature store). Per-instruction reference binding deferred (now defense-in-depth only — see below). |
| 3 | RPC key out of the client bundle | ✅ Done — client uses the same-origin `/api/rpc` proxy; key lives in `RPC_URL` server-side |
| 4 | Custody / recovery | ✅ Backup (key export) + recovery-password UI shipped; two policy/config decisions remain (below) |
| 5 | Monitoring + rate limits on money endpoints | ✅ Per-IP caps + structured `money` audit log + **alerting** (`src/alerts.ts`: signature-reuse-blocked, verify-failure spike, fund-volume → `ALERT_WEBHOOK_URL`) |

## 2. Payment verification — what's in place

`src/verify.ts` + the two verify loops (`/api/bills/:id/verify`,
`/api/trips/:id/settle/verify`):

- A payment is marked PAID only when an on-chain transfer matches **token mint +
  exact amount + collector ATA** at **finalized** commitment.
- **Signature uniqueness**: one on-chain signature can settle **at most one**
  share (across a verify pass and across repeated calls, via the persisted
  signature). This closes the multi-credit vector — a single transfer can't mark
  several equal-amount participants paid.
- **Reference binding**: the matched transaction must carry the participant's
  reference pubkey in its account keys.
- **Zero-amount guard**: a 0-base-unit transfer never counts as proof.

**CLOSED — cross-context signature reuse:** a **global** consumed-signature
store (`src/consumedSignatures.ts`, `consumed_signatures` table) now ensures one
on-chain signature settles **at most one share system-wide**, across all
bills/trips — wired into both verify loops (`claimSignature` before any credit).
As of the hardening pass it is **fail-CLOSED**: if the store is unreachable we do
NOT credit and fire a `critical` alert (a transient blip just defers the share to
the next verify poll; a sustained outage freezes settlement loudly instead of
silently opening a double-credit window). `CONSUMED_SIG_FAIL_OPEN=1` is a
documented operator escape hatch (availability over safety) for emergencies only.

**Deferred — per-instruction reference binding (now defense-in-depth only):**
binding the reference to the *specific* transfer instruction (not just the
transaction) requires a second raw `getTransaction` + account-index correlation
(the parsed form drops the appended reference key), and must be validated against
live on-chain fixtures — rushing it risks false negatives that strand real
payments. With the fail-closed global guard above, one signature already settles
exactly one share, so the "one transfer carrying many references" vector is fully
closed; per-instruction binding would only harden an already-closed path.

## 4. Custody / recovery — decision required

**Current model:** Privy embedded Solana wallets, self-custodial, auto-created on
login (`createOnLogin: "users-without-wallets"`). Auth methods: email, Google,
Apple, SMS. There is **no seed phrase** the user manages; key material is held by
Privy's infrastructure and reconstructed when the user re-authenticates.

**Implication:** account recovery == regaining access to the login method
(email/phone/OAuth). If a user permanently loses that, recovery depends entirely
on Privy. There is currently **no user-held backup** and **no key export**.

**Shipped (`web/src/Wallet.tsx`, reached from you → "wallet & recovery"):**
- **Key export** — Privy `exportWallet`, so users can back up and move the wallet
  outside Divvy. *(Requires "allow export" enabled in the Privy dashboard — if it
  errors, that toggle is off.)*
- **Recovery password** — Privy `setWalletRecovery`, a user-controlled factor so a
  user can recover even if they lose their login method.

**Decisions still required:**
1. Enable **key export** in the Privy dashboard (otherwise the export button
   errors gracefully).
2. Decide whether a recovery factor is **optional or required** (currently
   offered, not enforced) — enforcing it at onboarding is stronger self-custody.
3. Write the **"I lost my login" support path** explicitly.
4. Confirm Privy's custody terms are acceptable for the amounts you'll allow.

## Money rails (on/off-ramp)

**Wired (`src/onramp.ts`, `src/offramp.ts`, routes in `src/server.ts`):**
- **On-ramp** — fund your own balance with a card / Apple Pay:
  `GET /api/me/onramp/:amountCents` (requireAuth). Builds MoonPay buy + Coinbase
  Onramp widget URLs to the signed-in user's primary wallet.
- **Off-ramp** — cash out (sell USDC → card/bank):
  `GET /api/me/offramp/:amountCents` (requireAuth). Builds MoonPay sell +
  Coinbase Offramp widget URLs from the signed-in user's primary wallet.
- Both responses include `live: <bool>` (`ramsConfigured()`) so the client can
  tell **test mode** from real.

**Test-mode until keys + mainnet are set.** With placeholder keys (the default),
the widget URLs are correctly shaped but **will not actually charge or pay out** —
they're shaped, not live. Set `MOONPAY_API_KEY`, `MOONPAY_SECRET_KEY`, and/or
`COINBASE_ONRAMP_APP_ID` to go live.

- **MoonPay URLs must be HMAC-signed** with `MOONPAY_SECRET_KEY` (buy and sell);
  unsigned URLs are rejected in production. Without the secret the signer returns
  the URL unsigned (test mode only).
- **Mainnet cutover is required to go live.** The providers only ever
  deliver/sell **real mainnet USDC** — devnet test-USDC is not supported by
  MoonPay/Coinbase. So a working on/off-ramp implies real money, which gates it
  behind the full mainnet move (and everything else in this checklist).

## Internal security audit — findings & disposition

An adversarial audit of the money / settlement / auth path was run. Disposition:

**Fixed in the hardening pass:**
- **`claimSignature` fail-open → fail-closed** (was the keystone defect: any
  store error silently re-opened cross-context double-credit). Now fail-closed +
  `critical` alert; escape hatch documented above.
- **Privy login trusted a client-supplied wallet** (`/api/auth/privy/verify`):
  `body.wallet` became the account's PRIMARY wallet with no proof of ownership —
  letting an attacker bind an arbitrary/victim wallet and inherit its
  collector-binding, incoming-tab matching, and receipt access. Fixed: the wallet
  is now taken only from Privy's **authoritative** user API (`fetchPrivyWallets`,
  app-secret auth); a client-claimed wallet must be in that confirmed set or it is
  ignored (and logged). **Requires `PRIVY_APP_SECRET`** to link embedded wallets
  when Privy is enabled server-side (fails safe to "no wallet linked" without it).
  Note: the Privy route is currently inert (no server-side `PRIVY_APP_ID`), so this
  was a latent trap, not a live exploit.
- **Faucet per-user cap**: `/api/me/fund` was IP-rate-limited only; added a
  per-`userId` cap (5/min) so one account can't rotate IPs to drain the devnet
  treasury. (Devnet-only route; still mainnet-disabled by the `CLUSTER` gate.)
- **Trip settle-up payout reroute (closed)**: a share-link holder could
  `POST …/members/:mid/claim` an **unclaimed creditor slot** and overwrite its
  payout wallet, redirecting that creditor's settle-up to themselves. Now claiming
  a slot that has **paid for any expense** (a net creditor) requires the trip
  owner (or the same user re-claiming) — others get 403 and the owner assigns the
  wallet via `PATCH …/members/:mid`. Debtor/even slots stay freely self-claimable,
  so the "claim your spot" flow is intact. (Verified with an end-to-end test:
  attacker→creditor 403, attacker→debtor 200, owner→creditor 200.)

- **Trip expense edit/delete authz (closed)**: editing/deleting an expense
  rewrites the ledger (can erase a debt). Now gated to the trip owner or the
  person who fronted that expense (the payer slot's claimer); anonymous/ownerless
  trips keep the open behavior. Adding expenses stays collaborative. (Verified:
  token-only attacker delete → 403, owner delete → 200.)
- **`/api/rpc` write throttle (partially closed)**: `sendTransaction` now has a
  tight per-IP cap (~20/min) separate from reads, cutting the broadcast-relay /
  quota-sink abuse. Full fix (a session requirement on write methods) still wants
  the embedded `Connection` to attach a Bearer — a client change — so it's noted
  below, not yet done.
- **Per-transaction rail cap**: on/off-ramp amounts are now capped at
  `RAIL_MAX_CENTS` ($2,000 default) instead of the $1M ledger cap.
- **Mainnet readiness boot check**: the server now refuses to start on
  `mainnet-beta` in an unsafe/half-configured state (missing RPC_URL /
  SESSION_SECRET / COLLECTOR_WALLET, faucet still present, fail-open enabled,
  or SQLite backend — mainnet requires Supabase since Railway's disk is
  ephemeral) — so going live is a deliberate flag-flip, not a silent slide.
- **Server-pinned cluster**: bill/trip creation now ignores any client-supplied
  `cluster` and always uses the server's `CLUSTER` env — clients can't point
  payers at a different network (or inject an arbitrary string that breaks
  pay-URL building).
- **Session revocation on account deletion**: session tokens are stateless HMAC
  (30-day TTL), so deletion now also kills outstanding tokens — auth requires the
  user row to still exist (positive-cached, one DB hit per user per process;
  fails open on store errors so an outage delays revocation rather than signing
  everyone out).
- **Nudge delivery is relationship-gated**: a nudge only resolves/delivers when
  the target is a friend or shares a trip with the sender; unrelated targets are
  recorded by name with `sent:false` — indistinguishable from "not a user", so
  the endpoint can't be used to enumerate accounts or push-spam strangers.
- **Bill input caps**: `POST /api/bills` now enforces the same caps as trips
  (max 50 participants, name ≤ 80 chars, title ≤ 120 chars) so hostile payloads
  can't create megabyte bills or thousand-share splits.

**Open — must fix before mainnet (documented, not yet patched to avoid breaking
working flows without proper design):**
- **`/api/rpc` write methods are still unauthenticated** (now throttled). Full
  fix: require a session for `sendTransaction`/`simulateTransaction` (needs the
  embedded `Connection` to attach the Bearer — a client change) and/or per-user
  quotas.
- **`/api/bills/:id/verify` has no resource-level authz** — any signed-in user can
  drive verification on any bill. It can't fabricate payments (only real validated
  transfers flip shares) and the bill is already public, so impact is RPC spend.
  Fix: scope to the bill creator/collector or a participant.

**Verified OK (no action):** SIWS nonce is single-use/consumed-before-verify (no
replay); session tokens use constant-time HMAC + exp; zero/negative amounts are
guarded everywhere including `validatePayment`; recipient/mint/amount binding via
the collector ATA is sound (funds can't be redirected); money math is integer
cents with BigInt base units; claim-vs-credit ordering has no TOCTOU; RPC has no
SSRF and a 20-call batch cap; on/off-ramp URLs validate wallet+amount.

## Also before mainnet

- **Rotate** any RPC/keys that ever shipped in a client bundle (the prior
  devnet Helius key was bundled before #3; treat it as exposed and rotate when
  moving to a paid mainnet RPC).
- Move `RPC_URL` to a **mainnet** paid RPC; keep it server-side (already proxied).
- Set hard **per-user amount caps** and review the rate limits under real load.
- Replace the devnet **funding faucet** (`/api/me/fund`, `src/funding.ts`) — it
  mints test-USDC and must be removed/disabled on mainnet.
- Add alerting on the `money` audit log (failed verifies, unusual volume).
