/* app.js — Divvy SPA runtime: router, API helper, and shared UI helpers.
   Screens register as window.Screens[name] = { title, render(view, params) }.
   The shell (index.html) provides #view (scroll area) and #tabbar. */
(function () {
  "use strict";

  // ---- API helper (reuses window.Auth.authFetch when signed in) ----
  function fetchFn() {
    return (window.Auth && window.Auth.authFetch) ? window.Auth.authFetch : fetch;
  }
  async function req(method, path, body) {
    var opts = { method: method, headers: { "content-type": "application/json" } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    var res = await fetchFn()(path, opts);
    var data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      var e = new Error((data && data.error) || ("request failed (" + res.status + ")"));
      e.status = res.status; e.data = data; throw e;
    }
    return data;
  }
  var api = {
    get: function (p) { return req("GET", p); },
    post: function (p, b) { return req("POST", p, b); },
    del: function (p) { return req("DELETE", p); },
    put: function (p, b) { return req("PUT", p, b); },
    patch: function (p, b) { return req("PATCH", p, b); },
  };

  // ---- helpers ----
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // money(cents, kind) -> HTML: big mono digits, lighter $/decimals.
  // kind: 'pos' | 'neg' | 'settled' | '' ; pass showSign for +/-.
  function money(cents, kind, showSign) {
    var n = Math.abs(cents) / 100;
    var sign = showSign ? (cents > 0 ? "+" : cents < 0 ? "−" : "") : (cents < 0 ? "−" : "");
    var whole = Math.floor(n).toLocaleString();
    var dec = (n % 1).toFixed(2).slice(1); // ".00"
    return '<span class="money ' + (kind || "") + '">' +
      '<span class="cur">' + sign + '$</span>' + whole + '<span class="dec">' + dec + '</span></span>';
  }
  // deterministic emoji/color avatar fallback
  var PALETTE = ["#2775CA", "#3DE8C7", "#FF6B5E", "#FFC65C", "#8B5CF6", "#3a8fe0"];
  function colorFor(seed) {
    var h = 0, s = String(seed || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  function avatar(person, size) {
    person = person || {};
    var emoji = person.emoji || (person.name ? person.name.trim()[0].toUpperCase() : "🙂");
    var bg = person.color || colorFor(person.id || person.name);
    var cls = "avatar" + (size === "sm" ? " sm" : "");
    return '<span class="' + cls + '" style="background:' + bg + '">' + esc(emoji) + "</span>";
  }
  function mascot(opts) { return window.Mascot ? window.Mascot.html(opts) : ""; }

  // ---- toast ----
  function toast(msg) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = "position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:200;" +
      "background:var(--card);border:1px solid var(--line);color:var(--text);font-family:var(--mono);" +
      "font-size:13px;padding:11px 16px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.5);opacity:0;transition:opacity .2s;";
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.style.opacity = "1"; });
    setTimeout(function () { t.style.opacity = "0"; setTimeout(function () { t.remove(); }, 250); }, 2200);
  }

  // ---- bottom sheet ----
  function sheet(innerHtml) {
    closeSheet();
    var scrim = document.createElement("div"); scrim.className = "sheet-scrim";
    var el = document.createElement("div"); el.className = "sheet";
    el.innerHTML = '<div class="grab"></div>' + innerHtml;
    scrim.onclick = function (e) { if (e.target === scrim) closeSheet(); };
    document.body.appendChild(scrim); document.body.appendChild(el);
    app._sheet = [scrim, el];
    return el;
  }
  function closeSheet() { if (app._sheet) { app._sheet.forEach(function (n) { n.remove(); }); app._sheet = null; } }

  // ---- router (hash-based: #/home, #/group/:id, ...) ----
  var TABS = ["home", "groups", "activity", "you"];
  function parseHash() {
    var h = (location.hash || "#/home").replace(/^#\/?/, "");
    var parts = h.split("/");
    return { name: parts[0] || "home", params: parts.slice(1) };
  }
  async function render() {
    var r = parseHash();
    var screen = window.Screens && window.Screens[r.name];
    var view = document.getElementById("view");
    if (!view) return;
    if (!screen) { view.innerHTML = '<div class="empty"><div class="title">screen not found</div></div>'; return; }
    view.scrollTop = 0;
    try { await screen.render(view, r.params); }
    catch (e) { view.innerHTML = '<div class="empty"><div class="title lower">something broke</div><div class="hint">' + esc(e.message) + "</div></div>"; }
    renderTabbar(r.name);
  }
  // Only the five top-level destinations show the bottom tab bar; everything else
  // (group, new, settle, collect, chat, receipt, friend, recurring, customize,
  // onboarding) is a back-button sub-screen and hides it.
  var TOPLEVEL = { home: 1, groups: 1, activity: 1, you: 1, friends: 1 };
  function go(name) { location.hash = "#/" + name; }

  function icon(name) {
    var p = {
      home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',
      groups: '<circle cx="9" cy="9" r="3"/><path d="M2 20a7 7 0 0 1 14 0M16 7a3 3 0 0 1 0 6M22 20a6 6 0 0 0-5-6"/>',
      activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
      you: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
    };
    return '<svg viewBox="0 0 24 24">' + p[name] + "</svg>";
  }
  function renderTabbar(active) {
    var bar = document.getElementById("tabbar");
    if (!bar) return;
    if (!TOPLEVEL[active]) { bar.style.display = "none"; bar.innerHTML = ""; return; }
    bar.style.display = "";
    bar.innerHTML =
      '<a data-go="home" class="' + (active === "home" ? "active" : "") + '">' + icon("home") + "home</a>" +
      '<a data-go="groups" class="' + (active === "groups" ? "active" : "") + '">' + icon("groups") + "groups</a>" +
      '<a data-go="new" class="fab">' + icon("plus") + "</a>" +
      '<a data-go="activity" class="' + (active === "activity" ? "active" : "") + '">' + icon("activity") + "activity</a>" +
      '<a data-go="you" class="' + (active === "you" ? "active" : "") + '">' + icon("you") + "you</a>";
    Array.prototype.forEach.call(bar.querySelectorAll("a"), function (a) {
      a.onclick = function () { go(a.getAttribute("data-go")); };
    });
  }

  // ---- deposit / receive sheet ----
  // "add money" on devnet = receive USDC at your own wallet address. Shows the
  // address (copyable) + a QR a sender's wallet can scan. Reused by You + Settle.
  function qrImg(data) {
    return "https://api.qrserver.com/v1/create-qr-code/?size=190x190&margin=0&data=" + encodeURIComponent(data);
  }
  async function depositSheet() {
    var wallet = null, cluster = "devnet";
    try {
      var w = await api.get("/api/me/wallet");
      if (w) { wallet = w.wallet || null; if (w.cluster) cluster = w.cluster; }
    } catch (_) {}
    if (!wallet) {
      sheet('<div style="padding:8px 20px 26px; text-align:center;">' +
        '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:20px; color:#F4F7FA;">add money</div>' +
        '<div style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(244,247,250,0.6); margin-top:10px;">create or connect a wallet first, then come back to fund it.</div>' +
        '</div>');
      return;
    }
    var solUrl = "solana:" + wallet;
    var short = wallet.length > 12 ? (wallet.slice(0, 6) + "…" + wallet.slice(-6)) : wallet;
    sheet(
      '<div style="padding:6px 20px 28px;">' +
        '<div style="text-align:center;">' +
          '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:21px; letter-spacing:-0.3px; color:#F4F7FA;">add money</div>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:rgba(244,247,250,0.5); margin-top:5px;">receive usdc · ' + esc(cluster) + '</div>' +
        '</div>' +
        '<div style="width:206px; margin:18px auto 0; background:#fff; border-radius:16px; padding:8px;">' +
          '<img alt="your wallet qr" width="190" height="190" style="display:block; border-radius:8px;" src="' + esc(qrImg(solUrl)) + '">' +
        '</div>' +
        '<div id="depAddr" style="display:flex; align-items:center; gap:9px; justify-content:center; margin:18px auto 0; max-width:300px; background:#13212E; border:1px solid rgba(244,247,250,0.1); border-radius:13px; padding:12px 14px; cursor:pointer;">' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:13px; color:rgba(244,247,250,0.85);">' + esc(short) + '</span>' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.55)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>' +
        '</div>' +
        '<div style="text-align:center; margin-top:14px;">' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(244,247,250,0.42);">send usdc to this address — it shows up in your balance.</span>' +
        '</div>' +
      '</div>'
    );
    var addr = document.getElementById("depAddr");
    if (addr) addr.onclick = function () {
      try {
        navigator.clipboard.writeText(wallet);
        toast("address copied 📋");
      } catch (_) { toast(wallet); }
    };
  }

  var app = {
    api: api, esc: esc, money: money, avatar: avatar, colorFor: colorFor, mascot: mascot,
    toast: toast, sheet: sheet, closeSheet: closeSheet, go: go, render: render,
    depositSheet: depositSheet, _sheet: null,
  };
  window.app = app;

  // Bridge the server-persisted emoji/color identity into localStorage so every
  // screen (which reads "divvy.profile") reflects it, even on a fresh device.
  function syncIdentity() {
    var u = window.Auth && window.Auth.user;
    if (!u || (!u.emoji && !u.color)) return;
    try {
      var p = JSON.parse(localStorage.getItem("divvy.profile") || "{}") || {};
      if (u.emoji) p.emoji = u.emoji;
      if (u.color) p.color = u.color;
      localStorage.setItem("divvy.profile", JSON.stringify(p));
    } catch (_) {}
  }
  if (window.Auth && window.Auth.onChange) window.Auth.onChange(function () { syncIdentity(); });

  window.addEventListener("hashchange", render);
  window.addEventListener("DOMContentLoaded", function () {
    syncIdentity();
    if (!location.hash) location.hash = "#/home";
    render();
  });
})();
