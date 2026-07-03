# Push notifications (Divvy)

Divvy delivers "maya paid you $23 💸"-style notifications through **two** channels
from one call site — `sendPush(userId, { title, body, url?, tag? })` in
`src/push.ts` fans out to both:

1. **Web Push (VAPID)** — desktop browsers and the Android PWA (`src/push.ts`,
   config `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`).
2. **APNs** — native iOS (the Capacitor shell), via `src/pushNative.ts`.

The two are independent: APNs works even with no VAPID keys set, and vice-versa.
Everything is best-effort — a missing config or a dead token never throws into a
request path.

---

## How the APNs token reaches the server (remote-URL shell)

Divvy's iOS app is a **server-driven Capacitor shell**: `capacitor.config.ts`
points `server.url` at the remote origin, so the WKWebView loads the live web app
rather than bundled assets. The Capacitor JS bridge / plugins are **not**
available to a remote page, so we do NOT use `@capacitor/push-notifications`
(it isn't installed, and adding npm deps is out of scope). Instead:

```
 AppDelegate.swift (native)                 web layer (public/app.js)          server
 ─────────────────────────                  ─────────────────────────          ──────
 requestAuthorization(alert,badge,sound)
   └─ granted → registerForRemoteNotifications()
        └─ didRegister…DeviceToken(hex)
             └─ evaluateJavaScript on the                                   POST /api/push/native
                Capacitor web view:          window 'apnstoken' event  ───▶   { token }  (requireAuth)
                window.__divvyApnsToken=…      + reads __divvyApnsToken         └─ upsert push_tokens
                dispatchEvent('apnstoken')     once signed in, dedup/session
```

- **Native → web:** `AppDelegate` hex-encodes the device token and injects it
  into the web view (`window.__divvyApnsToken` + an `apnstoken` event). Because
  the remote page may not be loaded when the token arrives, injection **retries**
  on a short timer until Capacitor's web view exists, re-injects a few times to
  survive an early reload, and retries again on `applicationDidBecomeActive`.
- **Web → server:** `public/app.js` listens for the `apnstoken` event (and also
  checks `window.__divvyApnsToken` at boot and on `Auth.onChange`). Once the user
  is signed in it POSTs the token to `POST /api/push/native` exactly once per
  session (deduped by token value via `sessionStorage`), re-posting if the token
  or signed-in user changes.
- **Server:** `POST /api/push/native` (rate-limited `writeRateLimit`, `requireAuth`,
  validates 64–160 hex chars) upserts into the `push_tokens` table
  `{ token, user_id, platform:'ios', created_at }` (SQLite + Supabase mirror).
- **Delivery:** `sendPush()` lists the user's `push_tokens` and calls
  `sendApns()` (`src/pushNative.ts`) — a self-contained HTTP/2 client to
  `api.push.apple.com` authenticated with an ES256 provider JWT. A `410` /
  `BadDeviceToken` / `Unregistered` response prunes the dead token.

No new npm dependencies: APNs uses only Node's built-in `http2` + `crypto`.

---

## Remaining one-time user steps

### 1. Create an APNs Auth Key (.p8)

Apple Developer portal → **Certificates, Identifiers & Profiles** → **Keys** →
**＋** → name it "Divvy APNs" → check **Apple Push Notifications service (APNs)**
→ Continue → Register → **Download** the `AuthKey_XXXXXXXXXX.p8` (you can only
download it once). Note the **Key ID** (the 10-char `XXXXXXXXXX`).

An Auth Key is team-wide and works for **both** the APNs sandbox and production —
you do not need per-app certs, and it never expires.

### 2. Enable the Push Notifications capability on the App ID

The `aps-environment` entitlement only signs if the App ID
(`com.divvysol.app`) has the **Push Notifications** capability.

- **Automated:** the `fastlane ios beta` lane attempts this via the App Store
  Connect API (Spaceship `BundleIdCapability`) before `match`. It is idempotent
  and **guarded** — if the API key lacks capability-management permission it only
  prints a warning and continues.
- **Manual (if the warning appears / to be safe):** portal → **Identifiers** →
  `com.divvysol.app` → tick **Push Notifications** → Save.

> **Profile regeneration:** if the capability is added for the FIRST time *after*
> a `match` provisioning profile already exists, that profile won't include push.
> Regenerate it once by running the lane with `match(..., force: true)` (temporarily),
> or delete the stored `AppStore_com.divvysol.app.mobileprovision` from the
> `ios-certificates` branch so `match` recreates it. Subsequent builds are normal.

### 3. Set the server env (Railway)

| Env var         | Value                                                        |
|-----------------|-------------------------------------------------------------|
| `APNS_KEY_P8`   | contents of the `.p8` (PEM), or its base64 — both accepted  |
| `APNS_KEY_ID`   | the 10-char Key ID from step 1                              |
| `APPLE_TEAM_ID` | 10-char Apple Team ID (already set for fastlane)            |
| `APNS_TOPIC`    | *(optional)* defaults to `com.divvysol.app`                 |
| `APNS_SANDBOX`  | *(optional)* set `1` to target the APNs **sandbox**         |

Until all of `APNS_KEY_P8` + `APNS_KEY_ID` + `APPLE_TEAM_ID` are present,
`src/pushNative.ts` is **inert** and `sendPush()` simply skips the APNs fan-out.

---

## Sandbox vs production

APNs picks the environment from how the app was **code-signed**, and the
`aps-environment` entitlement string must match:

- **TestFlight / App Store** builds (the CI `fastlane ios beta` lane, `app-store`
  export) → `aps-environment = production` → deliver via **`api.push.apple.com`**
  (the default; leave `APNS_SANDBOX` unset).
- **Development** builds run from Xcode with a *development* provisioning profile
  → APNs **sandbox** → set `APNS_SANDBOX=1` on the server you point that build at,
  and deliver via `api.sandbox.push.apple.com`.

`ios/App/App/App.entitlements` ships `aps-environment = production` because the
only automated build path is TestFlight. (The entitlement is wired into both the
Debug and Release build configs via `CODE_SIGN_ENTITLEMENTS`; with automatic
signing Xcode reconciles the environment for local dev builds. A device token
minted against one environment will simply be rejected by the other — that dead
token is auto-pruned.)

---

## Testing it

1. Complete the three steps above (Auth Key, capability, Railway env) and cut a
   TestFlight build (`.testflight-build` bump). Install on a real device
   (push does not work in the iOS Simulator).
2. Open the app, sign in, and **allow notifications** when prompted (~2s after
   launch). This registers the device and POSTs the token to `/api/push/native`.
   Confirm a row landed: `select * from push_tokens;`.
3. From another account that is a friend / trip co-participant, **nudge** you
   (`POST /api/nudge`, or the in-app nudge button). `sendPush()` fans out to your
   iOS token → you should see the banner, foreground or background.
4. Server-side sanity without a device: `npm test` runs the `apns.*` selftests
   (JWT ES256 header/payload + signature verification, and payload shape) with a
   throwaway key and **no network**.

---

## Files

| File | Role |
|------|------|
| `src/pushNative.ts` | APNs HTTP/2 sender + ES256 provider JWT (Node built-ins only) |
| `src/push.ts` | `push_tokens` store, `POST /api/push/native`, native fan-out in `sendPush()` |
| `supabase/schema.sql` | `push_tokens` table mirror |
| `public/app.js` | receives the injected token, POSTs it once signed in |
| `ios/App/App/AppDelegate.swift` | registers for remote notifications, injects the token |
| `ios/App/App/App.entitlements` | `aps-environment = production` (wired via `CODE_SIGN_ENTITLEMENTS`) |
| `fastlane/Fastfile` | ensures the Push capability on the App ID (guarded) |
