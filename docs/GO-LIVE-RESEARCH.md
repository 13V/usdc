# Divvy Mainnet Go-Live — Research Decision Memo

Researched 2026-07-06 (overnight prep). Companion docs: the code-audit findings
and morning runbook land in `docs/GO-LIVE.md`; this file is the market/externals
research with sources. Informational only — compliance section is NOT legal advice.

## Recommended stack

### RPC — Primary: Helius (Free → Developer $49/mo). Fallback: QuickNode free tier.
- One API key works on both networks — same key, hostname flip:
  `https://mainnet.helius-rpc.com/?api-key=KEY` / `devnet.helius-rpc.com` (+ `wss://`).
  https://www.helius.dev/docs/api-reference/endpoints
- Mainnet is on the free tier for standard RPC + websockets; only LaserStream gRPC is
  gated to Business+. Free = 1M credits/mo, 10 RPS, sendTransaction 1/sec unstaked;
  Developer $49 = 10M credits, 50 RPS, staked sendTransaction.
  https://www.helius.dev/docs/billing/plans · https://www.helius.dev/pricing
- Workload is cheap: getBalance / getTokenAccountsByOwner / getTransaction /
  sendTransaction = 1 credit each; ws confirmations 2 credits per 0.1 MB.
  https://www.helius.dev/docs/billing/credits
- Helius Sender (staked + Jito dual-path submission) is 0 credits on all plans —
  use for settlement tx submission. https://www.helius.dev/sender
- Go-live rec: launch on Free, upgrade to Developer at launch. QuickNode free as
  read-path fallback (15 RPS; Solana methods 30 credits ≈ 333K calls/mo).
  https://www.quicknode.com/pricing · https://www.quicknode.com/api-credits/sol
  Keep `api.mainnet-beta.solana.com` last-resort read-only (100 req/10s/IP,
  "not intended for production applications") — never submit transactions there.
  https://solana.com/docs/references/clusters

### USDC mint — CONFIRMED, no migration
- Mainnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (Circle-issued; verified on
  Circle's contract page + live mainnet read 2026-07-06: initialized, ~$8.3B supply,
  decimals 6). https://developers.circle.com/stablecoins/usdc-contract-addresses
- Devnet test mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` confirmed likewise.
- Legacy SPL Token program (`Tokenkeg…`), NOT Token-2022 — derive ATAs with the legacy
  program ID. https://solana.com/docs/payments/how-payments-work
- No Token-2022 migration announced. Do not confuse CCTP V2 pre-mint `6xTBTq…`
  (https://www.circle.com/blog/cctp-v2-new-pre-mint-address-for-usdc-on-solana).

### Onramp — Primary: MoonPay (via Privy funding). Fallback: Coinbase Onramp.
- Privy natively integrates Meld, MoonPay, and Coinbase Onramp for wallet funding —
  dashboard toggles; Apple Pay/Google Pay/cards; mainnet-only.
  https://docs.privy.io/wallets/funding/overview
- MoonPay (test keys already held): USDC-Solana; Apple Pay/cards/ACH/PayPal/Venmo.
  Fees ~4.5% card / ~1% bank, $3.99 minimum fee (painful on sub-$20 splits).
  https://dev.moonpay.com/docs/on-ramp-overview ·
  https://www.moonpay.com/legal/pricing_disclosure
  Production = KYB review; live keys appear automatically on approval; timeline
  unpublished (anecdotally days-to-weeks).
  https://support.moonpay.com/en/articles/388689-how-to-go-live-with-moonpay-as-a-partner
- Coinbase Onramp: 0%-fee USDC promo, else 2.5% card / 0.5% ACH; Apple Pay ~$5 min.
  CAVEAT: hosted-widget guest checkout deprecated June 30, 2026 — Apple Pay without a
  Coinbase account now requires the Headless Onramp API. Session tokens server-side,
  single-use, 5-min expiry.
  https://www.coinbase.com/developer-platform/discover/launches/zero-fee-usdc ·
  https://docs.cdp.coinbase.com/onramp/coinbase-hosted-onramp/overview
- Stripe onramp: alive, USDC-Solana, ~48h application review, still public preview,
  unpublished fees. Apply for optionality. https://docs.stripe.com/crypto/onramp
- Fastest path: finish MoonPay KYB now; apply to Coinbase CDP in parallel.

### Offramp — Primary: Coinbase Offramp. Secondary: MoonPay Sell. Later: Bridge.
- Coinbase Offramp: US ACH, USDC/Solana, zero-fee promo; user needs a Coinbase
  account + linked bank. https://docs.cdp.coinbase.com/onramp/introduction/welcome
- MoonPay Sell: ACH/PayPal/Venmo payouts, but unavailable for TX, NY, LA, USVI
  residents. https://dev.moonpay.com/docs/off-ramp-faq
- Bridge (Stripe): Solana-USDC → USD via ACH/wire, min 1 USDC, liquidation addresses;
  cleanest UX long-term but sales-negotiated pricing and it makes Divvy the
  money-services customer rather than embedding a merchant-of-record widget —
  different compliance posture; counsel first. https://apidocs.bridge.xyz

## Start these clocks now (external approval latency)
1. MoonPay production KYB (docs + ownership + website review; timeline unpublished)
2. Coinbase CDP application (Onramp + Offramp full access)
3. Apple Developer ORG enrollment (D-U-N-S can take weeks) — required for wallet apps
   under 3.1.5(i)/5.1.1(ix)
4. Stripe onramp application (48h; cheap optionality)
5. Counsel review of CA DFAL (took effect July 1, 2026)
6. (No clock: Helius upgrade instant; USDC mint swap is config.)

## Compliance flags for counsel (informational, NOT legal advice)
- Favorable baseline: FinCEN 2019 CVC guidance — non-custodial wallet software where
  the user controls keys is generally not money transmission (FIN-2019-G001,
  https://www.fincen.gov/system/files/2019-05/FinCEN%20Guidance%20CVC%20FINAL%20508.pdf);
  DOJ April 2025 memo ended "regulation by prosecution" of neutral software.
  Comparable app Sling Money still registered as an MSB.
- §1960 risk is live where the operator routes/controls funds: Samourai plea
  (5-year sentence Nov 2025), Roman Storm §1960 conviction with Oct 2026 retrial.
  Non-custody is not a magic shield.
- THE flag — COLLECTOR_WALLET: under the 2019 guidance, accepting value from one
  person and transmitting it to another is money transmission. If that wallet
  receives user funds in-flow (fees/pooling/forwarding), the non-custodial analysis
  likely collapses (federal MSB + state MTLs). Safer: flat off-chain fees, or fees
  taken by the licensed ramp partner. Put the code audit of this wallet in front of
  counsel.
- CA DFAL in effect July 1, 2026: DFPI license for "digital financial asset business
  activity" with CA residents; software/connectivity + <$50K/yr exemptions exist —
  day-one counsel question. https://dfpi.ca.gov/regulated-industries/digital-financial-assets/
- NY BitLicense: broad, but pure software dev/dissemination carved out.
- GENIUS Act (signed 2025-07-18) regulates issuers, not transacting apps; final-rule
  deadline July 18, 2026. Net positive for USDC apps.

## App Store watch-outs
- 3.1.5(i): wallet apps only from developers enrolled as an ORGANIZATION — verify
  account type pre-submission. https://developer.apple.com/app-store/review/guidelines/
- 3.1.5(iii): transactions must run on approved exchanges in licensed regions —
  position: buy/sell happens inside licensed partners' flows (MoonPay/Coinbase as
  merchant of record); prepare review notes + partner licensing links.
- 5.1.1(ix) (Nov 13, 2025): crypto exchanges = highly regulated field; must be
  submitted by the legal entity providing the service.
  https://developer.apple.com/news/?id=ey6d8onl
- 3.1.5(v): NO crypto rewards for tasks/referrals — do not ship USDC invite bonuses
  in the iOS app.
- Ramp flows aren't digital goods → no IAP cut; May 2025 Epic ruling freed external
  purchase links on the US storefront. US-only distribution at launch avoids region
  licensing questions and matches ramp coverage.
- Public App Store review is stricter than TestFlight — budget extra cycles.

## Honesty notes (stale/conflicting/unverified)
- MoonPay/Coinbase KYB timelines unpublished — "days-to-weeks" is anecdote.
- Coinbase guest-checkout deprecation (June 30, 2026) is fresh; docs may be
  inconsistent — re-verify the Apple-Pay-without-account Headless path before building.
- Stripe onramp preview-gated; fees unpublished.
- Third-party "500K free credits" Helius figures are stale (now 1M).
- Public-RPC "sendTransaction blocked" claims anecdotal; docs just say not-for-production.
- MoonPay Sell state exclusions change — re-check at launch.

---

## Appendix: Offramp deep-dive (verified 2026-07-06)

- **MoonPay Sell — verified end-to-end fit**: `usdc_sol` isSellSupported per the live
  currencies API (min ~19.99 USDC, max 10,000). Payouts: ACH (~5 biz days), debit push,
  PayPal, Venmo (US). Sell UNAVAILABLE for LA, TX, NY, USVI residents — needs a fallback
  message for those users. MoonPay is merchant of record (lightest compliance posture).
  Off-ramp is a separate product enablement in the partner dashboard alongside buy.
- **Coinbase Offramp**: production product; ACH payouts; 0% USDC promo; BUT the user
  must have a Coinbase account with linked bank (no guest checkout for offramp —
  corroborated, direct doc 404'd); crypto must be sent to Coinbase's address within a
  30-minute session window. Trial mode instant; production via onboarding form +
  domain allowlist/verification file. Backup rail, not sole path.
- **Bridge (Stripe)**: Solana-USDC → ACH/wire, min 1 USDC, permanent per-user
  "liquidation addresses" that auto-cash-out — cleanest UX long-term. Stripe completed
  the acquisition Feb 2025; Bridge has conditional OCC trust-charter approval. BUT:
  Divvy becomes Bridge's KYB'd money-services customer (contract, beneficial-ownership
  disclosure, per-user KYC via Bridge links) — materially heavier posture; counsel first.
  Pricing sales-negotiated (~10–25 bps reported, unverified).
- **Ramp Network**: US offramp with RTP instant payouts (~41+ states via own MTLs) —
  interesting, but USDC-Solana sell unverified from their docs.
- **Transak**: US coverage and USDC-Solana sell unverified from first-party docs.

**Offramp ship order**: MoonPay Sell first (verified fit, merchant of record) →
Coinbase Offramp as parallel 0%-fee rail for Coinbase-account users → consider Bridge
when offramp becomes core and unit economics matter.

---

## Appendix: Onramp deep-dive (verified 2026-07-06) — REVISES the topline onramp rec

**Revised recommendation: Stripe onramp via Privy's native Embedded Components as
PRIMARY; Coinbase Onramp as fallback; MoonPay demoted to third.**

- Privy natively routes fiat funding through Meld, MoonPay, Coinbase, and **Stripe**
  (useFiatOnramp; Ramp/Transak are NOT native). Stripe Embedded Components inside
  Privy EXPLICITLY supports USDC on Solana; payment methods credit/debit/Apple Pay/
  Google Pay/ACH (US only); available US-wide EXCLUDING NEW YORK; needs
  @privy-io/react-auth >= 3.32.0 + @stripe/crypto.
  https://docs.privy.io/wallets/funding/fiat-onramp
- Stripe onramp application review is documented at ~48 hours — the fastest
  documented approval of the five. Fees are spread-based, disclosed at quote time
  (opaque until then). https://docs.stripe.com/crypto/onramp
- Coinbase Onramp (also Privy-native): trial mode day one; cheapest PUBLISHED fees
  (2.5% card / 0.5% ACH, 0% USDC promo); guest Apple Pay now requires the separate
  Headless Onramp API (post-June-30-2026), US phone + access fee + ~$2.5K/wk card cap.
- MoonPay verified live for usdc_sol (min buy $5 per currencies API — conflicts with
  the $20 figure in their help center; widget config likely differs) but 4.5% card +
  $3.99 minimum fee stings on sub-$20 Gen Z splits, and KYB has no published timeline.
  Signed URLs are MANDATORY when passing walletAddress.
  https://dev.moonpay.com/docs/on-ramp-enhance-security-using-signed-urls
- Asset-locking to the user's embedded wallet is supported on all three (session
  tokens / signed URLs / locked destination params); Coinbase requires a domain
  allowlist in the CDP portal.

**Morning action order (revised): 1) Stripe onramp application (48h documented),
2) Coinbase CDP application (trial instantly, 0%-fee USDC), 3) MoonPay KYB
(fallback + the offramp story via MoonPay Sell), all in parallel — they're free
options on each other.**

---

## Appendix: Compliance deep-dive highlights (2026-07-06, NOT legal advice)

- **Federal baseline solid**: FIN-2019-G001 §4.2.1/§4.2.2 — self-custodial wallet
  software (incl. 2-of-2 key-share providers that cannot act without the user) is
  not money transmission. GENIUS Act §3(c) (12 USC 5902(c)) EXPRESSLY carves out
  "software or hardware wallet that facilitates an individual's own custody" and
  "direct transfer of digital assets between two individuals acting on their own
  behalf... without an intermediary" — Divvy's exact shape.
- **The §1960 tension is real**: DOJ's Blanche memo (Apr 2025) says no charges for
  truly non-custodial P2P software absent willfulness, but Storm's conviction stands
  (retrial Oct 2026) and Samourai pleaded — "non-custodial" is not a per se defense
  where the operator routes funds or anonymizes. Divvy must never route P2P value
  through an operator address, never skim fees in-flight (fee = separate
  user-authorized transfer if ever monetized per-tx), never add mixing/relay features.
- **Comparable precedent**: Sling Money (closest comparable — self-custodial USDC on
  Solana) still registered with FinCEN as MSB + NMLS defensively, with Paxos/Bridge/
  Beam handling all fiat legs. Phantom runs pure non-custodial posture with a CFTC
  no-action letter. Decide deliberately: rely on non-custodial status vs register
  defensively.
- **CA DFAL (effective July 1, 2026)**: no express self-hosted-wallet exemption; the
  out is definitional ("control" = power to execute unilaterally or prevent
  indefinitely). Counsel should specifically analyze the Privy 2-of-2 config, any
  gas-sponsorship/fee-payer key, and whether any operator capability can block or
  execute a user tx. Watch DFPI final regs.
- **Counsel to-do list**: Privy custody-configuration memo for the record; 50-state
  MTL sweep; on/offramp contracts papered so the operator never accepts funds;
  burner-wallet consumer-protection/UDAP review (non-custodial status removes
  licensing, not consumer-protection law or OFAC prudence); verify Circle's formal
  PPSI designation before calling USDC "GENIUS-compliant".
