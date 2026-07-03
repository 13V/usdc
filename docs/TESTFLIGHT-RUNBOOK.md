# Divvy — TestFlight in one sitting (Mac runbook)

> **No Mac?** Use the cloud build instead: `docs/TESTFLIGHT-NO-MAC.md` — a
> GitHub Actions macOS runner builds, signs, and uploads to TestFlight. This
> file is the manual path for when a Mac is available.

Everything below assumes: you have a Mac with **Xcode 15+**, you're signed into
your **Apple Developer account** ($99/yr membership active), and you have this
repo. Total time first run: ~60–90 min (most of it App Store Connect clicking).

Companion docs: `docs/CAPACITOR.md` (wrapper details), `docs/APP-STORE.md`
(metadata, privacy labels, compliance — the reference), `docs/PRE-MAINNET.md`
(what must be true before real money; TestFlight on devnet/test-USDC is fine).

---

## Phase 0 — one-time Apple setup (~15 min, browser)

1. **developer.apple.com → Certificates, IDs & Profiles → Identifiers → +**
   - Register an **App ID**: platform iOS, Bundle ID **explicit** →
     `com.divvysol.app` (must match `capacitor.config.ts`).
   - Capabilities: check **Push Notifications** and **Associated Domains**.
2. **appstoreconnect.apple.com → Apps → +** → New App:
   - Platform iOS · Name **Divvy** · Language English · Bundle ID
     `com.divvysol.app` · SKU `divvy-ios-1`.
   - If "Divvy" is taken as an App Store name, fall back to **"Divvy — split
     bills"** (display name on the phone stays "Divvy").
3. **Users and Access → Integrations → App Store Connect API** (optional but
   recommended): create a key with **App Manager** role — lets you upload
   builds from the command line later.

## Phase 1 — build the shell (~5 min, Terminal)

The Xcode project is **already committed** (`ios/`), pre-configured with the
app icon, a Divvy-navy splash, portrait lock, camera/photo purpose strings,
`ITSAppUsesNonExemptEncryption=NO`, and the Haptics + Share native plugins
(Swift Package Manager — no CocoaPods install needed).

```bash
git clone <this repo> && cd usdc
npm ci

# Regenerate the gitignored generated files (web-asset copy + config) into the
# committed project. CAP_SERVER_URL defaults to the demo origin; override it
# once the app moves to its production origin.
npx cap sync ios

# Open in Xcode.
npx cap open ios
```

## Phase 2 — Xcode configuration (~10 min)

In Xcode, select the **App** target:

1. **Signing & Capabilities**
   - Team: your Apple Developer team. "Automatically manage signing" ON.
   - Bundle Identifier: `com.divvysol.app` (should already be set).
   - + Capability → **Push Notifications**.
   - + Capability → **Associated Domains** → add
     `applinks:app.divvysol.com` (and `applinks:divvysol.com` when the
     app origin moves there).
2. **General**
   - Display Name: `Divvy`. Version `1.0.0`, Build `1` (bump Build on every
     upload).
   - Deployment target: iOS 15.0 is a safe floor.
3. **App icon**: already in the committed asset catalog (1024×1024, no alpha)
   — nothing to do. Splash is pre-set to Divvy navy.
4. Run on the **iOS Simulator** once (⌘R). Sanity pass: sign in, create a tab,
   open a pay link, check the tab bar isn't clipped, dark theme everywhere.

## Phase 3 — archive & upload (~10 min)

1. Select destination **Any iOS Device (arm64)** (not a simulator).
2. **Product → Archive**. When the Organizer opens: **Distribute App → App
   Store Connect → Upload** (accept defaults; let Xcode manage signing).
3. Wait for the email: "Your app has completed processing" (~5–15 min).

## Phase 4 — TestFlight (~10 min, browser)

1. App Store Connect → Divvy → **TestFlight** tab.
2. Export Compliance: already answered in the project —
   `ITSAppUsesNonExemptEncryption = NO` is set in `ios/App/App/Info.plist`
   (standard HTTPS/TLS exemption), so App Store Connect won't prompt per build.
3. **Internal Testing** → create a group, add your own Apple ID → the build is
   installable from the TestFlight app on your phone immediately (no review).
4. **External testers** (optional, needs a light "Beta App Review", ~1 day):
   add a group + a public link. Use the reviewer notes from Phase 5.

## Phase 5 — App Store review submission

Fill the listing from `docs/APP-STORE.md` §(c)–(d) (metadata table + privacy
labels — the values are ready to paste). Screenshots: `public/screenshots/`
has the 6.7" set; re-take on a 6.7" simulator if Apple rejects sizes.

**App Review Information → Notes** — paste this (edit the demo details):

> Divvy is a bill-splitting app. Users split expenses with friends and settle
> up with each other in-app. Settlement uses USDC (a regulated dollar-pegged
> stablecoin) on the Solana network via each user's own non-custodial wallet
> (Privy embedded wallets) — Divvy never holds user funds (Guideline
> 3.1.5(b): peer-to-peer transfer of a user's own assets, no ICO/mining, no
> exchange functionality operated by us). Fiat on/off-ramp is provided by
> licensed third parties (MoonPay / Coinbase) in their own flows.
>
> Demo account: sign in with email `<reviewer demo email>` — a one-time code
> is sent to that inbox; we can also provide a pre-funded test account on
> request. The current build settles on Solana devnet with test funds; no
> real money moves in this build.
>
> Account deletion is available in-app: You tab → delete account (5.1.1(v)).

**Sign-in requirement**: App Review needs a working demo login. Privy email
login means the reviewer needs access to an inbox — create a dedicated
`review@divvysol.com` (or a Gmail) you control, pre-create the account, fund
it with test USDC (You tab → add money is the devnet faucet), and put those
credentials in the review notes. Apple accepts "code is emailed to this
address; here is the inbox password" as long as it works.

## Gotchas that cost a day if missed

- **Guideline 4.2 (minimum functionality)**: a bare web wrapper gets rejected.
  Push notifications + native share + haptics are already wired through
  Capacitor plugins in this repo — make sure the capability is ON in Xcode and
  mention them in the review notes if questioned.
- **Guideline 3.1.5(b)**: never call anything "banking"; the listing copy in
  APP-STORE.md is already worded to comply. Don't edit it casually.
- **Server outage during review = rejection.** The shell is server-driven;
  check https://app.divvysol.com/healthz is green before submitting and
  keep Railway alerts on (`ALERT_WEBHOOK_URL`).
- **Build number reuse**: every upload needs a strictly higher Build number
  for the same Version, or the upload silently fails at the end.
- **Icon alpha channel**: App Store rejects icons with transparency. The repo
  1024 icon is flat, but if you regenerate it, keep it opaque.

## Update cycle after the first release

Because the app is server-driven, day-to-day product changes ship by deploying
the server (`railway up`) — no store review. You only need a new
archive/upload when the native shell changes (plugins, icons, splash, config),
and a new App Store review when you change the listing or the binary.
