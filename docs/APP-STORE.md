# Divvy — App Store & Play Store Submission Runbook

Concrete, Divvy-specific checklist for shipping the existing web app to the
**Apple App Store** and **Google Play**. Divvy is a **non-custodial** bill-splitter
that settles in **USDC on Solana**, presented to users as plain dollars
("dollars, just faster"). Fiat on/off-ramp is handled by **licensed partners
(MoonPay / Coinbase)** who do KYC. Divvy never holds keys or funds.

> Owner: @averseinc · Target: v0.1 store launch · Last updated: 2026-07-01

---

## 0. TL;DR of the hard parts

1. **You cannot ship the PWA to Apple as-is.** Apple rejects thin web wrappers
   (Guideline 4.2 / "minimum functionality"). Wrap it in **Capacitor**.
2. **Crypto is scrutinized.** Apple 3.1.5(b) and Play's financial-services policy
   both apply. Our non-custodial + licensed-ramp model is generally acceptable,
   but the **"dollars" framing must not misrepresent** that this is USDC/crypto.
3. **In-app account deletion is REQUIRED by Apple.** Must exist before submitting.
4. **Privacy policy + Terms must be live URLs.** Ship `/privacy.html` and
   `/terms.html` (already created).

---

## (a) Wrapper decision — how to get a web app into the stores

### Why a raw PWA won't pass Apple
- Apple's App Review routinely rejects apps that are "primarily a web view" or a
  repackaged website (Guideline 4.2 Minimum Functionality; 2.3 metadata). A pure
  PWA/URL wrapper is the classic rejection.
- Apple does not distribute PWAs through the App Store at all — the only path is
  a native binary. So we need a native shell that hosts our web app **and adds
  native capability** (native shell, push, deep links, share sheet, biometric
  unlock, native account-deletion entry point).

### Recommended approach
- **iOS App Store → Capacitor.** Wrap the existing `/public` web app in a
  Capacitor iOS project. Capacitor gives a real native binary, native plugins
  (Push, App/Deep Links, Share, Biometrics, Browser for the MoonPay/Coinbase
  flow), and passes review far more reliably than a bare WKWebView because we can
  add genuine native features.
- **Google Play → Bubblewrap or PWABuilder (TWA).** Play *does* accept a
  **Trusted Web Activity** (TWA) that wraps the PWA, since our
  `manifest.webmanifest` + service worker (`/public/sw.js`) already qualify. To
  keep a single codebase, you can alternatively ship the **same Capacitor
  Android** project to Play — recommended so iOS and Android stay in lockstep.
- **PWABuilder** can bootstrap both packages from the deployed URL if you want a
  fast first pass, but plan to move to a checked-in Capacitor project for
  long-term control of native plugins and signing.

### High-level steps (Capacitor path)
1. `npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`
2. `npx cap init Divvy app.divvy.mobile --web-dir=public` (web assets already
   live in `/public`; confirm `webDir`).
3. Add native plugins we actually need: `@capacitor/app` (deep links / URL open),
   `@capacitor/browser` (in-app browser for MoonPay/Coinbase ramp),
   `@capacitor/push-notifications`, `@capacitor/share`, `@capacitor/preferences`.
4. `npx cap add ios && npx cap add android`
5. `npx cap sync` after every web build; open with `npx cap open ios` (Xcode) /
   `npx cap open android` (Android Studio).
6. Configure **Associated Domains** (iOS) + **assetlinks.json** (Android) so
   `divvysol.com` universal/app links open the app (needed for shared bill links).
7. Set up signing: Apple Developer account + provisioning; Play upload key +
   Play App Signing.
8. Wire native entry points for **account deletion** and **privacy/terms links**.
9. Build → TestFlight (iOS) / Internal testing track (Play) → submit.

> Note: there is a `mobile/` directory in the repo — audit it first to see if a
> shell already exists before scaffolding a new one.

---

## (b) Required assets & exact sizes

### iOS (App Store)
| Asset | Size / format | Notes |
|---|---|---|
| Marketing app icon | **1024×1024 PNG, no alpha, no transparency, sRGB** | Uploaded in App Store Connect. Flat square, no rounded corners (Apple rounds it). |
| App icon set | 20/29/40/60/76/83.5 pt @1x/2x/3x | Xcode asset catalog. A single 1024 source can be auto-scaled by Xcode 14+ (single-size app icon). |
| iPhone 6.7" screenshots | **1290×2796** (portrait) | Required. iPhone 15/16 Pro Max class. |
| iPhone 6.5" screenshots | **1242×2688** or 1284×2778 | Recommended; can be reused/adapted. |
| iPad 12.9" screenshots | **2048×2732** | **Only if we ship iPad.** Decide below — default is iPhone-only. |

### Android (Google Play)
| Asset | Size / format | Notes |
|---|---|---|
| App icon (Play listing) | **512×512 PNG, 32-bit with alpha** | Store listing "hi-res icon". |
| Adaptive / maskable icon | 108×108 dp (foreground 72dp safe zone) | In-app launcher icon; our manifest already declares `purpose:"any maskable"` — verify the raster meets the safe zone. |
| Feature graphic | **1024×500 PNG/JPG, no alpha** | Required for the Play listing header. |
| Phone screenshots | **min 320px, max 3840px**, 16:9 or 9:16, 2–8 images | JPEG or 24-bit PNG. |

### What we generate vs. what still needs design
- **Generating now (from brand):** PNG app icons at required sizes (source is
  `/public/icon.svg`) + a **1200×630 OG image** for link previews (also usable as
  a base for the Play feature graphic crop).
- **Still needs a designer/PM:**
  - iOS **1024×1024 no-alpha** marketing icon (flatten the SVG onto solid
    `#0B1622`; strip any transparency).
  - **1024×500 feature graphic** (Play) — proper composition, not just a crop.
  - **Real device screenshots** at all required sizes (6.7", 6.5", optional iPad,
    Android phone) with on-brand captions. These must show the actual app UI.
  - Decide **iPad support** (yes = must add 12.9" screenshots + verify layout at
    tablet widths; the web shell is a 430px phone column, so iPad would letterbox
    unless we adapt).

---

## (c) Store metadata to prepare

| Field | Value (draft — confirm with PM) |
|---|---|
| App name | **Divvy** |
| Subtitle (iOS, 30 char) | **Split bills, settle in seconds** |
| Short description (Play, 80 char) | Split any bill and settle up instantly. Dollars, just faster. |
| Promotional text (iOS) | Front the bill, split it, get paid back in seconds. |
| Full description | Bill-splitting that settles in seconds. Divvy divides any expense with friends and lets everyone settle up in dollars — powered by USDC on Solana, but you never have to think about crypto. Non-custodial: you hold your own keys. Add or cash out dollars through our licensed partners. |
| Keywords (iOS, 100 char) | split,bill,expenses,settle,friends,roommates,venmo,group,IOU,dinner,rent,dollars |
| Category (primary) | **Finance** |
| Category (secondary, optional) | Utilities / Social Networking |
| Support URL | **https://app.divvysol.com/support** — server-rendered support/FAQ + contact page (`GET /support`, `src/legal.ts`). Host is `PUBLIC_ORIGIN`-based (defaults to the request host); swap the domain if the app is served elsewhere. |
| Marketing URL | https://divvysol.com |
| Privacy policy URL | **https://app.divvysol.com/privacy** — server-rendered (`GET /privacy`, `src/legal.ts`). Legacy static `/public/privacy.html` still resolves as a fallback. |
| Terms of Use (EULA) URL | **https://app.divvysol.com/terms** — server-rendered (`GET /terms`, `src/legal.ts`). Legacy static `/public/terms.html` still resolves as a fallback. |
| Support email | support@divvysol.com |
| Copyright | © 2026 Divvy |
| Age rating | **17+ (iOS) / Teen or higher (Play)** — see age-rating note in (f). |

> Do **not** overstate. Avoid "bank", "banking", "savings", "guaranteed", or
> implying FDIC insurance. Say "settle" / "send" / "split," not "deposit."

---

## (d) Apple privacy "nutrition label" (App Privacy) mapping

Fill this in App Store Connect → App Privacy. Map to what the app **actually**
collects (see `/public/privacy.html`). MoonPay/Coinbase collect card & KYC data
**in their own flow** — disclose only what **Divvy** collects.

| Data type | Collected? | Linked to identity? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Email address | **Yes** (via Privy login) | Yes | No | App Functionality, Account |
| Phone number | **Yes** (if used to log in) | Yes | No | App Functionality, Account |
| User ID / OAuth ID | **Yes** (Privy) | Yes | No | App Functionality |
| Wallet public address | **Yes** | Yes | No | App Functionality |
| Financial info — other (bill/settlement records) | **Yes** | Yes | No | App Functionality |
| Payment card / bank details | **No — collected by MoonPay/Coinbase, not Divvy** | — | — | Disclose in their flow, not ours |
| Product interaction / usage | **Yes** (analytics) | Possibly | No | Analytics, Product Improvement |
| Crash data / diagnostics | **Yes** | No | No | Diagnostics |
| Coarse location / region | **Yes** (approx, from device/analytics) | No | No | Analytics |
| Precise location | **No** | — | — | — |
| Contacts | **No** (unless a contact-import feature is added — re-file if so) | — | — | — |

- **Tracking:** we do **not** track users across other companies' apps/sites →
  answer "No" to the tracking questions (assuming no third-party ad SDKs). If any
  analytics SDK does cross-app tracking, that changes the answer and requires
  App Tracking Transparency (ATT) prompt.
- Keep this label in sync with the actual SDKs shipped. Verify which analytics
  provider is wired before submitting.
- Play equivalent: fill the **Data safety** form with the same mapping.

---

## (e) Compliance landmines — get these right BEFORE submitting

### Apple Guideline 3.1.5(b) — Cryptocurrency
- **What it says (in spirit):** Apps may facilitate crypto transactions/storage
  on an approved basis; crypto exchanges must be offered by properly licensed
  entities; apps may **not** mine on-device; and apps facilitating crypto
  transactions must come from or be tied to appropriate licensing where required.
- **Why Divvy is generally acceptable:**
  - Divvy is **non-custodial** — it facilitates transfers of a **user-held
    asset** (USDC in the user's own wallet). It is not an exchange run by Divvy.
  - The **fiat on/off-ramp is delegated to licensed partners** (MoonPay /
    Coinbase) who hold the required money-transmission licenses and perform KYC.
    Divvy does not itself exchange fiat for crypto.
  - Divvy is not selling digital content or in-app collectibles; it moves a
    stablecoin the user already owns between wallets.
- **Where it can still get rejected — mitigate:**
  - **"Presented as dollars" must not misrepresent.** The app and metadata must
    not deny or hide that it's crypto/USDC when a reviewer looks. Keep a clear,
    findable disclosure (e.g., in onboarding/settings and in Terms) that balances
    are USDC on Solana. Marketing "dollars, just faster" is fine as a tagline;
    concealing the crypto nature is not.
  - Be ready to **name the licensed ramp partners** and show they're licensed in
    the review notes.
  - Don't imply Divvy is a bank / insured / a money transmitter.

### Apple Guideline 3.1.1 — In-App Purchase
- **What it says:** Digital goods/services consumed **in the app** must use
  Apple IAP; Apple takes its cut. Crucially, **3.1.1 does NOT apply to
  "goods and services outside the app"** or to transfers of a user's own funds.
- **Why Divvy is fine:** Divvy is **not selling digital content**. Users are
  splitting real-world expenses and moving their **own** USDC peer-to-peer. Fiat
  ramp purchases are a **real-money financial service via a licensed third
  party**, explicitly outside IAP scope (physical/real-world goods & services and
  person-to-person money transfers are excluded from IAP). So we should **not**
  wire USDC transfers or ramp purchases through Apple IAP.
- **Landmine:** If Divvy ever adds a **subscription or premium in-app feature**
  (e.g., Divvy Pro), that digital feature **would** require IAP. Keep any future
  paid tiers separate from the money-movement flow.

### Google Play — Financial Services / Crypto policy
- Play permits crypto apps but enforces a **Financial Services policy** and, in
  some regions, requires declarations/registration for exchanges and wallets.
- Since Divvy is **non-custodial** and defers fiat conversion to licensed
  partners, complete Play's **Financial features declaration** honestly:
  declare it as a **non-custodial wallet / crypto-transfer facilitator**, not a
  custodial exchange.
- Provide the **privacy policy URL** and complete **Data safety**.
- Avoid deceptive claims; the "dollars" framing must not hide the crypto nature.
- Check per-country availability — restrict distribution in regions where crypto
  transfer apps aren't permitted rather than risk a policy strike.

### Cross-cutting
- **KYC/AML sits with the licensed partners**, not Divvy — but keep evidence of
  that division of responsibility handy for both reviews.
- Include a **short reviewer note** on each submission explaining: non-custodial,
  user holds keys, licensed ramp partners named, no in-app sale of digital goods.
- Provide **working test credentials / a demo account** so reviewers can get
  past Privy login without a real phone/email.

---

## (f) Pre-submit QA checklist

**Links & content**
- [ ] No dead links anywhere. `/terms`, `/privacy`, and `/support` (server-rendered,
      `src/legal.ts`) resolve on the production domain and are linked from **inside
      the app** (You → help & support sheet, and the policy links on the You screen)
      and from store metadata. Legacy `/privacy.html` / `/terms.html` still resolve.
- [ ] Footer "back to divvy" (`/`) + the "terms · privacy · support" footer work on
      all three server-rendered pages (and on the `/pay/:id` tab-landing page).
- [ ] No placeholder text ships to users. **Fill `[YOUR JURISDICTION]`** in the
      governing-law section of `src/legal.ts` (`GET /terms`) before store
      submission, and have counsel review both policy pages.
- [ ] `support@divvysol.com` inbox is live and monitored.

**Account deletion (Apple REQUIRES in-app)**
- [ ] There is an **in-app path to delete the account** (not just email us) —
      Apple mandates this for any app with account creation. Add it to the
      **You/Settings** screen.
- [ ] Deletion removes off-chain personal data (Supabase) and revokes the session.
- [ ] UX clearly states **on-chain transactions cannot be deleted** (permanent) —
      matches the Privacy Policy.

**Auth & flows**
- [ ] Privy login works on device (email, phone, OAuth) inside the native shell.
- [ ] MoonPay/Coinbase ramp opens correctly (in-app browser / external) and
      returns to the app.
- [ ] A demo/test account is prepared for reviewers.

**Native / wrapper behavior**
- [ ] **Deep links / universal links** open shared bill links in the app
      (Associated Domains on iOS, `assetlinks.json` on Android).
- [ ] **Offline behavior** is graceful — service worker (`/public/sw.js`) serves a
      sensible offline state; no white screen / broken shell when disconnected.
- [ ] No broken back-button / navigation traps in the WebView.
- [ ] Safe-area insets respected (notch / home indicator) — `viewport-fit=cover`
      is already set; verify in the shell.
- [ ] Push notifications (if enabled) request permission properly; app runs fine
      if declined.

**Store hygiene**
- [ ] **Age rating** questionnaire completed. Because the app involves crypto /
      financial transfers, expect **17+ (iOS)** and **Teen+ (Play)**; answer the
      "unrestricted web / financial" questions honestly. (Note: the Privacy Policy
      allows 13+ for the app generally, but moving real funds via partners is 18+
      per Terms — set the store age rating to the stricter financial rating.)
- [ ] Screenshots show the **real UI** and don't overpromise or imply banking/FDIC.
- [ ] Metadata keywords aren't trademark-stuffed (e.g., competitor names in the
      description can be rejected; keeping "venmo" as a keyword is riskier than in
      the description — review).
- [ ] Data safety (Play) + App Privacy (Apple) forms match section (d).
- [ ] Reviewer notes attached explaining the non-custodial + licensed-ramp model.

---

## Appendix — quick reference

- Support / FAQ: `GET /support` (`src/legal.ts`) → https://app.divvysol.com/support
- Privacy Policy: `GET /privacy` (`src/legal.ts`) → https://app.divvysol.com/privacy
  (legacy static `/public/privacy.html` still served as a fallback)
- Terms of Service: `GET /terms` (`src/legal.ts`) → https://app.divvysol.com/terms
  (legacy static `/public/terms.html` still served as a fallback)
- Web app assets: `/public/` (`index.html`, `manifest.webmanifest`, `sw.js`,
  `icon.svg`)
- Existing mobile scaffold to audit: `/mobile/`
- Brand: bg `#0B1622`, card `#13212E`, blue `#2775CA`, mint `#3DE8C7`,
  coral `#FF6B5E`; fonts Clash Display / General Sans / Space Mono.
