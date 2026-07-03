/* screens/customize.js — "make it yours" profile customizer.
   Built by LIFTING the exact inline-styled markup from
   design/handoff/Customize Profile Frames.dc.html and wiring live state +
   interactivity into it, so it pixel-matches the approved design.

   Live: tapping an emoji updates the 132px hero preview AND moves the blue ring
   instantly; tapping a color swatch updates the hero background AND moves the
   white ring instantly (real selection state bound to the preview).

   Save keeps the existing logic: Auth.updateProfile({handle,displayName,emoji,
   color}) + a localStorage('divvy.profile') fallback (the API doesn't persist
   emoji/color yet, so the preview survives a reload). */
(function () {
  "use strict";
  var app = window.app;

  var PROFILE_KEY = "divvy.profile";

  // exact 8 swatches from the frame: 5 solids + 3 gradients
  var COLORS = [
    { id: "blue", bg: "#2775CA" },
    { id: "mint", bg: "#3DE8C7" },
    { id: "coral", bg: "#FF6B5E" },
    { id: "sunshine", bg: "#FFC65C" },
    { id: "violet", bg: "#8B5CF6" },
    { id: "blue-mint", bg: "linear-gradient(150deg,#2775CA,#3DE8C7)" },
    { id: "coral-sun", bg: "linear-gradient(150deg,#FF6B5E,#FFC65C)" },
    { id: "violet-blue", bg: "linear-gradient(150deg,#8B5CF6,#2775CA)" },
  ];
  // exact emoji set from the frame — keyword tags power the search pill
  var EMOJIS = [
    { c: "🦊", t: "fox face animal" },
    { c: "🐸", t: "frog face animal" },
    { c: "🐱", t: "cat face animal" },
    { c: "🐼", t: "panda face animal" },
    { c: "🐯", t: "tiger face animal" },
    { c: "🐨", t: "koala face animal" },
    { c: "🦜", t: "parrot bird animal" },
    { c: "🐢", t: "turtle animal" },
    { c: "🌸", t: "flower blossom" },
    { c: "🍜", t: "ramen noodles food" },
    { c: "🍕", t: "pizza food" },
    { c: "🍔", t: "burger food" },
    { c: "🌮", t: "taco food" },
    { c: "🎧", t: "headphones music object" },
    { c: "🛹", t: "skateboard object" },
    { c: "🪩", t: "disco ball party object" },
    { c: "😎", t: "cool sunglasses face" },
    { c: "🔥", t: "fire lit object" },
  ];

  function colorBg(id) {
    for (var i = 0; i < COLORS.length; i++) if (COLORS[i].id === id) return COLORS[i].bg;
    return COLORS[5].bg;
  }
  function matchColorId(bg) {
    for (var i = 0; i < COLORS.length; i++) if (COLORS[i].bg === bg) return COLORS[i].id;
    return "blue-mint";
  }

  // ── persisted emoji/color fallback ──────────────────────────────────────────
  function readProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}") || {}; }
    catch (_) { return {}; }
  }
  function writeProfile(p) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (_) {}
  }

  // Inject the keyframes lifted from the frame once (scoped to .cp-* classes).
  function ensureCss() {
    if (document.getElementById("cp-css")) return;
    var s = document.createElement("style");
    s.id = "cp-css";
    s.textContent = [
      ".cp-scroll::-webkit-scrollbar{width:0;height:0}",
      "@keyframes cpSquish{0%,100%{border-radius:47% 53% 52% 48% / 55% 48% 52% 45%}50%{border-radius:53% 47% 48% 52% / 46% 54% 47% 53%}}",
      "@keyframes cpBlink{0%,91%,100%{transform:scaleY(1)}96%{transform:scaleY(0.12)}}",
      "@keyframes cpPulse{0%,100%{opacity:.5}50%{opacity:1}}",
      "@keyframes cpFloat{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-5px) rotate(3deg)}}",
      "@keyframes cpWaveL{0%,100%{transform:rotate(14deg)}50%{transform:rotate(2deg)}}",
      "@keyframes cpHero{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}",
      "@keyframes cpCaret{0%,49%{opacity:1}50%,100%{opacity:0}}",
      "@media (prefers-reduced-motion: reduce){.cp-anim *{animation:none!important}}",
    ].join("");
    document.head.appendChild(s);
  }

  // exact thumbs-up mascot blob lifted from the frame
  function thumbMascot() {
    return '<div class="cp-anim" style="position:relative; width:54px; height:54px; animation:cpFloat 5s ease-in-out infinite; margin-left:6px;">' +
      '<div style="position:absolute; inset:-7px; border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,0.4) 0%, rgba(39,117,202,0) 70%); animation:cpPulse 3s ease-in-out infinite; z-index:-2;"></div>' +
      '<div style="position:relative; width:46px; height:46px; background:linear-gradient(155deg,#4aa0f0,#2775CA 60%,#1c5697); animation:cpSquish 4.5s ease-in-out infinite; box-shadow:0 8px 18px rgba(39,117,202,0.5), inset 0 1px 4px rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center;">' +
        '<div style="position:absolute; left:16px; bottom:-5px; width:7px; height:12px; border-radius:999px; background:linear-gradient(160deg,#3a8fe0,#1f5da3); z-index:-1;"></div>' +
        '<div style="position:absolute; right:16px; bottom:-5px; width:7px; height:12px; border-radius:999px; background:linear-gradient(160deg,#3a8fe0,#1f5da3); z-index:-1;"></div>' +
        '<div style="position:absolute; left:-5px; top:18px; width:8px; height:14px; border-radius:999px; background:linear-gradient(160deg,#3f93e4,#2061a8); transform-origin:5px 2px; animation:cpWaveL 3.4s ease-in-out infinite; z-index:-1;"></div>' +
        '<div style="position:absolute; right:-7px; top:6px; width:8px; height:15px; border-radius:999px; background:linear-gradient(160deg,#4a9ff0,#2a6fc0); transform:rotate(-26deg); z-index:-1;"></div>' +
        '<div style="position:absolute; right:-9px; top:1px; font-size:11px; z-index:1;">👍</div>' +
        '<div style="display:flex; gap:6.5px; margin-top:-3px;">' +
          '<div style="width:5px; height:6.5px; border-radius:50%; background:#F7F1E3; animation:cpBlink 5s infinite;"></div>' +
          '<div style="width:5px; height:6.5px; border-radius:50%; background:#F7F1E3; animation:cpBlink 5s infinite;"></div>' +
        '</div>' +
        '<div style="position:absolute; bottom:13px; width:11px; height:5.5px; border:2.2px solid #2B2118; border-top:none; border-radius:0 0 7px 7px;"></div>' +
      '</div>' +
    '</div>';
  }

  // top bar lifted from the frame (back ‹ + centered "make it yours" + blue save)
  function topbar() {
    return '<div style="position:relative; z-index:6; display:flex; align-items:center; justify-content:space-between; height:50px; padding:0 16px; flex:none;">' +
      '<div id="cpBack" style="width:38px; height:38px; border-radius:50%; background:#FFFDF7; border:1px solid rgba(43,33,24,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2B2118" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></div>' +
      '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; letter-spacing:-0.2px; color:#2B2118;">make it yours</span>' +
      '<span id="cpSaveTop" style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:15px; color:#2775CA; cursor:pointer; padding:8px 6px;">save</span>' +
    '</div>';
  }

  // texture + glow layers lifted from the frame
  function backdrop() {
    return '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 84% 2%, rgba(43,33,24,0.025) 0 1px, transparent 1px 8px); opacity:.55; pointer-events:none;"></div>' +
      '<div style="position:absolute; left:50%; top:90px; width:380px; height:260px; transform:translateX(-50%); border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,0.18) 0%, rgba(39,117,202,0) 70%); pointer-events:none;"></div>';
  }

  function signedOut(view) {
    ensureCss();
    view.innerHTML =
      '<div style="position:relative; height:100%; display:flex; flex-direction:column;">' +
        backdrop() + topbar() +
        '<div class="empty" style="position:relative; z-index:2; padding-top:48px;">' +
          app.mascot({ size: 120, mood: "sparkle", glow: true }) +
          '<div class="title lower">make it yours</div>' +
          '<div class="hint">sign in to pick your emoji + color ✨</div>' +
          '<button class="btn" id="cpConnect" style="max-width:260px;margin-top:8px;">create a wallet</button>' +
        '</div>' +
      '</div>';
    var b = document.getElementById("cpBack");
    if (b) b.onclick = function () { app.go("you"); };
    var c = document.getElementById("cpConnect");
    if (c) c.onclick = function () {
      if (window.Auth) Auth.createWallet().catch(function (e) { app.toast(e.message); });
    };
  }

  function signedIn(view, user) {
    ensureCss();
    var saved = readProfile();
    var state = {
      emoji: saved.emoji || user.emoji || "🦊",
      colorId: saved.colorId || (user.color ? matchColorId(user.color) : "blue-mint"),
      name: user.displayName || user.name || "",
      handle: (user.handle || "").replace(/^@/, ""),
      query: "",
    };

    view.innerHTML =
      '<div style="position:relative; height:100%; display:flex; flex-direction:column; overflow:hidden;">' +
        backdrop() + topbar() +

        // ── scroll ──
        '<div class="cp-scroll" style="position:relative; z-index:2; flex:1; overflow-y:auto; scrollbar-width:none; padding:6px 18px 22px;">' +

          // ===== HERO live preview + mascot thumbs-up =====
          '<div style="display:flex; align-items:center; justify-content:center; gap:14px; padding:10px 0 6px;">' +
            '<div class="cp-anim" style="position:relative; width:132px; height:132px; flex:none; animation:cpHero 5s ease-in-out infinite;">' +
              '<div style="position:absolute; inset:-14px; border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,0.4) 0%, rgba(39,117,202,0) 70%); animation:cpPulse 3.4s ease-in-out infinite;"></div>' +
              '<div style="position:relative; width:132px; height:132px; border-radius:36px; overflow:hidden; box-shadow:0 18px 40px rgba(43,33,24,0.13), inset 0 2px 0 rgba(255,255,255,0.18);">' +
                '<div id="cpHeroBg" style="position:absolute; inset:0; background:' + colorBg(state.colorId) + ';"></div>' +
                '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 80% 110%, rgba(255,255,255,0.1) 0 1px, transparent 1px 7px); opacity:.5;"></div>' +
                '<div id="cpHeroEmoji" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:68px;">' + app.esc(state.emoji) + '</div>' +
              '</div>' +
            '</div>' +

            '<div style="display:flex; flex-direction:column; align-items:flex-start; gap:8px; flex:none;">' +
              '<div style="background:#FFFDF7; border:1px solid rgba(43,33,24,0.1); border-radius:14px 14px 14px 4px; padding:7px 11px;">' +
                '<span style="font-family:\'Space Mono\',monospace; font-size:11px; color:rgba(43,33,24,0.75);">looking good 😎</span>' +
              '</div>' +
              thumbMascot() +
            '</div>' +
          '</div>' +

          // ===== YOUR EMOJI =====
          '<div style="display:flex; align-items:center; justify-content:space-between; margin:22px 2px 12px;">' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.45);">YOUR EMOJI</span>' +
            '<div style="display:inline-flex; align-items:center; gap:7px; background:#FFFDF7; border:1px solid rgba(43,33,24,0.09); border-radius:999px; padding:5px 12px;">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.45)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>' +
              '<input id="cpSearch" placeholder="search" style="border:none; outline:none; background:transparent; color:#2B2118; font-family:\'Space Mono\',monospace; font-size:10.5px; width:62px; padding:0;" />' +
            '</div>' +
          '</div>' +
          '<div id="cpEmojiGrid" style="display:grid; grid-template-columns:repeat(6, 1fr); gap:9px;"></div>' +

          // ===== YOUR COLOR =====
          '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.45); margin:24px 2px 12px;">YOUR COLOR</div>' +
          '<div id="cpColors" style="display:flex; flex-wrap:wrap; gap:11px;"></div>' +

          // ===== NAME + HANDLE =====
          '<div style="margin-top:26px; display:flex; flex-direction:column; gap:13px;">' +
            '<div>' +
              '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.45); margin-bottom:8px;">NAME</div>' +
              '<div style="display:flex; align-items:center; gap:10px; background:#FFFDF7; border:1px solid rgba(43,33,24,0.1); border-radius:16px; padding:15px 16px;">' +
                '<input id="cpName" placeholder="your name" value="' + app.esc(state.name) + '" style="flex:1; border:none; outline:none; background:transparent; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:16px; color:#2B2118; padding:0;" />' +
                '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.4)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>' +
              '</div>' +
            '</div>' +
            '<div>' +
              '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.45); margin-bottom:8px;">HANDLE</div>' +
              '<div style="display:flex; align-items:center; gap:6px; background:#FFFDF7; border:1px solid rgba(39,117,202,0.3); border-radius:16px; padding:15px 16px;">' +
                '<span style="font-family:\'Space Mono\',monospace; font-size:15px; color:rgba(39,117,202,0.7);">@</span>' +
                '<div style="flex:1; display:flex; align-items:center; min-width:0;">' +
                  '<input id="cpHandle" placeholder="handle" value="' + app.esc(state.handle) + '" style="flex:1; min-width:0; border:none; outline:none; background:transparent; font-family:\'Space Mono\',monospace; font-size:15px; color:#2B2118; padding:0;" />' +
                  '<span id="cpCaret" style="display:inline-block; width:2px; height:17px; background:#2775CA; margin-left:2px; animation:cpCaret 1s steps(1) infinite; flex:none;"></span>' +
                '</div>' +
                '<span style="display:inline-flex; align-items:center; gap:5px; background:rgba(61,232,199,0.1); border:1px solid rgba(61,232,199,0.35); border-radius:999px; padding:3px 9px; flex:none;"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#3DE8C7" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; color:#3DE8C7;">free</span></span>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div style="height:8px;"></div>' +
        '</div>' +

        // ── sticky save ──
        '<div style="position:relative; z-index:6; flex:none; padding:12px 18px calc(16px + env(safe-area-inset-bottom)); background:linear-gradient(180deg, rgba(11,22,34,0) 0%, #2B2118 24%);">' +
          '<button id="cpSave" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:56px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:0 12px 30px rgba(39,117,202,0.5), inset 0 1px 0 rgba(255,255,255,0.25);">' +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#fff;">save</span>' +
            '<span style="font-size:15px;">✨</span>' +
          '</button>' +
        '</div>' +
      '</div>';

    // ── live preview binding ──
    function refreshHero() {
      var bg = document.getElementById("cpHeroBg");
      var em = document.getElementById("cpHeroEmoji");
      if (bg) bg.style.background = colorBg(state.colorId);
      if (em) em.innerHTML = app.esc(state.emoji);
    }

    function renderEmoji() {
      var grid = document.getElementById("cpEmojiGrid");
      if (!grid) return;
      var q = state.query.trim().toLowerCase();
      var list = EMOJIS.filter(function (e) {
        return !q || e.t.indexOf(q) >= 0 || e.c === q;
      });
      if (!list.length) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:12px 0; font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(43,33,24,0.5);">no emoji like that 🤔</div>';
        return;
      }
      grid.innerHTML = list.map(function (e) {
        var sel = e.c === state.emoji;
        return '<div data-emoji="' + app.esc(e.c) + '" style="position:relative; aspect-ratio:1; border-radius:14px; background:#FFFDF7; border:1px solid rgba(43,33,24,0.06); display:flex; align-items:center; justify-content:center; font-size:23px; cursor:pointer;">' +
          app.esc(e.c) +
          (sel ? '<div style="position:absolute; inset:-2px; border-radius:16px; border:2px solid #2775CA; box-shadow:0 0 14px rgba(39,117,202,0.6); pointer-events:none;"></div>' : '') +
          '</div>';
      }).join("");
      Array.prototype.forEach.call(grid.querySelectorAll("[data-emoji]"), function (el) {
        el.onclick = function () { state.emoji = el.getAttribute("data-emoji"); refreshHero(); renderEmoji(); };
      });
    }

    function renderColors() {
      var wrap = document.getElementById("cpColors");
      if (!wrap) return;
      wrap.innerHTML = COLORS.map(function (c) {
        var sel = c.id === state.colorId;
        return '<div data-color="' + c.id + '" style="position:relative; width:50px; height:50px; border-radius:16px; background:' + c.bg + '; cursor:pointer; box-shadow:inset 0 1px 0 rgba(255,255,255,0.2), 0 6px 14px rgba(0,0,0,0.25);">' +
          (sel ? '<div style="position:absolute; inset:-3px; border-radius:19px; border:2.5px solid #fff; box-shadow:0 0 14px rgba(255,255,255,0.4); pointer-events:none;"></div>' : '') +
          '</div>';
      }).join("");
      Array.prototype.forEach.call(wrap.querySelectorAll("[data-color]"), function (el) {
        el.onclick = function () { state.colorId = el.getAttribute("data-color"); refreshHero(); renderColors(); };
      });
    }

    renderEmoji();
    renderColors();

    var search = document.getElementById("cpSearch");
    if (search) search.oninput = function () { state.query = search.value || ""; renderEmoji(); };

    var nameEl = document.getElementById("cpName");
    var handleEl = document.getElementById("cpHandle");
    if (handleEl) handleEl.oninput = function () {
      // keep handles tidy: lowercase, no spaces/@
      var v = (handleEl.value || "").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
      if (v !== handleEl.value) handleEl.value = v;
    };

    function save() {
      var handle = handleEl ? (handleEl.value || "").trim() : state.handle;
      var name = nameEl ? (nameEl.value || "").trim() : state.name;
      var color = colorBg(state.colorId);

      // persist emoji + color locally (API doesn't take them yet)
      writeProfile({ emoji: state.emoji, colorId: state.colorId, color: color });

      var btn = document.getElementById("cpSave");
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#fff;">saving…</span>';
      }

      var patch = { emoji: state.emoji, color: color };
      if (handle) patch.handle = handle;
      if (name) patch.displayName = name;

      var done = function () {
        if (window.Auth && Auth.user) { Auth.user.emoji = state.emoji; Auth.user.color = color; }
        app.go("you");
        app.toast("looking good 😎");
      };

      if (window.Auth && Auth.updateProfile && Auth.user) {
        Auth.updateProfile(patch).then(done).catch(function (e) {
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#fff;">save</span><span style="font-size:15px;">✨</span>';
          }
          app.toast(e && e.message ? e.message : "couldn't save handle");
        });
      } else {
        done();
      }
    }

    var saveBtn = document.getElementById("cpSave");
    if (saveBtn) saveBtn.onclick = save;
    var saveTop = document.getElementById("cpSaveTop");
    if (saveTop) saveTop.onclick = save;
    var back = document.getElementById("cpBack");
    if (back) back.onclick = function () { app.go("you"); };
  }

  window.Screens = window.Screens || {};
  window.Screens.customize = {
    title: "customize",
    render: function (view) {
      var user = window.Auth && window.Auth.user;
      if (user) { signedIn(view, user); return; }
      signedOut(view);
      if (window.Auth && window.Auth.onChange) window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("customize") >= 0) {
          if (u) signedIn(view, u); else signedOut(view);
        }
      });
    },
  };
})();
