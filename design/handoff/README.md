# Handoff: Divvy — bill-splitting app (mobile)

## Overview
Divvy is a mobile app for splitting bills with friends and settling instantly in USDC on Solana — but presented to users as **plain dollars** ("dollars, just faster"). It is **never marketed as "crypto."** This package covers the full **17-screen** canonical set: onboarding, home, groups (list + detail), new tab, settle-up flow, tab-collect, group chat, activity feed, transaction receipt, recurring bills (list + detail), friends (list + detail), the "you" profile, and a "customize your profile" identity picker.

> **One aesthetic only.** Every screen in this bundle belongs to the **"Playful" dark system** (lowercase voice, General Sans + Clash Display + Space Mono, `#0B1622` canvas, the USDC-blue mascot). An earlier, **superseded** direction also existed in the source project (Title Case, Space Grotesk, cream `#F6F1E7` on `#04121A`) — those files are **intentionally excluded.** Build only what's in this folder.

Audience: young, crypto-native Gen-Z / millennials. Vibe: Phantom-meets-Cash-App — dark, vibrant, emoji-native, dry/irreverent, screenshot-worthy. The product goal is **killing money-awkwardness between friends.**

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, **not production code to copy directly.** They are authored as "Design Components" (a streaming HTML format) and use inline styles throughout.

The task is to **recreate these designs in the target codebase's environment** (React Native, Expo, SwiftUI, Flutter, etc.) using its established patterns, component library, and navigation. If no environment exists yet, choose the most appropriate mobile framework for the project and implement there. Do **not** ship the HTML directly.

All screens are designed at a **390 × 844** logical viewport (iPhone 12/13/14 class). Treat that as the baseline; scale fluidly to other device widths.

## Fidelity
**High-fidelity (hifi).** These are pixel-considered mockups with final colors, typography, spacing, emoji usage, and interaction intent. Recreate the UI faithfully using the codebase's libraries. Exact values are listed in **Design Tokens** below; per-screen specifics follow.

---

## Design Language (applies to every screen)

### Color
- **Canvas / background:** `#0B1622` (near-black blue). Deepest backdrop behind device: `#050d15`.
- **Cards / raised surfaces:** `#13212E`. A darker recessed well: `#0e1a25` / `#0f1a24`.
- **Primary text:** `#F4F7FA`. Muted text: `rgba(244,247,250,0.45–0.6)`. Faint: `rgba(244,247,250,0.3–0.4)`.
- **USDC blue (anchor accent):** `#2775CA`. Lighter blue for text/glow: `#3B92E8`, `#7fc0ff`, `#5BA6F0`.
- **Mint (success / settled / celebration):** `#3DE8C7`.
- **Coral (you-owe / destructive):** `#FF6B5E`.
- **Sunshine (identity / warmth):** `#FFC65C`.
- **Violet (identity option only):** `#8B5CF6`.
- **Rule:** one accent + one soft glow per screen. Owed-to-you = **blue**; you-owe = **coral**; settled/done = **mint**.

### The "settle / success" gradient (reserved)
A **kinetic blue→mint gradient** (`linear-gradient(90deg,#2775CA,#3DE8C7,#2775CA)`, animated by shifting `background-position` left→right, ~4s linear loop) is reserved for **settle / payment-success moments only** (e.g. the "marco chipped in · settled" card in chat). It is **not** a static background anywhere.

### Typography
- **Money + all numerals + labels/meta/handles/addresses:** monospace — **Space Mono** (or JetBrains Mono). Big tabular digits; the `$` sign and decimals are rendered **smaller and lighter** (≈0.5 opacity, ~half the font-size) than the integer part. Negative/owe amounts use a `−` prefix in coral; positive in blue.
- **Headlines / titles / button labels:** **Clash Display** (600) with General Sans fallback.
- **UI / body text / names:** **General Sans** (400/500/600).
- **No Inter. No single-font designs.** Fonts loaded from Fontshare (Clash Display, General Sans) + Google Fonts (Space Mono).

### Voice & nomenclature (lowercase, dry, post-ironic)
All UI copy is **lowercase**. Renamed verbs used consistently:
- **split → "tab"** (a shared expense is a "tab")
- **pay → "chip in"**
- **done / settled → "square"** ("all squared", "square up", "squared ✨")
- Emoji used as **functional data**, not decoration: paid `🫡`, watching/owe `👀`, dead/funny `💀`, celebration `✨`.

### Shape & spacing
- Border radius: **20–24px** on cards; 12–16px on inner tiles/inputs; 999px on pills/buttons.
- Buttons are **chunky pills** (min-height 50–56px).
- Generous padding (16–22px inside cards).
- Use flex/grid with `gap` for all element groups.

### The mascot (canonical — same character everywhere)
A **full-body** round USDC-blue blob/coin character:
- Body: ~`linear-gradient(155deg,#4aa0f0,#2775CA 60%,#1c5697)`, with a soft inset highlight (`inset 0 2px 5px rgba(255,255,255,0.28)`) and an **outer radial glow** (`radial-gradient(circle, rgba(39,117,202,0.4), transparent 70%)`, gently pulsing).
- Face: **two dark dot eyes** (`#0B1622`, occasional blink) + a **small smile** (a `border-bottom` half-rounded rect, `#0B1622`).
- **Two short rounded arms** on the sides and **two small rounded feet** at the bottom (slightly darker blue gradients), gently waving/gesturing.
- Motion: ease-based float (translateY ±5–7px) + a slow "squish" of the border-radius. **Never** a cheap springy bounce. **Never** a headless/faceless corner blob.
- Expressions adapt per state: happy + thumbs-up `👍` (customize), waving (header/empty), watching the chain, etc.
- **Placement rule:** the mascot is a **companion** — it must **not overlap a user's avatar/photo.** It belongs on emotional/action moments (settle, success, empty states, onboarding, profile header, customize), not pasted onto utility content.

### Money texture (subtle)
- **Guilloché:** a faint `repeating-radial-gradient(circle at 84% 2%, rgba(244,247,250,0.025) 0 1px, transparent 1px 8px)` overlay at low opacity on the canvas and on receipt cards.
- On receipt-style cards: a soft, low-opacity **foil shimmer** band (`linear-gradient(102deg, transparent, rgba(127,192,255,0.045) 50%, rgba(255,255,255,0.03) 60%, transparent)`) — **not** a hard line or dotted "security strip."
- Receipt cards have a **perforated edge** (a row of `#0B1622` half-circles) and a **dashed tear divider** with two notch circles.

### Things to AVOID (explicit)
Laser eyes / "wagmi" / 🚀; flat web3-purple; fake-3D coins; rainbow-mesh backgrounds; hexagon/blockchain motifs; seed-phrase/gas UI front-and-center; candlesticks; celebrity FOMO; identical grey cards; tiny low-contrast numerals; Inter or single-font; cheap springy bounce animations.

### Bottom tab bar (shared)
Five items: **Home · Groups · ＋ · Activity · You**. Center `＋` is a raised 52px blue gradient FAB (radius 18px). Active tab gets a `rgba(39,117,202,0.18)` rounded chip behind a blue icon + blue mono label; inactive icons/labels are `rgba(244,247,250,0.5)`. Labels are 8.5px Space Mono, letter-spacing 0.8px. Bar height 84px, background `rgba(8,17,26,0.94)`, top hairline border.

### Status bar (shared, mocked)
Left: `9:41` (Space Mono 700, 14px). Right: `5G` + a battery glyph.

---

## Screens / Views

> Each screen is a fixed 390×844 frame: status bar → header/top bar → scrollable content → (composer or sticky CTA or tab bar). Several screens expose **state variants** (documented per screen) the developer should implement as real app states.

### 1. Group Chat (`Group Chat Frames.dc.html`)
**Purpose:** A warm group conversation where money is a first-class object in the feed.
**Layout:** Status bar → top bar (back ‹, group avatar 🗼 with mint online dot, "tokyo trip" + mono "maya, marco +2 · 3 online", ⋯) → scrolling message feed (gap 14px) → composer.
**Feed item types:**
- **Day divider:** centered mono pill "TODAY · JUN 24".
- **Other's text bubble (left):** lowercase mono author + time above; 33px emoji avatar; bubble `#13212E`, radius `20px 20px 20px 6px`, 15px General Sans.
- **Your text bubble (right):** blue tint `rgba(39,117,202,0.18)`, border `rgba(39,117,202,0.4)`, radius `20px 20px 6px 20px`, aligned right; mono "you" + time.
- **Receipt photo (tappable):** 198px striped placeholder (`repeating-linear-gradient(135deg, rgba(244,247,250,0.05) 0 9px, transparent 9px 18px)`) with 🧾, mono "receipt.jpg", and a bottom "tap to view 📷" gradient footer.
- **Expense money card:** raised card, left blue accent bar, 46px emoji tile (🍢), Clash title "karaage ×2", mono meta "new tab · maya paid · split 4", big mono amount `$24.00` with "you owe $6.00" coral subline, an avatar stack, and a blue **"chip in ＋"** pill. Below: reaction chips (🫡 2, 👀 1).
- **Payment/settle event (mini receipt):** the **kinetic blue→mint gradient border** card (1.5px animated gradient, inner `#0f1d29`); contains the **mascot blob**, "marco chipped in **$31.00**" (amount in mint mono), mint "settled · ~$0.001" with a pulsing dot, and a mint **"view ↗"** pill. Reactions (🫡 3, 💀 1).
- **Typing indicator:** avatar + three pulsing dots in a left bubble.
**Composer (sticky bottom):** 📷 attach circle (40px), input pill ("message…") containing a blue **"＋ tab"** shortcut, and a **glowing blue send** circle (46px, paper-plane icon, `box-shadow:0 6px 20px rgba(39,117,202,0.55)`).
**State variant — `empty`:** replaces feed with the mascot + lowercase "no messages yet — say hi or drop a receipt 📷".

### 2. Activity (`Activity Frames.dc.html`)
**Purpose:** A day-grouped feed of everything that happened.
**Layout:** Status bar → header ("activity" 30px Clash + search & filter circle buttons) → feed → bottom tab bar (**Activity active**).
**Feed:** small mono day headers (`TODAY`, `YESTERDAY`). Each row = emoji-avatar **or the mascot** (for your own settle) + a dry one-liner ("you started **dinner** 🍜", "ava chipped in 🫡", "you squared with theo ✨", "bali crew squared ✨", "jonah is waiting on you 👀", "sofia reacted 💀 to **hotel**") + a right-aligned mono amount (+blue / −coral, lighter $/decimals; `$0.00` grey when settled). Settle events carry a mint **"settled" / "all squared"** tag + a mono **"view ↗"** link, and may show reaction chips. Open requests show a blue **"chip in"** pill instead of an amount.
**State variants:** `feed` (default), `loading` (shimmer skeleton rows — animated `linear-gradient` sweep over `#13212E` blocks, ~1.3s), `empty` (mascot + "nothing's happened yet 🫥 / start a tab and the feed wakes up").

### 3. Transaction Receipt (`Receipt Detail Frames.dc.html`)
**Purpose:** Premium proof a payment moved — a receipt you'd keep.
**Layout:** Status bar → top bar (back circle, "receipt", close ✕) → scroll containing the receipt card → sticky actions.
**Receipt card:** `#13212E`, radius `24px 24px 0 0`, blue→mint 4px top edge, guilloché texture + soft foil shimmer (no hard strip). The **full-body mascot peeks over the top edge** (≈62px, friendly, soft glow — not on any avatar).
- Top row: pulsing **● FINALIZED** mint pill.
- Who: ava → you emoji-avatars with an arrow; "ava chipped in"; flow "ava → you".
- Big mono amount **+$24.00** (blue glow; coral with `−` when sent) + "you received · settled · 24.00 usdc".
- "apartment 4b · jun 24, 9:32pm".
- **Dashed tear divider** (two notch circles).
- **On-chain proof** block (mono, lowercase labels): from `9xQ…cMu (ava)`, to `7xKX…gAsU (you)`, network `solana` (mint dot), fee `~$0.0001` (mint), reference `7xKX…gAsU`, signature `5gT9…wZ4` + a copy icon. A centered **"view on solscan ↗"** link.
- **Perforated bottom edge** (half-circles) below the card.
**Actions (sticky):** glowing-blue **"share proof ✨"** + a quiet **"done"**.
**State variant — `direction`:** `received` (blue, +) / `sent` (coral, −, "you sent · settled").

### 4. Recurring list (`Recurring Frames.dc.html`)
**Purpose:** Bills you split every month, on autopilot.
**Layout:** Status bar → top bar (back + "on autopilot" + mono subhead) → scroll (featured card + bento grid) ; **no tab bar** (sub-screen).
- **Featured next-due card:** raised, blue border, left accent bar; 🏠 tile, "NEXT DUE" pill, "apartment 4b", "rent 🏠"; **progress ring** (SVG, ~66% mint/blue) reading **"6d / to run"**; big mono **$2,400.00 /mo**; a `monthly` pill + pulsing mint **active** pill; "next: jul 1 · split 3 · your share $800.00" with a 3-segment owe-bar preview.
- **Bento grid (2-col):** smaller cards (spotify duo 🎧, internet 📶, **the gym 🏋️ paused** [dimmed + amber "PAUSED" tag], cleaner 🧹) — emoji tile, mono amount, cadence + next date, active mint dot. A dashed full-width **"set up a new one ＋"** card.
**State variants:** `list` (default), `new` (the "well": a hero mono amount input with caret, then mono rows — title, segmented interval [weekly/**monthly**/yearly], next due + calendar icon, members avatar stack + add — and a **"set & forget ✨"** button), `empty` (full-body mascot + "set the bills you split every month and forget them 🫡" + "new recurring" button).

### 5. Recurring detail (`Recurring Detail Frames.dc.html`)
**Purpose:** Manage one recurring bill; calm, dependable.
**Layout:** Status bar → top bar (back, "recurring", ⋯) → scroll → controls row.
- **Blue identity header card** (gradient `#2f80d6→#2775CA→#1d5e9f`): 🏠 tile, "apartment 4b", mono "rent · auto-tab"; big mono **$2,400.00 /mo**; a `monthly` pill + an **active toggle** (mint track, knob); a **countdown ring** (mint, ~66%) with **"6d / left"** inside and a **"next: jul 1"** caption **below** the ring (caption must sit outside the ring — do not cram it inside).
- **who splits it:** 3 member rows each mono `$800.00`; footer "paid by: you 🦊 · everyone chips in to you" (amber-tinted).
- **this run · jul 1:** "2 of 3 squared" + a 3-segment progress bar (2 mint, 1 grey) + member ticks (marco ✓, maya ✓, ava 👀 pending) + a quiet "remind the group 👀".
- **past runs:** mono history rows (jun 1 / may 1 / apr 1 · "ALL SQUARED ✨" · $2,400.00) each with a settled tag + chevron → receipt.
- **controls:** pause · edit · **delete** (delete in coral).

### 6. Friends list (`Friends Frames.dc.html`)
**Purpose:** Your people; add by handle or wallet QR.
**Layout:** Status bar → header ("your people" + mono subhead + search) → **add well** → scroll → bottom tab bar (**Groups chip shown active in this mock**).
- **Add well** (recessed `#0e1a25`, blue border): mono input "@handle or wallet…", a **📷 QR-scan** tile, a **glowing blue ＋ add** button; footnote "scan their qr — never hand-type a wallet". (Never hand-type a wallet address — QR or handle only.)
- **saved tabs:** horizontal chip strip of groups (🗼 tokyo trip, 🏠 apartment 4b, 🏝️ bali crew) each with an avatar stack (+N overflow).
- **People rows:** 46px emoji **or initial-chip** avatar; name (Clash) + mono `@handle`; wallet truncated mono (`7xKX…gAsU`) + copy icon; right-aligned net (+blue / −coral; `$0.00` grey when even); a small **"tab"** pill (or mint **"square ✨"** when settled).
**State variant — `empty`:** mascot + "add your first person to split in one tap 🫡".

### 7. Friend detail (`Friend Detail Frames.dc.html`)
**Purpose:** The warm 1:1 version of the group ledger. **No mascot on this screen** (a friend's identity stands alone).
**Layout:** Status bar → top bar (back, ⋯) → scroll.
- **Header (centered):** big 🌸 avatar (84px, clean/standalone); "ava chen" + mono `@avac`; mono "12 tabs together · since march 🍜"; a wallet pill `9xQ…cMu` + copy icon.
- **Hero:** "ava owes you" + big mono **+$24.00** (blue glow). Below it a **two-tone owe-bar** (blue 30 / coral 6) + mono breakdown "she owes you **$30.00** · you owe her **$6.00** · net **+$24.00**". Then a context pill.
- **Actions:** primary glowing-blue **"request $24 👀"** + secondaries **"new tab"** and **"remind"**.
- **tabs together:** chip strip (🗼 tokyo trip · 4 tabs, 🍜 dinner · 1 tab, 🏠 apartment 4b · 2 tabs).
- **between you:** mono history rows — dinner (she owes $6 · blue), "ava chipped in" ($24 · SETTLED · view ↗), taxi (she owes $12), groceries (you owe $18 · coral) — each → its receipt.
- Quiet **"remove friend"** (coral) at the very bottom.
**State variant — `direction`:** `owed` (default; blue +, "request $24 👀" primary, pill "they'll get a link · pays in seconds") / `owe` (coral −, "settle up $24 ✨" primary, pill "settles instantly · ~$0.0001 fee").

### 8. You / Profile (`You Profile Frames.dc.html`)
**Purpose:** Your wallet + settings; utilitarian but warm.
**Layout:** Status bar → header ("you" 28px Clash + an **inline settings gear** beside the title on the left; the **full-body mascot** floats at the **top-right** of the header, waving, soft glow — not on any avatar) → scroll → bottom tab bar (**You active**).
- **Identity row:** 72px 🦊 avatar (clean), "you" + mono `@yourname`, wallet pill `7xKX…gAsU` + copy.
- **Balance card (receipt-style):** money texture, blue→mint top edge, foil shimmer, perforated middle. "YOUR BALANCE" + big mono **$248.50 USDC** (blue glow) + a "settles instantly · ~$0.001 fee" speed-flex pill. Then **add money** (glowing blue) + **cash out** (ghost) buttons and the dry note "spend it with any card. dollars, just faster."
- **Settings list** (emoji-icon + lowercase label + chevron): friends 🫂 · recurring 🔁 · saved tabs 🧾 · notifications 🔔 (value "on") · network 🌐 (mint **mainnet** tag) · help 💁 · **sign out** (coral, separate card). Footer: mono "divvy v1.4.0 · made for splitting, not stressing".

### 9. Customize your profile (`Customize Profile Frames.dc.html`)
**Purpose:** Expressive identity picker — emoji + color; **fully interactive (live).**
**Layout:** Status bar → top bar (back ‹, centered "make it yours", blue **save**) → scroll → sticky **save ✨** button.
- **Live hero preview:** a 132px rounded avatar tile showing the **currently-selected emoji** on the **currently-selected color/gradient** with a soft glow — **updates instantly** as the user picks. The **mascot** stands beside it giving a **thumbs-up 👍** with a "looking good 😎" speech bubble.
- **your emoji:** a 6-col grid (faces, animals 🦊🐸🐱🐼🐯🐨, 🦜🐢🌸, food 🍜🍕🍔🌮, objects 🎧🛹🪩😎🔥) + a "search" pill; the **selected emoji is ringed in blue** with a glow.
- **your color:** swatches — 5 solids (blue `#2775CA`, mint `#3DE8C7`, coral `#FF6B5E`, sunshine `#FFC65C`, violet `#8B5CF6`) + 3 gradients (blue→mint, coral→sunshine, violet→blue), each 50px rounded; the **selected one is ringed in white** with a glow.
- **name** + **@handle** mono input fields (handle shows a live caret + a mint "free" tick).
- Sticky glowing-blue **"save ✨"** button.

### 10. Onboarding (`Onboarding Playful.dc.html`)
**Purpose:** First-run — get a wallet in seconds, framed as dollars (not crypto).
**Layout:** Full-bleed welcome with ambient glow + guilloché; the **mascot** featured; the "divvy" wordmark; a mono kicker (e.g. "SPLIT BILLS · SETTLE IN SECONDS"); a short lowercase value headline; primary **"create a wallet"** (mono subline "~10 seconds, no app"), plus secondary social/sign-in options (Apple / Google) and a quiet "i already have one." Reinforce "dollars, just faster" — never "crypto/seed phrase" up front. Use this as the canonical onboarding (ignore the excluded Space-Grotesk `Onboarding.dc.html`).

### 11. Home (`Home Playful.dc.html`)
**Purpose:** The dashboard — your net position at a glance.
**Layout:** Status bar → top bar (divvy wordmark + mascot + bell) → scroll → bottom tab bar (**Home active**).
- **Hero receipt-style card:** "you're owed · across 3 groups" + big mono **$142.50** (blue glow) + "usdc"; "you owe $31.00 elsewhere" (coral); a "settles instantly · ~$0.001 fee" pill; a two-tone owed/owe avatar-stack bar; a tear divider; and **settle up** (blue) + **request** (ghost) buttons; perforated bottom edge.
- **people:** rows — emoji avatar, name, mono "owes you" / "you owe", mono amount (+blue / −coral).
- **groups:** cards — gradient emoji tile (🗼 tokyo trip, 🏠 apartment 4b, 🏝️ bali crew), title, mono meta, amount or a mint **square ✨** chip when settled.

### 12. Groups (`Groups Playful.dc.html`)
**Purpose:** All your shared groups.
**Layout:** Status bar → header ("your groups" 33px Clash + "N active") → scroll → bottom tab bar (**Groups active**).
- **Hero net-balance** summary card.
- **Group cards:** gradient emoji tile, name, mono member/expense meta, net amount (+blue / −coral) or settled chip, avatar stacks.
- **Empty state:** mascot + "no tabs yet — start one 🎉" + a "start a tab" button.

### 13. Group detail (`Group Detail Frames.dc.html`) — *canvas: 2 frames*
**Purpose:** One group's ledger + a single expense (tab) detail. (Authored in canvas mode — two 390×844 frames side by side.)
- **Frame 1 — the ledger:** blue cover header (avatar stack + mono "GROUP TOTAL $1,240.00" + "4 PEOPLE · 8 TABS · SINCE JUN 18"); "YOUR BALANCE" big mono **+$84.00**; an owed/owe split bar; quick pills (💬 chat · ✨ recap · ↗ share); **who owes who** rows (person → person with mono amount); **tabs** feed (🍜 dinner, 🚕 taxi, 🏨 hotel — payer · split N · time, mono total + your delta); sticky **settle up** + **add a tab** actions.
- **Frame 2 — tab detail:** a receipt sheet (blue→mint top edge, icon, title, izakaya/Shibuya meta, big mono **$96.00**, "maya paid · jun 22"), a perforation, per-person split rows ($24.00 each with PAID / SQUARED / **you owe 👀** tags), reaction chips, and a coral **"settle your $24.00"** action + edit/delete.

### 14. New tab (`New Split Playful.dc.html`)
**Purpose:** Create a shared expense (a "tab").
**Layout:** Sheet with a big mono **amount** entry (hero), a title/emoji field, **who's in** member chips (avatars + add), a **split method** control (evenly / by share), per-person preview, and a primary **"start the tab"**-style CTA. Lowercase, mono numerals, chunky pills.

### 15. Settle-up flow (`Settle Up Frames.dc.html`) — *canvas: multiple state frames*
**Purpose:** The pay-and-confirm moment + its on-chain status states. (Canvas mode — several 390×844 state frames.)
States include: **choose** ("settle up" / cancel; big coral **−$24.00** "you owe ava"; **pay with phantom** primary + "open in another wallet — solflare · backpack · any solana pay"); **success / squared** (the kinetic blue→mint success card with a **SQUARED ✨** stamp, **FINALIZED** pill, a waiting→confirmed→finalized progress, "settled. <1 second. <1 cent.", "view on solscan ›", and **share ✨**); **waiting for payment** (blue pulsing status); **not seen yet** (sunshine status); **balance too low** (coral status, "add money — debit card · apple pay · instant", "dollars, just faster."). The **mascot** changes expression per state (happy/sparkles when squared, watching while pending, worried on low balance).

### 16. Settle-up (alt) (`Settle Up Playful.dc.html`)
**Purpose:** A single-screen settle variant (earlier take on the same moment). Use `Settle Up Frames` as the primary spec; this is supporting reference for the same flow.

### 17. Tab collect (`Tab Collect Frames.dc.html`) — *canvas frames*
**Purpose:** The "collect" view of a tab — who has chipped in vs who's still pending, for the person who fronted the money. Member ticks (squared) vs pending (👀), running mono "$X in" progress, a progress bar, and a quiet **"remind the group 👀"** / nudge action. Mirrors the "this run" pattern used in Recurring detail.

---

## Interactions & Behavior
- **Navigation:** back ‹ pops; ✕ dismisses a sheet; tapping a feed row / history row / chip opens the relevant detail or **receipt**; "view ↗" opens the transaction receipt; "view on solscan ↗" opens an external explorer.
- **Customize (live):** tapping an emoji updates the hero preview **and** moves the blue selection ring instantly; tapping a color swatch updates the hero background **and** moves the white ring instantly. Implement as real selection state bound to the preview.
- **Toggles:** recurring active/paused toggle; notifications on/off.
- **Composer:** 📷 opens attach; "＋ tab" opens new-tab/split flow; send posts a message.
- **Add friend:** primary path is **QR scan** or **@handle** — never free-typing a raw wallet address.
- **Animations (ease-based only, no springy bounce):**
  - Mascot: float (translateY ±5–7px, ~5s), squish (border-radius morph, ~4.5s), blink (~5s), arm wave (~3–4s), glow pulse (opacity 0.5↔1, ~3s).
  - Settle/success card: kinetic blue→mint gradient, `background-position` 0→200%, ~4s linear infinite. Reserved for settle/success only.
  - Loading: shimmer sweep ~1.3s.
  - Typing dots / pulsing status dots: opacity pulse ~1.2–2.4s, staggered.
  - Button feedback: hover `filter:brightness(1.07)`, active `translateY(1px)`.
- **Loading state:** Activity has a shimmer skeleton; apply the same pattern to other lists while fetching.
- **Empty states:** Chat, Activity, Recurring, Friends each have a mascot-led empty state (copy listed per screen).

## State Management
- **Customize:** `selectedEmoji` (string), `selectedColorId` (enum of 8) → derive `heroBackground`. Plus editable `name`, `handle`.
- **Chat:** message list (types: text, receipt-photo, expense, payment/settle, typing), `isEmpty`.
- **Activity:** events grouped by day; `viewState` = feed | loading | empty.
- **Receipt:** `direction` = received | sent.
- **Recurring list:** `viewState` = list | new | empty; new-form fields (title, amount, interval, nextDue, members).
- **Recurring detail:** `active` (bool), this-run progress (paidCount/total + per-member paid flags), history list.
- **Friends list:** people (name, handle, wallet, net balance, settled?), saved-tab groups, `isEmpty`.
- **Friend detail:** `direction` = owed | owe; breakdown (sheOwes, youOwe, net); shared groups; shared history.
- **You:** balance, settings values (notifications, network).
- **Data fetching:** balances, activity, friend nets, receipts/signatures come from the wallet/ledger backend; show shimmer while loading and the mascot empty states when truly empty.

## Design Tokens
**Colors**
| Token | Hex |
|---|---|
| canvas | `#0B1622` |
| canvas-deep | `#050d15` |
| card | `#13212E` |
| well / recessed | `#0e1a25`, `#0f1a24` |
| text | `#F4F7FA` |
| text-muted | `rgba(244,247,250,0.5)` |
| text-faint | `rgba(244,247,250,0.4)` |
| usdc-blue | `#2775CA` |
| blue-bright | `#3B92E8` |
| blue-light | `#7fc0ff` / `#5BA6F0` |
| mint | `#3DE8C7` |
| coral | `#FF6B5E` |
| sunshine | `#FFC65C` |
| violet | `#8B5CF6` |

**Gradients**
- Settle/success (kinetic): `linear-gradient(90deg,#2775CA,#3DE8C7,#2775CA)` animated.
- Identity blue→mint: `linear-gradient(150deg,#2775CA,#3DE8C7)`.
- Identity coral→sunshine: `linear-gradient(150deg,#FF6B5E,#FFC65C)`.
- Identity violet→blue: `linear-gradient(150deg,#8B5CF6,#2775CA)`.
- Primary button: `linear-gradient(120deg,#3286db,#2775CA)`.
- Mascot body: `linear-gradient(155deg,#4aa0f0,#2775CA 60%,#1c5697)`.

**Radius:** cards 20–24px; inner tiles/inputs 12–16px; pills/buttons 999px; avatars 14–26px (rounded square) or 50% (circle).

**Typography scale (px):** hero money 54–62 · screen titles 28–30 · card titles 16–18 · body 15 · meta/labels 9–11 (mono) · button labels 15–17. Mono `$`/decimals ≈ 0.5× and 0.5 opacity vs integer. Letter-spacing: titles −0.2 to −0.8; mono labels +0.3 to +1.5.

**Shadows / glow:**
- Card: `0 14–18px 36–46px rgba(0,0,0,0.32–0.4)`.
- Blue button glow: `0 8–12px 24–30px rgba(39,117,202,0.45–0.55)` + `inset 0 1px 0 rgba(255,255,255,0.25)`.
- Accent radial glow (per screen): `radial-gradient(circle, rgba(39,117,202,0.16–0.3), transparent 70%)`.
- Mascot glow: `radial-gradient(circle, rgba(39,117,202,0.4), transparent 70%)` pulsing.

**Fonts:** Clash Display (600/700) + General Sans (400/500/600) via Fontshare; Space Mono (400/700) via Google Fonts. Map to the codebase's font-loading system (e.g. `expo-font`).

## Screenshots
Reference renders of each screen live in `screenshots/` (high-res PNGs). The numbers below match the screen sections above:
`1-group-chat.png` · `2-activity.png` · `3-receipt-detail.png` · `4-recurring-list.png` · `5-recurring-detail.png` · `6-friends-list.png` · `7-friend-detail.png` · `8-you-profile.png` · `9-customize-profile.png` · `10-home.png` · `11-groups.png` · `12-group-detail.png` (canvas, 2 frames) · `13-new-tab.png` · `14-tab-collect.png` (canvas) · `15-settle-up.png` (canvas, multiple states) · `16-settle-up-alt.png` · `17-onboarding.png`. These show the intended look; the HTML files + this README remain the source of truth for exact values and state variants.

## Assets
- **No raster image assets** are required — all visuals are CSS/SVG. Receipt photos are intentional **striped placeholders** to be replaced by real user images.
- **Icons** are inline SVGs (back chevron, ⋯, search, copy, calendar, share-nodes, edit, trash, sign-out, QR, tab-bar glyphs, etc.). Replace with the codebase's icon set (e.g. lucide / SF Symbols) — shapes are standard.
- **Emoji** are system emoji used as functional data; render with the platform emoji font.
- The **mascot** is built from CSS shapes (no asset) — reimplement as a small component (SVG or views) per the spec above; keep it the same character across screens.

## Files
HTML design references in this bundle (each is a self-contained 390×844 frame unless marked *canvas*, which holds multiple frames side by side):
- `Onboarding Playful.dc.html` — first-run / create wallet
- `Home Playful.dc.html` — dashboard (net position, people, groups)
- `Groups Playful.dc.html` — groups list (+ empty)
- `Group Detail Frames.dc.html` — *canvas* group ledger + tab detail
- `New Split Playful.dc.html` — create a tab
- `Settle Up Frames.dc.html` — *canvas* settle flow states (choose / squared / waiting / not-seen / low-balance)
- `Settle Up Playful.dc.html` — settle single-screen (alt reference)
- `Tab Collect Frames.dc.html` — *canvas* collect/who's-paid view
- `Group Chat Frames.dc.html` — group chat feed + composer (+ empty)
- `Activity Frames.dc.html` — activity feed (feed / loading / empty)
- `Receipt Detail Frames.dc.html` — transaction receipt (received / sent)
- `Recurring Frames.dc.html` — recurring list (list / new / empty)
- `Recurring Detail Frames.dc.html` — recurring detail
- `Friends Frames.dc.html` — friends list (+ empty)
- `Friend Detail Frames.dc.html` — friend 1:1 ledger (owed / owe)
- `You Profile Frames.dc.html` — wallet + settings
- `Customize Profile Frames.dc.html` — interactive emoji/color identity picker

**How to open:** these are Design Component HTML files. They render in a browser but rely on a runtime helper (`support.js`) included in this bundle — keep it next to the HTML files. Files marked *canvas* open zoomed-out with several frames on a gray board (pan/zoom). Read the inline styles directly for exact values; this README is the source of truth for intent.

> **Excluded on purpose:** the earlier Space-Grotesk / cream direction (`Home.dc.html`, `Onboarding.dc.html`) is **not** in this bundle — build the Playful versions above instead.
