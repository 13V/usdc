# Hook formulas that work (travel + money niches, researched Jul 2026)

Why this file exists: our first flagship cover was "10 tips for traveling with
friends (without a group-chat war)" — a category label, not a hook. Research
across hook-testing studies (HookMafia 30-hook test, OpusClip 34,635-clip
study) and travel-niche teardowns showed exactly why it underperforms and what
real travel pages do instead. Rules below apply to every future cover slide.

## The cover-slide rules

1. **Under ~10 words, readable in 0.7s.** Big type, high contrast.
2. **Never lead with "tips".** It's the most saturated word in the niche. Weld
   the number to a spiky noun instead: "10 unspoken rules", "things i wish i
   knew". The number is fine on the cover — but it doesn't hook by itself.
3. **The tension goes in the headline, not a parenthetical.** Parentheses are
   for proof or objection-killing ("(no tourists)", "(my actual process)"),
   never for the joke. If the bracket is the interesting part, it IS the hook.
4. **Speak the niche's own meme language.** Group-trip content's native phrase
   is the trip "making it out of the group chat" — not phrases we invent.
5. **Tease a numbered payoff** ("number 6 saved a friendship") when a later
   slide delivers it — opens a loop that drives swipe-through to the product
   beat.
6. **Save-bait is a closer, not an opener.** "save this for the trip chat"
   belongs in the caption / last slide.

## Ranked patterns (travel niche, strongest first)

1. **Insider / wish-i-knew** — "things i wish i knew before…", "nobody tells
   you…". The most-validated travel format of 2025–26.
2. **Specific number / cost receipt** — "$366 for 3 days", "six trips, zero
   fallouts". Odd specific numbers signal authenticity.
3. **Mistake / negative framing** — "your girls trip will flop if…", "stop
   doing X". Negative openers out-test positive ones.
4. **Identity call-out** — "if you're the friend who plans the whole trip…".
   Top-scoring pattern overall (85/100 avg in HookMafia's test); also targets
   exactly who installs a bill-splitting app.
5. **Native meme phrase** — "how to get the trip out of the group chat".
6. **Curiosity gap / named rule** — "the 6-3-1 rule", "the one rule that ended
   the 'you owe me $43' texts".
7. **POV** — better for comedy/aspiration than tips decks.

## Applied: travel-with-friends flagship

Live cover: **"things i wish i knew before my first girls trip"** + sub
"- number 6 saved a friendship. not exaggerating." (pattern 1 + 5-word tease
that slide 7's chat screenshot pays off).

Rendered alternates in `assets/carousels/travel-with-friends/hook-options/`:
- `a-group-chat.png` — "how to get the trip out of the group chat" (pattern 5
  + receipt sub "- 10 rules. six trips planned, zero fallouts.")
- `b-trip-planner.png` — "if you're the friend who plans the whole trip"
  (pattern 4 + urgency sub "- read this before anyone books the airbnb.")

Swap: copy one over `01.png`, or edit the cover section in `build-assets.mjs`
and re-run `node marketing/tiktok-kit/build-assets.mjs --only
travel-with-friends --stills-only`.

Key sources: hookmafia.io 30-hook test · opus.pro 34,635-clip hook study ·
getkoro.app travel-carousel guide · viryze.com tiktok-travel-trends-2026 ·
truefuturemedia.com carousel strategy 2026 · @gottabemaddy's viral 6-3-1
group-trip video · TikTok discover pages for "the friend that plans the trip"
/ "group trip makes it out of chat" / "rules for girl trip".
