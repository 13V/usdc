# Design direction mockups

Static home-screen mockups exploring eight art directions for the Divvy
re-skin (2026-07). Each is a self-contained HTML page; they reference
`/fonts.css` from the running app, so preview them by copying into `public/`
and opening `http://localhost:3000/<file>` (or just read them — all styles
are inline).

- **A — Electric**: neo-brutalist color blocks, hard offset shadows, stickers.
- **B — Aurora Glass**: mesh gradients, frosted glass, glow. Phantom-adjacent.
- **C — Receipt-core**: balance as a paper receipt — perforations, stamps,
  barcodes, ticket-stub rows. Most on-concept for bill splitting.
- **D — Terminal**: phosphor-green CRT ledger, scanlines, `$ settle --all`.
- **E — Arcade**: pixel HUD; bounty pool, XP collect bar, quests, boss fights.
- **F — Vault**: engraved gold-on-black private ledger, vault-dial progress.
- **G — Y2K Chrome**: liquid-chrome numerals, iridescent pastel, bubble gloss.
- **H — Journal**: light-mode notebook paper, washi tape, tilted cards.

Decision pending — the chosen direction gets applied to the money path first
(home, collect, settle), then swept across the app.
