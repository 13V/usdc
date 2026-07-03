# App Store screenshots

Generates the six iPhone 6.9" App Store screenshots for Divvy — the real app,
seeded with a lively demo dataset, wrapped in a journal-styled marketing frame.

## Regenerate

```bash
node design/appstore/generate.mjs
# VERBOSE=1 node design/appstore/generate.mjs   # to see server logs
```

Output lands in `design/appstore/out/*.png` (six framed PNGs) with the raw,
un-framed captures alongside in `design/appstore/out/raw/`. The `out/` directory
is git-ignored (see `design/appstore/.gitignore`; PNGs are globally ignored too).

No arguments, no setup. The script is fully self-contained:

1. **Boots the real server** (`ts-node src/server.ts`) on a free port with a
   throwaway SQLite DB, `SESSION_SECRET`, `DATA_BACKEND=sqlite`, `CLUSTER=devnet`
   — the same harness pattern as `e2e/happy-path.mjs`.
2. **Signs in** a burner wallet via `Auth.createWallet()` (SIWS), plus three more
   burner accounts (kenji / mei / leo) so trip members are real, wallet-linked
   accounts.
3. **Seeds** a "tokyo trip 🗼" group (4 members, 6 fun expenses), a partially-paid
   standalone tab, and mutual friends — all through `window.app.api`.
4. **Captures** six money screens at **1320×2868** (viewport 440×956 @
   `deviceScaleFactor: 3`) into `out/raw/`.
5. **Frames** each raw PNG (second Chromium pass; the raw is embedded as a
   `data:` URI in an HTML template) into the journal marketing composite at
   exactly **1320×2868** in `out/`.
6. **Verifies** every framed PNG is 1320×2868 by parsing the PNG IHDR (width/height
   at byte offsets 16 and 20) and fails the run if any is off.

Requires a Chromium binary: `CHROME_PATH`, else the local Playwright chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Uses `playwright-core` and
`better-sqlite3` — both already project dependencies. No new npm deps.

## The six shots

| # | file | screen | caption |
|---|------|--------|---------|
| 1 | `out/01-home.png` | home balances hero (net owed, people, tabs) | "split anything in seconds" |
| 2 | `out/02-group.png` | group ledger (who owes who, tabs) | "see who owes what" |
| 3 | `out/03-itemized.png` | itemized "who had what" tab | "tap who had what" |
| 4 | `out/04-settle.png` | settle-up screen | "settle up in a tap" |
| 5 | `out/05-recap.png` | shareable trip recap card | "relive the trip" |
| 6 | `out/06-customize.png` | profile customize (meme pfps) | "make it yours" |

## Apple's required sizes (2026)

Apple requires **one** 6.9" set and derives the rest, but supplying the 6.5" set
avoids letterboxing on older-display devices:

- **iPhone 6.9" — 1320 × 2868 (portrait) — MANDATORY.** This is the set this
  script produces. (Landscape equivalent is 2868 × 1320; we ship portrait.)
- **iPhone 6.5" — 1284 × 2778 (portrait) — optional** but recommended. To add it,
  change `CSS_W/CSS_H` in `generate.mjs` to `428 × 926` (still `deviceScaleFactor:
  3` → 1284 × 2778) and re-run; the frame pass reads `PX_W/PX_H` so it follows
  automatically.
- iPad screenshots are only needed if the app ships as iPad-compatible.

Upload the PNGs in App Store Connect → your app → the version → **Previews and
Screenshots → iPhone 6.9" Display**. See `docs/APP-STORE.md` for the full
submission checklist and `docs/LAUNCH.md` (Phase 2) for review-note guidance.
