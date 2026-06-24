# Divvy — Gen-Z prompts (Up Bank energy), two flavors to compare

Goal: fun, playful, social — Up Bank / Cash App / Monzo energy — while keeping
**USDC blue `#2775CA` as the hero brand color** plus a few vibrant accents.
Below are TWO complete base prompts (A = dark-vibrant, B = light-Up) and the same
**Groups** screen built on each, so you can generate both in Claude design and
pick a direction. Each block is self-contained — copy one and paste it.

## Shared Gen-Z DNA (baked into both bases)
- **Emoji as a first-class system** — every group, person, split, and category
  has one (🗼 🏠 🏝️ 🍜 🧻). Warmth comes from this.
- **Big, bubbly, friendly numbers** in a rounded characterful typeface with
  tabular figures — money feels approachable, not corporate.
- **Cheeky, human microcopy** — "You're up! 🤑", "Ava owes you (gentle nudge? 👀)",
  "All square ✨" — never "Balance: +$142.00".
- **Per-group color identity** — each group owns a color/gradient + emoji "cover",
  so it's instantly recognizable across the app.
- **Celebratory motion** — confetti + haptic + a number ticking to $0 on settle.
- **Palette:** anchor **USDC blue `#2775CA`**; playful accents **coral `#FF6B5E`**,
  **lime `#A8E84B`**, **violet `#8B5CF6`**, **sunshine `#FFC65C`**. Money rule:
  owed-to-you = blue (or lime when settled ✓); you owe = coral.
- **Type:** `Gabarito` (rounded, friendly) for headlines + big numbers,
  `General Sans` for UI text, `JetBrains Mono` ONLY for wallet addresses. Load via
  Google Fonts / Fontshare.

═══════════════════════════════════════════════════════════════════════════════
# FLAVOR A — DARK + VIBRANT  (base prompt)
═══════════════════════════════════════════════════════════════════════════════

> Design a single fun, playful mobile screen (390×844) for **Divvy** — an app to
> split bills with friends and settle up in **USDC on Solana**. Vibe: **Up Bank /
> Cash App energy on a dark canvas** — bold, colorful, emoji-rich, joyful, a
> little cheeky — NOT a corporate fintech dashboard and NOT a generic dark-card
> list. It should feel like a group chat about money that you actually enjoy.
>
> **LOOK & FEEL**
> - **Dark but warm & alive:** base `#0B1622`, cards `#13212E`, with **bold
>   full-bleed gradient "blocks"** for hero moments (e.g. USDC-blue→violet, or
>   coral→sunshine). Color is structure, not a thin accent on grey.
> - **USDC blue `#2775CA` is the hero**, with playful accents coral `#FF6B5E`,
>   lime `#A8E84B`, violet `#8B5CF6`, sunshine `#FFC65C`. Money rule: owed-to-you =
>   blue, you owe = coral, all-settled = lime ✓.
> - **Numbers are big, round and bubbly** — `Gabarito` (or similar rounded
>   geometric) at 48–80px with tabular figures, decimals shown (`$165.00`); they
>   tick/roll on change. `General Sans` for UI; `JetBrains Mono` only for wallet
>   addresses.
> - **Emoji everywhere as content** — each group/person/split has one in a soft
>   colored circle. **Cheeky, warm microcopy.** Rounded everything (cards 20–24px,
>   pills, chunky buttons). Soft glows behind hero numbers; subtle confetti and
>   springy motion on happy moments; haptic-feel taps.
> - **Identity is colorful:** real avatars or deterministic bright initial-chips,
>   each group with its own color/gradient cover. Never grey placeholder circles.
> - Fixed bottom tab bar (Home · Groups · ＋ · Activity · You) with a bouncy,
>   color-filling active state and a chunky center ＋.
>
> **AVOID:** flat grey cards stacked evenly; one neon accent on near-black; tiny
> low-contrast numerals; corporate stiffness; Inter/one-font systems; emoji used
> as the icon set (use real icons for nav, emoji for content). Make it feel
> designed, joyful, and unmistakably Divvy.

## FLAVOR A — Sample screen: GROUPS
[Paste FLAVOR A base above, then this:]

> **Screen: Groups.** Top: the Divvy "/" mark + a fun greeting ("yo, Alex 👋") and
> a small avatar.
> **Hero block (full-bleed gradient, USDC-blue→violet, rounded 24px):** a tiny
> label "you're up 🤑", a huge bubbly tabular number **`+$165.00`**, a cheeky sub
> "…but you owe Maya $31 😬", and a chunky **Settle up** button. Under the number,
> a fat rounded **two-tone bar** (blue = owed to you vs coral = you owe) with tiny
> avatars riding on the segments.
> **Group cards below — each with its OWN color cover + emoji,** varied sizes
> (bento, not identical):
>   • 🗼 **Tokyo trip** — blue cover, avatar stack, "Maya added Ramen 🍜 · 2h",
>     big **`+$84.00`** (blue).
>   • 🏠 **Apartment 4B** — coral cover, "Rent · auto-splits monthly 🔁", **`−$31.00`**
>     (coral).
>   • 🏝️ **Bali crew** — lime cover, a playful **"all square ✨"** pill instead of a
>     number.
>   • 🧻 **Roommates** — violet cover, **`+$12.00`**.
> A chunky **＋ New group** button. Friendly empty state: big emoji, "start your
> first group 🎉", one button. Bottom tab bar, Groups active (bouncy).

═══════════════════════════════════════════════════════════════════════════════
# FLAVOR B — LIGHT + FULL UP BANK  (base prompt)
═══════════════════════════════════════════════════════════════════════════════

> Design a single fun, playful mobile screen (390×844) for **Divvy** — an app to
> split bills with friends and settle up in **USDC on Solana**. Vibe: **Up Bank /
> Monzo energy** — bright, optimistic, colorful, emoji-rich, cheeky and joyful.
> Light-mode-forward with fearless candy color. It should feel like the most fun
> money app your friends use, not a banking tool.
>
> **LOOK & FEEL**
> - **Warm light canvas:** background cream `#FBF7F0` / white, soft cards
>   `#FFFFFF` with gentle shadows, plus **big bold candy color blocks &
>   gradients** for hero moments. Lots of color, lots of rounded shapes, generous
>   air.
> - **USDC blue `#2775CA` is the hero**, with playful accents coral `#FF6B5E`,
>   lime `#A8E84B`, violet `#8B5CF6`, sunshine `#FFC65C`. Money rule: owed-to-you =
>   blue, you owe = coral, all-settled = lime ✓. Dark text `#0B1622` on light;
>   white text on the color blocks.
> - **Numbers big, round, bubbly** — `Gabarito` 48–80px, tabular figures, decimals
>   shown, roll/tick on change. `General Sans` for UI; `JetBrains Mono` only for
>   wallet addresses.
> - **Emoji everywhere as content** in soft colored circles; **cheeky warm
>   microcopy**; very rounded everything (cards 24px, pill buttons); playful
>   illustration/sticker accents; confetti + springy motion + haptic-feel on happy
>   moments.
> - **Colorful identity:** bright avatars / initial-chips; each group owns a color
>   or gradient cover + emoji. Never grey circles.
> - Bottom tab bar (Home · Groups · ＋ · Activity · You) with a bouncy color-filling
>   active state, chunky center ＋.
>
> **AVOID:** sterile all-white minimalism with one grey accent; tiny numerals;
> corporate stiffness; Inter/one-font systems; emoji as the icon set (real icons
> for nav, emoji for content); muddy low-contrast color. Make it bright, joyful,
> tactile, and unmistakably Divvy.

## FLAVOR B — Sample screen: GROUPS
[Paste FLAVOR B base above, then this:]

> **Screen: Groups.** Top: the Divvy "/" mark + a fun greeting ("yo, Alex 👋") and
> a small avatar, on the cream canvas.
> **Hero block (big rounded USDC-blue→violet gradient card, white text):** label
> "you're up 🤑", a huge bubbly tabular **`+$165.00`**, a cheeky sub "…but you owe
> Maya $31 😬", and a chunky white **Settle up** button. Under the number, a fat
> rounded **two-tone bar** (blue owed vs coral owe) with tiny avatars on the
> segments.
> **Group cards below on the cream canvas — each its OWN bright color cover +
> emoji,** varied sizes (bento, not identical):
>   • 🗼 **Tokyo trip** — blue cover, avatar stack, "Maya added Ramen 🍜 · 2h",
>     big **`+$84.00`** (blue).
>   • 🏠 **Apartment 4B** — coral cover, "Rent · auto-splits monthly 🔁", **`−$31.00`**
>     (coral).
>   • 🏝️ **Bali crew** — lime cover, a playful **"all square ✨"** pill instead of a
>     number.
>   • 🧻 **Roommates** — violet cover, **`+$12.00`**.
> A chunky **＋ New group** button (coral or blue). Friendly empty state: big
> emoji + sticker, "start your first group 🎉", one button. Bottom tab bar, Groups
> active (bouncy).

═══════════════════════════════════════════════════════════════════════════════
Next: once you pick A or B, I'll convert pages 4–11 (group detail, chat, new
split, receipt, settle-up, activity, friends, recurring) into that flavor — each
self-contained and copy-paste ready.
