# Mochi the frog — Divvy's mascot

A smol mint journal-frog with periscope eyes, hand-inked outlines and an
offset paper shadow. Lives on the notebook-paper theme.

## Files

- `mochi.svg` — the master rig. Every part is a named group
  (`#body-group`, `#eye-left`, `#pupil-left`, `#arm-right`, `#mouth`,
  `#sweat`, …) so it imports into Figma / After Effects / Lottie with a
  usable layer structure out of the box.
- `mochi-animations.html` — motion reference. Six CSS loops (idle, hop,
  wave, worried, party, watching) with timing specs, built on the same
  part classes the app ships. Open in a browser; use as the spec when
  rebuilding loops in a motion tool.

## In-app source of truth

`public/mascot.js` renders the same rig as inline SVG via
`window.Mascot.html({ size, mood, glow })` (moods: happy · wave ·
sparkle · watching · worried · sleepy) and `window.Mascot.mini(px)` for
tiny inline frogs (pull-to-refresh, chat chips). Change the art there
and every screen updates.

## Rig conventions (keep these when animating)

| Part | Pivot | Move |
| --- | --- | --- |
| `body-group` | bottom-center | squash/stretch (sitting) |
| `eye-left/right` | bottom-center | independent vertical bob ("periscope") |
| `pupil-left/right` | center | blink = scaleY → 0.08 |
| `arm-left/right` | shoulder (path start) | rotate; wave = −42° |
| `mouth` | — | swap path per mood, don't tween |
| `sweat` | — | worried only: fade in, slide down, fade out |

Palette: mint `#3DE8C7` · ink `#2B2118` · coral `#FF6B5E` · blue `#2775CA`
· sunshine `#FFC65C`. Outlines 4px on the 170×158 viewBox, round caps.
Offset shadow: `drop-shadow(3px 4px 0 rgba(43,33,24,.45))`.
