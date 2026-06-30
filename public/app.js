/* app.js — Divvy SPA runtime: router, API helper, and shared UI helpers.
   Screens register as window.Screens[name] = { title, render(view, params) }.
   The shell (index.html) provides #view (scroll area) and #tabbar. */
(function () {
  "use strict";

  // ---- share-token store (token attached to a trip's share link) ----
  // sessionStorage map of tripId -> shareToken, so an unclaimed visitor who
  // arrives via /t/<token> can keep viewing + claiming after we redirect them
  // to #/group/<id> (the token survives the redirect/refresh).
  var TOKENS_KEY = "divvy.tripTokens";
  function loadTokens() {
    try { return JSON.parse(sessionStorage.getItem(TOKENS_KEY) || "{}") || {}; }
    catch (_) { return {}; }
  }
  function saveTokens(map) {
    try { sessionStorage.setItem(TOKENS_KEY, JSON.stringify(map || {})); } catch (_) {}
  }
  function setTripToken(tripId, token) {
    if (!tripId || !token) return;
    var map = loadTokens();
    map[String(tripId)] = String(token);
    saveTokens(map);
  }
  function tripToken(tripId) {
    if (!tripId) return null;
    return loadTokens()[String(tripId)] || null;
  }
  // For a /api/trips/<id>... path, return the stored share token for <id> (or null).
  function tokenForPath(path) {
    var m = /^\/api\/trips\/([^/?#]+)/.exec(String(path || ""));
    if (!m) return null;
    return tripToken(decodeURIComponent(m[1]));
  }

  // ---- API helper (reuses window.Auth.authFetch when signed in) ----
  function fetchFn() {
    return (window.Auth && window.Auth.authFetch) ? window.Auth.authFetch : fetch;
  }
  async function req(method, path, body) {
    var headers = { "content-type": "application/json" };
    // For trip paths we know a share token for, attach X-Trip-Token so an
    // unclaimed visitor can view + claim. Merged below so it rides alongside
    // any auth header (bearer) that authFetch adds — never replacing it.
    var token = tokenForPath(path);
    if (token) headers["X-Trip-Token"] = token;
    var opts = { method: method, headers: headers };
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
    var nm = (person.name == null ? "" : String(person.name)).trim();
    var emoji = person.emoji || (nm ? nm[0].toUpperCase() : "🙂");
    var bg = person.color || colorFor(person.id || nm || "?");
    var cls = "avatar" + (size === "sm" ? " sm" : "");
    return '<span class="' + cls + '" style="background:' + bg + '">' + esc(emoji) + "</span>";
  }
  function mascot(opts) { return window.Mascot ? window.Mascot.html(opts) : ""; }

  // copy(text) -> Promise. Uses the async Clipboard API when available (secure
  // contexts), and falls back to a hidden textarea + execCommand('copy') so it
  // still works on http/devnet where navigator.clipboard is undefined.
  function copy(text) {
    text = String(text == null ? "" : text);
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        var ok = document.execCommand("copy");
        ta.remove();
        ok ? resolve() : reject(new Error("copy failed"));
      } catch (err) { reject(err); }
    });
  }

  // ---- toast ----
  // Toasts render inside a persistent aria-live="polite" region so screen
  // readers announce them as they appear.
  function toastRegion() {
    var r = document.getElementById("toast-region");
    if (!r) {
      r = document.createElement("div");
      r.id = "toast-region";
      r.setAttribute("aria-live", "polite");
      r.setAttribute("aria-atomic", "true");
      r.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:200;pointer-events:none;";
      document.body.appendChild(r);
    }
    return r;
  }
  // Tactile feedback. navigator.vibrate is a no-op on desktop / unsupported
  // browsers, so this is always safe to call. Pass a ms number or a pattern
  // array (e.g. [30,40,30] for a celebratory double-pulse).
  function haptic(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern || 12); } catch (_) {}
  }
  function toast(msg) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = "position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:200;" +
      "background:var(--card);border:1px solid var(--line);color:var(--text);font-family:var(--mono);" +
      "font-size:13px;padding:11px 16px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.5);opacity:0;transition:opacity .2s;";
    toastRegion().appendChild(t);
    requestAnimationFrame(function () { t.style.opacity = "1"; });
    setTimeout(function () { t.style.opacity = "0"; setTimeout(function () { t.remove(); }, 250); }, 2200);
  }

  // ---- bottom sheet ----
  function sheet(innerHtml) {
    closeSheet();
    var scrim = document.createElement("div"); scrim.className = "sheet-scrim";
    var el = document.createElement("div"); el.className = "sheet";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("tabindex", "-1");
    el.innerHTML = '<div class="grab"></div>' + innerHtml;
    scrim.onclick = function (e) { if (e.target === scrim) closeSheet(); };
    var FOCUSABLE = 'input,select,textarea,button,a[href],[tabindex]:not([tabindex="-1"])';
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); closeSheet(); return; }
      if (e.key !== "Tab") return;
      // Trap Tab focus inside the open sheet so it can't escape to the page behind.
      var f = el.querySelectorAll(FOCUSABLE);
      if (!f.length) { e.preventDefault(); try { el.focus(); } catch (_) {} return; }
      var first = f[0], last = f[f.length - 1], active = document.activeElement;
      if (e.shiftKey && (active === first || !el.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !el.contains(active))) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    document.body.appendChild(scrim); document.body.appendChild(el);
    app._sheet = [scrim, el];
    app._sheetKey = onKey;
    // Swipe-to-dismiss: drag the sheet down past ~90px (or a quick flick) to
    // close; otherwise it springs back. Honors prefers-reduced-motion (no
    // transform follow — tap-out close stays the only path).
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      var startY = 0, lastY = 0, startT = 0, dragging = false;
      // Don't hijack drags that start on a scrolled-down inner scroller.
      function fromScroller(target) {
        for (var n = target; n && n !== el; n = n.parentNode) {
          if (n.scrollTop > 0) return true;
        }
        return false;
      }
      el.addEventListener("touchstart", function (e) {
        if (e.touches.length !== 1 || fromScroller(e.target)) { dragging = false; return; }
        dragging = true;
        startY = lastY = e.touches[0].clientY;
        startT = Date.now();
        el.style.transition = "none";
      }, { passive: true });
      el.addEventListener("touchmove", function (e) {
        if (!dragging) return;
        lastY = e.touches[0].clientY;
        var dy = Math.max(0, lastY - startY); // downward only
        el.style.transform = "translateY(" + dy + "px)";
      }, { passive: true });
      el.addEventListener("touchend", function () {
        if (!dragging) return;
        dragging = false;
        var dy = Math.max(0, lastY - startY);
        var dt = Date.now() - startT;
        var flick = dt > 0 && (dy / dt) > 0.5 && dy > 24; // quick downward flick
        if (dy > 90 || flick) {
          haptic(8);
          el.style.transition = "transform .2s ease-in";
          el.style.transform = "translateY(110%)";
          setTimeout(closeSheet, 180);
        } else {
          el.style.transition = "transform .22s cubic-bezier(.2,.9,.3,1)";
          el.style.transform = "translateY(0)";
        }
      }, { passive: true });
    }
    // Move focus into the sheet (first focusable element, else the sheet itself).
    var focusTarget = el.querySelector(FOCUSABLE) || el;
    try { focusTarget.focus(); } catch (_) {}
    return el;
  }
  function closeSheet() {
    if (app._sheetKey) { document.removeEventListener("keydown", app._sheetKey); app._sheetKey = null; }
    if (app._sheet) { app._sheet.forEach(function (n) { n.remove(); }); app._sheet = null; }
  }

  // ---- pull-to-refresh ----
  // pullToRefresh(scrollEl, onRefresh): when the user drags down at the very top
  // of scrollEl past ~70px, show a small on-brand spinner, await onRefresh()
  // (which returns a Promise), then hide it. Touch-based, dependency-free,
  // debounced so it can't double-fire. No-op-safe if scrollEl is null.
  function pullToRefresh(scrollEl, onRefresh) {
    if (!scrollEl || typeof onRefresh !== "function") return;
    if (scrollEl._ptrBound) return; // bind once per element
    scrollEl._ptrBound = true;

    var THRESHOLD = 70, MAX = 96;
    var startY = 0, pull = 0, tracking = false, refreshing = false;

    // The indicator floats above the scroll content; the host should be
    // position:relative (screens are) so it pins to the top.
    var ind = document.createElement("div");
    ind.setAttribute("aria-hidden", "true");
    ind.style.cssText = "position:absolute; left:50%; top:0; z-index:30; transform:translate(-50%,-44px); " +
      "width:30px; height:30px; border-radius:50%; pointer-events:none; opacity:0; " +
      "transition:opacity .15s; display:flex; align-items:center; justify-content:center;";
    ind.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none">' +
      '<circle cx="12" cy="12" r="9" stroke="rgba(244,247,250,0.12)" stroke-width="3"/>' +
      '<path d="M12 3a9 9 0 0 1 9 9" stroke="#3DE8C7" stroke-width="3" stroke-linecap="round"/></svg>';
    if (!document.getElementById("divvy-ptr-css")) {
      var s = document.createElement("style");
      s.id = "divvy-ptr-css";
      s.textContent = "@keyframes divvyPtrSpin{to{transform:rotate(360deg)}}" +
        "@media (prefers-reduced-motion: reduce){.divvy-ptr-spin svg{animation:none!important}}";
      document.head.appendChild(s);
    }
    // Pin the indicator to the top of the scroller's viewport. Append it into
    // a positioned host so absolute top:0 lines up; promote the host if needed.
    var host = scrollEl.parentNode || scrollEl;
    try {
      var pos = window.getComputedStyle(host).position;
      if (pos === "static") host.style.position = "relative";
    } catch (_) {}
    host.appendChild(ind);

    function place() {
      var y = Math.min(pull, MAX);
      ind.style.transform = "translate(-50%," + (y - 44) + "px)";
      ind.style.opacity = pull > 6 ? "1" : "0";
      var svg = ind.firstChild;
      if (svg) svg.style.transform = "rotate(" + (pull * 3) + "deg)";
    }
    function reset() {
      tracking = false; pull = 0;
      ind.classList.remove("divvy-ptr-spin");
      var svg = ind.firstChild; if (svg) svg.style.animation = "";
      ind.style.transition = "opacity .15s, transform .2s";
      ind.style.transform = "translate(-50%,-44px)";
      ind.style.opacity = "0";
    }
    function trigger() {
      refreshing = true;
      ind.style.transition = "opacity .15s, transform .2s";
      ind.style.transform = "translate(-50%,8px)";
      ind.style.opacity = "1";
      ind.classList.add("divvy-ptr-spin");
      var svg = ind.firstChild;
      if (svg) svg.style.animation = "divvyPtrSpin .8s linear infinite";
      var done = function () { refreshing = false; reset(); };
      try {
        Promise.resolve(onRefresh()).then(done, done);
      } catch (_) { done(); }
    }

    scrollEl.addEventListener("touchstart", function (e) {
      if (refreshing || e.touches.length !== 1) { tracking = false; return; }
      if (scrollEl.scrollTop > 0) { tracking = false; return; }
      tracking = true; startY = e.touches[0].clientY; pull = 0;
      ind.style.transition = "none";
    }, { passive: true });
    scrollEl.addEventListener("touchmove", function (e) {
      if (!tracking || refreshing) return;
      if (scrollEl.scrollTop > 0) { tracking = false; reset(); return; }
      var dy = e.touches[0].clientY - startY;
      if (dy <= 0) { pull = 0; place(); return; }
      pull = dy * 0.5; // rubber-band resistance
      place();
    }, { passive: true });
    scrollEl.addEventListener("touchend", function () {
      if (!tracking || refreshing) return;
      if (pull >= THRESHOLD) trigger();
      else reset();
      tracking = false;
    }, { passive: true });
  }

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
    // The signed-out home is a full-bleed onboarding welcome — hide the tab bar
    // (its destinations all need auth, and hiding it frees the space the CTAs
    // need so they don't sit behind it).
    var signedOutHome = active === "home" && !(window.Auth && window.Auth.user);
    if (!TOPLEVEL[active] || signedOutHome) { bar.style.display = "none"; bar.innerHTML = ""; return; }
    bar.style.display = "";
    // "friends" is a top-level destination but not one of the five tabs; map it
    // onto "groups" so the bar always has a sensible highlighted item.
    var act = active === "friends" ? "groups" : active;
    function tab(name, label) {
      var on = act === name;
      return '<a data-go="' + name + '" role="link" tabindex="0" class="' + (on ? "active" : "") + '"' +
        (on ? ' aria-current="page" style="background:rgba(39,117,202,0.18)"' : "") +
        '>' + icon(name) + label + "</a>";
    }
    bar.innerHTML =
      tab("home", "home") +
      tab("groups", "groups") +
      '<a data-go="new" role="link" tabindex="0" class="fab" aria-label="new">' + icon("plus") + "</a>" +
      tab("activity", "activity") +
      tab("you", "you");
    Array.prototype.forEach.call(bar.querySelectorAll("a"), function (a) {
      function activate() { go(a.getAttribute("data-go")); }
      a.onclick = activate;
      a.onkeydown = function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          activate();
        }
      };
    });
  }

  // ---- deposit / receive sheet ----
  // "add money" on devnet = receive USDC at your own wallet address. Shows the
  // address (copyable) + a QR a sender's wallet can scan. Reused by You + Settle.
  function qrImg(data) {
    return "https://api.qrserver.com/v1/create-qr-code/?size=190x190&margin=0&data=" + encodeURIComponent(data);
  }
  // Shared amount-entry sheet body used by both add-money and cash-out flows.
  // Renders quick chips + a custom amount input; reads/writes a cents value via
  // the elements it creates. The caller wires the primary button. Returns
  // markup; pair with wireAmountEntry(opts) after sheet() to bind behavior.
  // ----------------------------------------------------------------------------
  // CHIP amounts in cents.
  var MONEY_CHIPS = [2000, 5000, 10000];

  // Pretty-print cents -> "$50" or "$12.50" (drops trailing .00).
  function dollarsLabel(cents) {
    var n = (cents || 0) / 100;
    var s = (n % 1 === 0) ? String(Math.round(n)) : n.toFixed(2);
    return "$" + s;
  }

  // amountEntry(opts) -> { html } : a focused dollar input + quick chips.
  //  opts.idp     : id prefix (unique per sheet, e.g. "dep" / "out")
  //  opts.default : default cents to preselect
  //  opts.maxCents: optional cap (cash-out balance); shown as a subtle hint
  function amountEntryHtml(opts) {
    opts = opts || {};
    var idp = opts.idp || "amt";
    var def = opts.default || 5000;
    var chips = MONEY_CHIPS.map(function (c) {
      var on = c === def;
      return '<button type="button" data-cents="' + c + '" class="' + idp + '-chip" ' +
        'style="appearance:none; cursor:pointer; flex:1; min-height:46px; border-radius:14px; ' +
        'font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; ' +
        (on
          ? 'background:rgba(39,117,202,0.16); border:1px solid rgba(39,117,202,0.5); color:#7FC0FF;'
          : 'background:#13212E; border:1px solid rgba(244,247,250,0.1); color:#F4F7FA;') +
        '">' + dollarsLabel(c) + '</button>';
    }).join("");
    var maxHint = (typeof opts.maxCents === "number" && opts.maxCents > 0)
      ? '<div id="' + idp + '-max" style="text-align:center; font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(244,247,250,0.42); margin-top:9px;">balance ' + dollarsLabel(opts.maxCents) + ' available</div>'
      : '';
    return '' +
      '<div style="display:flex; align-items:center; justify-content:center; gap:4px; margin:6px 0 2px;">' +
        '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:34px; color:rgba(244,247,250,0.4);">$</span>' +
        '<input id="' + idp + '-input" inputmode="decimal" autocomplete="off" value="' + (def / 100) + '" ' +
          'style="width:auto; max-width:200px; min-width:60px; background:transparent; border:none; outline:none; ' +
          'font-family:\'Space Mono\',monospace; font-weight:700; font-size:46px; letter-spacing:-2px; ' +
          'color:#F4F7FA; text-align:center;">' +
      '</div>' +
      maxHint +
      '<div style="display:flex; gap:9px; margin-top:18px;">' + chips + '</div>';
  }

  // wireAmountEntry(idp) -> { getCents } : binds chip + input behavior, returns
  // a reader that yields the current integer cents (>= 0). Defensive: all
  // lookups guarded since screens re-render.
  function wireAmountEntry(idp) {
    var input = document.getElementById(idp + "-input");
    function readCents() {
      if (!input) return 0;
      var v = parseFloat(String(input.value).replace(/[^0-9.]/g, ""));
      if (!isFinite(v) || v <= 0) return 0;
      return Math.round(v * 100);
    }
    function highlight(cents) {
      var chipsEls = document.querySelectorAll("." + idp + "-chip");
      Array.prototype.forEach.call(chipsEls, function (b) {
        var on = parseInt(b.getAttribute("data-cents"), 10) === cents;
        if (on) {
          b.style.background = "rgba(39,117,202,0.16)";
          b.style.border = "1px solid rgba(39,117,202,0.5)";
          b.style.color = "#7FC0FF";
        } else {
          b.style.background = "#13212E";
          b.style.border = "1px solid rgba(244,247,250,0.1)";
          b.style.color = "#F4F7FA";
        }
      });
    }
    var chipsEls = document.querySelectorAll("." + idp + "-chip");
    Array.prototype.forEach.call(chipsEls, function (b) {
      b.onclick = function () {
        var c = parseInt(b.getAttribute("data-cents"), 10) || 0;
        if (input) input.value = String(c / 100);
        highlight(c);
        haptic(8);
      };
    });
    if (input) input.oninput = function () { highlight(readCents()); };
    return { getCents: readCents, input: input };
  }

  // Open the provider URL reliably inside a PWA / in-app webview: a synthetic
  // <a> click (with target+noopener) is more popup-safe than window.open; we
  // fall back to location.href if the click is swallowed.
  function openProvider(url) {
    if (!url) return;
    try {
      var a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (_) {}
    // location.href is the dependable path in webviews where the click is a no-op.
    try { location.href = url; } catch (_) {}
  }

  // Small honest "test mode" line, shown when the provider keys aren't live yet.
  function testModeNote() {
    return '<div style="text-align:center; margin-top:12px;">' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(244,247,250,0.4);">test mode · no real charge yet</span>' +
      '</div>';
  }

  // ---- ADD MONEY (on-ramp) ----------------------------------------------------
  // Lead with a card / Apple Pay path (plain dollars). Step 1 is a clean amount
  // entry + "add with card"; tapping fetches /api/me/onramp/<cents> and navigates
  // to the provider. A lower-emphasis "or receive USDC directly" reveals the
  // original QR + address block for crypto-native users.
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

    var DEFAULT = 5000;
    var solUrl = "solana:" + wallet;
    var short = wallet.length > 12 ? (wallet.slice(0, 6) + "…" + wallet.slice(-6)) : wallet;

    sheet(
      '<div style="padding:4px 20px 26px;">' +
        '<div style="text-align:center; margin-bottom:6px;">' +
          '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:21px; letter-spacing:-0.3px; color:#F4F7FA;">add money</div>' +
          '<div style="font-family:\'General Sans\',sans-serif; font-size:13px; color:rgba(244,247,250,0.55); margin-top:4px;">straight to your balance — dollars, just faster.</div>' +
        '</div>' +
        amountEntryHtml({ idp: "dep", default: DEFAULT }) +
        '<button id="depCard" type="button" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:54px; margin-top:20px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:0 8px 24px rgba(39,117,202,0.45), inset 0 1px 0 rgba(255,255,255,0.25);">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>' +
          '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff;">add with card</span>' +
        '</button>' +
        '<div style="text-align:center; margin-top:9px;">' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(244,247,250,0.5);">apple pay · debit · credit</span>' +
        '</div>' +
        '<div id="depTestNote"></div>' +
        '<button id="depMore" type="button" style="appearance:none; border:none; cursor:pointer; background:transparent; display:block; width:100%; text-align:center; margin-top:16px; padding:6px; font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.3px; color:rgba(127,192,255,0.75);">or receive usdc directly ▾</button>' +
        // crypto-native receive block — hidden until "more options" is tapped.
        '<div id="depRecv" style="display:none; margin-top:6px;">' +
          '<div style="text-align:center;">' +
            '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:rgba(244,247,250,0.5);">receive usdc · ' + esc(cluster) + '</div>' +
          '</div>' +
          '<div id="depQrWrap" style="width:206px; margin:14px auto 0; background:#fff; border-radius:16px; padding:8px;">' +
            '<img id="depQr" alt="your wallet qr" width="190" height="190" style="display:block; border-radius:8px;" src="' + esc(qrImg(solUrl)) + '">' +
          '</div>' +
          '<div id="depAddr" style="display:flex; align-items:center; gap:9px; justify-content:center; margin:16px auto 0; max-width:300px; background:#13212E; border:1px solid rgba(244,247,250,0.1); border-radius:13px; padding:12px 14px; cursor:pointer;">' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:13px; color:rgba(244,247,250,0.85);">' + esc(short) + '</span>' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.55)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>' +
          '</div>' +
          '<div style="text-align:center; margin-top:12px;">' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(244,247,250,0.42);">send usdc to this address — it shows up in your balance.</span>' +
          '</div>' +
        '</div>' +
      '</div>'
    );

    var entry = wireAmountEntry("dep");

    // Prefetch the live flag so the test-mode note appears without waiting for a
    // tap. Best-effort; the note simply stays absent if the call fails.
    api.get("/api/me/onramp/" + DEFAULT).then(function (r) {
      if (r && r.live === false) {
        var note = document.getElementById("depTestNote");
        if (note) note.innerHTML = testModeNote();
      }
    }).catch(function () {});

    var card = document.getElementById("depCard");
    if (card) card.onclick = function () {
      var cents = entry.getCents();
      if (!(cents > 0)) { toast("enter an amount first"); return; }
      var prev = card.innerHTML;
      card.disabled = true;
      card.innerHTML = '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff;">opening…</span>';
      api.get("/api/me/onramp/" + cents).then(function (r) {
        var url = r && (r.moonpay || r.coinbase);
        if (!url) throw new Error("couldn't start checkout");
        openProvider(url);
      }).catch(function (e) {
        card.disabled = false;
        card.innerHTML = prev;
        if (e && e.status === 400) toast("create or connect a wallet first");
        else toast((e && e.message) || "couldn't start checkout");
      });
    };

    var more = document.getElementById("depMore");
    if (more) more.onclick = function () {
      var recv = document.getElementById("depRecv");
      if (!recv) return;
      var open = recv.style.display !== "none";
      recv.style.display = open ? "none" : "block";
      more.innerHTML = open ? "or receive usdc directly ▾" : "hide receive address ▴";
    };

    var addr = document.getElementById("depAddr");
    if (addr) addr.onclick = function () {
      copy(wallet).then(function () {
        toast("address copied 📋");
      }).catch(function () { toast(wallet); });
    };
    // If the QR image fails to load, show the full address prominently instead.
    var qr = document.getElementById("depQr");
    if (qr) qr.onerror = function () {
      var wrap = document.getElementById("depQrWrap");
      if (!wrap) return;
      wrap.style.background = "#13212E";
      wrap.style.border = "1px solid rgba(244,247,250,0.1)";
      wrap.style.width = "auto";
      wrap.style.padding = "16px";
      wrap.innerHTML =
        '<div style="font-family:\'Space Mono\',monospace; font-size:11px; line-height:1.5; ' +
        'word-break:break-all; text-align:center; color:rgba(244,247,250,0.9);">' + esc(wallet) + '</div>';
    };
  }

  var app = {
    api: api, esc: esc, money: money, avatar: avatar, colorFor: colorFor, mascot: mascot,
    toast: toast, sheet: sheet, closeSheet: closeSheet, go: go, render: render,
    depositSheet: depositSheet, copy: copy, haptic: haptic, pullToRefresh: pullToRefresh,
    tripToken: tripToken, setTripToken: setTripToken,
    qrImg: qrImg, amountEntryHtml: amountEntryHtml, wireAmountEntry: wireAmountEntry,
    openProvider: openProvider, testModeNote: testModeNote, dollarsLabel: dollarsLabel,
    _sheet: null, _sheetKey: null,
  };
  window.app = app;

  // Universal tactile tick: a tiny pulse on every button press. One delegated
  // listener covers all screens (inline-styled buttons included). Screens can
  // call app.haptic([30,40,30]) for stronger, celebratory moments.
  document.addEventListener("pointerdown", function (e) {
    var t = e.target;
    if (t && t.closest && t.closest("button")) haptic(12);
  }, { passive: true });

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
  if (window.Auth && window.Auth.onChange) window.Auth.onChange(function () {
    syncIdentity();
    // Auth resolving (or signing in/out) flips whether the signed-out-home tab
    // bar should show — re-evaluate it for the current route.
    try { renderTabbar(parseHash().name); } catch (_) {}
  });

  // ---- share-link boot (/t/<shareToken>) ----
  // A second person opens a group's share link at /t/<token>. The server serves
  // the SPA shell for that path, so here we: read the token, fetch the trip with
  // it (authorized without a session), remember token->tripId, clean the URL,
  // and route to #/group/<id>. From then on req() attaches X-Trip-Token for
  // this trip so the visitor can view + claim a spot. Falls back to home on any
  // failure so a dead/expired link doesn't strand the user.
  async function handleShareLink() {
    var m = /^\/t\/([^/]+)/.exec(location.pathname || "");
    if (!m) return false;
    var token = decodeURIComponent(m[1]);
    try {
      var trip = await fetchFn()("/api/trips/" + encodeURIComponent(token), {
        headers: { "content-type": "application/json", "X-Trip-Token": token },
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) { var e = new Error("share link failed"); e.status = res.status; throw e; }
          return data;
        });
      });
      if (!trip || !trip.id) throw new Error("no trip");
      setTripToken(trip.id, token);
      // Clean the /t/ path so refreshes land on a normal SPA URL.
      try { history.replaceState(null, "", "/"); } catch (_) {}
      location.hash = "#/group/" + encodeURIComponent(trip.id);
      return true;
    } catch (_) {
      try { history.replaceState(null, "", "/"); } catch (_) {}
      location.hash = "#/home";
      return true;
    }
  }

  window.addEventListener("hashchange", render);
  window.addEventListener("DOMContentLoaded", function () {
    syncIdentity();
    handleShareLink().then(function (handled) {
      if (handled) { render(); return; }
      if (!location.hash) location.hash = "#/home";
      render();
    });
  });
})();
