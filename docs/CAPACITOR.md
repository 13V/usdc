# Divvy — Capacitor native build runbook

This repo is scaffolded to wrap the existing web app in a native iOS/Android
shell with [Capacitor](https://capacitorjs.com). Because Divvy is server-driven
(the SPA, the server-rendered `/pay` + `/embedded` routes, and the API all share
one origin), the shell loads that origin directly via `server.url` in
`capacitor.config.ts` — so you get a working build immediately, then add native
capabilities to pass Apple review.

## What's already in place
- `capacitor.config.ts` — appId `com.divvysol.app`, appName `Divvy`, loads
  `CAP_SERVER_URL` (defaults to the demo). HTTPS only.
- Capacitor deps in `devDependencies` (`@capacitor/cli|core|ios|android`).
- `npm run cap:sync` / `cap:open:ios` / `cap:open:android` scripts.
- Deep-link association endpoints served with `application/json`:
  `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
  (driven by `APPLE_TEAM_ID` / `ANDROID_CERT_SHA256` env — placeholders until set).
- App icons + splash color already generated (`public/icons/`, `#0B1622`).

## Prerequisites (your machine)
- **iOS:** macOS + Xcode, CocoaPods, an **Apple Developer account** ($99/yr).
- **Android:** Android Studio + JDK, a **Play Console account** ($25 one-time).

## First build
```bash
# 1. Point the shell at your production origin (or leave unset for the demo).
export CAP_SERVER_URL="https://app.yourdomain.com"

# 2. Generate the native projects (one-time).
npx cap add ios
npx cap add android

# 3. Sync web config + plugins into them (re-run after any config/plugin change).
npm run cap:sync

# 4. Open in the native IDE and run on a simulator/device.
npm run cap:open:ios       # Xcode
npm run cap:open:android   # Android Studio
```
`ios/` and `android/` are generated folders — commit them if you want CI to build
them, or keep them local and regenerate.

## Deep links (universal / app links)
1. Set `APPLE_TEAM_ID` (10-char Team ID) and `ANDROID_CERT_SHA256` (your app
   signing cert fingerprint) in the server env and redeploy — the
   `/.well-known/...` endpoints then return real values.
2. iOS: add the Associated Domains capability in Xcode
   (`applinks:app.yourdomain.com`).
3. Android: the App Links intent filter is added by `cap add android`; verify the
   `assetlinks.json` fingerprint matches your release keystore.
Now `/pay/*` and `/t/*` links open the app instead of the browser.

## Before you submit — Apple Guideline 4.2 ("minimum functionality")
A shell that only loads a URL can be rejected as a "repackaged website." Add
native capabilities that elevate it (all are Capacitor plugins):
- **Push notifications** — `@capacitor/push-notifications` ("Maya paid you $24").
- **Native share** — `@capacitor/share` for the pay/trip links.
- **Haptics** — `@capacitor/haptics` (the app already calls a JS haptic shim).
- **Biometric unlock** — Face/Touch ID gate before sending money.
Ship at least push + share + haptics before submitting.

## Also see
- `docs/APP-STORE.md` — assets, metadata, privacy labels, crypto-compliance,
  and the full pre-submit QA checklist.
- In-app **account deletion** (Apple 5.1.1(v)) is already implemented
  (you → delete account → `DELETE /api/me`).
