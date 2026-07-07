# The asset generator — chats, videos, carousels

Everything in `assets/` is rendered by one script:

```
node marketing/tiktok-kit/build-assets.mjs                 # everything
node marketing/tiktok-kit/build-assets.mjs --only rent     # one scenario/deck
node marketing/tiktok-kit/build-assets.mjs --stills-only   # skip the videos
```

`--only` matches substrings of scenario slugs, output filenames, or carousel
slugs (comma-separate several). Runtime: a chat scenario takes ~5s for the
still + **roughly the video's own duration (~30–35s) to record the video**,
since it plays out in real time. A full run is ~5 minutes.

## Fake-text chats: one JSON = still + video

Each file in `scenarios/*.json` renders BOTH:
- `assets/<file>` — the 1080×1920 still (final state of the thread), and
- `assets/videos/<slug>.webm` — the 25–35s fake-text video (the same thread
  playing out live: typing bubbles, pop-ins, tapbacks landing late, receipts
  fading in, the pay-card arriving on a dramatic beat, typing-indicator outro).

The slug is the JSON filename. To make a new one, copy `scenarios/rent.json`
and edit:

```jsonc
{
  "file": "chat-my-story.png",     // still filename (under assets/)
  "kind": "group",                 // "group" (avatar cluster, sender names)
                                   // or "dm" (single avatar, no name labels)
  "title": "trip house 🎿",        // header title
  "time": "9:41",                  // status-bar clock
  "members": [                     // cast; "dm" uses only the first entry
    { "n": "Maya", "i": "M", "g": ["#F6B356", "#EE8B2E"] }   // name, initial,
  ],                                                         // avatar gradient
  "rows": [
    { "ts": "Today 9:12 PM" },                        // time separator
    { "who": "Maya", "text": "..." },                 // received message
    { "me": true, "text": "...",                      // sent message
      "status": "Read 9:18 PM" },                     // receipt (use ONCE per
                                                      // thread — iOS only shows
                                                      // the latest)
    { "who": "Maya", "text": "...",
      "tapback": { "e": "😂", "n": 2 } },             // reaction (+count if 2+)
    { "me": true, "card": {                           // the divvy pay-card
        "title": "ski house — your share is $240",
        "sub": "pay in one tap", "domain": "divvysol.com" },
      "tapback": { "e": "‼️" } },
    { "typing": true, "who": "Maya" },                // closing typing bubble
    { "text": "😂😂" }                                // emoji-only → rendered
  ]                                                   // big and bubble-less
}
```

Video pacing is derived automatically (typing time scales with message length,
seeded jitter so re-renders are identical). Two optional knobs per row:
`"beat": 800` adds a pause (ms) before the row, `"hold": 2500` overrides the
closing typing-indicator hold. Keep threads at 12–14 rows for the 25–40s
TikTok sweet spot — the generator hard-fails outside 20–55s.

Realism rules the renderer enforces or expects: sender name labels and
per-sender avatars only in groups; bubbles group into runs (tail + avatar on
the last of a run); tapbacks overlap the top-right corner of received bubbles
and the top-LEFT of sent ones; the still fails loudly if the thread is too
tall for one screen.

### Video format: webm → mp4

Playwright records VP8 `.webm`; its bundled ffmpeg cannot write mp4 (no
libx264/vp9, no mp4 muxer). The generator automatically produces `.mp4` too
when a capable ffmpeg exists — set `FFMPEG_PATH=/path/to/ffmpeg` or just have
`ffmpeg` on PATH. Otherwise it prints a NOTE and you convert once, anywhere:

```
ffmpeg -i videos/rent.webm -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart videos/rent.mp4
```

TikTok/IG want mp4; the videos are silent on purpose (add trending audio
in-app — it's better for reach anyway).

## Carousels

Deck configs live at the bottom of `build-assets.mjs` (`CAROUSELS`,
`NOTES_CAROUSELS`, `LISTICLES`) — a deck is data, slide count comes from the
config (8–12 slides supported; default shape is 10). House style: cover hook +
genuinely-useful numbered tips + **the CTA as the final numbered item** ("9.
the app that does 1–8 for you"). Never pad with filler tips to hit a count.

Notes-skin decks (`NOTES_CAROUSELS`) support four section kinds:
`cover`, plain tip (`h` + `lines`), `tips2` (two dense tips on one slide —
the flagship travel-deck shape), `shot` (a screenshot pasted into the note,
e.g. the girls-trip chat as "tip 6 in the wild:"), and `reveal` (Mochi +
wordmark CTA attachment; give it `h: "9. …"` to number it into the list).

Output: `assets/carousels/<slug>/01.png…NN.png`, 1080×1350 (4:5). Every slide
is dimension-checked; chats embedded via `shot` are read fresh from the same
run, so `--only travel-with-friends` after editing the girls-trip scenario
picks up the new screenshot only if you re-render the chat first (or just run
without `--only`).
