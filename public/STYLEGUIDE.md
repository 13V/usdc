# Divvy app — UI styleguide (the shared contract)

Every agent restyling a screen MUST follow this so the app looks like one
product. The look matches the live marketing site: **dark "on-chain receipt",
USDC-blue accent, mono numbers.** Goal: make it feel *easy, fast, and a little
delightful* — generous spacing, clear hierarchy, one obvious action per screen,
soft motion, friendly empty states.

## Non-negotiable rules
1. **Do not break behavior.** Preserve every element `id`, `data-*` attribute,
   event handler, fetch URL, and `window.<Module>` API. Read the file first.
   Change presentation only (markup structure of rendered output + styles).
2. **Use the design tokens** (CSS variables below) — never hardcode hex. The
   tokens are defined in `index.html` `:root`; they resolve everywhere.
3. **Money color rule:** owed *to you* / positive / paid = `var(--accent)`.
   *You owe* / negative / outstanding = `var(--terra)`. Neutral = `var(--cream)`.
4. **Numbers, amounts, labels, on-chain states use the mono font** (`.mono` or
   `font-family:var(--mono)`). UI text uses the sans (default).
5. Mobile-first, single column, comfortable tap targets (min 44px). Max content
   width is handled by the shell; don't set page widths.

## Tokens (already in :root)
```
--ink:#04121a          /* app background            */
--surface:#0a1f2b      /* cards                     */
--surface-2:#0e2734    /* inputs, raised rows       */
--line:rgba(246,241,231,0.10)  /* hairline borders  */
--cream:#f6f1e7        /* primary text              */
--muted:rgba(246,241,231,0.58) /* secondary text    */
--faint:rgba(246,241,231,0.38) /* tertiary / hints  */
--accent:#2775ca       /* USDC blue — primary       */
--accent-ink:#04121a   /* text on accent            */
--accent-soft:rgba(39,117,202,0.14)
--accent-line:rgba(39,117,202,0.34)
--terra:#e0a892        /* you-owe / debit           */
--terra-soft:rgba(224,168,146,0.13)
--radius:16px          /* cards */ 
--radius-sm:12px       /* inputs, small */
--mono:'JetBrains Mono',ui-monospace,monospace
--sans:'Space Grotesk',-apple-system,system-ui,sans-serif
```

## Component classes (defined globally in index.html — just use them)
- `.card` — surface panel: `var(--surface)`, 1px `var(--line)`, radius 16, padding 16, margin 12 0.
- `.btn` — primary pill button: `var(--accent)` bg, `--accent-ink` text, weight 700, radius 999, padding 14.
- `.btn.ghost` — transparent bg, 1px `var(--line)`, `var(--cream)` text.
- `.btn.sm` — compact (padding 9px 14px, font .9rem, width auto).
- `.pill` — inline rounded tag/action (auto width).
- `.chip` — toggle chip; `.chip.selected` fills `var(--accent)`.
- `.input` (inputs/selects) — `var(--surface-2)` bg, 1px `var(--line)`, radius 12, padding 12, cream text.
- `.eyebrow` — ALL-CAPS mono micro-label: font .68rem, letter-spacing .12em, `var(--muted)`, mono.
- `.hero-amount` — big balance: mono, ~2.6rem, weight 600. Add `.pos` (accent) or `.neg` (terra).
- `.row` — list row: flex, gap 12, align center, padding 12 0, `border-bottom:1px solid var(--line)`.
- `.avatar` — circle, 38px, `var(--surface-2)` bg, centered mono initial; can set bg color inline.
- `.avatar-stack` — overlapping avatars (margin-left:-10px on children).
- `.state-chip` — on-chain state: outlined pill + leading dot. Variants by class:
  `.reading`(muted), `.confirmed`(accent), `.finalized`(accent), `.settled`(accent solid).
  Markup: `<span class="state-chip finalized"><i></i>FINALIZED</span>`.
- `.empty` — empty state wrapper: centered, padding 36 16; contains a big glyph
  (`.empty-glyph`, ~40px, opacity .5), a line (`.empty-title`), and a hint (`.empty-hint`, muted).
- `.skeleton` — shimmer placeholder block (use while loading instead of "Loading…").
- `.toast` — transient confirmation (bottom center). Use `window.toast(msg)` if present.
- `.receipt` — perforated receipt card (for itemized bills): like `.card` but with a
  dashed divider (`.receipt hr`) and perforated bottom edge. Use for expense/bill itemization.

## Patterns
- **One hero, one primary action.** Each screen leads with the key number or
  state, then a single `.btn`; secondary actions are `.btn.ghost` or `.pill`.
- **Empty states sell the feature.** Replace bare "No X yet" text with an
  `.empty` block: glyph + one friendly line + a primary action to create the first one.
- **Loading = skeletons,** not the word "Loading…". Show 2–3 `.skeleton` rows.
- **Lists** use `.row` with an `.avatar`, a middle `.meta` (title + mono sub-line),
  and a right-aligned mono amount colored by the money rule.
- **Microcopy** is warm and short ("You're all settled ✓", "Ava owes you").
- **Motion**: rows/cards fade-and-rise in (transition 160ms ease), buttons scale
  to .97 on `:active`. Keep it subtle; respect `prefers-reduced-motion`.

## Don't
- Don't add a CSS framework or external libs.
- Don't redefine the global component classes inside a page file (use them).
- Don't change fetch endpoints, IDs, or the `window.<Module>` contract.
- Don't use green (`#14f195`) anywhere — the brand is USDC blue now.
