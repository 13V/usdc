/* screens/tabs.js — Tabs: running one-on-one tabs with friends.
   Route #/tabs (back-button sub-screen; reached from home). Lists every tab
   (friend + net balance, GET /api/tabs) — "sam owes you $23" / "you owe alex
   $4" — plus friends you haven't started a tab with yet. Journal aesthetic
   (paper card stock, washi tape, mono money) matching home.js / friend.js.
   Money color rule: owed-to-you = blue, you-owe = coral, square = mint.
   Never crashes. */
(function () {
  "use strict";
  var app = window.app;

  function topbar() {
    return '<div style="position:relative; z-index:6; display:flex; align-items:center; gap:12px; height:50px; padding:0 16px; flex:none;">' +
      '<div id="tbBack" role="button" aria-label="back" tabindex="0" style="width:38px; height:38px; border-radius:50%; background:#FFFDF7; border:1px solid rgba(43,33,24,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2B2118" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></div>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:1.5px; color:rgba(43,33,24,0.5);">tabs</span>' +
    '</div>';
  }
  function wireBack() {
    var b = document.getElementById("tbBack");
    if (b) b.onclick = function () { if (history.length > 1) history.back(); else app.go("home"); };
  }
  // $ split into whole + lighter .dec (frame-style; caller adds the prefix)
  function money3(cents) {
    var n = Math.abs(cents) / 100, whole = Math.floor(n).toLocaleString(), dec = (n % 1).toFixed(2).slice(1);
    return whole + '<span style="opacity:.5;">' + dec + '</span>';
  }
  function relTime(iso) {
    if (!iso) return "recently";
    var t = new Date(iso).getTime();
    if (isNaN(t)) return "recently";
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return "now";
    var m = s / 60; if (m < 60) return Math.round(m) + "m";
    var h = m / 60; if (h < 24) return Math.round(h) + "h";
    var d = h / 24; if (d < 7) return Math.round(d) + "d";
    return Math.round(d / 7) + "w";
  }
  function friendName(f) { return (f && (f.displayName || f.handle)) || "friend"; }
  function firstName(f) { return String(friendName(f)).trim().split(/\s+/)[0].toLowerCase(); }

  function sectionLabel(name) {
    return '<div style="margin:26px 2px 12px;"><span class="jdoodle" style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:18px; letter-spacing:-0.2px; color:#2B2118;">' + name + '</span></div>';
  }

  // one tab row — a jcard ledger line: avatar · "sam owes you" · +$23.00
  function tabRow(t) {
    var f = t.friend || {};
    var pos = t.direction === "owed", neg = t.direction === "owes";
    var col = pos ? "#2775CA" : neg ? "#FF6B5E" : "#3DE8C7";
    var sub = pos ? firstName(f) + " owes you" : neg ? "you owe " + firstName(f) : "square ✨";
    var amt = t.direction === "settled"
      ? '<span style="font-family:\'Space Mono\',monospace; font-size:12px; color:#3DE8C7; flex:none;">square ✨</span>'
      : '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:18px; letter-spacing:-0.4px; color:' + col + '; flex:none;"><span style="opacity:.5;">' + (pos ? "+$" : "−$") + '</span>' + money3(t.balanceCents) + '</div>';
    return '<a href="#/tab/' + encodeURIComponent(f.id || "") + '" style="text-decoration:none; display:flex; align-items:center; gap:13px; background:#FFFDF7; border:2px solid #2B2118; border-radius:15px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:11px 14px 11px 11px;">' +
      '<div style="width:44px; height:44px; border-radius:14px; background:' + app.esc(f.color || "rgba(39,117,202,0.18)") + '; display:flex; align-items:center; justify-content:center; font-size:21px; flex:none;">' + app.face(f.emoji || (friendName(f)[0] || "?").toUpperCase()) + '</div>' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; letter-spacing:-0.2px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(friendName(f)) + '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:0.5px; color:' + (neg ? "rgba(255,107,94,0.8)" : "rgba(43,33,24,0.6)") + '; margin-top:3px;">' + app.esc(sub) + ' · ' + t.entryCount + (t.entryCount === 1 ? " entry" : " entries") + ' · ' + relTime(t.lastActivity) + '</div>' +
      '</div>' + amt + '</a>';
  }

  // a friend without a tab yet — quiet row with a "start" affordance
  function friendRow(f) {
    return '<a href="#/tab/' + encodeURIComponent(f.id || "") + '" style="text-decoration:none; display:flex; align-items:center; gap:13px; padding:10px 6px; cursor:pointer;">' +
      '<div style="width:38px; height:38px; border-radius:50%; background:rgba(39,117,202,0.14); display:flex; align-items:center; justify-content:center; font-size:18px; flex:none;">' + app.face(f.emoji || (friendName(f)[0] || "?").toUpperCase()) + '</div>' +
      '<div style="flex:1; min-width:0; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(friendName(f)) + (f.handle ? ' <span style="font-family:\'Space Mono\',monospace; font-size:11px; color:rgba(39,117,202,0.7);">@' + app.esc(f.handle) + '</span>' : '') + '</div>' +
      '<span style="display:inline-flex; align-items:center; gap:5px; background:#FFFDF7; border:2px solid #2B2118; border-radius:999px; box-shadow:2px 2px 0 rgba(43,33,24,0.85); padding:6px 13px; font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:13px; color:#2B2118; flex:none;">+ start</span>' +
    '</a>';
  }

  function skeleton(view) {
    var rows = "";
    for (var i = 0; i < 4; i++) rows += '<div class="skeleton" style="height:66px; margin:11px 0; border-radius:15px;"></div>';
    view.innerHTML = '<div class="vfill">' + topbar() + '<div class="appscroll" style="padding-top:4px;">' + rows + '</div></div>';
    wireBack();
  }

  function signedOut(view) {
    view.innerHTML = '<div class="vfill">' + topbar() +
      '<div class="empty" style="padding-top:60px;">' +
        app.mascot({ size: 120, mood: "wave" }) +
        '<div class="title lower">sign in to see your tabs</div>' +
        '<div class="hint">running tabs with friends live behind your account.</div>' +
        '<button class="btn" id="tbSignIn" style="max-width:280px;margin-top:8px;">sign in</button>' +
      '</div></div>';
    wireBack();
    var b = document.getElementById("tbSignIn");
    if (b) b.onclick = function () { app.signIn(); };
  }

  async function signedIn(view) {
    skeleton(view);
    var tabs = [], friends = [];
    try {
      var both = await Promise.all([
        app.api.get("/api/tabs").catch(function () { return { tabs: [] }; }),
        app.api.get("/api/friends").catch(function () { return { friends: [] }; }),
      ]);
      tabs = (both[0] && both[0].tabs) || [];
      friends = (both[1] && both[1].friends) || [];
    } catch (_) { /* both fetches are individually caught; keep going */ }

    var tabbed = {};
    tabs.forEach(function (t) { if (t.friend && t.friend.id) tabbed[t.friend.id] = 1; });
    var startable = friends.filter(function (f) { return f && f.id && !tabbed[f.id]; });

    var body = "";
    if (tabs.length) {
      body += sectionLabel("open tabs") +
        '<div style="display:flex; flex-direction:column; gap:11px;">' + tabs.map(tabRow).join("") + '</div>';
    }
    if (startable.length) {
      body += sectionLabel(tabs.length ? "start another" : "start a tab with") +
        '<div style="display:flex; flex-direction:column; gap:3px;">' + startable.map(friendRow).join("") + '</div>';
    }
    if (!tabs.length && !startable.length) {
      // mochi holds the empty page
      body = '<div class="empty" style="padding-top:50px;">' +
        app.mascot({ size: 110, mood: "happy" }) +
        '<div class="title lower">no tabs yet — start one with a friend 🐸</div>' +
        '<div class="hint">a tab is a running "+$7 coffee" ledger between you two. add a friend first.</div>' +
        '<button class="btn" id="tbAddFriend" style="max-width:260px;margin-top:8px;">add a friend</button>' +
      '</div>';
    } else if (!tabs.length) {
      body = '<div class="empty" style="padding:26px 20px 6px;">' +
        app.mascot({ size: 96, mood: "happy" }) +
        '<div class="title lower">no tabs yet — start one with a friend 🐸</div>' +
        '<div class="hint">tap a friend below and jot the first "+$7 coffee".</div>' +
      '</div>' + body;
    }

    view.innerHTML = '<div class="vfill">' + topbar() + '<div class="appscroll" style="padding-top:4px;">' + body + '</div></div>';
    wireBack();
    var add = document.getElementById("tbAddFriend");
    if (add) add.onclick = function () { app.go("friends"); };
    if (app.enter) app.enter(view.querySelector(".appscroll"));
    if (app.pullToRefresh) {
      var scrollEl = view.querySelector(".appscroll");
      if (scrollEl) app.pullToRefresh(scrollEl, function () { return signedIn(view); });
    }
  }

  window.Screens = window.Screens || {};
  window.Screens.tabs = {
    title: "tabs",
    render: function (view) {
      var user = window.Auth && window.Auth.user;
      if (user) return signedIn(view);
      signedOut(view);
      if (window.Auth && window.Auth.onChange) window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("tabs") >= 0) { if (u) signedIn(view); else signedOut(view); }
      });
    },
  };
})();
