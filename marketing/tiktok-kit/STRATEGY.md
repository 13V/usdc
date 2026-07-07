# Divvy TikTok + Reels — post-from-your-phone strategy

**The play in one line:** Mochi is our Duolingo owl — a smol mint frog who has
*feelings about money between friends*. We post mascot-led money-friction comedy
that people tag their group chat in. The app stays almost invisible until launch.

## Positioning
- **Character first.** Mochi reacts to universal money pain: the "i'll get you
  back" guy, the card-machine hand-off, 1am trip math, the $12 that never comes
  home. People follow the frog, not the app.
- **Journal aesthetic.** Cream paper, ink lines, washi tape, mono type — every
  asset in `assets/` already looks like this. Keep filmed content warm and lo-fi
  to match (no corporate polish).
- **Dollars, feelings, friendship.** We talk about money between friends.
  We NEVER talk about the rails (see do-nots).
- **Two engines, one account.** (1) Mochi comedy gives the account a face and
  gets tags/comments. (2) **Unbranded value carousels** (concepts 21–26) get
  saves and shares — pure money-splitting tips with zero branding until the
  final slide's soft reveal ("we built divvy for this"). Saves are the growth
  loop; the frog is the retention loop. Roughly half the calendar is carousels.

## Cadence
- **Now → launch week:** 2–3 posts/week (Tue / Thu / Sat evenings, 6–10pm your
  audience's time), ramping to ~5/week in week 4. Same content to TikTok AND
  Reels — carousels go up as IG carousels + TikTok photo mode.
- **Launch week:** daily. Switch to the launch kit (`design/launch-x/`) for
  product posts; keep one Mochi bit mid-week so the account doesn't go full ad.
- Reply to every early comment as Mochi (dry, lowercase, kind). Comments are
  content: screenshot the good ones for future posts.

## Account setup checklist
- [ ] Handle (check free, in order): **@divvyapp** → **@divvy.money** →
      **@getdivvy** → **@mochi.divvy**. Use the SAME handle on TikTok + IG.
- [ ] Name field: `divvy 🐸`
- [ ] Bio: `the app that makes "i'll get you back" actually happen 🐸`
      `— starring mochi, who remembers your $12` · link: **divvysol.com**
- [ ] Profile picture: `assets/pfp.png` (1000×1000, Mochi on mint)
- [ ] Banner / X header if needed: `assets/banner.png` (1500×500)
- [ ] Switch to a Business/Creator account (unlocks analytics + link in bio)
- [ ] Link-in-bio points at **divvysol.com** (the waitlist form is live on it —
      "get early access" is the only conversion we want pre-launch)

## Brand content vs launch content — the rule
> **Before the App Store approves us: entertainment and value only.** No
> "download now", no app-store screenshots, no feature demos framed as demos.
> The allowed product touches are *quiet*: the final-slide reveal on carousels
> (Mochi + wordmark + one line, no CTA), aesthetic b-roll (concepts 19–20), and
> the meme-lab link when someone asks "where is this from". Carousel slides
> before the reveal carry **zero branding** — that's what makes them shareable.
> **After launch:** flip to `design/launch-x/` (thread, demo.webm, memes) and
> add install CTAs.

## Five do-nots (the compliance ones are non-negotiable)
1. **Never promise money, tokens, credits, or rewards** for following, sharing,
   referring, joining the waitlist — anything. (App Store rule 3.1.5(v) +
   basic regulatory hygiene. One "share to earn $5" post can kill the review.)
2. **Never lead with crypto.** No "USDC", "Solana", "crypto", "wallet", "on-chain"
   in videos, captions, hashtags, or comment replies. If asked how it works:
   "dollars, instantly. tech's boring on purpose 🐸".
3. **No "download now" / pre-order CTAs before launch.** Waitlist link in bio is
   the ceiling.
4. **No real people, real screenshots, or real names** in the drama content.
   Group-chat images are fabricated skits (built in this kit) — keep it that way,
   and say "it's a skit lol" if anyone asks.
5. **No financial claims or advice.** No fee comparisons, no "save $X", no
   dunking on named competitors. Mochi does comedy, not consumer finance.

## Where everything lives
- `CONCEPTS.md` — 26 numbered post ideas with hooks, scripts, captions, effort.
- `CALENDAR.md` — the 4-week schedule (zero-effort posts front-loaded,
  carousels ≈ half the slots).
- `assets/` — 15 ready-to-post files + `assets/carousels/` (6 complete
  carousels, 46 slides, 1080×1350). AirDrop the folder to your phone.
- Rebuild / remix assets: `node marketing/tiktok-kit/build-assets.mjs`.
- More raw material: the meme lab (`/memes` on the app) and `design/launch-x/`
  (mochi.webm loop, demo video, X kit for launch day).
