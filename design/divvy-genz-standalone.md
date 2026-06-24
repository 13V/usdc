# Divvy — standalone Gen-Z prompts (copy-paste ready)

Every block below is self-contained — it already includes the full style base, so
copy ONE block and paste it into Claude design. Style locked from research:
dark + vibrant, USDC-blue anchor, money in mono, lowercase dry voice, mascot,
emoji-as-data, "dollars just faster" (chain hidden), kinetic gradient only at the
settle moment. Screens: Settle up · New split · Group detail · Group chat ·
Activity · Friends · Recurring · You/Profile.

The shared base (baked into each block):
> Design a fun, premium mobile screen (390×844) for **Divvy** — split bills with
> friends and settle instantly in **USDC on Solana**, shown as plain dollars
> ("dollars, just faster" — never market it as "crypto"). Audience: young,
> crypto-native Gen-Z / millennials. Vibe: **Phantom-meets-Cash-App** — dark,
> vibrant, emoji-native, dry/irreverent, screenshot-worthy; the point is killing
> money-awkwardness between friends. **Dark canvas** (`#0B1622`, cards `#13212E`),
> one accent + soft glow per screen; **USDC blue `#2775CA` anchor** + mint
> `#3DE8C7`, coral `#FF6B5E`, sunshine `#FFC65C` for identity/celebration. **Money
> is the hero in MONO** (`Space Mono`/`JetBrains Mono`), big tabular digits with
> smaller/lighter `$` & decimals; headlines `Clash Display`/`General Sans`; UI
> `General Sans`; no Inter. A **kinetic blue→mint gradient reserved for the
> settle/success moment**, not a static bg. **Emoji as functional data** (paid 🫡,
> owe 👀); a soft-animated **mascot** (USDC-blue coin/blob); faint **money
> texture** (guilloché lines + a neon banknote security-strip) — no fake-3D coins.
> **Lowercase, dry, post-ironic voice**; renamed: split = **tab**, pay = **chip
> in**, done = **square**. Rounded 20–24px, chunky pills, bottom tab bar
> (Home·Groups·＋·Activity·You). AVOID: laser eyes/wagmi/🚀, flat web3-purple,
> fake-3D coins, rainbow-mesh bg, hexagon/blockchain motifs, seed-phrase/gas UI,
> candlesticks, celebrity FOMO, identical grey cards, tiny low-contrast numerals,
> Inter/one-font, cheap springy bounce.

---

## SETTLE UP  ⭐ (the dopamine moment)
[full base above] **SCREEN: Settle up** — the emotional payoff; satisfying and
instant. A focused card: "you → ava 🌸", a big **mono** `$31.00` (coral, − sign,
lighter `$`/decimals), fee hidden (it's ~nothing). A crisp **Solana Pay QR** on a
light tile + "open in wallet". **The moment:** on confirm, fire the **kinetic
blue→mint gradient sweep**, the **mascot does a happy reaction**, a haptic tap,
and the amount **ticks down to `$0.00`** as a **"squared ✨"** stamp lands.
Plain-flex caption: **"settled. <1 second. <1 cent."** + a tiny "view on solscan".
End on a screenshot-worthy "you're square with ava ✨" share card. Primary action
dominant; cancel is a quiet text link.

---

## NEW SPLIT  ⭐ (start a tab)
[full base above] **SCREEN: New split.** Headline "new tab". **Hero affordance:** a
big **scan receipt** tile ("snap it, we'll read the total") with a quieter "enter
manually". Inputs on dark wells with mono values: "what's it for?" ("dinner 🍜" —
emoji first-class), **total** (`$96.00`, big mono) + tip %. **Headcount stepper:**
− / a big mono `4` / + with member emoji-avatars. **Live preview (the hero):** a
two-tone bar that re-segments as people change + a mono line that ticks: **"each
chips in `$24.00`"**. Primary **send the tab** (one glowing blue button). Dry
reassurance: "no app needed to pay. dollars, just faster."

---

## GROUP DETAIL (the tab / ledger)
[full base above] **SCREEN: Group detail ("tokyo trip 🗼").** Header: name, a
stacked avatar row + "4 people", group total in mono; quiet pills **chat · recap ·
share**. **Hero:** "you're owed" + a big mono **+$84.00** (lighter `$`/decimals,
soft blue glow), then the **two-tone owe-bar** for this group and a short
**who-owes-who list** with arrows — "marco → you $31.00", "priya → you $53.00" —
two avatars + arrow + mono amount, minimized to the fewest payments. **Expenses**
as compact receipt rows with an emoji per expense ("dinner 🍜 · maya paid · split
4 · $96.00", mono) and tiny reaction emojis. Sticky bottom: **＋ add expense**
(primary) + **settle up** (secondary, when you owe).

---

## GROUP CHAT (receipt feed)
[full base above] **SCREEN: Group chat.** A warm feed where money is a first-class
object. Your bubbles right in a soft blue tint; others left on the raised surface;
lowercase mono author + time. Interleave: plain text bubbles; tappable **receipt
photos**; and **money cards** — an expense ("karaage ×2 🍢 · $24.00 · split 4",
mono) and a payment event as a mini receipt ("marco chipped in $31.00 · settled",
with the mascot + a "view" link), each with **emoji reactions** (🫡 👀 💀). Empty
state: "no messages yet — say hi or drop a receipt 📷". Composer: input, a 📷
attach, a **＋ split** shortcut, and a glowing blue send.

---

## ACTIVITY
[full base above] **SCREEN: Activity.** Lowercase "activity". Day-grouped (today /
yesterday) in small mono headers. Each event a feed row: emoji-avatar or the
mascot, a dry one-liner ("ava chipped in 🫡", "you started dinner 🍜", "bali crew
squared ✨"), a mono amount on the right (+blue / −coral, lighter `$`/decimals),
a mono relative time, and settle events carry a tiny "settled" tag + view link.
Keep emoji reactions visible. Friendly empty state + shimmer skeleton rows while
loading. Bottom tab bar, Activity active.

---

## FRIENDS
[full base above] **SCREEN: Friends.** Lowercase "your people". **Add** on a dark
well: a mono input (handle or wallet) + a 📷 QR-scan (never hand-type a wallet) +
one glowing blue **add** button. **List:** rows with a bright emoji/initial-chip
avatar, name + @handle, the wallet truncated in mono (`7xKX…gAsU`) with a copy
affordance, the net with that friend in mono (blue/coral), and a small **split**
pill. A "saved tabs" chip strip with avatar stacks. Empty: the mascot + "add your
first person to split in one tap".

---

## RECURRING (autopilot)
[full base above] **SCREEN: Recurring.** Lowercase "on autopilot". **Each item a
bento card** (the next-due one featured larger): title ("apartment 4b · rent 🏠"),
a big mono amount, a cadence pill ("monthly") + an `active`/`paused` indicator, a
mono sub "next: jul 1 · split 3" with a tiny owe-bar preview and a subtle progress
ring to the next run. **New** on a well: mono inputs (title, amount, interval, next
due, members) + one button. Empty: the mascot + "set the bills you split every
month and forget them".

---

## YOU / PROFILE
[full base above] **SCREEN: You.** Lowercase "you". Header: a big emoji/initial
avatar with the **mascot** beside it, display name, @handle, and the wallet
truncated in mono (`7xKX…gAsU`) with a copy affordance. **Balance card**
(receipt-style with faint money texture + perforated edge): "your balance" + a big
mono **`$248.50`** USDC (lighter `$`/decimals, soft blue glow), a speed-flex chip
**"settles instantly · ~$0.001 fee"**, and two chunky buttons — **add money**
(glowing blue) + **cash out** (ghost) — with a dry note "spend it with any card.
dollars, just faster." A tidy settings list (rows: emoji/icon + lowercase label +
chevron): friends · recurring · saved tabs · notifications · network
(devnet/mainnet) · help · **sign out** (coral). Quiet and utilitarian but still
warm — the mascot adds personality. Bottom tab bar, You active.
