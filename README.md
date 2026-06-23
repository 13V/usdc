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

## Project layout

| File | Purpose |
| --- | --- |
| `src/split.ts` | Money math. Integer cents, fair penny distribution. `dollars`, `fmt`, `toCents`, `withTip`. |
| `src/solanaPay.ts` | Builds Solana Pay transfer-request URLs; USDC mints; references. |
| `src/bill.ts` | Bill / participant model; `createBill()`; JSON file persistence. |
| `src/store.ts` | In-memory multi-bill store for the web app (swap for a DB). |
| `src/verify.ts` | `findPayment()` by reference; `validatePayment()` (exact amount/token, finalized). |
| `src/qr.ts` | Terminal + PNG + data-URL QR rendering. |
| `src/onramp.ts` | No-wallet path: MoonPay / Coinbase Onramp "Pay with card" URLs. |
| `src/server.ts` | Express API + shareable server-rendered pay page. |
| `src/liveDevnet.ts` | Real end-to-end on devnet. |
| `src/index.ts` | CLI: demo / new / status / qr / verify. |
| `public/index.html` | Mobile-first UI. |
| `src/split.selftest.ts` | Offline money-math + URL tests. |

## Security / production notes

- **Devnet first.** Never point at mainnet without explicit review. `CLUSTER`
  defaults to `devnet`.
- **Verification must be hardened.** A confirmed signature on a reference means
  "something happened". Production must `validatePayment` — confirm exact amount,
  recipient, and token mint at **`finalized`** — before marking PAID.
  `validatePayment()` sketches this; wire it into the verify endpoints.
- **On-ramp keys.** The "Pay with card" URLs are correctly shaped but won't
  charge until you add real MoonPay/Coinbase keys (MoonPay URLs must be
  HMAC-signed server-side).
- **Persistence.** The web store is in-memory; bills don't survive a restart.
  Swap `store.ts` for SQLite/Postgres.

## Roadmap

1. ✅ Repo stood up; typecheck clean; 8/8 self-tests; web API working.
2. Complete the live devnet demo on a non-rate-limited RPC; harden `verify.ts`.
3. Wire real on-ramp keys so "Pay with card" actually charges.
4. Web UI buildout: saved bills, multiple groups, settle-up history, persistent store.
5. (Stretch) Embedded-wallet no-wallet path (Privy / Coinbase CDP).

## License

MIT
