/* faces.js — Divvy's meme-face pfp pack. Hand-drawn ink doodles (inline SVG,
   journal style) that read as memes without shipping anyone's copyrighted
   image. A face is stored in the SAME users.emoji field as a token "m:<id>"
   (≤8 chars), so it flows through identity/sync/localStorage unchanged.

   window.Faces = { list, has(token), svg(token, em) }
   Render through app.face(value) — emoji text OR meme token both work. */
(function () {
  "use strict";

  var INK = "#2B2118";
  var S = 'fill="none" stroke="' + INK + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';
  var F = 'fill="' + INK + '"';

  // Each drawing is a 48x48 doodle. Kept loose on purpose — they're meant to
  // look like your friend drew them in the margin.
  var ART = {
    doge: '<path ' + S + ' d="M12 16 8 6l9 5M36 16l4-10-9 5"/><circle cx="24" cy="26" r="16" ' + S + '/><circle cx="18" cy="23" r="1.8" ' + F + '/><circle cx="31" cy="21" r="1.8" ' + F + '/><ellipse cx="27" cy="30" rx="2.6" ry="2" ' + F + '/><path ' + S + ' d="M20 35q4 2.5 8-.5"/>',
    frog: '<circle cx="15" cy="15" r="7" ' + S + '/><circle cx="33" cy="15" r="7" ' + S + '/><circle cx="15" cy="15" r="2" ' + F + '/><circle cx="33" cy="15" r="2" ' + F + '/><path ' + S + ' d="M7 26q17 14 34 0M10 33q14 9 28 0"/>',
    moai: '<path ' + S + ' d="M17 6h13q6 0 6 7v22q0 7-6 7H17q-3 0-3-4V10q0-4 3-4z"/><path ' + S + ' d="M14 15h9M14 24h7"/><path ' + S + ' d="M25 18v9h5"/><path ' + S + ' d="M22 35h9"/>',
    skull: '<path ' + S + ' d="M24 5C13 5 8 13 8 21c0 6 3 9 6 11v6h20v-6c3-2 6-5 6-11 0-8-5-16-16-16z"/><circle cx="17" cy="21" r="4.4" ' + F + '/><circle cx="31" cy="21" r="4.4" ' + F + '/><path ' + S + ' d="M24 27l-2.5 4h5zM19 38v4M24 38v4M29 38v4"/>',
    clown: '<path ' + S + ' d="M10 20q-6 1-6 7t7 6M38 20q6 1 6 7t-7 6"/><circle cx="24" cy="24" r="14" ' + S + '/><circle cx="24" cy="27" r="3.4" fill="#FF6B5E" stroke="' + INK + '" stroke-width="2.4"/><circle cx="19" cy="20" r="1.8" ' + F + '/><circle cx="29" cy="20" r="1.8" ' + F + '/><path ' + S + ' d="M16 32q8 6 16 0"/>',
    cry: '<circle cx="24" cy="24" r="17" ' + S + '/><path ' + S + ' d="M14 19q3-3 6 0M28 19q3-3 6 0"/><ellipse cx="24" cy="32" rx="6" ry="7" ' + F + '/><path ' + S + ' d="M13 25q-2 7 0 13M35 25q2 7 0 13" stroke="#2775CA"/>',
    side: '<circle cx="24" cy="24" r="17" ' + S + '/><ellipse cx="16" cy="21" rx="5" ry="6" ' + S + '/><ellipse cx="32" cy="21" rx="5" ry="6" ' + S + '/><circle cx="13.5" cy="22" r="2.2" ' + F + '/><circle cx="29.5" cy="22" r="2.2" ' + F + '/><path ' + S + ' d="M19 34h10"/>',
    cash: '<circle cx="24" cy="24" r="17" ' + S + '/><text x="10" y="25" font-family="monospace" font-weight="700" font-size="13" fill="#1E9E7E">$</text><text x="27" y="25" font-family="monospace" font-weight="700" font-size="13" fill="#1E9E7E">$</text><path ' + S + ' d="M15 31q9 7 18 0"/><path d="M22 34q2 4 5 3" ' + S + ' stroke="#FF6B5E"/>',
    fine: '<circle cx="22" cy="26" r="14" ' + S + '/><circle cx="17" cy="23" r="1.8" ' + F + '/><circle cx="26" cy="23" r="1.8" ' + F + '/><path ' + S + ' d="M17 31q5 3 9 0"/><path ' + S + ' d="M38 20c3-4-1-7 1-10-4 1-3 4-6 6s-2 7 1 8 3-2 4-4z" stroke="#FF6B5E"/>',
    grem: '<circle cx="24" cy="25" r="16" ' + S + '/><path ' + S + ' d="M13 17l7 4M35 17l-7 4"/><circle cx="18" cy="24" r="2" ' + F + '/><circle cx="30" cy="24" r="2" ' + F + '/><path ' + S + ' d="M14 32h20M17 32l2 4 3-4 2 4 3-4 2 4 2-4"/>',
    ghost: '<path ' + S + ' d="M24 6c-9 0-13 7-13 14v18l4-3 4 3 5-3 5 3 4-3 4 3V20c0-7-4-14-13-14z"/><path ' + S + ' d="M16 20l5 5M21 20l-5 5M28 20l5 5M33 20l-5 5"/><path ' + S + ' d="M19 32q5 3 10 0"/>',
    cat: '<path ' + S + ' d="M11 15 8 5l8 5M37 15l3-10-8 5"/><circle cx="24" cy="26" r="15" ' + S + '/><path ' + S + ' d="M15 24q3-3 6 0M28 24q3-3 6 0"/><path ' + S + ' d="M21 33q3 2 6 0"/><path ' + S + ' d="M4 26h7M4 31l7-2M37 26h7M37 29l7 2"/><path ' + S + ' d="M31 29q2 5 0 9" stroke="#2775CA"/>',
    // ── pack 2 ──────────────────────────────────────────────────────────────
    // pepe-adjacent sad frog: mint head, droopy eyes, a frown + one blue tear.
    sad: '<ellipse cx="24" cy="26" rx="17" ry="14" fill="#3DE8C7" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round"/><circle cx="16" cy="19" r="5" fill="#FFFDF7" stroke="' + INK + '" stroke-width="2.5"/><circle cx="32" cy="19" r="5" fill="#FFFDF7" stroke="' + INK + '" stroke-width="2.5"/><circle cx="16" cy="21" r="2" ' + F + '/><circle cx="32" cy="21" r="2" ' + F + '/><path ' + S + ' d="M16 34q8-6 16 0"/><path ' + S + ' d="M12 27q-2 5 0 9" stroke="#2775CA"/>',
    // chad: side-profile with a heroic jaw, blonde fill, tiny confident eye.
    chad: '<path fill="#FFC65C" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round" d="M17 9Q33 8 33 22L37 26L33 29Q34 41 22 42L17 42"/><path ' + S + ' d="M17 9q2-4 12-2"/><path ' + S + ' d="M27 14l5 1"/><circle cx="30" cy="19" r="1.8" ' + F + '/><path ' + S + ' d="M29 32l6 1"/>',
    // npc: rectangular gray head, flat brows, dead blank stare.
    npc: '<rect x="12" y="8" width="24" height="33" rx="5" fill="rgba(43,33,24,0.22)" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round"/><path ' + S + ' d="M16 18h6M26 18h6"/><circle cx="19" cy="23" r="1.9" ' + F + '/><circle cx="29" cy="23" r="1.9" ' + F + '/><path ' + S + ' d="M19 33h10"/>',
    // based: dark shades + a knowing smirk.
    base: '<circle cx="24" cy="24" r="17" ' + S + '/><path ' + F + ' d="M8 19h13v5q-6 3-13 0z"/><path ' + F + ' d="M27 19h13v5q-7 3-13 0z"/><path ' + S + ' d="M21 20h6"/><path ' + S + ' d="M17 33q7 3 13-1"/>',
    // rage-comic REEE face: red, slanted brows, gritted teeth.
    rage: '<circle cx="24" cy="24" r="17" fill="#FF6B5E" stroke="' + INK + '" stroke-width="3"/><path ' + S + ' d="M12 16l10 5M36 16l-10 5"/><circle cx="18" cy="24" r="2" ' + F + '/><circle cx="30" cy="24" r="2" ' + F + '/><rect x="15" y="31" width="18" height="8" rx="1.5" fill="#FFFDF7" stroke="' + INK + '" stroke-width="2.5"/><path ' + S + ' d="M20 31v8M25 31v8M29 31v8" stroke-width="2"/>',
    // sob: squeezed-shut eyes + two blue tear rivers + a wailing mouth.
    sob: '<circle cx="24" cy="24" r="17" fill="#FFC65C" stroke="' + INK + '" stroke-width="3"/><path ' + S + ' d="M13 20q4 4 8 0M27 20q4 4 8 0"/><path fill="#2775CA" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round" d="M14 24q-4 8-1 15q3-4 6 0q0-8 2-13z"/><path fill="#2775CA" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round" d="M34 24q4 8 1 15q-3-4-6 0q0-8-2-13z"/><ellipse cx="24" cy="34" rx="5" ry="4" ' + F + '/>',
  };

  var LIST = [
    { id: "doge", name: "doge" },
    { id: "frog", name: "the frog" },
    { id: "moai", name: "moai" },
    { id: "skull", name: "dead 💀" },
    { id: "clown", name: "clown" },
    { id: "cry", name: "sobbing" },
    { id: "side", name: "side-eye" },
    { id: "cash", name: "pay me" },
    { id: "fine", name: "this is fine" },
    { id: "grem", name: "gremlin" },
    { id: "ghost", name: "gone" },
    { id: "cat", name: "sad cat" },
    { id: "sad", name: "sad frog" },
    { id: "chad", name: "chad" },
    { id: "npc", name: "npc" },
    { id: "base", name: "based" },
    { id: "rage", name: "rage" },
    { id: "sob", name: "bawling" },
  ];

  function idOf(token) {
    return typeof token === "string" && token.indexOf("m:") === 0 ? token.slice(2) : null;
  }
  function has(token) {
    var id = idOf(token);
    return !!(id && ART[id]);
  }
  // em-sized so it drops in anywhere an emoji glyph went (inherits font-size).
  function svg(token, em) {
    var id = idOf(token);
    if (!id || !ART[id]) return "";
    var size = em || "1.15em";
    return '<svg viewBox="0 0 48 48" width="' + size + '" height="' + size + '" style="vertical-align:-0.18em;" aria-label="' + id + '">' + ART[id] + "</svg>";
  }

  window.Faces = { list: LIST, has: has, svg: svg };
})();
