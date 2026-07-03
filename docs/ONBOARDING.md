# Onboarding — how sign-in works

Divvy's happy path is designed so a person with **zero crypto knowledge** can sign
up without ever making a custody decision or seeing the word "wallet". Under the
hood everyone still gets a self-custodial Solana wallet — they just never have to
think about it.

## The flow (what the user sees)

1. **Welcome screen** (`public/screens/home.js`, signed-out state)
   - Headline: _"split bills. settle in dollars. instantly."_
   - **Primary CTA**: ` continue with apple` on iOS (Apple leads — native
     expectation), `sign in` everywhere else.
   - **Secondary CTA**: `continue with phone or email` — same flow, opens Privy
     straight to the phone/email entry screen.
   - **Tertiary link**: `just exploring? try a demo account` — a local burner
     wallet (`Auth.createWallet`, see below). Small, quiet, deliberately demoted.

2. Tapping the primary/secondary CTA calls `app.signIn(method?)`, which navigates
   to the embedded Privy React app at **`/embedded/`** (built from `web/`, output
   to `public/embedded/`, served statically by Express).

3. The embedded app (`web/src/Login.tsx`) auto-opens the Privy login modal. On
   success it:
   - auto-provisions a Solana **embedded wallet** (`createOnLogin:
     "users-without-wallets"`), no seed phrase,
   - exchanges the Privy access token at `POST /api/auth/privy/verify` for a Divvy
     session token,
   - stashes that token in the shared-origin `localStorage["divvy.token"]`,
   - redirects to `/#/welcome` (the "you're all set" celebration).

4. **First sign-in lands on home**, where a one-time **"how it works"** journal
   card explains the loop in plain English (split → they pay their share →
   money's yours). It's dismissible and shown once, gated by
   `localStorage["divvy.seenHowItWorks"]`.

Every other signed-out surface (home, groups, friends, you, activity, recurring,
customize, friend) now says **"sign in"** and routes through the same
`app.signIn()` entry point. There are no more "connect a wallet" / "create a
wallet" buttons on the happy path.

## What the demo-account path is for

`Auth.createWallet()` (in `public/auth.js`) generates an Ed25519 keypair in the
browser, persists it in `localStorage["divvy.localWallet"]`, and signs in via
Sign-In-With-Solana. It is:

- the **"try a demo account"** tertiary link on the welcome + you screens — a
  zero-friction way to look around without signing up;
- the mechanism the **e2e happy-path test** (`e2e/happy-path.mjs`) drives
  (`window.Auth.createWallet()`), so it must never be removed;
- the silent auto-provision used when an **invited member claims their spot** from
  a shared group link (`public/screens/group.js` → `claimSlot`), so they stay in
  context instead of bouncing to a sign-in page.

It is a devnet/MVP convenience (raw key in localStorage). It is intentionally NOT
the promoted path — real users should sign in with Apple/Google/phone/email so
their wallet is a recoverable Privy embedded wallet.

## How sign-in maps to a wallet (under the hood)

| User does                | Privy provisions            | Divvy stores                         |
| ------------------------ | --------------------------- | ------------------------------------ |
| Apple / Google / phone / email sign-in | a self-custodial Solana embedded wallet (no seed phrase; recover via the same login) | session token + verified wallet address (`fetchPrivyWallets`, server-authoritative) |
| "try a demo account"     | nothing (local burner keypair) | session token + the burner's base58 address |

Balances, settle-ups, and QR/receive all use the resulting Solana address. The
user just sees **"your balance"** in USDC (dollars).

## Privy config (code side — already done)

`web/src/main.tsx` `PrivyProvider` config:

```ts
embeddedWallets: { solana: { createOnLogin: "users-without-wallets" } },
loginMethods: ["apple", "google", "sms", "email"],   // NO "wallet" → no MetaMask list
loginMethodsAndOrder: { primary },                    // Apple first on iOS, else Google first
appearance: {
  walletChainType: "solana-only",
  walletList: [],        // belt-and-suspenders: hides every external wallet option
  theme: "light",
  accentColor: "#2775CA",
  logo: `${origin}/icons/icon-192.png`,
},
```

`web/src/Login.tsx` reads a `method` query param: `?method=phone` opens Privy
straight to the phone/email screen; otherwise the full modal (Apple-first on iOS
via the provider order).

App id is injected at build time from the repo-root `.env`:
`VITE_PRIVY_APP_ID=cmquaqg6n00yz0cjxloju78s6`. After changing `web/` you must
rebuild: `npm run build:web` (outputs to `public/embedded/`).

## Privy DASHBOARD checklist (you must do this — it can't be done in code)

In the Privy dashboard (dashboard.privy.io) for app `cmquaqg6n00yz0cjxloju78s6`:

1. **Login methods → enable**: Email, SMS, Google, Apple. (Any method not enabled
   here is ignored even though the code requests it.)
2. **Email / SMS**: no extra credentials needed — turn them on.
3. **Google**: enable the Google provider. Privy supplies a default OAuth client;
   for production add your own Google OAuth **Client ID + secret** and authorize
   your domain(s).
4. **Apple ("Sign in with Apple")** — required for the iOS primary CTA:
   - In the Apple Developer portal create a **Services ID** (this is the OAuth
     `client_id`), enable "Sign in with Apple" on it, and register the return URL
     Privy shows you (`https://auth.privy.io/api/v1/oauth/callback` — copy the
     exact value from the dashboard).
   - Create a **Sign in with Apple key** (.p8), note its **Key ID** and your
     **Team ID**.
   - Paste Services ID, Team ID, Key ID, and the .p8 private key into Privy's
     Apple provider config.
   - For the native iOS app (Capacitor), add the **Sign in with Apple**
     capability to the app target and list your bundle id.
5. **Embedded wallets → Solana**: ensure Solana embedded wallets are enabled and
   set to **create on login for users without wallets** (matches the code).
6. **Allowed origins / domains**: add the app's origin(s) (production domain +
   `http://localhost:<port>` for local dev) so the embedded flow can run.
7. **Server API** (for wallet verification, `src/auth.ts` `fetchPrivyWallets`):
   set `PRIVY_APP_ID` and `PRIVY_APP_SECRET` as **server env vars** so
   `/api/auth/privy/verify` can confirm which wallets a Privy user owns. Without
   `PRIVY_APP_SECRET` the server links no wallet (safe, but the address won't
   attach). `/api/auth/config` reports `privy:true` only once `PRIVY_APP_ID` is
   set server-side.

## Language: "wallet" on the happy path

Balance surfaces say **"your balance"**. The word "wallet" is kept only in
advanced / receive / power-user contexts (e.g. the you-screen wallet-address chip
and "wallet & recovery" row, friend QR/address rows, the send-to-address field).
See the copy audit in the PR notes for the exact changed-vs-kept list.
