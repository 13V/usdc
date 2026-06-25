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

  var app = {
    api: api, esc: esc, money: money, avatar: avatar, colorFor: colorFor, mascot: mascot,
    toast: toast, sheet: sheet, closeSheet: closeSheet, go: go, render: render, _sheet: null,
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
