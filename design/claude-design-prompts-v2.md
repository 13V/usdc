# Divvy — Claude-design prompts v2 (research-backed, anti-slop)

Each section below (pages 3–11) is **self-contained**: it already includes the
BASE block, so you can copy one whole section and paste it straight into Claude
design. The BASE is also printed once at the top for reference.

Research distilled from Splitwise/Tricount/Splid, Cash App, Robinhood, Venmo,
Monzo, Mercury, Phantom, Rainbow, Coinbase/Base, and 2024–25 design-trend +
"AI-slop" critiques. Core idea: push OFF the statistically-average dark-card
screen with intention — layered tinted blacks, one rationed accent, money as an
oversized tabular-mono hero, a signature segmented owe-bar, bento layouts, and
one repeated "/" motif.

---

## BASE (already included in every prompt below)

> Design a single polished mobile screen (390×844) for **Divvy** — an app to
> split bills with friends and settle up in **USDC on Solana**. Make it premium,
> distinctive, and genuinely easy to use — the OPPOSITE of a generic dark-mode
> card list. A senior product designer's work, not a template.
>
> **DESIGN LAWS**
> 1. **Layered, brand-tinted off-black — never flat #000 or grey.** Background
>    `#04121A`, cards `#0A1F2B`, raised rows `#0E2734`, inset wells `#081019`.
>    Convey depth by making higher surfaces *lighter*, with 1px hairline borders
>    `rgba(246,241,231,0.08)` — NOT a drop shadow on every element.
> 2. **One rationed accent: USDC blue `#2775CA`**, on a single hero element per
>    screen. Money color rule everywhere: **owed to you / positive / paid = USDC
>    blue; you owe / outstanding = terracotta `#E0A892`; settled = cream**. Never
>    use green.
> 3. **Money is the hero.** Set the key figure huge (48–72px), tight tracking,
>    **tabular mono** numerals, decimals always shown (`$84.00`). On change,
>    numbers roll odometer-style, never hard-cut.
> 4. **Type with a voice:** `Clash Display` for big numbers + headlines,
>    `General Sans` for UI text, `JetBrains Mono` for amounts, wallet addresses,
>    dates, and on-chain states (load via Fontshare/Google Fonts). Big size jumps;
>    hierarchy from size + space, not weight. No Inter, no single-font system.
> 5. **Break the uniform card grid — use a bento layout:** one hero tile plus a
>    few varied-size tiles/rows; tight spacing within a group, generous between
>    sections. Never an endless stack of identical equal-height rounded cards.
> 6. **Signature motifs, reused:** a USDC-blue rounded-square "/" **divide mark**
>    (logo + settle moment); a horizontal **segmented owe-bar** (blue vs
>    terracotta segments, each tagged with a member avatar) as the who-owes-whom
>    visual — NOT a donut/pie; perforated paper **receipt cards**; and **on-chain
>    state pills** (`READING → CONFIRMED → FINALIZED → SETTLED`) as outlined pills
>    with a leading dot.
> 7. **Identity is human:** real avatars or deterministic colored initial-chips,
>    never grey placeholder circles. Wallets shown truncated in mono (`7xKX…gAsU`).
> 8. **Warm, plain microcopy** ("Ava owes you", "You're all settled ✓"). Friendly
>    empty states; shimmer skeletons while loading (never the word "Loading…").
>
> **AVOID (AI-slop tells):** identical rounded cards stacked at even 16px; one
> neon accent floating on grey; colored side-border stripes; pure black; a glow
> shadow on every card; Inter/one-font systems; donut/pie charts; emoji used as
> the icon set; hidden decimals; proportional (non-tabular) digits; centered
> everything with no hierarchy.

---

## PAGE 3 — Groups

[BASE — see above; paste it, then this:]

**Screen: Groups** — your shared ledgers, as a confident bento, not a card stack.

- Top: brand "/" mark + "Divvy" + a small avatar; below it an eyebrow folded into
  the headline — **"Groups"** with a quiet "4 active" beside it (no pill chip).
- **Hero tile (full-width, the only accent moment):** "ACROSS ALL GROUPS" label,
  then a huge tabular-mono **`+$165.00`** net (USDC blue), sub "you owe $31.00 in
  one". Under it, a single **segmented owe-bar**: blue segments (people who owe
  you) vs one terracotta segment (where you owe), each segment tagged with a tiny
  avatar. A `Settle up` text-button sits inline.
- **Group rows below** (varied, not identical): each shows a tight stack of member
  avatars, the group name in General Sans, a mono sub-line of latest activity
  ("Maya added Ramen · 2h"), and on the right the user's balance in tabular mono
  by the money rule — or a `SETTLED` state-pill when squared. Give one row a
  larger "featured" treatment (most active group) to break the rhythm.
- Examples: Tokyo trip +$84.00, Apartment 4B −$31.00 (mono tag "AUTO-SPLIT · JUN
  1"), Bali crew SETTLED, Roommates +$12.00.
- A prominent but secondary **＋ New group** action (ghost/outline pill, top-right
  of the list — not competing with the hero number).
- Empty state: the "/" mark, "Start a group", one warm line, one primary button.
- Fixed bottom tab bar: Home · Groups(active) · ＋ · Activity · You.

---

## PAGE 4 — Group detail (the ledger)

[BASE — see above; paste it, then this:]

**Screen: Group detail ("Tokyo trip")** — a shared ledger that reads like a clean
receipt, with the balance picture as the hero.

- Header: group name (Clash Display), a stacked avatar row + "4 people", and the
  group total in mono. A row of quiet action pills: **Chat · Recap · Share**.
- **Hero: the settle picture.** "YOU'RE OWED" label + a big tabular-mono
  **`+$84.00`** (blue). Directly under it, the **segmented owe-bar** for this group
  (each member a colored segment sized to what they owe, avatar on the segment),
  then a short **simplified-debts list** — "Marco → you $31.00", "Priya → you
  $53.00", "you → Maya $0" — each a one-line row with two avatars, an arrow, and a
  mono amount (Splitwise-style "simplify debts").
- **Expenses** section: each expense a compact **perforated receipt row** — title
  ("Dinner — Izakaya 🍜"), mono amount, "Maya paid · split 4 ways", relative time;
  the emoji memo is first-class. Show 3 with varied amounts.
- **Members** row: avatars + names with small state-pills (You / Linked /
  Unclaimed).
- Sticky bottom bar: **＋ Add expense** (primary) and **Settle up** (secondary,
  shown when you owe).

---

## PAGE 5 — Group chat / receipt feed

[BASE — see above; paste it, then this:]

**Screen: Group chat** — a warm messaging surface where receipts and payments are
first-class objects in the conversation (Venmo's "payment as social object").

- Full-screen feed. Your bubbles right-aligned in a soft USDC-blue tint with a
  subtle blue edge; others left on the raised surface. Author + time as tiny mono
  labels.
- **Interleave three object types** in the timeline, visually distinct:
  (a) plain text bubbles; (b) a tappable **receipt photo** (rounded, hairline
  border); (c) **expense/payment cards** — a mini perforated receipt ("Karaage ×2
  🍢 · $24.00 · split 4 ways") and payment events rendered as an **on-chain
  receipt chip** ("Marco paid you $31.00 · FINALIZED" with the state pill + a tiny
  "view" link). The emoji memo is a first-class field on every money object.
- Empty state: "No messages yet — say hi or drop a receipt 📷".
- Composer: a clean input, an attach-photo button, a **＋ split** shortcut, and a
  circular USDC-blue send button. Keep it calm and tactile.

---

## PAGE 6 — New split (create a bill)

[BASE — see above; paste it, then this:]

**Screen: New split** — the fastest possible scan → split → done, with the math
as a live hero.

- Headline "New split". **Hero affordance:** a large **Scan receipt** tile
  (camera glyph, "Snap it — we read the total") as the primary path; a quieter
  "enter manually" below.
- Inputs on raised wells with mono values: **What's it for?** ("Dinner 🍜" — emoji
  memo first-class), **Total** (`$96.00`, big tabular mono) and **Tip %**, plus a
  subtle "another currency?" disclosure.
- **Headcount as a tactile stepper:** − / a big odometer-mono **`4`** PEOPLE / +
  inside a single rounded control. A quiet "name them / use a group" reveal shows
  member chips.
- **Live split preview (the hero):** a **segmented owe-bar** that re-segments as
  people change, with a tabular-mono line that rolls: **"Each pays `$24.00` USDC"**
  in blue.
- Primary action: **Generate payment links** (the one accent button). Reassurance:
  "Settles in USDC. No app needed to pay — wallet QR or card."

---

## PAGE 7 — Payment request / on-chain receipt

[BASE — see above; paste it, then this:]

**Screen: Bill result** — render it as a real, shareable **on-chain receipt
artifact** (the receipt IS the brand; field set modeled on a tx detail view).

- A large **perforated receipt card** with a faint paper texture: header eyebrow
  "ON-CHAIN RECEIPT · USDC", the title + total in tabular mono ("Dinner — Izakaya
  🍜 · `$96.00`"), then a dashed divider and an honest line-item block —
  "Collected `$24.00` / Outstanding `$72.00`", "Network fee ~`$0.0001`".
- **Per-person rows:** avatar + name + mono share amount, each with a status pill
  using a desaturated wash fill + saturated text: `PAID ✓` (blue) with a small
  "1 confirmation", or `OWES` (terracotta outline). Show one paid, two owing, with
  +/− signs so it's not color-only.
- A small live **"1 of 3 settled"** progress line in mono; the card's bottom edge
  is perforated/scalloped.
- Primary **Check payments**; secondary **Share** and **New bill**. If everyone's
  paid, stamp a rotated **SETTLED ✓** on the receipt.

---

## PAGE 8 — Settle up (Solana Pay, the trust moment)

[BASE — see above; paste it, then this:]

**Screen: Settle up** — the confidence-defining on-chain moment, designed like a
modern signing sheet (simulate-before-sign calm, not a block explorer).

- A focused **diff hero:** "You pay" with a big tabular-mono **`$31.00 USDC`**
  (terracotta, − sign) flowing to "Ava" (avatar + truncated mono wallet
  `7xKX…gAsU`) — outgoing clearly distinct from incoming, gas/fee on its own muted
  row ("network fee ~`$0.0001`"), never blended into the amount.
- A crisp **Solana Pay QR** centered on a light tile (so it scans), with "Scan
  with any Solana wallet" and an **Open in wallet** link.
- **The star: a live on-chain state pill** animating `READING → CONFIRMED →
  FINALIZED` (200–400ms transitions, gradual color shift, optional confirmation
  count), then a **full-bleed USDC-blue success moment** with a drawn-on
  checkmark and the receipt stamping **SETTLED ✓**. Note a haptic tap at confirm.
- Reassurance microcopy: "Irreversible · arrives in seconds · view on Solscan".
  Primary action dominant; Cancel demoted to a text button.

---

## PAGE 9 — Activity

[BASE — see above; paste it, then this:]

**Screen: Activity** — a chronological, on-chain-aware feed where each event is a
social-payment object.

- Headline "Activity" with a mono "ON-CHAIN" tag folded in. Day-grouped sections
  with small mono date headers (TODAY / YESTERDAY / JUN 18).
- **Each event a feed row:** a real avatar or a custom glyph, a one-line story
  (bold subject + muted detail — "Ava paid you 🍜", "Marco added Dinner", "Bali
  crew settled"), a tabular-mono amount on the right by the money rule (+blue /
  −terracotta), and a mono relative time. Settlement/payment events carry an
  on-chain **state pill** (`FINALIZED` / `SETTLED`) with a tiny "view" link.
- Keep the emoji memo visible (Venmo-style). Vary row emphasis for big events.
- Friendly empty state; shimmer skeleton rows while loading.
- Fixed bottom tab bar, Activity active.

---

## PAGE 10 — Friends

[BASE — see above; paste it, then this:]

**Screen: Friends** — identity-forward; your crew ready to split in one tap.

- Headline "Friends" with a mono "YOUR CREW" folded in.
- **Add a friend** on a raised well: a mono input (handle or wallet) with a
  toggle (by handle / by wallet) and one accent **Add** button; QR-scan affordance
  (don't make people hand-type a wallet).
- **Friends list:** rows with a deterministic colored initial-chip avatar, name +
  @handle, the wallet truncated in mono (`7xKX…gAsU`) with a copy affordance, the
  net balance with that friend in tabular mono (blue/terracotta), and a small
  **Split** pill action. Avoid identical grey rows — let the avatar color and the
  balance carry visual variety.
- A "SAVED GROUPS" strip: chips with stacked member avatars.
- Empty state: "Add your first friend to split in one tap." + primary button.

---

## PAGE 11 — Recurring splits

[BASE — see above; paste it, then this:]

**Screen: Recurring** — bills that auto-split on a schedule (rent, utilities).

- Headline "Recurring" with a mono "AUTOPILOT" tag folded in.
- **Each item a bento card** (vary sizes; the next-due one featured larger): title
  ("Apartment 4B — Rent 🏠"), a big tabular-mono amount, a cadence **state pill**
  ("MONTHLY") plus an `ACTIVE` / `PAUSED` indicator, and a mono sub-line "next due
  Jul 1 · split 3 ways" with a tiny segmented owe-bar preview. A subtle progress
  ring to the next run.
- **New recurring split** on a well: mono inputs for title, amount, interval, next
  due, participants (member chips), and one primary button.
- Empty state: a "↻" mark, "Automate the bills you split every month", a primary
  button. Calm, dependable, set-and-forget tone.
