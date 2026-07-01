/**
 * mascot-cutout.mjs — turn a Gemini mascot render (character on a near-uniform
 * dark background, with a corner "sparkle" watermark) into a clean transparent PNG.
 *
 * Pipeline:
 *   1. Region-grow the background inward from the borders (local + global color
 *      tolerance, so a vignette gradient is followed but the bright character edge
 *      stops it).
 *   2. Foreground = everything not flagged background.
 *   3. Keep only the LARGEST connected foreground blob → drops the watermark and
 *      any stray specks.
 *   4. Autocrop to the character + a little padding; write a square PNG.
 *
 * Usage: node scripts/mascot-cutout.mjs <in.png> <out.png> [pad]
 */
import { Jimp } from "jimp";

const [, , inPath, outPath, padArg] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node scripts/mascot-cutout.mjs <in.png> <out.png> [pad]");
  process.exit(1);
}
const PAD = Number(padArg || 48);

const img = await Jimp.read(inPath);
const { width: W, height: H, data } = img.bitmap;
const idx = (x, y) => (y * W + x) * 4;
const dist = (a, b) => {
  const dr = data[a] - data[b], dg = data[a + 1] - data[b + 1], db = data[a + 2] - data[b + 2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
};
// seed color = average of the four corners
const corners = [idx(0, 0), idx(W - 1, 0), idx(0, H - 1), idx(W - 1, H - 1)];
const seed = [0, 0, 0];
for (const c of corners) { seed[0] += data[c]; seed[1] += data[c + 1]; seed[2] += data[c + 2]; }
seed[0] /= 4; seed[1] /= 4; seed[2] /= 4;
const distSeed = (a) => {
  const dr = data[a] - seed[0], dg = data[a + 1] - seed[1], db = data[a + 2] - seed[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

// Flood the background inward from the borders, but ONLY across pixels within
// GLOBAL_TOL of the (dark) corner color. This captures the vignette while the big
// color jump at the bright character edge stops it — and it never follows the
// character's own smooth gradient inward (which local-tolerance growing would).
const GLOBAL_TOL = Number(process.env.CUTOUT_TOL || 88);
const bg = new Uint8Array(W * H);
const stack = [];
const pushIf = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const p = y * W + x;
  if (bg[p]) return;
  bg[p] = 1;
  stack.push(x, y);
};
for (let x = 0; x < W; x++) { pushIf(x, 0); pushIf(x, H - 1); }
for (let y = 0; y < H; y++) { pushIf(0, y); pushIf(W - 1, y); }
while (stack.length) {
  const y = stack.pop(), x = stack.pop();
  const neigh = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
  for (const [nx, ny] of neigh) {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const np = ny * W + nx;
    if (bg[np]) continue;
    if (distSeed(idx(nx, ny)) < GLOBAL_TOL) {
      bg[np] = 1;
      stack.push(nx, ny);
    }
  }
}

// Largest connected FOREGROUND component (4-connectivity).
const label = new Int32Array(W * H).fill(0);
let best = 0, bestSize = 0, cur = 0;
for (let p = 0; p < W * H; p++) {
  if (bg[p] || label[p]) continue;
  cur++;
  let size = 0;
  const st = [p];
  label[p] = cur;
  while (st.length) {
    const q = st.pop(); size++;
    const x = q % W, y = (q / W) | 0;
    const ns = [q + 1, q - 1, q + W, q - W];
    const ok = [x + 1 < W, x - 1 >= 0, y + 1 < H, y - 1 >= 0];
    for (let i = 0; i < 4; i++) {
      if (!ok[i]) continue;
      const r = ns[i];
      if (bg[r] || label[r]) continue;
      label[r] = cur; st.push(r);
    }
  }
  if (size > bestSize) { bestSize = size; best = cur; }
}

// Apply alpha: keep only the largest blob opaque; find its bounding box.
let minX = W, minY = H, maxX = 0, maxY = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (label[p] === best) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    } else {
      data[idx(x, y) + 3] = 0; // transparent
    }
  }
}

// Crop to content + padding, keep square.
minX = Math.max(0, minX - PAD); minY = Math.max(0, minY - PAD);
maxX = Math.min(W - 1, maxX + PAD); maxY = Math.min(H - 1, maxY + PAD);
let cw = maxX - minX + 1, ch = maxY - minY + 1;
const side = Math.max(cw, ch);
const cropped = img.clone().crop({ x: minX, y: minY, w: cw, h: ch });
const out = new Jimp({ width: side, height: side, color: 0x00000000 });
out.composite(cropped, Math.floor((side - cw) / 2), Math.floor((side - ch) / 2));
await out.write(outPath);
console.log(`ok → ${outPath}  (${side}×${side}, kept blob ${bestSize}px, bbox ${cw}×${ch})`);
