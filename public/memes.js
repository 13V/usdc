/* memes.js — the Mochi Meme Generator (public/, loaded by GET /memes).
   Pure client. No network, no uploads. Composes a 1080x1080 journal-paper meme
   on a <canvas>: paper + ruled lines + washi tape, a BIG Mochi in a chosen pose,
   top/bottom Space-Mono captions (auto-sized, max 2 lines), and a tasteful
   "divvy · app.divvysol.com" watermark.

   Mochi is drawn by porting the mascot.js frog GEOMETRY to an SVG string, then
   rasterizing SVG -> data-URI -> <img> -> drawImage (the cheap in-browser path).
   Pose-specific flourishes (party hat + confetti, stonks arrow, pain scribble)
   are drawn as canvas ops around the frog.

   Exposes window.MemeLab = { render, toDataURL, toBlob, state } for tests. */
(function () {
  "use strict";

  // ── journal palette (canvas can't read CSS vars) ────────────────────────────
  var INK = "#2B2118", MINT = "#3DE8C7", CORAL = "#FF6B5E", BLUE = "#2775CA", SUN = "#FFC65C";
  var PAPER = "#F7F1E3";
  var MONO = "'Space Mono', ui-monospace, monospace";
  var STROKE = 'stroke="' + INK + '" stroke-linecap="round" stroke-linejoin="round"';
  var W = 1080, H = 1080;

  // ── Mochi frog geometry (ported verbatim from public/mascot.js, static) ──────
  function eyeStalks(mood) {
    var sw = 4;
    function stalk(side, cx) {
      var inner;
      if (mood === "sleepy") {
        inner = '<path d="M' + (cx - 9) + ',34 q9,8 18,0" fill="none" ' + STROKE + ' stroke-width="3.4"/>';
      } else if (mood === "watching") {
        inner = '<circle cx="' + (cx + 5.5) + '" cy="35" r="5.6" fill="' + INK + '"/>' +
          '<circle cx="' + (cx + 7.5) + '" cy="33" r="1.8" fill="#fff"/>';
      } else {
        inner = '<circle cx="' + cx + '" cy="34" r="5.6" fill="' + INK + '"/>' +
          '<circle cx="' + (cx + 2) + '" cy="32" r="1.8" fill="#fff"/>';
      }
      var brow = mood === "worried"
        ? '<path d="M' + (cx - 8) + ',18 q8,-4 15,-1" fill="none" ' + STROKE + ' stroke-width="3"/>'
        : "";
      return '<g><circle cx="' + cx + '" cy="34" r="17" fill="' + MINT + '" ' + STROKE +
        ' stroke-width="' + sw + '"/>' + inner + brow + '</g>';
    }
    return stalk("l", 60) + stalk("r", 110);
  }

  function mouthFor(mood) {
    if (mood === "worried")
      return '<path d="M75,98 q5,-5 10,0 q5,5 10,0" fill="none" ' + STROKE + ' stroke-width="3.6"/>';
    if (mood === "watching")
      return '<circle cx="85" cy="97" r="4.6" fill="none" ' + STROKE + ' stroke-width="3.4"/>';
    if (mood === "sleepy")
      return '<path d="M79,96 q6,4 12,0" fill="none" ' + STROKE + ' stroke-width="3.4"/>';
    return '<path d="M63,92 q11,10 22,0 q11,10 22,0" fill="none" ' + STROKE + ' stroke-width="3.6"/>';
  }

  function frogSvg(mood, waving) {
    var sweat = mood === "worried"
      ? '<path d="M36,50 q7,9 0,14 q-8,-5 0,-14" fill="' + BLUE + '"/>'
      : "";
    var inner =
      '<g><path d="M60,132 v9 M51,141 h15" fill="none" ' + STROKE + ' stroke-width="4"/></g>' +
      '<g><path d="M110,132 v9 M104,141 h15" fill="none" ' + STROKE + ' stroke-width="4"/></g>' +
      '<g>' +
        '<g><path d="M27,98 q-11,3 -13,13" fill="none" ' + STROKE + ' stroke-width="4"/></g>' +
        '<g><path d="' + (waving ? "M143,94 q13,-7 15,-18" : "M143,98 q11,3 13,13") +
          '" fill="none" ' + STROKE + ' stroke-width="4"/></g>' +
        eyeStalks(mood) +
        '<path d="M25,96 Q25,50 85,50 Q145,50 145,96 L145,102 Q145,132 85,132 Q25,132 25,102 Z" fill="' +
          MINT + '" ' + STROKE + ' stroke-width="4"/>' +
        '<path d="M42,64 q16,-9 32,-7" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="4.6" stroke-linecap="round"/>' +
        '<g>' + mouthFor(mood) +
          '<ellipse cx="44" cy="90" rx="9" ry="5.4" fill="#FF9C8F"/>' +
          '<ellipse cx="126" cy="90" rx="9" ry="5.4" fill="#FF9C8F"/>' +
        '</g>' + sweat +
      '</g>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 170 158" width="680" height="632">' +
      inner + '</svg>';
  }

  // ── pose catalogue ──────────────────────────────────────────────────────────
  // baseMood -> the frog SVG variant; deco -> canvas flourish key.
  var POSES = [
    { id: "happy",    name: "happy",    mood: "happy",   deco: null },
    { id: "worried",  name: "worried",  mood: "worried", deco: null },
    { id: "party",    name: "party",    mood: "happy",   deco: "party" },
    { id: "sleepy",   name: "sleepy",   mood: "sleepy",  deco: null },
    { id: "watching", name: "watching", mood: "watching",deco: null },
    { id: "wave",     name: "wave",     mood: "wave",    deco: null },
    { id: "stonks",   name: "stonks up",mood: "happy",   deco: "stonks" },
    { id: "pain",     name: "pain",     mood: "worried", deco: "pain" }
  ];

  var PRESETS = [
    "when they say they'll pay you back",
    "the group chat after i send the tab",
    "me waiting for my $12",
    "split the bill. not the friendship.",
    "he remembers the $23",
    "gm to everyone who settles up"
  ];

  var TINTS = {
    paper: { key: "paper", wash: null, sw: PAPER },
    mint:  { key: "mint",  wash: "rgba(61,232,199,0.16)",  sw: "#c9f4ea" },
    coral: { key: "coral", wash: "rgba(255,107,94,0.13)",  sw: "#f6cfc9" },
    sun:   { key: "sun",   wash: "rgba(255,198,92,0.18)",  sw: "#f6e2b4" }
  };

  // ── state ───────────────────────────────────────────────────────────────────
  var state = { pose: "happy", tint: "paper", top: "", bottom: PRESETS[0] };

  // strip control chars, collapse whitespace, cap length (defensive, cosmetic).
  function clean(s) {
    return String(s == null ? "" : s).replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
  }
  function currentPose() {
    for (var i = 0; i < POSES.length; i++) if (POSES[i].id === state.pose) return POSES[i];
    return POSES[0];
  }

  // ── frog raster cache (SVG data-URI -> Image) ───────────────────────────────
  var imgCache = {};
  function frogImage(mood, waving, cb) {
    var key = mood + (waving ? "|w" : "");
    if (imgCache[key]) { cb(imgCache[key]); return; }
    var img = new Image();
    img.onload = function () { imgCache[key] = img; cb(img); };
    img.onerror = function () { cb(null); };
    img.src = "data:image/svg+xml," + encodeURIComponent(frogSvg(mood, waving));
  }
  function preloadAll(done) {
    var pending = 0, fired = false;
    function one() { pending--; if (pending <= 0 && !fired) { fired = true; done(); } }
    for (var i = 0; i < POSES.length; i++) {
      pending++;
      frogImage(POSES[i].mood, POSES[i].mood === "wave", one);
    }
    if (pending === 0) done();
  }

  // ── canvas helpers ──────────────────────────────────────────────────────────
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }

  function greedyLines(ctx, text, maxWidth) {
    var words = text.split(/\s+/).filter(Boolean), lines = [], line = "";
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + " " + words[i] : words[i];
      if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = words[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  function fitsWidth(ctx, lines, maxWidth) {
    for (var i = 0; i < lines.length; i++) if (ctx.measureText(lines[i]).width > maxWidth) return false;
    return true;
  }
  function truncate(ctx, s, maxWidth) {
    var t = s;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
    return t + "…";
  }
  // Auto-size a caption to at most maxLines within maxWidth. Returns {lines, px}.
  function layoutCaption(ctx, raw, maxWidth, maxLines, startPx, minPx) {
    var text = clean(raw);
    if (!text) return null;
    for (var px = startPx; px >= minPx; px -= 2) {
      ctx.font = "700 " + px + "px " + MONO;
      var lines = greedyLines(ctx, text, maxWidth);
      if (lines.length <= maxLines && fitsWidth(ctx, lines, maxWidth)) return { lines: lines, px: px };
    }
    ctx.font = "700 " + minPx + "px " + MONO;
    var l = greedyLines(ctx, text, maxWidth);
    if (l.length > maxLines) { l = l.slice(0, maxLines); l[maxLines - 1] = truncate(ctx, l[maxLines - 1], maxWidth); }
    else if (!fitsWidth(ctx, l, maxWidth)) { for (var k = 0; k < l.length; k++) if (ctx.measureText(l[k]).width > maxWidth) l[k] = truncate(ctx, l[k], maxWidth); }
    return { lines: l, px: minPx };
  }
  function drawCaption(ctx, cap, bandTop, bandH) {
    if (!cap) return;
    ctx.font = "700 " + cap.px + "px " + MONO;
    ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var lh = cap.px * 1.14, total = cap.lines.length * lh, y = bandTop + bandH / 2 - total / 2 + lh / 2;
    for (var i = 0; i < cap.lines.length; i++) { ctx.fillText(cap.lines[i], W / 2, y); y += lh; }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  // frog draw box (centered), leaving caption bands top & bottom.
  var FROG = { w: 590, h: 548, x: (W - 590) / 2, y: 250 };
  var TOP_BAND = { y: 48, h: 190 };
  var BOT_BAND = { y: 812, h: 208 };

  function drawBackground(ctx, tint) {
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    if (tint.wash) { ctx.fillStyle = tint.wash; ctx.fillRect(0, 0, W, H); }
    // ruled notebook lines
    ctx.strokeStyle = "rgba(39,117,202,0.12)"; ctx.lineWidth = 2;
    for (var ly = 120; ly < H; ly += 58) { ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W, ly); ctx.stroke(); }
    // coral margin line
    ctx.strokeStyle = "rgba(255,107,94,0.30)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(72, 0); ctx.lineTo(72, H); ctx.stroke();
  }

  function tape(ctx, x, y, rot, w, color) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = color; ctx.fillRect(-w / 2, -26, w, 52);
    // torn-tape sheen
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    for (var i = -w / 2; i < w / 2; i += 16) ctx.fillRect(i, -26, 8, 52);
    ctx.restore();
  }
  function drawTape(ctx) {
    tape(ctx, 150, 60, -0.11, 190, "rgba(255,198,92,0.80)");   // top-left sunshine
    tape(ctx, W - 150, 62, 0.10, 190, "rgba(61,232,199,0.72)"); // top-right mint
    tape(ctx, 138, H - 70, 0.09, 180, "rgba(61,232,199,0.62)"); // bottom-left mint
    tape(ctx, W - 140, H - 66, -0.10, 180, "rgba(255,107,94,0.55)"); // bottom-right coral
  }

  // stonks: a chunky mint up-and-to-the-right arrow behind Mochi.
  function drawStonks(ctx) {
    var cx = W / 2, cy = FROG.y + FROG.h * 0.52;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.06);
    ctx.beginPath();
    var p = [[-250, 210], [-90, 30], [10, 120], [180, -150], [110, -180], [250, -210],
             [250, -70], [205, -110], [40, 110], [-60, 20], [-190, 260]];
    ctx.moveTo(p[0][0], p[0][1]); for (var i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]); ctx.closePath();
    ctx.fillStyle = "rgba(61,232,199,0.5)"; ctx.fill();
    ctx.lineWidth = 8; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(43,33,24,0.55)"; ctx.stroke();
    ctx.restore();
  }

  // pain: frantic coral scribble behind Mochi.
  function drawPain(ctx) {
    ctx.save(); ctx.strokeStyle = "rgba(255,107,94,0.42)"; ctx.lineWidth = 10; ctx.lineCap = "round";
    var cx = W / 2, cy = FROG.y + FROG.h * 0.5;
    for (var s = 0; s < 6; s++) {
      ctx.beginPath();
      var baseY = cy - 210 + s * 78, amp = 150 + (s % 3) * 40;
      for (var x = -300; x <= 300; x += 14) {
        var yy = baseY + Math.sin((x + s * 60) / 30) * (amp * 0.18) + Math.cos(x / 17) * 22;
        if (x === -300) ctx.moveTo(cx + x, yy); else ctx.lineTo(cx + x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // party: confetti (fixed layout so redraws are stable) + a striped hat on Mochi.
  var CONFETTI = [
    [120, 300, 22, 0.3, BLUE, "r"], [980, 280, 18, -0.4, CORAL, "c"], [220, 520, 20, 0.8, SUN, "r"],
    [900, 560, 16, 0.2, MINT, "c"], [160, 760, 24, -0.6, CORAL, "r"], [960, 820, 20, 0.5, BLUE, "c"],
    [300, 210, 16, 1.0, MINT, "r"], [820, 200, 22, -0.2, SUN, "c"], [420, 900, 18, 0.4, BLUE, "r"],
    [680, 920, 20, -0.7, CORAL, "c"], [520, 150, 16, 0.6, MINT, "r"], [780, 700, 18, 0.9, SUN, "r"]
  ];
  function drawConfetti(ctx) {
    for (var i = 0; i < CONFETTI.length; i++) {
      var c = CONFETTI[i];
      ctx.save(); ctx.translate(c[0], c[1]); ctx.rotate(c[3]); ctx.fillStyle = c[4];
      ctx.strokeStyle = "rgba(43,33,24,0.55)"; ctx.lineWidth = 3;
      if (c[5] === "c") { ctx.beginPath(); ctx.arc(0, 0, c[2] * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      else { ctx.fillRect(-c[2] / 2, -c[2] / 3, c[2], c[2] * 0.66); ctx.strokeRect(-c[2] / 2, -c[2] / 3, c[2], c[2] * 0.66); }
      ctx.restore();
    }
  }
  function drawHat(ctx) {
    // sits on Mochi's head, between the periscope eyes.
    var cx = FROG.x + FROG.w * 0.5, baseY = FROG.y + FROG.h * 0.10, half = 78, apex = baseY - 150;
    ctx.save();
    ctx.translate(cx, 0); ctx.rotate(0.08);
    // cone
    ctx.beginPath(); ctx.moveTo(-half, baseY); ctx.lineTo(half, baseY); ctx.lineTo(0, apex); ctx.closePath();
    ctx.fillStyle = SUN; ctx.fill();
    ctx.lineWidth = 7; ctx.lineJoin = "round"; ctx.strokeStyle = INK; ctx.stroke();
    // stripes
    ctx.save(); ctx.clip();
    ctx.strokeStyle = CORAL; ctx.lineWidth = 14;
    for (var k = 0; k < 4; k++) { var yy = baseY - k * 42; ctx.beginPath(); ctx.moveTo(-half, yy); ctx.lineTo(half - k * 6, yy - 30); ctx.stroke(); }
    ctx.restore();
    // pom-pom
    ctx.beginPath(); ctx.arc(0, apex, 17, 0, Math.PI * 2); ctx.fillStyle = MINT; ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.stroke();
    ctx.restore();
  }

  function drawWatermark(ctx) {
    ctx.font = "700 27px " + MONO;
    ctx.fillStyle = "rgba(43,33,24,0.6)";
    ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
    ctx.fillText("divvy · app.divvysol.com", W - 46, H - 40);
    ctx.textAlign = "left";
  }

  // full compose. frogImg may be null (frog skipped until it loads).
  function compose(ctx, frogImg) {
    var pose = currentPose();
    var tint = TINTS[state.tint] || TINTS.paper;

    drawBackground(ctx, tint);
    drawTape(ctx);

    // deco behind the frog
    if (pose.deco === "stonks") drawStonks(ctx);
    else if (pose.deco === "pain") drawPain(ctx);
    else if (pose.deco === "party") drawConfetti(ctx);

    // Mochi, with a soft offset paper shadow
    if (frogImg) {
      ctx.save();
      ctx.shadowColor = "rgba(43,33,24,0.38)"; ctx.shadowOffsetX = 7; ctx.shadowOffsetY = 9; ctx.shadowBlur = 0;
      ctx.drawImage(frogImg, FROG.x, FROG.y, FROG.w, FROG.h);
      ctx.restore();
    }

    if (pose.deco === "party") drawHat(ctx);

    // captions (auto-sized, max 2 lines each)
    var maxW = W - 150;
    drawCaption(ctx, layoutCaption(ctx, state.top, maxW, 2, 92, 40), TOP_BAND.y, TOP_BAND.h);
    drawCaption(ctx, layoutCaption(ctx, state.bottom, maxW, 2, 96, 40), BOT_BAND.y, BOT_BAND.h);

    drawWatermark(ctx);
  }

  var canvas = null;
  function render() {
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var pose = currentPose();
    frogImage(pose.mood, pose.mood === "wave", function (img) { compose(ctx, img); });
  }

  function toBlob(cb) {
    if (canvas.toBlob) { canvas.toBlob(function (b) { cb(b); }, "image/png"); return; }
    try {
      var d = canvas.toDataURL("image/png"), bin = atob(d.split(",")[1]), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      cb(new Blob([arr], { type: "image/png" }));
    } catch (_) { cb(null); }
  }
  function toDataURL() { return canvas.toDataURL("image/png"); }

  // ── UI ──────────────────────────────────────────────────────────────────────
  function el(tag, cls, html) { var d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; }

  function buildUI(root) {
    // stage + canvas
    var stage = el("div", "stage");
    canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H; canvas.id = "memeCanvas";
    canvas.setAttribute("aria-label", "your mochi meme preview");
    stage.appendChild(canvas);
    root.appendChild(stage);

    // captions card
    var capCard = el("div", "card");
    capCard.appendChild(el("div", "lbl", "caption"));
    var top = document.createElement("input"); top.type = "text"; top.id = "capTop"; top.maxLength = 90;
    top.placeholder = "top text (optional)"; top.value = state.top;
    var bot = document.createElement("input"); bot.type = "text"; bot.id = "capBottom"; bot.maxLength = 90;
    bot.placeholder = "bottom text"; bot.value = state.bottom;
    capCard.appendChild(top); capCard.appendChild(bot);
    top.addEventListener("input", function () { state.top = top.value; render(); });
    bot.addEventListener("input", function () { state.bottom = bot.value; render(); });
    root.appendChild(capCard);

    // preset chips (fill bottom caption)
    var presetCard = el("div", "card");
    presetCard.appendChild(el("div", "lbl", "one-tap captions"));
    var chips = el("div", "chips");
    PRESETS.forEach(function (p) {
      var c = el("button", "chip", "“" + p + "”"); c.type = "button";
      c.addEventListener("click", function () { state.bottom = p; state.top = ""; bot.value = p; top.value = ""; render(); });
      chips.appendChild(c);
    });
    presetCard.appendChild(chips);
    root.appendChild(presetCard);

    // pose grid
    var poseCard = el("div", "card");
    poseCard.appendChild(el("div", "lbl", "pose"));
    var grid = el("div", "poses");
    POSES.forEach(function (p) {
      var b = el("div", "pose" + (p.id === state.pose ? " sel" : "")); b.setAttribute("data-pose", p.id);
      var im = document.createElement("img"); im.alt = p.name;
      im.src = "data:image/svg+xml," + encodeURIComponent(frogSvg(p.mood, p.mood === "wave"));
      b.appendChild(im); b.appendChild(el("div", "pn", p.name));
      b.addEventListener("click", function () {
        state.pose = p.id;
        grid.querySelectorAll(".pose").forEach(function (x) { x.classList.remove("sel"); });
        b.classList.add("sel"); render();
      });
      grid.appendChild(b);
    });
    poseCard.appendChild(grid);
    root.appendChild(poseCard);

    // background tint
    var tintCard = el("div", "card");
    tintCard.appendChild(el("div", "lbl", "background wash"));
    var sw = el("div", "swatches");
    Object.keys(TINTS).forEach(function (key) {
      var t = TINTS[key];
      var s = el("div", "swatch" + (key === state.tint ? " sel" : "")); s.setAttribute("data-tint", key);
      s.style.background = t.sw; s.title = key;
      s.addEventListener("click", function () {
        state.tint = key;
        sw.querySelectorAll(".swatch").forEach(function (x) { x.classList.remove("sel"); });
        s.classList.add("sel"); render();
      });
      sw.appendChild(s);
    });
    tintCard.appendChild(sw);
    var surprise = el("button", "btn ghost wide", "🎲 surprise me"); surprise.type = "button";
    surprise.style.marginTop = "12px";
    surprise.addEventListener("click", function () {
      var p = POSES[Math.floor(Math.random() * POSES.length)];
      var cap = PRESETS[Math.floor(Math.random() * PRESETS.length)];
      var tkeys = Object.keys(TINTS), tk = tkeys[Math.floor(Math.random() * tkeys.length)];
      state.pose = p.id; state.bottom = cap; state.top = ""; state.tint = tk;
      bot.value = cap; top.value = "";
      grid.querySelectorAll(".pose").forEach(function (x) { x.classList.toggle("sel", x.getAttribute("data-pose") === p.id); });
      sw.querySelectorAll(".swatch").forEach(function (x) { x.classList.toggle("sel", x.getAttribute("data-tint") === tk); });
      render();
    });
    tintCard.appendChild(surprise);
    root.appendChild(tintCard);

    // actions
    var actions = el("div", "");
    var rowA = el("div", "rowbtns");
    var dl = el("button", "btn", "⬇ download"); dl.type = "button"; dl.id = "memeDownload";
    var share = el("button", "btn primary", "share ↗"); share.type = "button"; share.id = "memeShare";
    rowA.appendChild(dl); rowA.appendChild(share);
    var post = el("button", "btn x wide", "post on 𝕏"); post.type = "button"; post.id = "memeTweet"; post.style.marginTop = "9px";
    actions.appendChild(rowA); actions.appendChild(post);
    actions.appendChild(el("div", "hint", 'sharing sends the image straight from your phone. posting on 𝕏 opens a tweet — <b>attach your meme!</b> (download it first, then add it to the post)'));
    root.appendChild(actions);

    dl.addEventListener("click", downloadPng);
    share.addEventListener("click", doShare);
    post.addEventListener("click", doTweet);
  }

  function fileName() {
    return "mochi-" + currentPose().id + ".png";
  }

  function downloadPng() {
    toBlob(function (blob) {
      if (!blob) { window.open(toDataURL(), "_blank"); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = fileName();
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
  }

  // caption text used for share / tweet copy.
  function captionText() {
    var t = clean(state.top), b = clean(state.bottom);
    var joined = [t, b].filter(Boolean).join(" / ");
    return joined || "made a mochi meme";
  }
  function shareLink() { return "https://app.divvysol.com/memes"; }

  function doShare() {
    toBlob(function (blob) {
      var file = null;
      try { if (blob) file = new File([blob], fileName(), { type: "image/png" }); } catch (_) { file = null; }
      var payload = { title: "mochi meme 🐸", text: captionText() + " — made with divvy 🐸", url: shareLink() };
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        navigator.share(Object.assign({ files: [file] }, payload)).catch(function () {});
        return;
      }
      if (navigator.share) { navigator.share(payload).catch(function () {}); return; }
      downloadPng(); // no Web Share — fall back to a download
    });
  }

  function tweetIntent() {
    var text = captionText() + " 🐸 made with divvy — split the bill, settle in seconds";
    return "https://twitter.com/intent/tweet?text=" +
      encodeURIComponent(text + "\n" + shareLink());
  }
  function doTweet() { window.open(tweetIntent(), "_blank", "noopener"); }

  // ── boot ────────────────────────────────────────────────────────────────────
  function boot() {
    var root = document.getElementById("memeRoot");
    if (!root) return;
    buildUI(root);
    // Ensure Space Mono is ready before the first paint so captions aren't drawn
    // in a fallback metric; re-render once fonts + frog rasters are in.
    function firstPaint() { preloadAll(render); }
    if (document.fonts && document.fonts.load) {
      Promise.all([
        document.fonts.load('700 90px "Space Mono"'),
        document.fonts.load('400 40px "Space Mono"')
      ]).then(firstPaint, firstPaint);
      if (document.fonts.ready && document.fonts.ready.then) document.fonts.ready.then(render);
    } else {
      firstPaint();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // Test / integration surface.
  window.MemeLab = {
    render: render,
    toDataURL: function () { return canvas ? toDataURL() : null; },
    toBlob: function (cb) { if (canvas) toBlob(cb); else cb(null); },
    tweetIntent: tweetIntent,
    state: state,
    POSES: POSES,
    PRESETS: PRESETS
  };
})();
