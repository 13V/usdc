---
name: verify
description: Build/launch/drive recipe for verifying Divvy changes end-to-end (server + PWA UI) in this repo.
---

# Verifying Divvy changes

## Launch the real app

```bash
PORT=<free> DB_PATH=$(mktemp -d)/v.db SESSION_SECRET=x DATA_BACKEND=sqlite CLUSTER=devnet \
TS_NODE_TRANSPILE_ONLY=1 node_modules/.bin/ts-node src/server.ts
# ready when GET /api/auth/config answers 200
```

## Drive the UI (headless Chromium)

- Use `playwright-core` with `executablePath: /opt/pw-browsers/chromium-1194/chrome-linux/chrome`
  (see `e2e/happy-path.mjs` for a complete working harness — copy its boot/teardown).
- Sign in from the page: `await window.Auth.createWallet()` (burner wallet + SIWS),
  then **wait ~1s** — home.js's post-auth re-render clobbers hash navigation done
  immediately after.
- Navigate screens by setting `location.hash` (`#/group/<id>`, `#/new/<id>`, …).
- GOTCHA: Playwright's `click()`/`fill()` stability waits time out on this UI
  (screens re-render whole sections on every state change + infinite CSS
  animations). Interact via the DOM instead — same real handlers fire:
  `page.$eval(sel, el => el.click())` and set `input.value` + dispatch
  `input`/`blur` events.
- Authed API calls from the page: `window.app.api.get/post/patch/del(path, body)`.

## Flows worth driving

- group ledger: create trip via `POST /api/trips`, add expenses, check
  balances/who-owes-who text and `.gTab` rows; tap a row for the detail sheet.
- add-expense form: `#/new/<groupId>`; itemized editor uses
  `#nItemizeOn`, `[data-item-label|price|del="i"]`, `[data-item-idx][data-item-member]`
  chips, `#nItemAdd`, `#nSend`.
- destructive taps (delete/archive) are two-tap armed — tap twice.
