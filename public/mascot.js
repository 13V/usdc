/* mascot.js — Mochi the frog, Divvy's mascot, locked as ONE reusable asset.
   A smol mint journal-frog with periscope eyes, hand-inked outlines and an
   offset paper shadow. Drawn as inline SVG with STABLE part classes
   (.mq-body, .mq-eye-l, .mq-pupil-l, .mq-mouth, .mq-arm-r, …) so the same
   rig can be animated in-app today and exported for marketing later
   (see design/mascot/ for the master SVG + animation reference).

   Usage:
     window.Mascot.html({ size: 120, mood: 'happy', glow: true })  -> HTML string
     window.Mascot.el({ ... })                                     -> DOM element
     window.Mascot.mini(px)                                        -> tiny head-only frog (spinners, chips)
   Moods: 'happy' (default) · 'wave' · 'sparkle' · 'watching' · 'worried' · 'sleepy'
*/
(function () {
  "use strict";

  // Inject the keyframes + base styles once.
  if (!document.getElementById("divvy-mascot-css")) {
    var s = document.createElement("style");
    s.id = "divvy-mascot-css";
    s.textContent = [
      // whole-frog idle float (gentle bob, tiny tilt)
      "@keyframes mFloat{0%,100%{transform:translateY(0) rotate(-1.5deg)}50%{transform:translateY(-7px) rotate(1.5deg)}}",
      // body breathes: squash from the feet, like it's sitting
      "@keyframes mqSquish{0%,100%{transform:scale(1,1)}50%{transform:scale(1.035,.96)}}",
      // frog blink: pupils squash shut
      "@keyframes mBlink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}",
      // periscope eyes bob independently — the signature move
      "@keyframes mqPeekL{0%,100%{transform:translateY(0)}30%{transform:translateY(-2.5px)}60%{transform:translateY(0)}}",
      "@keyframes mqPeekR{0%,100%{transform:translateY(0)}45%{transform:translateY(-2.5px)}75%{transform:translateY(0)}}",
      // arms: resting bob / big hello wave
      "@keyframes mqArm{0%,100%{transform:rotate(0)}50%{transform:rotate(-7deg)}}",
      "@keyframes mqWave{0%,100%{transform:rotate(0)}50%{transform:rotate(-42deg)}}",
      // soft paper glow
      "@keyframes mGlow{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.7}50%{transform:translate(-50%,-50%) scale(1.1);opacity:1}}",
      "@keyframes mSpark{0%,100%{opacity:.3;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}",
      // worried sweat drop slides down
      "@keyframes mqSweat{0%{opacity:0;transform:translateY(-2px)}30%{opacity:1}100%{opacity:0;transform:translateY(7px)}}",
      // Tap squash: a springy pop when the mascot is poked.
      "@keyframes mPop{0%{transform:scale(1)}30%{transform:scale(.9,1.08)}60%{transform:scale(1.06,.94)}100%{transform:scale(1)}}",
      ".dmascot-drawn{transform-origin:50% 90%}",
      ".dmascot-drawn.mtap{animation:mPop .42s cubic-bezier(.34,1.56,.64,1)}",
      // poke games: 5 quick pokes → dizzy wobble; rare lucky poke → backflip
      "@keyframes mDizzy{0%,100%{transform:rotate(0)}20%{transform:rotate(13deg)}45%{transform:rotate(-11deg) scale(.96)}70%{transform:rotate(7deg)}88%{transform:rotate(-4deg)}}",
      ".dmascot-drawn.mdizzy{animation:mDizzy .9s ease-in-out 2}",
      "@keyframes mFlip{to{transform:rotate(360deg)}}",
      ".dmascot-drawn.mflip{animation:mFlip .7s cubic-bezier(.34,1.56,.64,1)}",
      // idle: after ~40s of stillness mochi nods off (floating z z)
      "@keyframes mZz{0%{opacity:0;transform:translateY(4px) scale(.8)}25%{opacity:1}100%{opacity:0;transform:translateY(-16px) scale(1.1)}}",
      ".mzz{position:absolute;right:6%;top:2%;font-family:'Space Mono',monospace;font-weight:700;font-size:13px;color:#17a98c;animation:mZz 2.4s ease-in-out infinite;pointer-events:none;z-index:5}",
      // SVG rig part animations (transform-box so origins are per-part)
      ".mq-bodygroup{transform-box:fill-box;transform-origin:50% 100%;animation:mqSquish 4.5s ease-in-out infinite}",
      ".mq-eye-l{transform-box:fill-box;transform-origin:50% 100%;animation:mqPeekL 6s ease-in-out infinite}",
      ".mq-eye-r{transform-box:fill-box;transform-origin:50% 100%;animation:mqPeekR 6s ease-in-out infinite .4s}",
      ".mq-pupil{transform-box:fill-box;transform-origin:center;animation:mBlink 5s ease-in-out infinite}",
      ".mq-arm-l{transform-box:fill-box;transform-origin:100% 0%;animation:mqArm 4.2s ease-in-out infinite}",
      ".mq-arm-r{transform-box:fill-box;transform-origin:0% 0%;animation:mqArm 4.2s ease-in-out infinite .3s}",
      ".mq-arm-r.mq-waving{animation:mqWave 1.5s ease-in-out infinite}",
      ".mq-sweat{transform-box:fill-box;animation:mqSweat 2.2s ease-in-out infinite}",
      // ---- life engine: random micro-behaviors ----
      // pupils glance (wrapper so it composes with the blink animation)
      ".mq-pupilbox{transform-box:fill-box;transform-origin:center;transition:transform .22s ease}",
      ".mlook-l .mq-pupilbox{transform:translateX(-4.5px)}",
      ".mlook-r .mq-pupilbox{transform:translateX(4.5px)}",
      // quick double-blink
      "@keyframes mBlink2{0%,100%{transform:scaleY(1)}25%{transform:scaleY(.08)}50%{transform:scaleY(1)}75%{transform:scaleY(.08)}}",
      ".mblink2 .mq-pupil{animation:mBlink2 .55s ease-in-out}",
      // little excited hop (squash -> leap -> land)
      "@keyframes mHop{0%,100%{transform:translateY(0) scale(1,1)}22%{transform:translateY(1px) scale(1.09,.86)}45%{transform:translateY(-13px) scale(.95,1.07)}70%{transform:translateY(0) scale(1.07,.9)}85%{transform:translateY(-2px) scale(.99,1.02)}}",
      ".mhop{animation:mHop .75s cubic-bezier(.4,0,.35,1)}",
      // croak: throat puffs twice
      ".mq-throat{transform-box:fill-box;transform-origin:center}",
      "@keyframes mCroak{0%{opacity:0;transform:scale(.6)}25%{opacity:1;transform:scale(1.15)}45%{transform:scale(.85)}65%{transform:scale(1.15)}85%{transform:scale(.9)}100%{opacity:0;transform:scale(.6)}}",
      ".mcroak .mq-throat{animation:mCroak 1.15s ease-in-out}",
      // tongue zap (fly catch)
      ".mq-tongue{opacity:0;transform-box:fill-box;transform-origin:0% 100%}",
      "@keyframes mTongue{0%{opacity:1;transform:scale(.05)}40%{opacity:1;transform:scale(1)}65%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.1)}}",
      ".mzap .mq-tongue{animation:mTongue .5s cubic-bezier(.2,.85,.3,1)}",
      // the fly
      ".mfly{position:absolute;right:7%;top:4%;z-index:4;pointer-events:none;animation:mFlyBuzz .5s ease-in-out infinite}",
      "@keyframes mFlyBuzz{0%,100%{transform:translate(0,0)}25%{transform:translate(-2px,1.5px)}50%{transform:translate(1.5px,-2px)}75%{transform:translate(-1px,-1px)}}",
      "@keyframes mFlyPop{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.2)}}",
      ".mfly.mgone{animation:mFlyPop .18s ease-out forwards}",
      // settle-up cheer: three happy bounces (triggered by app.celebrate)
      "@keyframes mCheer{0%,100%{transform:translateY(0) scale(1)}30%{transform:translateY(-10px) scale(.97,1.05)}60%{transform:translateY(0) scale(1.06,.92)}}",
      ".mcheer{animation:mCheer .5s ease-in-out 3}",
      "@media (prefers-reduced-motion: reduce){.dmascot *{animation:none!important}.mzz{animation:none!important}.mfly{display:none!important}}",
    ].join("");
    document.head.appendChild(s);
  }

  // One delegated tap handler for every mascot on the page: squash on poke,
  // dizzy after 5 quick pokes, and a rare 1-in-50 backflip.
  if (!window.__divvyMascotTap) {
    window.__divvyMascotTap = true;
    var pokes = 0, pokeAt = 0;
    document.addEventListener("pointerdown", function (e) {
      var host = e.target && e.target.closest && e.target.closest(".dmascot");
      if (!host) return;
      var blob = host.querySelector(".dmascot-drawn");
      if (!blob) return;
      var now = Date.now();
      pokes = now - pokeAt < 1600 ? pokes + 1 : 1;
      pokeAt = now;
      blob.classList.remove("mtap", "mdizzy", "mflip");
      void blob.offsetWidth; // reflow so animations retrigger on rapid taps
      if (pokes >= 5) {
        pokes = 0;
        blob.classList.add("mdizzy");
        if (window.app && app.haptic) app.haptic([15, 25, 15, 25, 15, 25, 40]);
      } else if (Math.random() < 0.02) {
        blob.classList.add("mflip");
        if (window.app && app.haptic) app.haptic([10, 20, 10, 20, 60]);
      } else {
        blob.classList.add("mtap");
      }
    }, { passive: true });
  }

  // Idle life: after 40s without any interaction, mascots on screen doze off
  // (a floating "z z"); any touch/scroll/keypress wakes them.
  if (!window.__divvyMascotIdle) {
    window.__divvyMascotIdle = true;
    var idleTimer = null;
    function sleep() {
      document.querySelectorAll(".dmascot").forEach(function (m) {
        if (m.querySelector(".mzz")) return;
        var z = document.createElement("span");
        z.className = "mzz";
        z.textContent = "z z";
        m.appendChild(z);
      });
    }
    function wake() {
      document.querySelectorAll(".mzz").forEach(function (z) { z.remove(); });
      clearTimeout(idleTimer);
      idleTimer = setTimeout(sleep, 40000);
    }
    ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"].forEach(function (ev) {
      document.addEventListener(ev, wake, { passive: true, capture: true });
    });
    wake();
  }

  // ---- life engine: every 6-13s one visible mochi does something small ------
  // (double-blink, glance, hop, croak — and, rarely, catches a fly with a
  // tongue zap). Mascots also glance toward taps. Paused when the tab is
  // hidden; disabled entirely under prefers-reduced-motion.
  if (!window.__divvyMascotLife) {
    window.__divvyMascotLife = true;
    var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var visibleMascots = function () {
      var out = [];
      document.querySelectorAll(".dmascot").forEach(function (m) {
        var r = m.getBoundingClientRect();
        if (r.width > 44 && r.bottom > 0 && r.top < window.innerHeight) out.push(m);
      });
      return out;
    };
    var timed = function (el, cls, ms) {
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
      setTimeout(function () { el.classList.remove(cls); }, ms);
    };

    var flyCatch = function (host) {
      var drawn = host.querySelector(".dmascot-drawn");
      if (!drawn || host.querySelector(".mfly")) return;
      var fly = document.createElement("span");
      fly.className = "mfly";
      fly.innerHTML = '<svg width="13" height="11" viewBox="0 0 13 11"><ellipse cx="6.5" cy="7" rx="3.4" ry="2.6" fill="#2B2118"/><path d="M4,4 q-3,-3 -1,-4 M9,4 q3,-3 1,-4" stroke="rgba(39,117,202,.75)" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';
      host.appendChild(fly);
      timed(drawn, "mlook-r", 1400);                                     // spot it…
      setTimeout(function () { timed(drawn, "mzap", 520); }, 850);       // …zap!
      setTimeout(function () { fly.classList.add("mgone"); }, 1060);
      setTimeout(function () { fly.remove(); }, 1400);
      setTimeout(function () { if (window.app && app.haptic) app.haptic(12); }, 1000);
    };

    var tick = function () {
      setTimeout(tick, 6000 + Math.random() * 7000);
      if (reducedMotion || document.hidden) return;
      var ms = visibleMascots();
      if (!ms.length) return;
      var host = ms[Math.floor(Math.random() * ms.length)];
      var drawn = host.querySelector(".dmascot-drawn");
      if (!drawn) return;
      var r = Math.random();
      if (r < 0.13) flyCatch(host);
      else if (r < 0.30) timed(drawn, "mhop", 800);
      else if (r < 0.48) timed(drawn, "mcroak", 1200);
      else if (r < 0.66) timed(drawn, "mblink2", 600);
      else if (r < 0.83) timed(drawn, "mlook-l", 1100);
      else timed(drawn, "mlook-r", 1100);
    };
    setTimeout(tick, 3500);

    // Glance toward taps elsewhere on the page (poking the mascot itself is
    // handled by the tap-squash handler above).
    document.addEventListener("pointerdown", function (e) {
      if (reducedMotion) return;
      if (e.target && e.target.closest && e.target.closest(".dmascot")) return;
      visibleMascots().forEach(function (m) {
        var drawn = m.querySelector(".dmascot-drawn");
        if (!drawn) return;
        var r = m.getBoundingClientRect();
        var cx = r.left + r.width / 2;
        drawn.classList.remove("mlook-l", "mlook-r");
        timed(drawn, e.clientX < cx - 20 ? "mlook-l" : e.clientX > cx + 20 ? "mlook-r" : "mblink2", 900);
      });
    }, { passive: true });
  }

  // Every mochi on screen does three happy bounces — app.celebrate calls this
  // on settle-up success so the mascot parties with the confetti.
  function cheer() {
    document.querySelectorAll(".dmascot-drawn").forEach(function (m) {
      m.classList.remove("mcheer");
      void m.offsetWidth;
      m.classList.add("mcheer");
      setTimeout(function () { m.classList.remove("mcheer"); }, 1600);
    });
  }

  var INK = "#2B2118", MINT = "#3DE8C7", CORAL = "#FF6B5E", BLUE = "#2775CA";
  var STROKE = 'stroke="' + INK + '" stroke-linecap="round" stroke-linejoin="round"';

  // ---- the rig ---------------------------------------------------------------
  // One 170x150 SVG. Every part carries a stable class so CSS (in-app) or a
  // motion tool (marketing) can grab it: mq-eye-l/r, mq-pupil-l/r, mq-body,
  // mq-mouth, mq-blush-l/r, mq-arm-l/r, mq-leg-l/r, mq-sweat, mq-lid-l/r.

  function eyeStalks(mood) {
    var sw = 4;
    function stalk(side, cx) {
      var cls = side === "l" ? "mq-eye-l" : "mq-eye-r";
      var inner;
      if (mood === "sleepy") {
        // closed, content lids
        inner = '<path class="mq-lid-' + side + '" d="M' + (cx - 9) + ',34 q9,8 18,0" fill="none" ' + STROKE + ' stroke-width="3.4"/>';
      } else if (mood === "watching") {
        // pupils track something off to the side
        inner = '<g class="mq-pupilbox"><circle class="mq-pupil mq-pupil-' + side + '" cx="' + (cx + 5.5) + '" cy="35" r="5.6" fill="' + INK + '"/>' +
          '<circle cx="' + (cx + 7.5) + '" cy="33" r="1.8" fill="#fff"/></g>';
      } else {
        inner = '<g class="mq-pupilbox"><circle class="mq-pupil mq-pupil-' + side + '" cx="' + cx + '" cy="34" r="5.6" fill="' + INK + '"/>' +
          '<circle cx="' + (cx + 2) + '" cy="32" r="1.8" fill="#fff"/></g>';
      }
      var brow = mood === "worried"
        ? '<path d="M' + (cx - 8) + ',18 q8,-4 15,-1" fill="none" ' + STROKE + ' stroke-width="3"/>'
        : "";
      return '<g class="' + cls + '">' +
        '<circle cx="' + cx + '" cy="34" r="17" fill="' + MINT + '" ' + STROKE + ' stroke-width="' + sw + '"/>' +
        inner + brow +
      '</g>';
    }
    return stalk("l", 60) + stalk("r", 110);
  }

  function mouthFor(mood) {
    if (mood === "worried")
      return '<path class="mq-mouth" d="M75,98 q5,-5 10,0 q5,5 10,0" fill="none" ' + STROKE + ' stroke-width="3.6"/>';
    if (mood === "watching")
      return '<circle class="mq-mouth" cx="85" cy="97" r="4.6" fill="none" ' + STROKE + ' stroke-width="3.4"/>';
    if (mood === "sleepy")
      return '<path class="mq-mouth" d="M79,96 q6,4 12,0" fill="none" ' + STROKE + ' stroke-width="3.4"/>';
    // happy: the wide double-arc frog smile
    return '<path class="mq-mouth" d="M63,92 q11,10 22,0 q11,10 22,0" fill="none" ' + STROKE + ' stroke-width="3.6"/>';
  }

  function frogSvg(mood, waving) {
    var sweat = mood === "worried"
      ? '<path class="mq-sweat" d="M36,50 q7,9 0,14 q-8,-5 0,-14" fill="' + BLUE + '"/>'
      : "";
    return '' +
    '<svg class="mq-rig" viewBox="0 0 170 158" width="100%" height="100%" style="overflow:visible; display:block;">' +
      // legs (behind body)
      '<g class="mq-leg-l"><path d="M60,132 v9 M51,141 h15" fill="none" ' + STROKE + ' stroke-width="4"/></g>' +
      '<g class="mq-leg-r"><path d="M110,132 v9 M104,141 h15" fill="none" ' + STROKE + ' stroke-width="4"/></g>' +
      '<g class="mq-bodygroup">' +
        // arms (attach at the body sides)
        '<g class="mq-arm-l"><path d="M27,98 q-11,3 -13,13" fill="none" ' + STROKE + ' stroke-width="4"/></g>' +
        '<g class="mq-arm-r' + (waving ? " mq-waving" : "") + '"><path d="' + (waving ? "M143,94 q13,-7 15,-18" : "M143,98 q11,3 13,13") + '" fill="none" ' + STROKE + ' stroke-width="4"/></g>' +
        // periscope eyes (overlap the body top)
        eyeStalks(mood) +
        // body
        '<path class="mq-body" d="M25,96 Q25,50 85,50 Q145,50 145,96 L145,102 Q145,132 85,132 Q25,132 25,102 Z" fill="' + MINT + '" ' + STROKE + ' stroke-width="4"/>' +
        '<path d="M42,64 q16,-9 32,-7" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="4.6" stroke-linecap="round"/>' +
        // face
        '<ellipse class="mq-throat" cx="85" cy="112" rx="15" ry="9" fill="#8bf2dd" ' + STROKE + ' stroke-width="3" opacity="0"/>' +
        '<g class="mq-face">' +
          mouthFor(mood) +
          '<ellipse class="mq-blush-l" cx="44" cy="90" rx="9" ry="5.4" fill="#FF9C8F"/>' +
          '<ellipse class="mq-blush-r" cx="126" cy="90" rx="9" ry="5.4" fill="#FF9C8F"/>' +
        '</g>' +
        sweat +
        '<g class="mq-tongue"><path d="M95,90 Q120,60 146,28" fill="none" stroke="' + CORAL + '" stroke-width="5.5" stroke-linecap="round"/><circle cx="146" cy="28" r="4.5" fill="' + CORAL + '"/></g>' +
      '</g>' +
    '</svg>';
  }

  function html(opts) {
    opts = opts || {};
    var size = opts.size || 120;        // body width in px (same scale as the old blob)
    var mood = opts.mood || "happy";
    var glow = opts.glow !== false;
    var k = size / 118;                 // scale factor off the 118px base
    function px(n) { return Math.round(n * k); }

    var sparkles = mood === "sparkle"
      ? '<span style="position:absolute;left:-6px;top:2px;font-size:' + px(20) + 'px;animation:mSpark 1.4s ease-in-out infinite;">✨</span>' +
        '<span style="position:absolute;right:-4px;top:18px;font-size:' + px(15) + 'px;animation:mSpark 1.8s ease-in-out infinite .3s;">✨</span>'
      : "";

    var glowEl = glow
      ? '<div style="position:absolute;left:50%;top:55%;width:' + px(190) + 'px;height:' + px(190) + 'px;border-radius:50%;background:radial-gradient(circle, rgba(61,232,199,.4) 0%, rgba(61,232,199,0) 66%);animation:mGlow 7s ease-in-out infinite;pointer-events:none;"></div>'
      : "";

    return '' +
      '<div class="dmascot" style="position:relative;width:' + px(170) + 'px;height:' + px(150) + 'px;display:flex;align-items:center;justify-content:center;flex:none;">' +
        glowEl +
        '<div style="position:relative;width:100%;height:100%;animation:mFloat 5.5s ease-in-out infinite;">' +
          '<div class="dmascot-drawn" style="position:relative;width:100%;height:100%;filter:drop-shadow(' + Math.max(2, px(3)) + 'px ' + Math.max(3, px(4)) + 'px 0 rgba(43,33,24,0.45));">' +
            frogSvg(mood, mood === "wave") +
            sparkles +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // Tiny head-only mochi for spinners / chips / inline moments. Pure SVG,
  // inherits the same idle blink so even the smallest frog feels alive.
  function mini(pxSize) {
    pxSize = pxSize || 28;
    return '' +
    '<svg viewBox="0 0 120 100" width="' + pxSize + '" height="' + Math.round(pxSize * 0.83) + '" style="overflow:visible; display:block; filter:drop-shadow(2px 3px 0 rgba(43,33,24,0.55));">' +
      '<g class="mq-eye-l"><circle cx="38" cy="26" r="14" fill="' + MINT + '" ' + STROKE + ' stroke-width="4"/><circle class="mq-pupil" cx="38" cy="26" r="4.6" fill="' + INK + '"/></g>' +
      '<g class="mq-eye-r"><circle cx="82" cy="26" r="14" fill="' + MINT + '" ' + STROKE + ' stroke-width="4"/><circle class="mq-pupil" cx="82" cy="26" r="4.6" fill="' + INK + '"/></g>' +
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

  window.Mascot = { html: html, el: el, mini: mini, cheer: cheer };
})();
