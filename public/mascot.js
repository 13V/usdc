/* mascot.js — Mochi the frog, Divvy's mascot: a real-time RIGGED character
   with an actual SKELETON. A spring-physics engine drives every part per frame:

     · 2-bone IK LIMBS: legs have hips → knees → planted feet. The body bobs
       and crouches while the feet stay put, so the knees genuinely bend and
       extend. Jumps push off through full leg extension, tuck in the air,
       and re-plant on landing. Arms reach toward pose targets (rest, hands-up,
       wave, flail) through elbows, with spring lag for follow-through.
     · jelly body: the blob path regenerates from squash + lean springs
     · velocity-based squash & stretch + real ground contact with impact wobble
     · real eyelids over clipped eyes, randomized blinks, spring-driven pupils
       that track taps, glances and the fly
     · mouth MORPHS between expression shapes (lerped bezier control points)
     · the fly actually flies (wander steering); eyes lock on, the tongue aims
       at its live position, sticks, reels it into an open mouth. gulp.

   Public API (unchanged):
     window.Mascot.html({ size, mood, glow })  -> HTML string (auto-rigs itself)
     window.Mascot.el({ ... })                 -> DOM element
     window.Mascot.mini(px)                    -> tiny static frog for chips
     window.Mascot.cheer()                     -> every frog celebrates
     window.Mascot.react("pop")                -> quick squash reaction
   Moods: happy · wave · sparkle · watching · worried · sleepy
   prefers-reduced-motion -> static art, no engine. Hidden tab -> paused. */
(function () {
  "use strict";

  var INK = "#2B2118", MINT = "#3DE8C7", CORAL = "#FF6B5E", BLUE = "#2775CA";
  var STROKE = 'stroke="' + INK + '" stroke-linecap="round" stroke-linejoin="round"';
  var REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ---- static css (glow, sparkles, zzz, fly shell) ---------------------------
  if (!document.getElementById("divvy-mascot-css")) {
    var s = document.createElement("style");
    s.id = "divvy-mascot-css";
    s.textContent = [
      "@keyframes mGlow{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.7}50%{transform:translate(-50%,-50%) scale(1.1);opacity:1}}",
      "@keyframes mSpark{0%,100%{opacity:.3;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}",
      "@keyframes mZz{0%{opacity:0;transform:translateY(4px) scale(.8)}25%{opacity:1}100%{opacity:0;transform:translateY(-16px) scale(1.1)}}",
      ".mzz{position:absolute;right:6%;top:2%;font-family:'Space Mono',monospace;font-weight:700;font-size:13px;color:#17a98c;animation:mZz 2.4s ease-in-out infinite;pointer-events:none;z-index:5}",
      ".mfly{position:absolute;left:0;top:0;z-index:4;pointer-events:none;will-change:transform}",
      ".dmascot-drawn{will-change:transform}",
      "@media (prefers-reduced-motion: reduce){.dmascot *{animation:none!important}.mzz,.mfly{display:none!important}}",
    ].join("");
    document.head.appendChild(s);
  }

  // ---- tiny spring library ----------------------------------------------------
  function Spring(k, d, x) {
    this.k = k; this.d = d; this.x = x || 0; this.v = 0; this.t = x || 0;
  }
  Spring.prototype.step = function (dt) {
    var a = (this.t - this.x) * this.k - this.v * this.d;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  };
  Spring.prototype.kick = function (v) { this.v += v; };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, m) { return a + (b - a) * m; }
  function n2(x) { return Math.round(x * 100) / 100; }

  // 2-bone IK: hip/shoulder (hx,hy) reaching for (fx,fy) with bone lengths
  // l1,l2; `side` flips which way the knee/elbow points. Returns [kx,ky,fx,fy]
  // with the target clamped into reach.
  function ik(hx, hy, fx, fy, l1, l2, side) {
    var dx = fx - hx, dy = fy - hy;
    var d = Math.sqrt(dx * dx + dy * dy) || 0.001;
    var maxd = l1 + l2 - 0.4, mind = Math.abs(l1 - l2) + 0.4;
    if (d > maxd) { var m1 = maxd / d; dx *= m1; dy *= m1; d = maxd; }
    if (d < mind) { var m2 = mind / d; dx *= m2; dy *= m2; d = mind; }
    fx = hx + dx; fy = hy + dy;
    var a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    var h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    var mx = hx + dx * a / d, my = hy + dy * a / d;
    return [mx - dy / d * h * side, my + dx / d * h * side, fx, fy];
  }

  // ---- expression shapes -------------------------------------------------------
  var MOUTHS = {
    happy:   [63, 92, 74, 102, 85, 92, 96, 102, 107, 92],
    soft:    [72, 94, 78.5, 99, 85, 94, 91.5, 99, 98, 94],
    worried: [75, 98, 80, 93, 85, 98, 90, 103, 95, 98],
    sleepy:  [78, 95, 81.5, 98, 85, 95, 88.5, 98, 92, 95],
  };
  function mouthPath(m) {
    return "M" + n2(m[0]) + "," + n2(m[1]) +
      " Q" + n2(m[2]) + "," + n2(m[3]) + " " + n2(m[4]) + "," + n2(m[5]) +
      " Q" + n2(m[6]) + "," + n2(m[7]) + " " + n2(m[8]) + "," + n2(m[9]);
  }

  // Jelly body: regenerate the blob from squash s (+down/-up) and lean.
  function bodyPath(s, leanX) {
    var top = 50 + s * 15;
    var side = 25 - s * 9;
    var right = 170 - side;
    var apex = 85 + leanX;
    return "M" + n2(side) + ",96" +
      " Q" + n2(side + leanX * 0.4) + "," + n2(top) + " " + n2(apex) + "," + n2(top) +
      " Q" + n2(right + leanX * 0.4) + "," + n2(top) + " " + n2(right) + ",96" +
      " L" + n2(right) + ",102 Q" + n2(right) + ",132 85,132 Q" + n2(side) + ",132 " + n2(side) + ",102 Z";
  }

  // limb path through the joint (slightly curved = hand-inked)
  function limbPath(hx, hy, kx, ky, fx, fy) {
    return "M" + n2(hx) + "," + n2(hy) + " Q" + n2(kx) + "," + n2(ky) + " " + n2(fx) + "," + n2(fy);
  }

  // ---- rig markup ---------------------------------------------------------------
  var UID = 0;
  function frogSvg(mood, id) {
    function eye(side, cx) {
      return '' +
      '<g class="mq-eye-' + side + '">' +
        '<clipPath id="mqclip' + id + side + '"><circle cx="' + cx + '" cy="34" r="15.4"/></clipPath>' +
        '<circle cx="' + cx + '" cy="34" r="17" fill="' + MINT + '" ' + STROKE + ' stroke-width="4"/>' +
        '<g clip-path="url(#mqclip' + id + side + ')">' +
          '<g class="mq-pupilbox-' + side + '"><circle class="mq-pupil" cx="' + cx + '" cy="34" r="5.6" fill="' + INK + '"/>' +
          '<circle cx="' + (cx + 2) + '" cy="32" r="1.8" fill="#fff"/></g>' +
          '<circle class="mq-lid-' + side + '" cx="' + cx + '" cy="0" r="16.5" fill="' + MINT + '"/>' +
        '</g>' +
        '<path class="mq-shut-' + side + '" d="M' + (cx - 9) + ',34 q9,8 18,0" fill="none" ' + STROKE + ' stroke-width="3.4" opacity="0"/>' +
        '<path class="mq-brow-' + side + '" d="M' + (cx - 8) + ',16 q8,-4 15,-1" fill="none" ' + STROKE + ' stroke-width="3" opacity="0"/>' +
      '</g>';
    }
    return '' +
    '<svg class="mq-rig" viewBox="0 0 170 158" width="100%" height="100%" style="overflow:visible; display:block;">' +
      // limbs live in WORLD space and are re-drawn per frame from the IK solver
      '<path class="mq-leg-l" d="M63,127 Q56,134 58,141" fill="none" ' + STROKE + ' stroke-width="4.4"/>' +
      '<path class="mq-toe-l" d="M51,141 L65,141" fill="none" ' + STROKE + ' stroke-width="4"/>' +
      '<path class="mq-leg-r" d="M107,127 Q114,134 112,141" fill="none" ' + STROKE + ' stroke-width="4.4"/>' +
      '<path class="mq-toe-r" d="M105,141 L119,141" fill="none" ' + STROKE + ' stroke-width="4"/>' +
      '<g class="mq-dust" opacity="0"><path d="M38,143 q-7,2 -12,-1 M132,143 q7,2 12,-1" fill="none" stroke="rgba(43,33,24,0.4)" stroke-width="3" stroke-linecap="round"/></g>' +
      '<path class="mq-arm-l" d="M31,99 Q22,104 24,112" fill="none" ' + STROKE + ' stroke-width="4"/>' +
      '<path class="mq-arm-r" d="M139,99 Q148,104 146,112" fill="none" ' + STROKE + ' stroke-width="4"/>' +
      '<g class="mq-bodygroup">' +
        '<g class="mq-eyes">' + eye("l", 60) + eye("r", 110) + '</g>' +
        '<path class="mq-body" d="' + bodyPath(0, 0) + '" fill="' + MINT + '" ' + STROKE + ' stroke-width="4"/>' +
        '<path class="mq-hl" d="M42,64 q16,-9 32,-7" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="4.6" stroke-linecap="round"/>' +
        '<ellipse class="mq-throat" cx="85" cy="112" rx="15" ry="9" fill="#8bf2dd" ' + STROKE + ' stroke-width="3" opacity="0"/>' +
        '<g class="mq-face">' +
          '<path class="mq-mouth" d="' + mouthPath(MOUTHS.happy) + '" fill="none" ' + STROKE + ' stroke-width="3.6"/>' +
          '<ellipse class="mq-moutho" cx="85" cy="96" rx="7.5" ry="9" fill="' + INK + '" opacity="0"/>' +
          '<ellipse class="mq-blush-l" cx="44" cy="90" rx="9" ry="5.4" fill="#FF9C8F"/>' +
          '<ellipse class="mq-blush-r" cx="126" cy="90" rx="9" ry="5.4" fill="#FF9C8F"/>' +
        '</g>' +
        '<path class="mq-sweat" d="M36,50 q7,9 0,14 q-8,-5 0,-14" fill="' + BLUE + '" opacity="0"/>' +
        '<path class="mq-tongue" d="" fill="none" stroke="' + CORAL + '" stroke-width="5.5" stroke-linecap="round" opacity="0"/>' +
        '<circle class="mq-tip" r="4.5" fill="' + CORAL + '" opacity="0"/>' +
      '</g>' +
    '</svg>';
  }

  // ---- the engine ---------------------------------------------------------------
  var rigs = [];
  var running = false;
  var lastT = 0;

  function q(el, cls) { return el.querySelector("." + cls); }
  function T(el, str) { el.style.transform = str; }

  function makeRig(host) {
    var drawn = host.querySelector(".dmascot-drawn");
    var svg = host.querySelector(".mq-rig");
    if (!drawn || !svg) return null;
    var mood = host.getAttribute("data-mood") || "happy";

    var r = {
      host: host, drawn: drawn, svg: svg, mood: mood,
      // parts
      body: q(svg, "mq-body"), bodyG: q(svg, "mq-bodygroup"),
      eyeL: q(svg, "mq-eye-l"), eyeR: q(svg, "mq-eye-r"),
      pupL: q(svg, "mq-pupilbox-l"), pupR: q(svg, "mq-pupilbox-r"),
      lidL: q(svg, "mq-lid-l"), lidR: q(svg, "mq-lid-r"),
      shutL: q(svg, "mq-shut-l"), shutR: q(svg, "mq-shut-r"),
      browL: q(svg, "mq-brow-l"), browR: q(svg, "mq-brow-r"),
      legL: q(svg, "mq-leg-l"), legR: q(svg, "mq-leg-r"),
      toeL: q(svg, "mq-toe-l"), toeR: q(svg, "mq-toe-r"),
      armL: q(svg, "mq-arm-l"), armR: q(svg, "mq-arm-r"),
      mouth: q(svg, "mq-mouth"), mouthO: q(svg, "mq-moutho"),
      throat: q(svg, "mq-throat"), sweat: q(svg, "mq-sweat"),
      tongue: q(svg, "mq-tongue"), tip: q(svg, "mq-tip"),
      dust: q(svg, "mq-dust"),
      blushL: q(svg, "mq-blush-l"), blushR: q(svg, "mq-blush-r"),
      // core springs
      bounce: new Spring(90, 9, 0),      // vertical (px, negative = airborne)
      squash: new Spring(140, 10, 0),
      lean: new Spring(60, 8, 0),
      rot: new Spring(120, 10, 0),
      px: new Spring(160, 16, 0),
      py: new Spring(160, 16, 0),
      blink: new Spring(260, 22, 0),
      throatS: new Spring(180, 12, 0),
      open: new Spring(170, 14, 0),
      // limb springs: hands chase pose targets (lag = follow-through)
      hlx: new Spring(130, 12, 24), hly: new Spring(130, 12, 112),
      hrx: new Spring(130, 12, 146), hry: new Spring(130, 12, 112),
      // feet state (smoothed positions + planted flags)
      flx: 58, fly_: 141, frx: 112, fry: 141, plantL: true, plantR: true,
      spin: 0,
      // state
      t: Math.random() * 10, phase: Math.random() * 6.28,
      mouthA: MOUTHS.happy,
      blinkBase: 0, nextBlink: 1 + Math.random() * 3, nextShift: 3 + Math.random() * 4,
      nextAct: 4 + Math.random() * 5, lookUntil: 0, busyUntil: 0, stretchUntil: 0,
      pokes: 0, pokeAt: 0, pxBase: 0, pyBase: 0, sweatT: 0, dustFade: null,
      flyOb: null,
      onScreen: true, visW: 999, visCheck: 0, cx: 0, cy: 0, rectW: 170, rectH: 150,
    };

    // engine owns all motion — kill the css idle float html() set inline
    if (drawn.parentElement) drawn.parentElement.style.animation = "none";

    // mood presets
    if (mood === "worried") {
      r.mouthA = MOUTHS.worried;
      r.browL.setAttribute("opacity", "1"); r.browR.setAttribute("opacity", "1");
    } else if (mood === "sleepy") {
      r.blinkBase = 0.88; r.blink.x = 0.88; r.blink.t = 0.88; r.mouthA = MOUTHS.sleepy;
    } else if (mood === "watching") {
      r.pxBase = 4.2; r.pyBase = 0.6; r.px.t = 4.2; r.py.t = 0.6; r.mouthA = MOUTHS.soft;
    }
    r.mouth.setAttribute("d", mouthPath(r.mouthA));
    return r;
  }

  function rigVisible(r, now) {
    if (now > r.visCheck) {
      r.visCheck = now + 0.5;
      var rect = r.host.getBoundingClientRect();
      r.visW = rect.width;
      r.onScreen = rect.width > 0 && rect.bottom > -40 && rect.top < window.innerHeight + 40;
      r.cx = rect.left + rect.width / 2; r.cy = rect.top + rect.height / 2;
      r.rectW = rect.width || 170; r.rectH = rect.height || 150;
    }
    return r.onScreen;
  }

  // ---- behaviors: impulses into the physics --------------------------------------
  function doHop(r, big) {
    r.busyUntil = r.t + 1.2;
    r.squash.kick(4.5);                                   // anticipation crouch
    setTimeout(function () {
      r.bounce.kick(big ? -330 : -250);                   // launch (legs push off)
      r.squash.kick(-6);
    }, 130);
  }
  function doCroak(r) {
    r.busyUntil = r.t + 1.4;
    r.throatS.t = 1; r.throatS.kick(6);
    r.squash.kick(1.6);
    setTimeout(function () { r.throatS.kick(5); r.squash.kick(1.2); }, 380);
    setTimeout(function () { r.throatS.t = 0; }, 760);
  }
  function doGlance(r, dir) {
    r.px.t = dir * 4.4;
    r.lookUntil = r.t + 0.9 + Math.random() * 0.5;
  }
  function doStretch(r) {
    r.busyUntil = r.t + 1.4;
    r.stretchUntil = r.t + 0.95;
    r.squash.t = -1.4;
    setTimeout(function () { r.squash.t = 0; }, 900);
  }
  function doBlink(r, dbl) {
    r.blink.t = 1;
    setTimeout(function () { r.blink.t = r.blinkBase; }, 90);
    if (dbl) setTimeout(function () {
      r.blink.t = 1;
      setTimeout(function () { r.blink.t = r.blinkBase; }, 90);
    }, 210);
  }
  function spawnFly(r) {
    if (r.flyOb || r.visW < 90) return;
    r.busyUntil = r.t + 3.6;
    var el = document.createElement("span");
    el.className = "mfly";
    el.innerHTML = '<svg width="13" height="11" viewBox="0 0 13 11"><ellipse cx="6.5" cy="7" rx="3.4" ry="2.6" fill="#2B2118"/><path d="M4,4 q-3,-3 -1,-4 M9,4 q3,-3 1,-4" stroke="rgba(39,117,202,.75)" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';
    r.host.appendChild(el);
    r.flyOb = { el: el, x: 175, y: 6, vx: -46, vy: 14, state: "wander", until: r.t + 1.3 + Math.random() * 0.7, zap: new Spring(150, 13, 0), caught: false };
  }
  function doDizzy(r) {
    r.busyUntil = r.t + 1.8;
    var i = 0;
    var iv = setInterval(function () {
      r.rot.kick(i % 2 ? -160 : 160);
      if (++i >= 5) clearInterval(iv);
    }, 190);
    if (window.app && app.haptic) app.haptic([15, 25, 15, 25, 15, 25, 40]);
  }
  function doFlip(r) {
    r.busyUntil = r.t + 1;
    r.spin = 359.9;
    r.bounce.kick(-240);
    if (window.app && app.haptic) app.haptic([10, 20, 10, 20, 60]);
  }
  function doCheer(r) {
    r.busyUntil = r.t + 1.9;
    [-300, -240, -170].forEach(function (k, i) {
      setTimeout(function () {
        r.squash.kick(3.4);
        setTimeout(function () { r.bounce.kick(k); }, 100);
      }, i * 430);
    });
    r.open.t = 0.9;
    setTimeout(function () { r.open.t = 0; }, 1500);
  }
  function doPoke(r, sideSign) {
    r.squash.kick(5.5);
    r.rot.kick(sideSign * 90);
    r.bounce.kick(-70);
    // arms flail up
    r.hly.kick(-140); r.hry.kick(-140);
    r.hlx.kick(-60); r.hrx.kick(60);
    var now = Date.now();
    r.pokes = now - r.pokeAt < 1600 ? r.pokes + 1 : 1;
    r.pokeAt = now;
    if (r.pokes >= 5) { r.pokes = 0; doDizzy(r); }
    else if (Math.random() < 0.02) doFlip(r);
  }

  // ---- per-frame update ----------------------------------------------------------
  function stepRig(r, dt) {
    r.t += dt;
    var t = r.t;

    // ---- brain ----
    if (t > r.nextBlink && r.blinkBase < 0.5) {
      doBlink(r, Math.random() < 0.14);
      r.nextBlink = t + 2.2 + Math.random() * 3.6;
    }
    if (t > r.nextShift) {
      r.lean.t = (Math.random() * 2 - 1) * 1.15;
      r.nextShift = t + 3.5 + Math.random() * 4.5;
    }
    if (t > r.nextAct && t > r.busyUntil && !r.flyOb) {
      r.nextAct = t + 6 + Math.random() * 7;
      var m = Math.random();
      if (m < 0.13) spawnFly(r);
      else if (m < 0.32) doHop(r, Math.random() < 0.3);
      else if (m < 0.48) doCroak(r);
      else if (m < 0.62) doStretch(r);
      else if (m < 0.82) doGlance(r, Math.random() < 0.5 ? -1 : 1);
      else doBlink(r, true);
    }
    if (r.lookUntil && t > r.lookUntil && !r.flyOb) {
      r.px.t = r.pxBase; r.py.t = r.pyBase; r.lookUntil = 0;
    }

    if (r.mood === "worried") {
      r.sweatT += dt;
      var sw = (r.sweatT % 2.2) / 2.2;
      var so = sw < 0.28 ? sw / 0.28 : sw > 0.6 ? Math.max(0, 1 - (sw - 0.6) / 0.4) : 1;
      r.sweat.setAttribute("opacity", n2(so * 0.95));
      T(r.sweat, "translate(0," + n2(sw * 9 - 2) + "px)");
    }

    if (r.flyOb) stepFly(r, dt);

    // ---- physics ----
    var bounce = r.bounce.step(dt);
    if (bounce > 0) {                                     // ground contact
      r.bounce.x = 0;
      if (r.bounce.v > 60) {
        r.squash.kick(clamp(r.bounce.v * 0.045, 2, 9));
        r.hly.kick(90); r.hry.kick(90);                   // arms drop on impact
        if (r.bounce.v > 190) {
          r.dust.setAttribute("opacity", "0.7");
          r.dustFade = 0.32;
        }
        r.bounce.v = -r.bounce.v * 0.22;
      } else r.bounce.v = 0;
      bounce = 0;
    }
    if (r.dustFade != null) {
      r.dustFade -= dt;
      if (r.dustFade <= 0) { r.dust.setAttribute("opacity", "0"); r.dustFade = null; }
      else r.dust.setAttribute("opacity", n2(r.dustFade / 0.32 * 0.7));
    }
    var squash = r.squash.step(dt);
    var lean = r.lean.step(dt);
    var rot = r.rot.step(dt);
    var blink = clamp(r.blink.step(dt), 0, 1.05);
    var px = r.px.step(dt), py = r.py.step(dt);
    var throat = Math.max(0, r.throatS.step(dt));
    var open = clamp(r.open.step(dt), 0, 1);
    if (r.spin > 0) r.spin = Math.max(0, r.spin - dt * 560);

    // breathing + crouch move the BODY while the feet stay planted (that's
    // what makes him stand on legs instead of floating)
    var bob = Math.sin(t * 1.35 + r.phase) * 1.9;
    var crouch = clamp(squash, 0, 9) * 1.05;
    var baseTilt = Math.sin(t * 0.85 + r.phase) * 0.7;

    var vStretch = clamp(-r.bounce.v * 0.00085, -0.16, 0.2);
    var s = clamp(squash * 0.1 + Math.sin(t * 1.35 + r.phase) * 0.05 * 0.25, -0.45, 0.5);
    var sy = 1 - squash * 0.028 + vStretch;
    var sx = 1 + squash * 0.032 - vStretch * 0.75;

    // ---- LIMBS (world space, IK) ----
    var bodyDy = bob + crouch;                             // body offset from rest
    // hips: attached to the body bottom (follow bob/crouch and a bit of lean)
    var hipLx = 64 + lean * 2.5, hipLy = 125 + bodyDy;
    var hipRx = 106 + lean * 2.5, hipRy = 125 + bodyDy;
    // planted foot targets: fixed in WORLD space — svg translates by `bounce`,
    // so the planted y in svg coords counters it (feet stay on the ground while
    // the body rises, until the leg can't reach)
    var plantLy = 141 - bounce, plantRy = 141 - bounce;
    var REACH = 16.6;
    function stepFoot(px0, py0, hx, hy, plantX, plantY, planted, side) {
      var tx, ty, nowPlanted = planted;
      var dPlant = Math.sqrt((plantX - hx) * (plantX - hx) + (plantY - hy) * (plantY - hy));
      if (planted) {
        if (dPlant > REACH + 1.2) nowPlanted = false;      // push-off: release
        else { tx = plantX; ty = plantY; }
      }
      if (!nowPlanted) {
        // tucked under the body while airborne
        tx = hx + side * 4.5; ty = hy + 10.5;
        if (r.bounce.x > -5 && dPlant < REACH - 0.5) nowPlanted = true; // re-plant
      }
      if (nowPlanted) { tx = plantX; ty = plantY; }
      // smooth foot travel (fast but not teleporting)
      var f = Math.min(1, dt * (nowPlanted ? 26 : 14));
      return [px0 + (tx - px0) * f, py0 + (ty - py0) * f, nowPlanted];
    }
    var L = stepFoot(r.flx, r.fly_, hipLx, hipLy, 58, plantLy, r.plantL, -1);
    r.flx = L[0]; r.fly_ = L[1]; r.plantL = L[2];
    var R = stepFoot(r.frx, r.fry, hipRx, hipRy, 112, plantRy, r.plantR, 1);
    r.frx = R[0]; r.fry = R[1]; r.plantR = R[2];
    var lkL = ik(hipLx, hipLy, r.flx, r.fly_, 8.6, 8.6, -1);   // knees point outward
    var lkR = ik(hipRx, hipRy, r.frx, r.fry, 8.6, 8.6, 1);
    r.legL.setAttribute("d", limbPath(hipLx, hipLy, lkL[0], lkL[1], lkL[2], lkL[3]));
    r.legR.setAttribute("d", limbPath(hipRx, hipRy, lkR[0], lkR[1], lkR[2], lkR[3]));
    r.toeL.setAttribute("d", "M" + n2(lkL[2] - 7) + "," + n2(lkL[3]) + " L" + n2(lkL[2] + 7) + "," + n2(lkL[3]));
    r.toeR.setAttribute("d", "M" + n2(lkR[2] - 7) + "," + n2(lkR[3]) + " L" + n2(lkR[2] + 7) + "," + n2(lkR[3]));

    // arms: shoulders on the body sides; hands chase pose targets
    var shLx = 31 + lean * 3, shLy = 99 + bodyDy;
    var shRx = 139 + lean * 3, shRy = 99 + bodyDy;
    var air = clamp(-bounce / 15, 0, 1);
    var tHLx, tHLy, tHRx, tHRy;
    if (t < r.stretchUntil) {                              // big stretch: arms up
      tHLx = shLx - 4; tHLy = shLy - 19;
      tHRx = shRx + 4; tHRy = shRy - 19;
    } else if (air > 0.25) {                               // airborne: hands up!
      tHLx = shLx - 9 - air * 3; tHLy = shLy - 8 - air * 8;
      tHRx = shRx + 9 + air * 3; tHRy = shRy - 8 - air * 8;
    } else if (r.mood === "wave") {                        // hello!
      tHLx = shLx - 7; tHLy = shLy + 12;
      tHRx = shRx + 11 + Math.sin(t * 4.6) * 3.4;
      tHRy = shRy - 15 + Math.cos(t * 4.6) * 4.5;
    } else if (r.mood === "worried") {                     // hands wring together
      var wr = Math.sin(t * 5.2) * 1.6;
      tHLx = 76 + wr; tHLy = 117 + bodyDy;
      tHRx = 94 + wr; tHRy = 117 + bodyDy;
    } else {                                               // rest: sway at the sides
      var sway = Math.sin(t * 1.1 + r.phase) * 1.4;
      tHLx = shLx - 7 + sway + lean * 2; tHLy = shLy + 13 - crouch * 0.4;
      tHRx = shRx + 7 + sway + lean * 2; tHRy = shRy + 13 - crouch * 0.4;
    }
    r.hlx.t = tHLx; r.hly.t = tHLy; r.hrx.t = tHRx; r.hry.t = tHRy;
    var hlx = r.hlx.step(dt), hly = r.hly.step(dt);
    var hrx = r.hrx.step(dt), hry = r.hry.step(dt);
    var elL = ik(shLx, shLy, hlx, hly, 8, 8, 1);           // elbows point outward
    var elR = ik(shRx, shRy, hrx, hry, 8, 8, -1);
    r.armL.setAttribute("d", limbPath(shLx, shLy, elL[0], elL[1], elL[2], elL[3]));
    r.armR.setAttribute("d", limbPath(shRx, shRy, elR[0], elR[1], elR[2], elR[3]));

    // ---- write the body/face frame ----
    T(r.drawn, "translate3d(0," + n2(bounce) + "px,0) rotate(" + n2(rot * 0.06 + baseTilt + lean * 0.9 - r.spin) + "deg)");
    r.bodyG.style.transformOrigin = "85px 132px";
    T(r.bodyG, "translate(0," + n2(bodyDy) + "px) scale(" + n2(sx) + "," + n2(sy) + ")");
    r.body.setAttribute("d", bodyPath(s, lean * 5));
    var topDrop = s * 15;
    var peekL = Math.sin(t * 0.9 + r.phase) * 1.4;
    var peekR = Math.sin(t * 0.9 + r.phase + 2.1) * 1.4;
    T(r.eyeL, "translate(" + n2(lean * 3.2) + "px," + n2(topDrop * 0.86 + peekL) + "px)");
    T(r.eyeR, "translate(" + n2(lean * 3.2) + "px," + n2(topDrop * 0.86 + peekR) + "px)");
    T(r.pupL, "translate(" + n2(px) + "px," + n2(py) + "px)");
    T(r.pupR, "translate(" + n2(px) + "px," + n2(py) + "px)");
    var lidY = -2 + blink * 36.5;
    T(r.lidL, "translate(0," + n2(lidY) + "px)");
    T(r.lidR, "translate(0," + n2(lidY) + "px)");
    var shut = blink > 0.93 ? 1 : 0;
    r.shutL.setAttribute("opacity", shut); r.shutR.setAttribute("opacity", shut);
    r.throat.setAttribute("opacity", n2(clamp(throat, 0, 1)));
    r.throat.style.transformOrigin = "85px 112px";
    T(r.throat, "scale(" + n2(0.6 + throat * 0.55) + ")");
    r.mouth.setAttribute("opacity", n2(1 - open * 0.95));
    r.mouthO.setAttribute("opacity", n2(open));
    r.mouthO.style.transformOrigin = "85px 96px";
    T(r.mouthO, "scale(" + n2(0.3 + open * 0.7) + ")");
    var bs = 1 + clamp(Math.abs(r.squash.v) * 0.004, 0, 0.18);
    r.blushL.style.transformOrigin = "44px 90px"; T(r.blushL, "scale(" + n2(bs) + ")");
    r.blushR.style.transformOrigin = "126px 90px"; T(r.blushR, "scale(" + n2(bs) + ")");
  }

  function stepFly(r, dt) {
    var f = r.flyOb;
    var mouthX = 95, mouthY = 88;
    if (f.state === "wander") {
      f.vx += (Math.random() * 2 - 1) * 320 * dt + (110 - f.x) * 0.9 * dt;
      f.vy += (Math.random() * 2 - 1) * 300 * dt + (16 - f.y) * 1.1 * dt;
      f.vx = clamp(f.vx, -70, 70); f.vy = clamp(f.vy, -55, 55);
      f.x += f.vx * dt; f.y += f.vy * dt;
      r.px.t = clamp((f.x - 85) * 0.08, -4.4, 4.4);
      r.py.t = clamp((f.y - 34) * 0.08, -3, 2.4);
      r.lookUntil = r.t + 9;
      if (r.t > f.until) {
        f.state = "zap";
        f.zap.t = 1; f.zap.kick(9);
        r.rot.kick(120); r.squash.kick(1.8);
        r.open.t = 0.85;
        if (window.app && app.haptic) setTimeout(function () { app.haptic(12); }, 90);
      }
    }
    var e = clamp(f.zap.step(dt), 0, 1.06);
    if (f.state === "zap" || f.state === "reel") {
      if (f.state === "zap" && e > 0.96) { f.state = "reel"; f.caught = true; f.zap.t = 0; }
      var tipX = lerp(mouthX, f.x, e), tipY = lerp(mouthY, f.y, e);
      var sag = (1 - e) * 10 + 4;
      r.tongue.setAttribute("d", "M" + mouthX + "," + mouthY +
        " Q" + n2((mouthX + tipX) / 2 + 6) + "," + n2((mouthY + tipY) / 2 + sag) +
        " " + n2(tipX) + "," + n2(tipY));
      r.tongue.setAttribute("opacity", "1");
      r.tip.setAttribute("opacity", "1");
      r.tip.setAttribute("cx", n2(tipX)); r.tip.setAttribute("cy", n2(tipY));
      if (f.caught) { f.x = tipX; f.y = tipY; }
      if (f.state === "reel" && e < 0.07) {
        f.el.remove(); r.flyOb = null;
        r.tongue.setAttribute("opacity", "0"); r.tip.setAttribute("opacity", "0");
        r.open.t = 0;
        r.throatS.t = 1; r.throatS.kick(7);
        setTimeout(function () { r.throatS.t = 0; }, 300);
        r.squash.kick(2);
        r.px.t = r.pxBase; r.py.t = r.pyBase; r.lookUntil = 0;
        r.blink.t = 0.62;
        setTimeout(function () { r.blink.t = r.blinkBase; }, 520);
        return;
      }
    }
    var kx = r.rectW / 170, ky = r.rectH / 150;
    T(f.el, "translate(" + n2(f.x * kx) + "px," + n2(f.y * ky) + "px)");
  }

  // ---- main loop -------------------------------------------------------------------
  function loop(ts) {
    if (!rigs.length) { running = false; return; }
    requestAnimationFrame(loop);
    var dt = clamp((ts - lastT) / 1000, 0.001, 0.034);
    lastT = ts;
    if (document.hidden) return;
    var now = ts / 1000;
    for (var i = rigs.length - 1; i >= 0; i--) {
      var r = rigs[i];
      if (!r.host.isConnected) {
        if (r.flyOb) r.flyOb.el.remove();
        rigs.splice(i, 1);
        continue;
      }
      if (!rigVisible(r, now)) continue;
      stepRig(r, dt);
    }
  }
  function ensureLoop() {
    if (!running && rigs.length) {
      running = true;
      lastT = performance.now();
      requestAnimationFrame(loop);
    }
  }

  function boot(host) {
    if (host.dataset.mqRigged) return;
    if ((parseInt(host.style.width, 10) || 999) < 80) return;
    host.dataset.mqRigged = "1";
    var r = makeRig(host);
    if (r) {
      rigs.push(r);
      if (rigs.length > 6) rigs.shift();
      ensureLoop();
    }
  }
  function bootAll(root) {
    if (root.nodeType !== 1) return;
    if (root.classList && root.classList.contains("dmascot")) boot(root);
    if (root.querySelectorAll) root.querySelectorAll(".dmascot").forEach(boot);
  }
  if (!REDUCED) {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) bootAll(added[j]);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    if (document.body) bootAll(document.body);
  }

  // ---- global interactions -----------------------------------------------------------
  if (!window.__divvyMascotTap) {
    window.__divvyMascotTap = true;
    document.addEventListener("pointerdown", function (e) {
      if (REDUCED) return;
      var pokedHost = e.target && e.target.closest && e.target.closest(".dmascot");
      for (var i = 0; i < rigs.length; i++) {
        var r = rigs[i];
        if (!r.host.isConnected || !r.onScreen) continue;
        if (r.host === pokedHost) {
          doPoke(r, e.clientX < r.cx ? -1 : 1);
          if (window.app && app.haptic) app.haptic(12);
        } else if (!r.flyOb) {
          r.px.t = clamp((e.clientX - r.cx) * 0.03, -4.4, 4.4);
          r.py.t = clamp((e.clientY - r.cy) * 0.02, -3, 2.4);
          r.lookUntil = r.t + 0.9;
        }
      }
    }, { passive: true });
  }

  // Idle life: after 40s without any interaction, mascots doze off ("z z").
  if (!window.__divvyMascotIdle) {
    window.__divvyMascotIdle = true;
    var idleTimer = null;
    var dozing = false;
    function sleepAll() {
      dozing = true;
      document.querySelectorAll(".dmascot").forEach(function (m) {
        if (m.querySelector(".mzz")) return;
        var z = document.createElement("span");
        z.className = "mzz";
        z.textContent = "z z";
        m.appendChild(z);
      });
      rigs.forEach(function (r) { if (r.mood !== "sleepy") { r.blinkBase = 0.85; r.blink.t = 0.85; } });
    }
    function wakeAll() {
      if (dozing) {
        dozing = false;
        document.querySelectorAll(".mzz").forEach(function (z) { z.remove(); });
        rigs.forEach(function (r) { if (r.mood !== "sleepy") { r.blinkBase = 0; r.blink.t = 0; } });
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(sleepAll, 40000);
    }
    ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"].forEach(function (ev) {
      document.addEventListener(ev, wakeAll, { passive: true, capture: true });
    });
    wakeAll();
  }

  // ---- public API ----------------------------------------------------------------------
  function html(opts) {
    opts = opts || {};
    var size = opts.size || 120;
    var mood = opts.mood || "happy";
    var glow = opts.glow !== false;
    var k = size / 118;
    function px(n) { return Math.round(n * k); }

    var sparkles = mood === "sparkle"
      ? '<span style="position:absolute;left:-6px;top:2px;font-size:' + px(20) + 'px;animation:mSpark 1.4s ease-in-out infinite;">✨</span>' +
        '<span style="position:absolute;right:-4px;top:18px;font-size:' + px(15) + 'px;animation:mSpark 1.8s ease-in-out infinite .3s;">✨</span>'
      : "";
    var glowEl = glow
      ? '<div style="position:absolute;left:50%;top:55%;width:' + px(190) + 'px;height:' + px(190) + 'px;border-radius:50%;background:radial-gradient(circle, rgba(61,232,199,.4) 0%, rgba(61,232,199,0) 66%);animation:mGlow 7s ease-in-out infinite;pointer-events:none;"></div>'
      : "";

    return '' +
      '<div class="dmascot" data-mood="' + mood + '" style="position:relative;width:' + px(170) + 'px;height:' + px(150) + 'px;display:flex;align-items:center;justify-content:center;flex:none;">' +
        glowEl +
        '<div style="position:relative;width:100%;height:100%;">' +
          '<div class="dmascot-drawn" style="position:relative;width:100%;height:100%;transform-origin:50% 90%;filter:drop-shadow(' + Math.max(2, px(3)) + 'px ' + Math.max(3, px(4)) + 'px 0 rgba(43,33,24,0.45));">' +
            frogSvg(mood, ++UID) +
            sparkles +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // Tiny head-only mochi for spinners / chips (static — rigs are for the big guy).
  function mini(pxSize) {
    pxSize = pxSize || 28;
    return '' +
    '<svg viewBox="0 0 120 100" width="' + pxSize + '" height="' + Math.round(pxSize * 0.83) + '" style="overflow:visible; display:block; filter:drop-shadow(2px 3px 0 rgba(43,33,24,0.55));">' +
      '<g><circle cx="38" cy="26" r="14" fill="' + MINT + '" ' + STROKE + ' stroke-width="4"/><circle cx="38" cy="26" r="4.6" fill="' + INK + '"/></g>' +
      '<g><circle cx="82" cy="26" r="14" fill="' + MINT + '" ' + STROKE + ' stroke-width="4"/><circle cx="82" cy="26" r="4.6" fill="' + INK + '"/></g>' +
      '<path d="M14,64 Q14,38 60,38 Q106,38 106,64 Q106,88 60,88 Q14,88 14,64 Z" fill="' + MINT + '" ' + STROKE + ' stroke-width="4"/>' +
      '<path d="M43,64 q8.5,8 17,0 q8.5,8 17,0" fill="none" ' + STROKE + ' stroke-width="3.4"/>' +
      '<ellipse cx="28" cy="66" rx="7" ry="4.4" fill="#FF9C8F"/>' +
      '<ellipse cx="92" cy="66" rx="7" ry="4.4" fill="#FF9C8F"/>' +
    '</svg>';
  }

  function el(opts) {
    var d = document.createElement("div");
    d.innerHTML = html(opts).trim();
    return d.firstElementChild;
  }

  function cheer() {
    rigs.forEach(function (r) { if (r.host.isConnected && r.onScreen) doCheer(r); });
  }
  function react(kind) {
    rigs.forEach(function (r) {
      if (!r.host.isConnected) return;
      if (kind === "pop") { r.squash.kick(5); r.bounce.kick(-70); }
    });
  }

  window.Mascot = { html: html, el: el, mini: mini, cheer: cheer, react: react };
})();
