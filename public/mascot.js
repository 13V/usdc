/* mascot.js — Divvy's mascot, locked as ONE reusable asset.
   A squishy USDC-blue blob with blinking eyes, a smile, waving arms, little
   feet, and a kinetic glow — lifted from the design frames so it's pixel-
   identical everywhere (no more re-rolls).

   Usage:
     window.Mascot.html({ size: 120, mood: 'happy', glow: true })  -> HTML string
     window.Mascot.el({ ... })                                     -> DOM element
   Moods: 'happy' (default) · 'wave' · 'sparkle' · 'watching' · 'worried' · 'sleepy'
*/
(function () {
  "use strict";

  // Inject the keyframes + base styles once.
  if (!document.getElementById("divvy-mascot-css")) {
    var s = document.createElement("style");
    s.id = "divvy-mascot-css";
    s.textContent = [
      "@keyframes mFloat{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-8px) rotate(3deg)}}",
      "@keyframes mSquish{0%,100%{border-radius:47% 53% 52% 48% / 55% 48% 52% 45%}50%{border-radius:53% 47% 48% 52% / 46% 54% 47% 53%}}",
      "@keyframes mBlink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}",
      "@keyframes mWaveL{0%,100%{transform:rotate(15deg)}50%{transform:rotate(0)}}",
      "@keyframes mWaveR{0%,100%{transform:rotate(-15deg)}50%{transform:rotate(0)}}",
      "@keyframes mWaveBig{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(-38deg)}}",
      "@keyframes mGlow{0%,100%{transform:translate(-50%,-50%) scale(1) rotate(0);opacity:.85}50%{transform:translate(-50%,-50%) scale(1.12) rotate(18deg);opacity:1}}",
      "@keyframes mSpark{0%,100%{opacity:.3;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}",
      // Tier-1 life for the image mascot: a springy pop-in entrance, a gentle
      // breathe idle, and a tap squash. Entrance → idle is a clean handoff: the
      // idle animation is delayed by the entrance's duration, and both start/end
      // on the identity transform.
      "@keyframes mArrive{0%{opacity:0;transform:translateY(18px) scale(.55)}60%{opacity:1}100%{opacity:1;transform:translateY(0) scale(1)}}",
      "@keyframes mBreathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-6px) scale(1.025)}}",
      // celebrate: a happier idle — quicker bounce with a tiny lean left/right.
      "@keyframes mCheer{0%,100%{transform:translateY(0) scale(1) rotate(0)}25%{transform:translateY(-9px) scale(1.03) rotate(-2deg)}50%{transform:translateY(0) scale(1)}75%{transform:translateY(-9px) scale(1.03) rotate(2deg)}}",
      "@keyframes mPop{0%{transform:scale(1)}30%{transform:scale(.9,1.08)}60%{transform:scale(1.06,.94)}100%{transform:scale(1)}}",
      ".dmascot-img{animation:mArrive .55s cubic-bezier(.34,1.56,.64,1) both,mBreathe 4.6s ease-in-out .55s infinite;transform-origin:50% 90%;will-change:transform}",
      ".dmascot-img.mood-celebrate{animation:mArrive .55s cubic-bezier(.34,1.56,.64,1) both,mCheer 2.6s ease-in-out .55s infinite}",
      // tap squash resumes the idle when it's done (a bare mPop would otherwise
      // replace the idle animation permanently and freeze the breathing).
      ".dmascot-img.mtap{animation:mPop .42s cubic-bezier(.34,1.56,.64,1),mBreathe 4.6s ease-in-out .42s infinite}",
      ".dmascot-img.mood-celebrate.mtap{animation:mPop .42s cubic-bezier(.34,1.56,.64,1),mCheer 2.6s ease-in-out .42s infinite}",
      "@media (prefers-reduced-motion: reduce){.dmascot *{animation:none!important}}",
    ].join("");
    document.head.appendChild(s);
  }

  // One delegated tap→squash for every mascot on the page (image mascots only).
  if (!window.__divvyMascotTap) {
    window.__divvyMascotTap = true;
    document.addEventListener("pointerdown", function (e) {
      var host = e.target && e.target.closest && e.target.closest(".dmascot");
      if (!host) return;
      var img = host.querySelector(".dmascot-img");
      if (!img || img.style.display === "none") return;
      img.classList.remove("mtap");
      // reflow so the animation can retrigger on rapid taps
      void img.offsetWidth;
      img.classList.add("mtap");
    }, { passive: true });
  }

  var INK = "#0B1622";

  // Mood → mascot image (drop the Gemini PNGs into public/mascot/). Existing mood
  // names used across the app are aliased onto the real art so nothing 404s.
  var IMG_BASE = "/mascot/";
  var MOOD_IMG = {
    happy: "happy", wave: "happy", hello: "happy",
    sparkle: "celebrate", celebrate: "celebrate", paid: "celebrate",
    watching: "thinking", thinking: "thinking", worried: "thinking",
    sleepy: "sleepy", empty: "sleepy",
    hero: "hero", proud: "hero",
  };
  function resolvedMood(mood) { return MOOD_IMG[mood] || "happy"; }
  function imgFor(mood) { return IMG_BASE + resolvedMood(mood) + ".png"; }

  function eyes(mood) {
    var blink = "animation:mBlink 5s ease-in-out infinite;";
    if (mood === "sleepy") {
      // closed happy arcs
      var arc = "width:15px;height:8px;border:2.5px solid " + INK + ";border-bottom:none;border-radius:14px 14px 0 0;";
      return '<div style="' + arc + '"></div><div style="' + arc + '"></div>';
    }
    var w = mood === "watching" ? 12 : 14;
    var h = 18;
    var pupil = mood === "watching"
      ? '<div style="position:absolute;right:2px;bottom:3px;width:6px;height:6px;border-radius:50%;background:#7fc0ff;"></div>'
      : "";
    var eye = '<div style="position:relative;width:' + w + 'px;height:' + h + 'px;border-radius:50%;background:' + INK + ';' + (mood === "watching" ? "" : blink) + '">' + pupil + "</div>";
    return eye + eye;
  }

  function mouth(mood) {
    if (mood === "worried")
      return '<div style="position:absolute;bottom:32px;width:16px;height:9px;border:3px solid ' + INK + ';border-bottom:none;border-radius:14px 14px 0 0;"></div>';
    if (mood === "watching")
      return '<div style="position:absolute;bottom:34px;width:10px;height:10px;border:3px solid ' + INK + ';border-radius:50%;"></div>';
    // happy smile
    return '<div style="position:absolute;bottom:34px;width:22px;height:11px;border:3px solid ' + INK + ';border-top:none;border-radius:0 0 14px 14px;"></div>';
  }

  function html(opts) {
    opts = opts || {};
    var size = opts.size || 120;        // body width in px
    var mood = opts.mood || "happy";
    var glow = opts.glow !== false;
    var k = size / 118;                 // scale factor off the 118px base
    function px(n) { return Math.round(n * k); }

    var armAnimL = mood === "wave" ? "mWaveBig 1.6s ease-in-out infinite" : "mWaveL 4.2s ease-in-out infinite";
    var armAnimR = "mWaveR 4.2s ease-in-out infinite";

    var sparkles = mood === "sparkle"
      ? '<span style="position:absolute;left:-6px;top:2px;font-size:' + px(20) + 'px;animation:mSpark 1.4s ease-in-out infinite;">✨</span>' +
        '<span style="position:absolute;right:-4px;top:18px;font-size:' + px(15) + 'px;animation:mSpark 1.8s ease-in-out infinite .3s;">✨</span>'
      : "";
    var sweat = mood === "worried"
      ? '<div style="position:absolute;right:' + px(14) + 'px;top:' + px(20) + 'px;width:' + px(9) + 'px;height:' + px(13) + 'px;border-radius:60% 60% 60% 60%/70% 70% 40% 40%;background:linear-gradient(160deg,#7fc0ff,#3de8c7);"></div>'
      : "";

    var glowEl = glow
      ? '<div style="position:absolute;left:50%;top:50%;width:' + px(200) + 'px;height:' + px(200) + 'px;border-radius:46% 54% 52% 48%;background:conic-gradient(from 0deg, rgba(39,117,202,.5), rgba(61,232,199,.42), rgba(39,117,202,.5));filter:blur(' + px(32) + 'px);animation:mGlow 7s ease-in-out infinite;pointer-events:none;"></div>'
      : "";

    return '' +
      '<div class="dmascot" style="position:relative;width:' + px(170) + 'px;height:' + px(150) + 'px;display:flex;align-items:center;justify-content:center;flex:none;">' +
        glowEl +
        '<div style="position:relative;animation:mFloat 5.5s ease-in-out infinite;">' +
          // Drawn fallback layer — shown until (and unless) the mood PNG loads.
          '<div class="dmascot-drawn" style="position:relative;">' +
            // legs
            '<div style="position:absolute;left:' + px(39) + 'px;bottom:-' + px(13) + 'px;width:' + px(17) + 'px;height:' + px(27) + 'px;border-radius:999px;background:linear-gradient(160deg,#3a8fe0,#1f5da3);"></div>' +
            '<div style="position:absolute;right:' + px(39) + 'px;bottom:-' + px(13) + 'px;width:' + px(17) + 'px;height:' + px(27) + 'px;border-radius:999px;background:linear-gradient(160deg,#3a8fe0,#1f5da3);"></div>' +
            // arms
            '<div style="position:absolute;left:-' + px(9) + 'px;top:' + px(45) + 'px;width:' + px(19) + 'px;height:' + px(32) + 'px;border-radius:999px;background:linear-gradient(160deg,#3f93e4,#2061a8);transform-origin:' + px(14) + 'px ' + px(4) + 'px;animation:' + armAnimL + ';"></div>' +
            '<div style="position:absolute;right:-' + px(9) + 'px;top:' + px(45) + 'px;width:' + px(19) + 'px;height:' + px(32) + 'px;border-radius:999px;background:linear-gradient(160deg,#3f93e4,#2061a8);transform-origin:' + px(5) + 'px ' + px(4) + 'px;animation:' + armAnimR + ';"></div>' +
            // body
            '<div style="position:relative;width:' + px(118) + 'px;height:' + px(118) + 'px;background:linear-gradient(155deg,#4aa0f0,#2775CA 60%,#1c5697);animation:mSquish 4.5s ease-in-out infinite;box-shadow:0 ' + px(16) + 'px ' + px(40) + 'px rgba(39,117,202,.5), inset 0 4px 8px rgba(255,255,255,.28);display:flex;align-items:center;justify-content:center;">' +
              '<div style="display:flex;gap:' + px(15) + 'px;margin-top:-' + px(8) + 'px;">' + eyes(mood) + '</div>' +
              mouth(mood) +
              '<div style="position:absolute;top:' + px(30) + 'px;left:' + px(22) + 'px;width:' + px(13) + 'px;height:' + px(13) + 'px;border-radius:50%;background:rgba(255,255,255,.22);"></div>' +
              sweat +
            '</div>' +
            sparkles +
          '</div>' +
          // Real mascot art (Gemini PNGs in /mascot/). On load it hides the drawn
          // fallback; on error (file missing) it hides itself so the fallback shows.
          '<div style="position:absolute;left:50%;top:50%;width:' + px(172) + 'px;height:' + px(172) + 'px;transform:translate(-50%,-52%);pointer-events:none;">' +
            '<img class="dmascot-img mood-' + resolvedMood(mood) + '" alt="" src="' + imgFor(mood) + '" style="width:100%;height:100%;object-fit:contain;display:block;filter:drop-shadow(0 ' + px(10) + 'px ' + px(18) + 'px rgba(0,0,0,.35));" ' +
            'onload="var w=this.closest(\'.dmascot\');var d=w&&w.querySelector(\'.dmascot-drawn\');if(d)d.style.display=\'none\';this.style.animation=\'none\';void this.offsetWidth;this.style.animation=\'\';" ' +
            'onerror="var w=this.parentElement;if(w)w.style.display=\'none\';">' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function el(opts) {
    var d = document.createElement("div");
    d.innerHTML = html(opts).trim();
    return d.firstElementChild;
  }

  window.Mascot = { html: html, el: el };
})();
