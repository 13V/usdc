# Divvy Mainnet Go-Live — Morning Runbook

The operator's checklist for flipping production from devnet to mainnet-beta.
Written 2026-07-06. Companions: `docs/GO-LIVE-RESEARCH.md` (provider/compliance
research), `docs/PRE-MAINNET.md` (original gate design), `docs/LAUNCH.md`
(smoke-test script). Everything code-side referenced here is already merged;
the only things left are **your** env values, wallet, data decision, and the
Railway flip.

The single most important rule: **`npm run preflight:mainnet` must print GO
before you flip.** It is read-only and replicates the boot gate, so a NO-GO on
your candidate env means the deploy would refuse to boot anyway.

```
npm run preflight:mainnet -- --env-file .env.mainnet          # candidate file
npm run preflight:mainnet -- --env-file .env.mainnet --ping-webhooks
```

---

## 0. Before you start (external prerequisites)

- [ ] MoonPay production KYB approved → `pk_live_…` + secret key in the
      dashboard. Without it, launch with rails DARK (see §2 — this is fine:
      add-money/cash-out show "coming soon", wallet-to-wallet still works).
- [ ] A paid mainnet RPC (Helius recommended — same key as devnet, hostname
      flip: `https://mainnet.helius-rpc.com/?api-key=KEY`).
- [ ] The collector wallet decision reviewed by counsel (see the compliance
      flag in GO-LIVE-RESEARCH.md — the collector receives user funds on
      standalone tabs when the creator has no wallet; current code binds the
      creator's own wallet whenever one exists).
- [ ] A fresh Supabase project OR the truncate script agreed (see §3).

## 1. The environment table

Set these on the production service (Railway → Variables). `<USER-PROVIDES>`
means only you have the value — nothing in the repo or this doc contains it.

| Variable | Value | Notes |
| --- | --- | --- |
| `CLUSTER` | `mainnet-beta` | **Exactly this string.** `mainnet` is normalized with a loud warning, anything else refuses to boot. |
| `RPC_URL` | `<USER-PROVIDES>` | Paid mainnet endpoint. Preflight live-probes the genesis hash. |
| `COLLECTOR_WALLET` | `<USER-PROVIDES>` | Base58, funded, USDC ATA pre-created (§4). |
| `DATA_BACKEND` | `supabase` | SQLite is ephemeral on Railway. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | `<USER-PROVIDES>` | Of the **mainnet** project (§3). |
| `SESSION_SECRET` | `<USER-PROVIDES>` | **Mint a FRESH ≥32-char secret** (`openssl rand -hex 32`). Rotating it invalidates every devnet session — that's desirable at the flip. |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | `<USER-PROVIDES>` | Boot **hard-fails** without both — sign-up would be dead. |
| `MOONPAY_API_KEY` | `pk_live_…` or **unset** | A `pk_test_` key refuses to boot (it would open the sandbox widget on real users). Unset = rails dark, graceful "coming soon". |
| `MOONPAY_SECRET_KEY` | `<USER-PROVIDES>` (required if API key set) | MoonPay requires signed URLs in production. |
| `COINBASE_ONRAMP_APP_ID` | optional | Second rail; counts as "live" when set. |
| `RAIL_MAX_CENTS` | `50000` | **$500/transaction on the fiat rails for week one.** Raise deliberately later. |
| `LEDGER_MAX_CENTS` | `500000` | $5,000 max per recorded expense/IOU/tab entry for launch (default is $1M if unset — set it). |
| `RAILS_REQUIRE_LIVE` | `1` only if rails must be live | With rails dark, leave unset. |
| `ALERT_WEBHOOK_URL` | `<USER-PROVIDES>` | Money-path pager. Warn-only at boot but you want this on day one. |
| `ALERT_WEBHOOK`, `ALERT_PUSH_USER_ID` | `<USER-PROVIDES>` | Client error-rate pager (telemetry). |
| `ADMIN_TOKEN` | `<USER-PROVIDES>` | Enables `/api/telemetry/recent` read-back. |
| `VITE_PRIVY_APP_ID` | build-time only | Already baked into the committed `public/embedded` bundle; only matters if you rebuild. |

**DELETE these variables entirely** (each one *individually* refuses boot or is
a live hazard):

- `MINT_AUTHORITY_SECRET` — devnet faucet authority keypair
- `TEST_USDC_MINT` — devnet test-USDC mint override
- `PAYER_SECRET_KEY` — live-devnet payer keypair
- `CONSUMED_SIG_FAIL_OPEN` — must never be set on mainnet (double-credit guard would fail open)

## 2. Rails decision (MoonPay)

- **KYB approved:** set `pk_live_` + secret, optionally `RAILS_REQUIRE_LIVE=1`.
  `/healthz` should then report `railsLive:true`.
- **KYB not approved yet:** leave both MoonPay vars **unset**. The UI degrades
  to "coming soon" on add-money/cash-out; settling with existing USDC and
  receiving USDC by QR/address still work. Do NOT ship the test key: the boot
  gate refuses it, and `ramsConfigured()` would treat it as dark anyway.

## 3. Data decision (make it deliberately, before the flip)

Devnet production data is play money. Two options:

**Option A — fresh Supabase project (RECOMMENDED).** Clean ledger, zero
cross-network ambiguity, trivially auditable from day one.

1. Create the project, get the service-role key + `SUPABASE_DB_URL`.
2. `SUPABASE_DB_URL=postgres://… npx ts-node scripts/apply-schema.ts`
3. `npx ts-node scripts/supabase-health.ts` (with the new env) — all tables ✓.
4. Cost: users re-sign-in and re-add friends. At current user counts this is
   the cheap option; the app was in test.

**Option B — keep the project, truncate the money tables.** Keeps accounts,
friend graphs and push subscriptions; deletes every money row.

```sql
-- money tables (order irrelevant; run in the SQL editor of the SAME project)
truncate table bills, groups,
  trips, trip_members, expenses, settlements, trip_messages, trip_reactions,
  ious, tab_entries, tab_settlements,
  recurring, subscriptions, subscription_renewals,
  outside_claims, nudges, auto_nudge_configs, auto_nudge_sends cascade;
-- KEEP: users, identities, user_wallets, friendships, push_subscriptions,
-- push_tokens, referrals, telemetry, auth_handoff_codes
-- KEEP consumed_signatures: harmless (signatures are per-chain) and keeping it
-- preserves the strictest possible replay posture.
```

Then run the additive migration bits: paste `supabase/schema.sql` in the SQL
editor again (idempotent — it adds the new `cluster` columns on
`ious`/`tab_settlements` and backfills `'devnet'`, which matters only for
Option B leftovers if you skip the truncate).

**If you do neither:** the code now refuses cross-cluster money anyway —
devnet-era bills/trips/tabs/IOUs surface as "created on the test network —
closed" instead of becoming payable — but the preflight will red-flag the open
devnet rows so the choice is conscious.

## 4. Collector wallet prep

1. Generate/choose a hardware- or properly-custodied keypair. **Not** a burner,
   not the devnet collector.
2. Fund it with a little SOL (rent + fees), e.g. 0.05 SOL.
3. **Pre-create the USDC ATA** so the very first inbound payment can't fail on
   a missing token account:

   ```bash
   spl-token create-account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
     --owner <COLLECTOR_WALLET> --fee-payer <FUNDED_KEYPAIR.json> --url mainnet-beta
   ```

4. Preflight verifies: base58 validity, not the system program, on-chain
   presence (yellow if 0 lamports), and the ATA (red with this exact command
   if missing).

## 5. Flip order (verify after every step)

1. **Preflight on the candidate env** (before touching Railway):
   `npm run preflight:mainnet -- --env-file .env.mainnet` → **GO**.
2. **Data step** (§3 A or B). Verify: `scripts/supabase-health.ts` green.
3. **Set the env table** (§1) on Railway, delete the delete-list vars.
   Double-check `CLUSTER` reads `mainnet-beta` character-for-character.
4. **Deploy.** The boot gate IS the test — if the container crash-loops, read
   the log: `assertMainnetReadiness` prints exactly which clause refused. Do
   not weaken the gate; fix the env.
5. **Verify `/healthz`:**
   ```json
   { "ok": true, "cluster": "mainnet-beta", "backend": "supabase",
     "rpc": true, "railsLive": <true iff live keys>, "time": "…" }
   ```
6. **Verify the client got the flip:** open the app fresh (or after the SW
   updates — cache is `divvy-v62`): the "you" screen network row shows a quiet
   `mainnet` tag (no mint-green devnet badge); `GET /api/auth/config` returns
   `"cluster":"mainnet-beta"`.
7. **Verify the burner gate:** signed-out "try a demo account" /
   "create a wallet" CTAs must land on the Privy sign-in (`/embedded/`), not
   mint a local key.
8. **$1 smoke test** (per docs/LAUNCH.md): two real accounts A and B.
   - Fund A with a few dollars of USDC (live ramp if on, else transfer in).
   - A creates a $1 tab split with B → B opens the share link → pays their
     ~$0.50 share.
   - PAID must flip only on the real on-chain transfer (finalized, exact
     amount, right mint, collector ATA). Check the structured `money` log
     lines: exactly one signature settled one share.
   - Receipt screen: Solscan link opens WITHOUT `?cluster=devnet` and resolves.
   - If rails live: A cashes ~$1 back out via the sell flow.
9. **Embedded-surface smoke:** open a pay link (`/pay/:id/:name`) in a private
   window → "no crypto wallet? no problem" flow → Privy sign-in → the pay
   screen must show the real balance, NOT auto-mint funds, and when short must
   show the add-money card (not a dead 501). Also `/embedded/?pay=send&…` from
   the app's send flow.
10. **Arm the pager:** `preflight --ping-webhooks` already proved delivery;
    now trip a real one, e.g. one manual 429 burst or a temporary
    `ALERT_ERROR_THRESHOLD=1` + a forced client error, then restore.
11. **Watch window (24h):** watch Railway logs for `evt:"money"` lines,
    `signature_reuse_blocked`, `verify_failure_spike`, `server_error_spike`;
    Supabase table sizes; Helius usage dashboard (credit burn); healthz
    uptime monitor.

## 6. Rollback caveats

- **Env rollback is easy, money is not.** Flipping `CLUSTER` back to devnet
  restores the old behavior for NEW rows, and mainnet-era rows then become
  "closed" cross-cluster rows on devnet (same guard, mirrored). Any REAL money
  already moved stays moved — rollback does not refund anything.
- Do not restore the deleted faucet vars while `CLUSTER=mainnet-beta` — boot
  refuses each of them individually.
- If you truncated (Option B), rollback does not resurrect the devnet ledger.
  Keep the pre-flip Supabase backup/snapshot until you're sure.
- The service worker caches by version (`divvy-v62`); a rollback deploy should
  bump the version again so clients don't hold the mainnet copy.

## 7. Open risks accepted at launch (sign off consciously)

- **H2 residual — legacy burner wallets.** New burner creation is gated to the
  Privy flow on mainnet (client-side; `Auth.createWallet()` checks the server
  cluster). BUT: a device that already holds a devnet-era localStorage key can
  still sign back in with it (deliberate — it's the only way back into that
  account), and that raw key could custody real USDC if someone funds it. The
  gate is UX-level, not a server ban on SIWS. Accepted for launch; revisit
  with a "migrate to a real login" nudge for burner accounts.
- **M3 — `/api/rpc` sendTransaction is unauthenticated.** web3.js can't attach
  a Bearer, so the proxy allows anonymous `sendTransaction`, capped at
  ~20 broadcasts/min/IP + 150 req/min/IP. On mainnet this spends YOUR RPC
  quota and relays arbitrary (user-signed) transactions. Accepted with rate
  limits; watch the Helius dashboard, revisit with per-session tokens.
- **M2 — alert thresholds are devnet-tuned.** Spike detectors (verify fails,
  fund volume, 5xx) were tuned for devnet traffic shapes; expect either quiet
  or noisy pages in week one and re-tune from real data.
- **FX quote endpoint** (`/api/fx/:from/:amount`) still serves fallback-table
  quotes for DISPLAY when the rate API is down; entry of new FX expenses is
  refused on mainnet in that state (M4). Displayed quote ≠ bookable rate in
  that window.
- **Collector-wallet compliance flag** — see GO-LIVE-RESEARCH.md; counsel
  review is a prerequisite, not a code item.

## 8. Quick reference

```
npm run preflight:mainnet -- --env-file .env.mainnet   # go/no-go, read-only
npx ts-node scripts/apply-schema.ts                     # fresh project schema
npx ts-node scripts/supabase-health.ts                  # table reachability
```

Boot-gate clauses (all replicated by preflight check 12): exact CLUSTER ·
RPC_URL set · SESSION_SECRET set · supabase backend · collector set ·
MINT_AUTHORITY_SECRET absent · TEST_USDC_MINT absent · no fail-open sig guard ·
Privy id+secret present · no pk_test_ MoonPay key · secret with API key ·
rails live if RAILS_REQUIRE_LIVE=1.
