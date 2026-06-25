/* screens/customize.js — "make it yours" profile customizer.
   Live emoji-on-color avatar preview + emoji/color pickers + name/@handle.
   Matches design/frames/Customize Profile Frames.dc.html. See design/BUILD.md.
   updateProfile only persists handle/displayName, so emoji+color are stored in
   localStorage("divvy.profile") as a fallback so the preview persists. */
(function () {
  "use strict";
  var app = window.app;

  var PROFILE_KEY = "divvy.profile";

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
  // faces · animals · food · objects — keyword tags power the search box
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
    return COLORS[0].bg;
  }

  // ── persisted emoji/color fallback ──────────────────────────────────────────
  function readProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}") || {}; }
    catch (_) { return {}; }
  }
  function writeProfile(p) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (_) {}
  }

  function topbar(state) {
    return '<div class="topbar">' +
      '<div id="cpBack" style="width:38px;height:38px;border-radius:50%;background:var(--card);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;cursor:pointer;">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></div>' +
      '<span class="display lower" style="font-size:17px;">make it yours</span>' +
      '<span id="cpSaveTop" class="display" style="font-size:15px;color:var(--blue-bright);cursor:pointer;padding:8px 6px;">save</span>' +
      '</div>';
  }

  function signedOut(view) {
    view.innerHTML = topbar() +
      '<div class="empty" style="padding-top:48px;">' +
        app.mascot({ size: 120, mood: "happy", glow: true }) +
        '<div class="title lower">make it yours</div>' +
        '<div class="hint">sign in to pick your emoji + color ✨</div>' +
        '<button class="btn" id="cpConnect" style="max-width:260px;margin-top:8px;">create a wallet</button>' +
      '</div>';
    var b = document.getElementById("cpBack");
    if (b) b.onclick = function () { app.go("you"); };
    var c = document.getElementById("cpConnect");
    if (c) c.onclick = function () {
      if (window.Auth) Auth.createWallet().catch(function (e) { app.toast(e.message); });
    };
  }

  function signedIn(view, user) {
    var saved = readProfile();
    var state = {
      emoji: saved.emoji || user.emoji || "🦊",
      colorId: saved.colorId || (user.color ? matchColorId(user.color) : "blue-mint"),
      name: user.displayName || user.name || "",
      handle: (user.handle || "").replace(/^@/, ""),
      query: "",
    };

    function matchColorId(bg) {
      for (var i = 0; i < COLORS.length; i++) if (COLORS[i].bg === bg) return COLORS[i].id;
      return "blue-mint";
    }

    view.innerHTML =
      topbar(state) +
      '<div class="appscroll" style="padding-top:6px;">' +

        // ── live hero preview + mascot ──
        '<div style="display:flex;align-items:center;justify-content:center;gap:14px;padding:10px 0 6px;">' +
          '<div class="glow-blue" style="position:relative;width:132px;height:132px;flex:none;border-radius:36px;">' +
            '<div id="cpHero" class="paper" style="width:132px;height:132px;border-radius:36px;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:68px;box-shadow:0 18px 40px rgba(0,0,0,0.4),inset 0 2px 0 rgba(255,255,255,0.18);background:' + colorBg(state.colorId) + ';">' +
              app.esc(state.emoji) +
            '</div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-start;gap:8px;flex:none;">' +
            '<div style="background:var(--card);border:1px solid var(--line);border-radius:14px 14px 14px 4px;padding:7px 11px;">' +
              '<span class="mono" style="font-size:11px;color:var(--muted);">looking good 😎</span>' +
            '</div>' +
            '<div style="transform:scale(.62);transform-origin:left top;margin-left:2px;">' +
              app.mascot({ size: 64, mood: "sparkle", glow: true }) +
            '</div>' +
          '</div>' +
        '</div>' +

        // ── your emoji ──
        '<div style="display:flex;align-items:center;justify-content:space-between;margin:22px 2px 12px;">' +
          '<span class="eyebrow">your emoji</span>' +
          '<div style="display:inline-flex;align-items:center;gap:7px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:5px 12px;">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>' +
            '<input id="cpSearch" class="mono" placeholder="search" style="border:none;outline:none;background:transparent;color:var(--text);font-size:11px;width:64px;padding:0;" />' +
          '</div>' +
        '</div>' +
        '<div id="cpEmojiGrid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:9px;"></div>' +

        // ── your color ──
        '<div class="eyebrow" style="margin:24px 2px 12px;">your color</div>' +
        '<div id="cpColors" style="display:flex;flex-wrap:wrap;gap:11px;"></div>' +

        // ── name + handle ──
        '<div style="margin-top:26px;display:flex;flex-direction:column;gap:13px;">' +
          '<div><label>name</label>' +
            '<input id="cpName" class="input" placeholder="your name" value="' + app.esc(state.name) + '" /></div>' +
          '<div><label>@handle</label>' +
            '<div style="display:flex;align-items:center;gap:6px;background:var(--card-2);border:1px solid var(--line);border-radius:var(--r-sm);padding:0 14px;min-height:52px;">' +
              '<span class="mono" style="font-size:15px;color:rgba(127,192,255,0.7);">@</span>' +
              '<input id="cpHandle" class="mono" placeholder="handle" value="' + app.esc(state.handle) + '" style="flex:1;border:none;outline:none;background:transparent;color:var(--text);font-size:15px;padding:14px 0;" /></div>' +
          '</div>' +
        '</div>' +

        '<div style="height:8px;"></div>' +
      '</div>' +

      // ── sticky save ──
      '<div style="position:sticky;bottom:0;padding:12px 0 calc(16px + env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(11,22,34,0) 0%,var(--ink) 24%);">' +
        '<button id="cpSave" class="btn glow-blue">save ✨</button>' +
      '</div>';

    // ── live updates ──
    function refreshHero() {
      var hero = document.getElementById("cpHero");
      if (hero) {
        hero.style.background = colorBg(state.colorId);
        hero.innerHTML = app.esc(state.emoji);
      }
    }

    function renderEmoji() {
      var grid = document.getElementById("cpEmojiGrid");
      if (!grid) return;
      var q = state.query.trim().toLowerCase();
      var list = EMOJIS.filter(function (e) {
        return !q || e.t.indexOf(q) >= 0 || e.c === q;
      });
      if (!list.length) {
        grid.innerHTML = '<div class="hint" style="grid-column:1/-1;text-align:center;padding:12px 0;">no emoji like that 🤔</div>';
        return;
      }
      grid.innerHTML = list.map(function (e) {
        var sel = e.c === state.emoji;
        return '<div data-emoji="' + app.esc(e.c) + '" style="position:relative;aspect-ratio:1;border-radius:14px;background:var(--card);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:23px;cursor:pointer;">' +
          app.esc(e.c) +
          (sel ? '<div style="position:absolute;inset:-2px;border-radius:16px;border:2px solid var(--blue);box-shadow:0 0 14px rgba(39,117,202,0.6);pointer-events:none;"></div>' : '') +
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
        return '<div data-color="' + c.id + '" style="position:relative;width:50px;height:50px;border-radius:16px;background:' + c.bg + ';cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,0.2),0 6px 14px rgba(0,0,0,0.25);">' +
          (sel ? '<div style="position:absolute;inset:-3px;border-radius:19px;border:2.5px solid #fff;box-shadow:0 0 14px rgba(255,255,255,0.4);pointer-events:none;"></div>' : '') +
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
      if (btn) { btn.disabled = true; btn.textContent = "saving…"; }

      var patch = { emoji: state.emoji, color: color };
      if (handle) patch.handle = handle;
      if (name) patch.displayName = name;

      var done = function () {
        // best-effort: stamp emoji/color on the in-memory user too
        if (window.Auth && Auth.user) { Auth.user.emoji = state.emoji; Auth.user.color = color; }
        app.go("you");
        app.toast("looking good 😎");
      };

      if (window.Auth && Auth.updateProfile && Auth.user) {
        Auth.updateProfile(patch).then(done).catch(function (e) {
          if (btn) { btn.disabled = false; btn.textContent = "save ✨"; }
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
