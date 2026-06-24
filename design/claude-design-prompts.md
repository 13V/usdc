# Divvy — Claude design prompts (one per page)

How to use: paste **§0 Brand System** first, then any page prompt below it in the
same message. Each page prompt also restates the essentials so it works alone.
Target: a polished, mobile-first product screen (390 × 844), dark theme.

---

## §0 — Brand System (paste this above any page prompt)

You are designing screens for **Divvy**, a mobile app to split bills with
friends and collect the money in **USDC on Solana** — instant, almost free, no
chargebacks. The feeling is **premium fintech meets "on-chain receipt"**: dark,
confident, warm, quietly delightful — Linear/Things-level polish with a
crypto-native edge. NOT loud, neon, or "web3 bro." Clean, trustworthy, friendly.

Design system (use exactly):
- **Background** ink `#04121A`. **Card surfaces** `#0A1F2B`, raised rows `#0E2734`.
  **Hairline borders** `rgba(246,241,231,0.10)`.
- **Text**: primary cream `#F6F1E7`, muted `rgba(246,241,231,0.58)`, faint
  `rgba(246,241,231,0.38)`.
- **Accent**: USDC blue `#2775CA` — primary buttons, links, and *money owed to
  you / positive / paid*. **Terracotta** `#E0A892` — *money you owe / debts*.
  **Never use green.**
- **Type**: *Space Grotesk* for UI and headings; *JetBrains Mono* for ALL
  numbers, amounts, labels, on-chain states, wallet addresses, and dates.
- **Money color rule** (apply everywhere): owed-to-you / positive / paid = blue;
  you-owe / outstanding = terracotta; neutral / settled = cream.
- **Signature motifs**: perforated paper **receipt cards** (dashed dividers,
  scalloped/perforated bottom edge); **on-chain state chips** — outlined pills
  with a leading dot reading `READING → CONFIRMED → FINALIZED → SETTLED`;
  ALL-CAPS mono **eyebrow** micro-labels above sections; **stacked circular
  avatars**; soft blur; radii 12–16px; generous spacing.
- **Brand mark**: a USDC-blue rounded square containing a white forward-slash
  "/" (a divide mark). Wordmark: **Divvy**.
- **Layout**: mobile-first single column. Sticky top bar (brand mark + wordmark +
  small avatar). Fixed **bottom tab bar**: Home · Groups · ＋(raised blue FAB) ·
  Activity · You. Min 44px tap targets. Safe-area padding top and bottom.
- **Ease-of-use rules**: one clear hero (the key number or state) and **one
  obvious primary action** per screen; warm, short microcopy ("You're all
  settled ✓", "Ava owes you"); friendly empty states that sell the feature;
  skeleton shimmer while loading (never the word "Loading…").

Deliver a beautiful, immediately usable screen that feels like one cohesive
product with the other Divvy screens.

---

## 1 — Onboarding / Sign in

Design the **first-run / sign-in** screen. Goal: get someone in within seconds,
with zero crypto intimidation.

- Hero: the Divvy slash mark, the wordmark, and a one-line promise — "Split the
  bill. Get paid back in USDC — instant, no chargebacks."
- A short 3-dot value strip (mono micro-labels): "SCAN", "SPLIT", "SETTLE".
- Primary action: **Create a wallet** (accent pill) — emphasize "no app, 10
  seconds." Secondary: **Connect a wallet** (ghost pill). Tertiary text link:
  **Sign in with email**.
- A faint trust line at the bottom: "Non-custodial · USDC on Solana · your keys".
- Subtle background: a barely-there perforated-receipt texture or a soft blue
  glow behind the mark. Keep it calm and premium.

---

## 2 — Home / Balances (the centerpiece)

Design the **Home / Balances** dashboard — the emotional core of the app.

- Top bar with brand + your avatar.
- **Hero**: an eyebrow "YOU'RE OWED · ACROSS 3 GROUPS", then a huge **mono**
  net balance `+$142.50` in USDC blue (terracotta if you're net-negative), and a
  one-line sub in terracotta: "you owe $31.00 elsewhere".
- Two actions under the hero: **Settle up** (accent pill) and **Request** (ghost
  pill).
- Section "BY PERSON" (eyebrow): rows of avatar + name + a mono amount on the
  right, colored by the money rule — e.g. "Ava — +$84.00" (blue), "Marco —
  −$31.00" (terracotta), "Priya — settled ✓" (cream/faint).
- Section "BY GROUP": same row style with stacked-avatar clusters — "Tokyo trip
  +$84.00", "Apartment 4B −$31.00 · auto-splits monthly", "Bali crew settled".
- Friendly empty state for new users ("Nothing to settle yet — start a split").
- Bottom tab bar, Home active.

---

## 3 — Groups list

Design the **Groups** screen — a list of shared ledgers, styled like a warm chat
inbox.

- Eyebrow "SHARED LEDGERS", title "Groups", a one-line intro.
- Primary action up top: **＋ New group** (accent or prominent ghost).
- List of group cards/rows: a stacked cluster of member avatars, the group name,
  a mono sub-line of last activity ("Ava added Tonkatsu set · $52" / "Rent ·
  auto-splits monthly"), and the user's balance on the right (money color rule),
  or a "SETTLED" state chip when squared up.
- Show 3–4 example groups: "Tokyo trip" (+$84.00), "Apartment 4B" (−$31.00),
  "Bali crew" (settled), "Roommates".
- A friendly empty state with a receipt glyph + "Start your first group" primary
  button for when there are none.
- Bottom tab bar, Groups active.

---

## 4 — Group detail (the ledger)

Design a **Group detail** screen — the shared ledger for one group ("Tokyo trip").

- Header card: group name, a stacked avatar row of members + count, and the
  group total in mono. Quick action pills: **Chat**, **Recap**, **Share link**.
- "YOUR BALANCE" eyebrow + a mono figure with the money rule ("+$84.00 — you're
  owed").
- "EXPENSES" section: each expense as a small **receipt card** — title ("Dinner —
  Izakaya"), who paid + how many people split it, a mono amount, and a relative
  time. Show 3 examples with varied amounts.
- "MEMBERS" section: avatars + names with small state chips (You / Linked /
  Unclaimed).
- Sticky bottom: **＋ Add expense** primary, and a secondary **Settle up** when
  the user owes.
- Keep it scannable — the ledger should read like a clean receipt feed.

---

## 5 — Group chat / receipt feed

Design the **group chat** for a trip — a warm messaging surface where receipts
and expenses live inline with the conversation.

- Full-screen chat. Your messages right-aligned in a soft USDC-blue bubble
  (`accent` tint with a blue edge); others left-aligned on the raised surface.
- Author name + time as tiny **mono** labels.
- Interleave **receipt cards** in the feed: when someone adds an expense, it
  appears as a perforated mini-receipt ("Karaage ×2 · $24 · split 4 ways") with a
  state chip. Also show a real **receipt photo** message (rounded, tappable).
- A friendly empty state: "No messages yet — say hi or drop a receipt 📷".
- Bottom composer: a clean input with an attach-photo button and a circular
  accent **send** button.

---

## 6 — New split (create a bill)

Design the **New split** flow screen — the fastest possible "scan → split → done".

- Eyebrow + title "New split".
- A prominent **Scan receipt** card (camera glyph, "Snap the receipt, we read
  the total") as the hero affordance; secondary "enter manually".
- Fields on cards with mono inputs: **What's it for?** ("Dinner"), **Total**
  ($96.00, big mono) and **Tip %**; an optional "Amount in another currency?"
  disclosure.
- A delightful **headcount stepper**: − / big mono "4" PEOPLE / + inside a
  rounded control. Below it, a subtle link "Name them / use a group" revealing
  member chips.
- Live per-head math line: "Each pays $24.00 USDC" in mono blue.
- Primary action: **Generate payment links** (accent pill). Reassurance line:
  "Settles in USDC. No app needed to pay — wallet QR or pay-with-card."

---

## 7 — Payment request / result receipt

Design the **bill result** screen — a shareable **on-chain receipt**.

- A large perforated **receipt card**: eyebrow "ON-CHAIN RECEIPT · USDC", the
  title + total in mono ("Dinner — Izakaya $96.00"), a dashed divider, then
  "Collected $24.00 / Outstanding $72.00".
- Per-person rows: avatar/QR thumbnail + name + mono share amount + a status chip
  ("OWES" outlined, or "PAID ✓" in blue). Show one paid, two owing.
- Perforated scalloped bottom edge on the card.
- Primary: **Check payments** (accent). Secondary: **Share** and **New bill**
  (ghost). A small live "1 of 3 paid" progress hint in mono.

---

## 8 — Settle up (Solana Pay)

Design the **Settle up** screen — the trust-defining on-chain moment.

- A focused receipt card for one transfer: "You → Ava" with a big mono amount
  "$31.00 USDC".
- A crisp **Solana Pay QR** centered on a light tile (so it scans), with "Scan
  with any Solana wallet" beneath, and an **Open in wallet** link.
- The star element: a live **on-chain state chip** that animates through
  `READING → CONFIRMED → FINALIZED`, then stamps **SETTLED ✓** in blue on the
  receipt when done. Show the FINALIZED→SETTLED moment.
- Reassurance microcopy: "Irreversible · ~$0.0001 fee · arrives in seconds."
- Keep everything calm and confidence-building.

---

## 9 — Activity feed

Design the **Activity** feed — a chronological, on-chain-aware timeline.

- Eyebrow "ON-CHAIN ACTIVITY", title "Activity".
- Day-grouped sections with small mono date headers (TODAY / YESTERDAY).
- Each event as a row: a leading avatar or glyph, a one-line description (bold
  subject + muted detail — "Ava paid you", "Marco added Dinner", "Bali crew
  settled"), a mono amount on the right by the money rule, and a mono relative
  time. Settlement events carry a **SETTLED / FINALIZED** state chip.
- Friendly empty state; skeleton rows while loading.
- Bottom tab bar, Activity active.

---

## 10 — Friends

Design the **Friends** screen — your crew, ready to split with.

- Eyebrow "YOUR CREW", title "Friends".
- **Add a friend** card: a mono input (handle or wallet) with an accent **Add**
  button and a toggle between "by handle" / "by wallet".
- Friends list: rows of avatar (mono initial) + name/handle + a mono short
  wallet ("7xKX…gAsU") + a small **Split** pill action.
- A "SAVED GROUPS" strip of chips with member avatar stacks.
- Friendly empty state: "Add your first friend to split in one tap."
- Bottom tab bar (this lives under "You").

---

## 11 — Recurring splits

Design the **Recurring** screen — bills that auto-split on a schedule (rent, etc.).

- Eyebrow + title "Recurring".
- Each item as a card: title ("Apartment 4B — Rent"), a big mono amount, a
  cadence **state chip** ("MONTHLY") and an "ACTIVE"/"PAUSED" indicator, and a
  mono sub-line "next due Jul 1 · split 3 ways".
- A **New recurring split** form on a card: mono inputs for title, amount,
  interval, next due, participants (member chips), and a primary button.
- Friendly empty state with a "↻" glyph + "Automate the bills you split every
  month."

---

## 12 — Recap / share card (1080×1080)

Design a square **shareable recap card** for the "everyone settled" moment
(Instagram-story ready, 1080 × 1080).

- Ink background, a rounded inner surface panel with a hairline USDC-blue frame.
- Brand lockup top-left: the slash mark + "Divvy" wordmark, with a mono eyebrow
  "SETTLE-UP RECAP".
- Hero: "Total split" label over a huge mono accent-blue amount ("$1,284.00"),
  the trip name ("Tokyo trip · 4 people"), and 2 muted breakdown lines (biggest
  expense, per-person average).
- A playful **SETTLED ✓** stamp (rotated, accent-tinted pill) over the corner.
- Footer hairline + tagline "Split the bill. Settle in USDC."
- Make it genuinely share-worthy — the kind of card people post.

---

## 13 — You / Profile (wallet)

Design the **You** screen — profile, wallet, and settings.

- Header: large avatar, display name, @handle, and a mono short wallet address
  with a copy affordance.
- A **balance card**: "USDC BALANCE" eyebrow + a big mono figure, with **Add
  funds** (accent) and **Withdraw / Cash out** (ghost) actions; a small note
  "Attach a crypto card to spend what you collect."
- A tidy settings list (rows with leading glyphs): Friends, Recurring splits,
  Saved bills, Notifications, Network (Devnet/Mainnet), Sign out.
- Quiet and utilitarian — the calm counterpart to the lively Home screen.
