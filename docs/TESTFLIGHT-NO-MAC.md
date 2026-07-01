# TestFlight with no Mac — cloud build via GitHub Actions

The `iOS TestFlight` workflow (`.github/workflows/ios-testflight.yml`) builds
the app on a GitHub-hosted macOS runner, signs it, and uploads it to
TestFlight. Everything below happens in a **web browser** — no Mac, ever.

Never share your Apple ID password with anyone or any tool: 2FA makes it
useless for automation anyway, and Apple's terms forbid it. The App Store
Connect **API key** below is Apple's designed way to delegate exactly this
power — it's team-scoped and revocable at any time.

## One-time setup (~20 minutes, all in the browser)

### 1. Apple Developer Program must be active
appstoreconnect.apple.com should let you in and show "Apps". If enrollment is
still pending, finish that first (it gates everything).

### 2. Create the App Store Connect API key
1. App Store Connect → **Users and Access** → **Integrations** tab →
   **App Store Connect API** → Team Keys → **+**.
2. Name: `divvy-ci` · Access: **Admin** (needed to create the signing
   certificate on first run; you can rotate to a narrower key later).
3. **Download the .p8 file** (one chance only — keep it safe), and note the
   **Key ID** (on the key row) and the **Issuer ID** (top of the page).

### 3. Find your Team ID
developer.apple.com/account → **Membership details** → **Team ID**
(10 characters, like `A1B2C3D4E5`).

### 4. Add the five GitHub secrets
GitHub → the `usdc` repo → **Settings** → **Secrets and variables** →
**Actions** → **New repository secret**, five times:

| Secret name      | Value                                                     |
|------------------|-----------------------------------------------------------|
| `ASC_KEY_ID`     | the Key ID from step 2                                    |
| `ASC_ISSUER_ID`  | the Issuer ID from step 2                                 |
| `ASC_KEY_P8`     | the FULL text of the .p8 file (open it in a text editor, paste everything including the BEGIN/END lines) — or add `ASC_KEY_P8_B64` with the base64-encoded file instead |
| `MATCH_PASSWORD` | a passphrase you invent (encrypts the stored signing certs — save it in your password manager) |
| `APPLE_TEAM_ID`  | the Team ID from step 3                                   |

Adding them yourself in the GitHub UI means the key never transits chat,
email, or anything else.

> **Bootstrap mode:** the workflow also accepts `asc_key_p8_b64` and
> `match_password` as manual run inputs (Key ID / Issuer ID / Team ID have
> defaults baked in). This exists so the first builds can run before secrets
> are configured — but run inputs are visible in the run history to anyone
> with repo read access, so once TestFlight works: add the real secrets,
> re-run without inputs, and rotate the API key in App Store Connect.

### 5. Create the app record (needed before the first upload)
App Store Connect → **Apps** → **+** → **New App**:
- Platform **iOS** · Name **Divvy** (fallback: "Divvy — split bills") ·
  Language **English (U.S.)** · SKU `divvy-ios-1`
- Bundle ID: pick **com.divvy.app** from the dropdown. If it isn't listed yet,
  run the workflow once first — its first step registers the bundle ID via the
  API (the build will fail at the upload step because the app record doesn't
  exist yet; create the record, then re-run).

## Building

Actions tab → **iOS TestFlight** → **Run workflow** (or ask Claude to trigger
and babysit it). ~15–25 minutes. First run additionally mints the signing
cert + provisioning profile and stores them encrypted on the
`ios-certificates` branch; later runs reuse them and are faster.

When the run is green, App Store Connect processes the build for ~5–15 min,
then it appears under **TestFlight**. Add yourself to an **Internal Testing**
group → install the TestFlight app on your iPhone → the build is on your
phone. Internal testing needs no review.

## Costs & quotas
- GitHub-hosted macOS runners bill at a 10× minutes multiplier on private
  repos (a 20-min build ≈ 200 of the 2,000 free monthly minutes). A few
  builds a month fits the free tier; heavy iteration may need a paid plan.
- The app shell is server-driven: day-to-day product changes deploy via
  Railway with **no new iOS build**. You only rebuild when the native shell
  changes (icon, splash, plugins, config).

## Later (not needed for the first TestFlight build)
- Push notifications + universal links: need capability toggles on the bundle
  ID, entitlements in the project, and a re-run of match — do this when the
  native push plugin lands.
- App Store review submission: listing metadata, screenshots, privacy labels,
  and review notes are prepped in `docs/APP-STORE.md` + `docs/TESTFLIGHT-RUNBOOK.md` (Phase 5).
