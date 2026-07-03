# Divvy — beta launch runbook

The operational path from "code is ready" to "real users in the App Store." This
is a checklist + playbook, not a design doc. It references the deeper docs rather
than repeating them:

- Ramp / money rails config → `docs/MONEY-RAILS.md`
- Onboarding / auth (Privy, wallets) → `docs/ONBOARDING.md`
- Push (APNs / VAPID) → `docs/PUSH.md`
- Pre-mainnet hardening + the mainnet flip → `docs/PRE-MAINNET.md`
- Store submission detail → `docs/APP-STORE.md`, `docs/TESTFLIGHT-RUNBOOK.md`

Owner: @averseinc. Divvy is **non-custodial**, settles in **USDC on Solana**, and
is presented to users as plain **dollars**. KYC + fiat conversion live entirely
with the **licensed ramp partners (MoonPay / Coinbase)** — never with Divvy.

---

## Phase 0 — environment & config (before any real user)

Set these in the production environment (Railway) and redeploy. Full descriptions
live in `.env.example`; this is the go-live subset. Nothing here should be a
placeholder when a real user touches it.

**Money rails (see `docs/MONEY-RAILS.md`)**
- [ ] `MOONPAY_API_KEY` (publishable) + `MOONPAY_SECRET_KEY` (HMAC-signs buy/sell
      URLs — MoonPay requires the signature in production). Live keys, not test.
- [ ] `COINBASE_ONRAMP_APP_ID` if Coinbase Pay is offered as a second ramp.
- [ ] `COLLECTOR_WALLET` (mainnet), `RAIL_MAX_CENTS` (per-transaction cap, default
      $2,000), `RAILS_REQUIRE_LIVE=1` (refuse to boot on mainnet without ramp keys).

**Chain / infra**
- [ ] `CLUSTER` — leave `devnet` for the TestFlight beta; flip to `mainnet-beta`
      only per Phase 1's mainnet checklist.
- [ ] `RPC_URL` — a real (paid) RPC endpoint; the client uses the same-origin
      `/api/rpc` proxy, so the key never ships in the bundle.
- [ ] `SESSION_SECRET` — a strong random secret (sessions are stateless HMAC).
- [ ] `DATA_BACKEND=supabase` + `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` /
      `SUPABASE_DB_URL` — mainnet requires Supabase (Railway disk is ephemeral).
- [ ] `PUBLIC_ORIGIN` / production domain wired to the deploy; `/.well-known`
      association files return real values (deep links) once `APPLE_TEAM_ID` and
      `CAP_SERVER_URL` are set.

**Auth (Privy — see `docs/ONBOARDING.md`)**
- [ ] `PRIVY_APP_ID` + `PRIVY_APP_SECRET` (server-side; without the secret Privy
      logins link no wallet and fail safe). `VITE_PRIVY_APP_ID` at web-build time.
- [ ] In the Privy dashboard: allowed login methods (email / phone / OAuth),
      allowed origins = the production domain, embedded-wallet config, and the
      app's logo/name for the login modal.

**Push (see `docs/PUSH.md`)**
- [ ] `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` for web/PWA push.
- [ ] Native iOS: APNs auth key (`.p8`), `APPLE_TEAM_ID`, key id + bundle id wired
      into the native build (APNs JWT signing is covered in `docs/PUSH.md`).

**Telemetry & alerting (see `src/telemetry.ts`, `src/alerts.ts`)**
- [ ] `ADMIN_TOKEN` — gates `GET /api/telemetry/recent` (404 when unset). Set it;
      this is your daily error/funnel read-back.
- [ ] `SENTRY_DSN` / `POSTHOG_KEY` — optional forwarders; inert without them.
- [ ] `ALERT_WEBHOOK` + `ALERT_ERROR_THRESHOLD` (default 25) — the client
      **error-rate** pager: >N client errors in a rolling 10-min window fires ONE
      alert (60-min cooldown) as `{ text }` to a Slack/Discord webhook. Optionally
      `ALERT_PUSH_USER_ID` (the founder's user id) also gets a push.
- [ ] `ALERT_WEBHOOK_URL` — the separate **money-path** pager (signature reuse,
      verify-failure spikes, fund volume). Different concern, different env; set both.

Sanity: the server refuses to boot on `mainnet-beta` if any of RPC_URL /
SESSION_SECRET / COLLECTOR_WALLET is missing, the faucet is still on, fail-open is
enabled, or the backend is SQLite. Treat a boot failure as the checklist working.

---

## Phase 1 — TestFlight beta (10–30 friendlies)

Ship the Capacitor build to TestFlight (see `docs/TESTFLIGHT-RUNBOOK.md` /
`docs/TESTFLIGHT-NO-MAC.md`). Start on **devnet with test-USDC** — real UX, zero
real-money risk — while you watch the funnel and error rate before flipping.

**Watch daily**
- **Top errors:** `GET /api/telemetry/recent?token=$ADMIN_TOKEN` — the `top` list
  groups by name; errors are listed first. The `ALERT_WEBHOOK` pager will ping you
  out-of-band if the client error rate spikes, but eyeball the top list daily.
- **Funnel:** the client emits `app_open` → `tab_sent` (a bill/tab was sent) →
  `settle_started` (someone began settling). Track the drop-off between stages in
  PostHog (if `POSTHOG_KEY` is set) or from the raw telemetry events. A cliff
  between `app_open` and `tab_sent` = onboarding/first-split friction;
  `tab_sent` → `settle_started` = payment friction. `group_created` and
  `screen_view` add context.
- **Money-path alerts:** anything on `ALERT_WEBHOOK_URL` (signature-reuse-blocked
  should be ~never; a real one means investigate immediately).

**The mainnet flip** (details + rationale in `docs/PRE-MAINNET.md`)
1. Close the pre-mainnet checklist (`docs/PRE-MAINNET.md`) — a third-party audit
   is still **required** before real money; the rest of the guardrails are in.
2. Move state to **Supabase** (`DATA_BACKEND=supabase`, `SUPABASE_*` set).
3. Set mainnet config: `CLUSTER=mainnet-beta`, mainnet `RPC_URL`, mainnet
   `COLLECTOR_WALLET`, live `MOONPAY_*`, `RAILS_REQUIRE_LIVE=1`, faucet OFF,
   `CONSUMED_SIG_FAIL_OPEN` unset (fail-closed).
4. Redeploy. The boot check refuses a half-configured mainnet — if it starts,
   the unsafe-config gates passed. The cluster is server-pinned; clients can't
   point payers at another network.

**Small-amount smoke test (on mainnet, before opening the gates)**
Two real accounts, real USDC, a ~$1 bill end-to-end:

```
# Account A (creator) and Account B (payer), each a real signed-in device/wallet.
# 1. Fund A's wallet with a few dollars of USDC via the in-app MoonPay ramp.
# 2. A creates a $1 bill split between A and B:
#      new tab → total $1.00 → add B → send the tab
# 3. B opens the shared tab link and pays their ~$0.50 share (MoonPay/existing USDC).
# 4. Verify settlement: B's share flips to PAID only on a real on-chain USDC
#    transfer matching mint + exact amount + collector ATA at finalized commitment.
#      → confirm in-app the tab shows paid, and in the money audit log
#        (structured `money` lines) that exactly one signature settled one share.
# 5. Off-ramp check: A cashes the $1 back out via the sell/off-ramp flow.
```

Pass = paid state is correct, no double-credit, ramp in and out both complete.
Only then widen the TestFlight group / open public sign-up.

---

## Phase 2 — App Store submission

Full detail in `docs/APP-STORE.md`; the launch-relevant parts:

**Screenshots** — upload the six 1320×2868 PNGs from `design/appstore/out/` to
App Store Connect → the version → **Previews and Screenshots → iPhone 6.9"**.
Regenerate any time with `node design/appstore/generate.mjs` (see
`design/appstore/README.md`). They must show the **real UI** and not imply banking
/ FDIC insurance.

**Reviewer notes** (attach to the submission — see `docs/APP-STORE.md` §(e)):
- Divvy is a **non-custodial** bill-splitter. The user holds their own keys; Divvy
  never holds funds.
- Money moves as **USDC on Solana**, shown to users as dollars.
- The **fiat on/off-ramp is delegated to licensed partners (MoonPay / Coinbase)**
  who perform KYC/AML — not Divvy.
- No in-app sale of digital goods (so IAP / Guideline 3.1.1 doesn't apply).

**Demo account for the reviewer** — provide working credentials so the reviewer
gets past Privy login without a real phone/email, plus a seeded group so the core
loop is visible on first open. Note in the review that fiat funding uses the
partner's sandbox/live flow and doesn't require the reviewer to spend real money.

**Common crypto-adjacent rejection reasons → how Divvy answers them**

| Rejection angle | Divvy's answer |
|---|---|
| 3.1.5(b) — must be a licensed exchange to trade crypto | Non-custodial transfer facilitator, not an exchange. Fiat conversion is the **licensed partner's** regulated flow, not ours. |
| "Dollars" framing hides that it's crypto | We don't deny it — reviewer notes + settings/legal state USDC-on-Solana plainly. Dollars-forward UX is presentation, not misrepresentation. |
| 3.1.1 — in-app purchase of digital goods | No digital goods sold. Users split real-world expenses and settle peer-to-peer. |
| 4.2 — thin web wrapper / minimum functionality | Native Capacitor shell with push, deep links, share sheet, biometric unlock, native account-deletion entry point. |
| 5.1.1(v) — account deletion required | In-app account deletion ships (You/Settings); it revokes the session + off-chain PII. On-chain history is permanent and the UX says so. |
| Region / financial policy | Restrict distribution in regions where crypto-transfer apps aren't permitted; 17+ age rating. |

---

## Go / no-go gates

| Gate | Blocks | Criterion |
|------|--------|-----------|
| Env complete | any launch | Phase 0 set, no placeholders; server boots on the target cluster |
| Legal live | store submit | `/terms` + `/privacy` + `/support` resolve on prod domain; `[YOUR JURISDICTION]` filled; counsel-reviewed |
| Account deletion | store submit (Apple 5.1.1) | in-app delete works, revokes session + off-chain PII |
| Telemetry + alerting | mainnet | `ADMIN_TOKEN` set; `ALERT_WEBHOOK` + `ALERT_WEBHOOK_URL` firing to a channel someone reads |
| Pre-mainnet checklist | real money | `docs/PRE-MAINNET.md` closed; **third-party audit done**; fail-closed; faucet off; Supabase backend |
| $1 smoke test | opening the gates | mainnet $1 bill settles correctly; no double-credit; ramp in + out both complete |
| Funnel healthy | scale-up | no unexplained cliff `app_open → tab_sent → settle_started` in the beta cohort |
| CI green | any deploy | `tsc --noEmit`, `npm test`, `npm run test:e2e` all pass |

A **no** on any mainnet/real-money gate means stay on devnet. Going live is a
deliberate flag-flip, never a slide.
