# Divvy — split the bill, collect in USDC on Solana

You're out with friends, you front the bill. Divvy splits it and generates a
**Solana Pay USDC payment link + QR per person**. They pay their share in USDC
(instant, ~free, no chargebacks); you track who paid and collect to your wallet.

## Honest positioning (read this before you get excited)

Divvy does **not** beat Venmo / Zelle / Revolut for same-country friends who all
already have those apps installed. That's a real adoption wall and pretending
otherwise wastes everyone's time. Where it actually wins:

1. **Crypto-native friend groups** — everyone already has a wallet.
2. **Cross-border / travel groups** — USDC is one borderless currency, so nobody
   eats FX spread or "I'll Venmo you... oh wait, you're in the EU."
3. **Markets with weak fiat rails** — LatAm, Africa, parts of Asia, where USDC is
   often the *easier* money to move.

And: **no bespoke token.** Everything settles in **USDC**. A token here would be
fake utility.

## How it works

1. Enter the total (+ optional tip), the names, and how to split it.
2. Divvy computes a fair split (every penny accounted for) and, per person,
   generates a unique [Solana Pay](https://docs.solanapay.com/) transfer request:
   ```
   solana:<yourWallet>?amount=<dollars>&spl-token=<USDC mint>&reference=<unique pubkey>&label=..&message=..
   ```
3. Each person scans their QR (Phantom/Solflare/etc.) or taps **Pay with card**
   (MoonPay/Coinbase Onramp buys USDC and delivers it to you).
4. Each request embeds a unique throwaway **reference** pubkey. We find the
   payment on-chain by that reference and flip the person to **PAID**.

## The dinner flow (scan → pick people → share links)

The fast path for "we're out, I'll front it":

1. **Set your wallet once.** On the web UI, paste your Solana wallet address — it's
   saved on your device and every bill you make collects to it. This is the wallet
   you'd **attach a crypto card to** (Coinbase Card, Crypto.com, etc.) so you can
   spend what you collect. Divvy doesn't issue cards; it routes USDC to a wallet
   you control.
2. **Scan the receipt.** Snap a photo (`<input capture>` opens the camera on
   mobile). Claude vision reads the **grand total** off it and prefills the amount
   — no typing. Needs `ANTHROPIC_API_KEY`; without it you just type the total
   (everything else still works). Money stays integer cents end-to-end.
3. **Pick the people**, split equally/weighted, and Divvy generates a Solana Pay
   USDC link + QR per person.
4. **Share the links.** Each friend pays their share straight to your wallet —
   with their own wallet (scan QR), a card (MoonPay/Coinbase), or by creating an
   embedded wallet in-page (Privy). You watch who's paid.

The **default split is just a headcount stepper** — scan the total, tap "− N +",
generate. No names needed. Want named people? Expand "Name them / use a group":
type names once and **save them as a group** (`me, you, Andy`) so next time it's
one tap. Every bill is saved to a **settle-up history** ("Saved bills") with a
Settled ✓ badge, and you can reopen any past bill to re-check payments.

Bills and groups persist in **SQLite** (`better-sqlite3`, file at `DB_PATH` or
`./divvy.db`) — they survive a restart. New endpoints: `GET/POST /api/groups`,
`DELETE /api/groups/:id`; `POST /api/bills` also accepts `count` (auto-names
`Person 1..N`) or `groupId`.

`POST /api/scan` takes `{ image: "data:image/...;base64,..." }` and returns the
detected total; it falls back to `{ needsManualEntry: true }` when no key is set.

### Multi-currency

Travelling? Scan a **local-currency receipt** — Thai baht, euros, yen — and it's
**auto-converted to USDC at capture**. The foreign total is converted to USD
**once** (rounded a single time into integer cents), and from there the normal
split math takes over so every share still sums to the total exactly.

The **locked rate is recorded and shown** with its source and timestamp, so the
table can see exactly how the conversion was made — e.g. *"Originally ฿2,450.00
THB @ $0.0304 (as of …)"*. Rates come from a **free, no-key source**
(`open.er-api.com`), cached ~10 minutes, with a **static offline fallback** so
the feature still works without a network (marked `source: "fallback"`).

Note honestly: **1 USDC is treated as 1 USD**. USDC is a USD stablecoin and
normally trades at par, but that peg *can* drift in a depeg event — the recorded
USD amount is what gets collected, not a live-reconverted figure.

- `GET /api/fx/:from/:amount` returns `{ from, amount, rate, asOf, source,
  usdCents, usdFmt }` (e.g. `GET /api/fx/THB/2450`). USD quotes return rate `1`.
- `POST /api/scan` echoes `converted`, `originalAmount/originalCurrency`,
  `originalFmt`, `rate`, `fxAsOf`, `fxSource` for foreign receipts.
- `POST /api/bills` accepts an optional `fx` field
  (`{ sourceCurrency, sourceAmount, rate, asOf, source }`); bills then record
  that **FX provenance** (surfaced as `fxNote` in the serialized bill).

## Money math (the guardrail)

All money is **integer cents** — never floats. Every split is computed so the
shares **sum to the total exactly** (fair largest-remainder penny distribution).
There are offline self-tests for this; keep them green:

```bash
npm test     # 8/8 money-math + URL tests
```

## Quick start

```bash
npm install
cp .env.example .env      # set COLLECTOR_WALLET (and RPC_URL for live devnet)

npm run typecheck         # types clean
npm test                  # 8/8 self-tests
npm run demo              # $74.07 + 18% tip = $87.40 -> 29.14 / 29.13 / 29.13
npm run web               # web app on http://localhost:3000
```

CLI:

```bash
npm run new -- --title "Trip dinner" --total 120 --names "Ava,Ben,Cy" --tip 18
npm run status -- <billId>
npm run qr     -- <billId> [name]
npm run verify -- <billId>     # checks the chain, marks PAID
```

## Live on devnet (real on-chain payment)

`npm run live-devnet` funds a payer, mints a USDC-style token, sends an exact
share with the reference attached, and verifies it — a real tx flips a payer to
PAID.

> **Heads up:** the public devnet faucet rate-limits airdrops (HTTP 429). To run
> this reliably, point `RPC_URL` at a Helius/QuickNode **devnet** endpoint and/or
> provide a funded `PAYER_SECRET_KEY` in `.env`.

```bash
RPC_URL="https://devnet.helius-rpc.com/?api-key=..." npm run live-devnet
```

## No-wallet pay path (embedded wallets, Privy)

A friend with **no crypto wallet at all** can still pay without leaving the page.
From a pay page, "Create a wallet & pay" opens an embedded-wallet flow
(`web/`, a small Vite + React app served at `/embedded/`):

1. Sign in with **email or phone** — Privy provisions a self-custodial Solana
   wallet. No seed phrase for the friend to manage.
2. If the new wallet is empty, top it up with a **card** (reuses the on-ramp,
   pointed at the new wallet).
3. Tap pay — it sends the exact USDC share to the collector with the bill's
   `reference` attached (same on-chain trick as `liveDevnet.ts`), then tells the
   server to flip the share to PAID.

```bash
# set VITE_PRIVY_APP_ID in .env (https://dashboard.privy.io), then:
npm run build:web      # builds web/ -> public/embedded/ (served by Express)
npm run web            # the "Create a wallet & pay" button now works
```

Without `VITE_PRIVY_APP_ID` the embedded page renders a clear "not configured"
notice; the wallet-QR and card paths still work. The build output
(`public/embedded/`) is generated and git-ignored.

## Project layout

| File | Purpose |
| --- | --- |
| `src/split.ts` | Money math. Integer cents, fair penny distribution. `dollars`, `fmt`, `toCents`, `withTip`. |
| `src/solanaPay.ts` | Builds Solana Pay transfer-request URLs; USDC mints; references. |
| `src/bill.ts` | Bill / participant model; `createBill()`; JSON file persistence. |
| `src/store.ts` | SQLite-backed multi-bill store (`db.ts`); same sync interface. |
| `src/db.ts` | Opens the SQLite database; creates `bills` + `groups` tables. |
| `src/groups.ts` | Saved-group model + SQLite CRUD (one-tap "me, you, Andy"). |
| `src/verify.ts` | `findPayment()` by reference; `validatePayment()` (exact amount/token, finalized). |
| `src/qr.ts` | Terminal + PNG + data-URL QR rendering. |
| `src/onramp.ts` | No-wallet path: MoonPay / Coinbase Onramp "Pay with card" URLs. |
| `src/scan.ts` | Receipt scanning — Claude vision reads the total off a photo. |
| `src/server.ts` | Express API + shareable server-rendered pay page. |
| `src/liveDevnet.ts` | Real end-to-end on devnet. |
| `src/index.ts` | CLI: demo / new / status / qr / verify. |
| `public/index.html` | Mobile-first UI. |
| `web/` | Vite + React embedded-wallet (Privy) pay page, built to `public/embedded/`. |
| `src/split.selftest.ts` | Offline money-math + URL tests. |

## Security / production notes

- **Devnet first.** Never point at mainnet without explicit review. `CLUSTER`
  defaults to `devnet`.
- **Verification is hardened.** A confirmed signature on a reference only means
  "something happened". The server + CLI verify paths mark PAID only after
  `validatePayment` confirms the exact amount, the collector's associated token
  account as destination, and the token mint, all at **`finalized`** commitment.
  `findPayment` (confirmed) remains as a fast "seen it" hint used by the live demo.
- **On-ramp keys.** The "Pay with card" URLs are correctly shaped but won't
  charge until you add real MoonPay/Coinbase keys (MoonPay URLs must be
  HMAC-signed server-side).
- **Persistence.** The web store is in-memory; bills don't survive a restart.
  Swap `store.ts` for SQLite/Postgres.

## Roadmap

1. ✅ Repo stood up; typecheck clean; 8/8 self-tests; web API working.
2. ✅ Live devnet demo on a Helius RPC — a real on-chain transfer flips a payer
   to PAID; `verify.ts` hardened with `validatePayment` (exact amount + collector
   ATA + token mint at `finalized`), wired into the server + CLI verify paths.
3. Wire real on-ramp keys so "Pay with card" actually charges.
4. ✅ Web UI buildout: headcount fast-path, saved groups, settle-up history, SQLite store.
5. ✅ Embedded-wallet no-wallet path (Privy) — `web/`, served at `/embedded/`.

## License

MIT
