# Money rails — MONEY-IN / MONEY-OUT

Divvy settles in USDC on Solana, but the whole money experience is dollars. Two
flows carry real money across the boundary, both through the **MoonPay** widget:

- **add money** (on-ramp): "add $20" → Apple Pay sheet → balance appears.
- **cash out** (off-ramp): "cash out" → USDC sells → dollars land in the bank.

We never say "crypto" in the UI. The user picks a dollar amount and taps once.

## How it's wired

- `src/onramp.ts` — `moonpayUrl()` builds the **buy** widget URL and
  `signMoonPayUrl()` HMAC-signs it. Params we pre-fill so the widget is as short
  as possible: `apiKey`, `currencyCode=usdc_sol` (USDC on Solana),
  `walletAddress` (the user's primary wallet), `baseCurrencyCode=usd`,
  `baseCurrencyAmount` (the chosen amount), `colorCode=#2775CA` + `theme=light`
  (Divvy brand), `redirectURL` (back into the app), and `paymentMethod=apple_pay`
  when the client hinted iOS/Safari.
- `src/offramp.ts` — `moonpaySellUrl()` builds the **sell** widget URL and
  `signMoonPaySellUrl()` signs it. Params: `baseCurrencyCode=usdc_sol`,
  `baseCurrencyAmount`, `quoteCurrencyCode=usd`, `walletAddress` +
  `refundWalletAddress`, `colorCode`/`theme`, `redirectURL`.
- `src/server.ts` — `GET /api/me/onramp/:amountCents` and
  `GET /api/me/offramp/:amountCents` return the signed URLs for the signed-in
  user's primary wallet plus a `live` flag. On-ramp accepts `?applePay=1` to add
  the Apple Pay hint. Both enforce the per-transaction rail cap
  (`RAIL_MAX_CENTS`, default $2,000).
- `public/app.js` — `depositSheet()` (add-money sheet), `watchBalance()` (the
  shared balance watcher), `isAppleClient()` (Apple Pay detection). The cash-out
  sheet lives in `public/screens/you.js`; the settle screen's "top up to settle"
  state is in `public/screens/settle.js`.

The widget host follows the key prefix (`moonpayHost()`): a `pk_test_` key targets
`buy-sandbox.moonpay.com` / `sell-sandbox.moonpay.com`; a `pk_live_` key targets
the production hosts. Flipping to live is a single env swap — see below.

## Balance watcher (how the balance "just appears")

MoonPay settlement is asynchronous — the widget hands off, then USDC lands in the
wallet seconds-to-a-minute later. We do **not** yet run a webhook, so the client
detects the credit by polling:

`app.watchBalance({ baseline, onIncrease })` arms on return-to-foreground
(`visibilitychange` / `focus`), polls `GET /api/me/wallet` every 5s for up to
3 min, and the first time `usdcCents` rises above the baseline it fires
`app.celebrate()`, toasts "money's in 🎉 $X ready", and calls `onIncrease()` so the
screen refreshes (on settle it re-runs the covered/short computation). It cancels
itself on navigation. Both the you-screen and the settle screen use it.

## Switching to live keys

1. Get production keys from the MoonPay dashboard: a publishable `pk_live_…` and
   the matching secret `sk_live_…`.
2. Swap the env — nothing else changes (the host is derived from the key prefix):

   ```
   MOONPAY_API_KEY=pk_live_xxxxxxxx
   MOONPAY_SECRET_KEY=sk_live_xxxxxxxx
   ```

3. In the MoonPay dashboard, whitelist the app's `redirectURL` origin (e.g.
   `https://app.divvy.example`) so the widget is allowed to return the user.
4. Optionally tune `RAIL_MAX_CENTS` (per-transaction cap) and `MOONPAY_MIN_CENTS`
   (provider minimum surfaced on the guest pay page).

`ramsConfigured()` reports whether a usable (non-placeholder) key is present; the
endpoints echo it as `live`.

### Degraded mode (no keys)

With **no** `MOONPAY_API_KEY` (and no Coinbase app id), `ramsConfigured()` is
false and the endpoints return `live:false`. The client degrades gracefully: the
"add money" / "cash out" buttons show a soft **"coming soon in your region ✨"**
state and refuse to open a broken widget link, rather than sending the user to a
placeholder URL that can't charge.

## Apple Pay availability

Apple Pay is offered by MoonPay's own widget and only renders where Apple Pay is
available: **iOS/iPadOS Safari and in-app WKWebViews, and desktop Safari on a
Mac** with a card in Wallet. We detect the client (`isAppleClient()` — iPhone/iPad
UA, or a Mac UA with touch points for iPadOS) and pass `?applePay=1` so the widget
opens straight onto the Apple Pay sheet; the button reads "add with apple pay".
Everywhere else the button reads "add money" and MoonPay falls back to its card
flow. There is no native Apple Pay merchant integration on our side — it all runs
inside MoonPay's PCI-compliant widget, so there's no cert/merchant-id setup here.

## Future upgrade: MoonPay webhooks for instant crediting

Today we detect an incoming credit by **balance polling** (above). A cleaner
production path is MoonPay's **transaction webhooks**: register a signed webhook
endpoint, verify the `Moonpay-Signature-V2` header, and on a
`transaction.updated` → `completed` event mark the funding done and push a
notification / flip the UI immediately — no polling window, instant celebration.
The polling watcher can stay as a belt-and-suspenders fallback for clients that
never receive the push. This is intentionally deferred; polling is enough for the
current experience.
