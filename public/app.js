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
  // face(value) — render an avatar face: a meme token ("m:doge" → the drawn
  // Faces SVG) or a plain emoji/initial (escaped text). Drop-in wherever an
  // emoji glyph was printed: the svg is em-sized so it follows font-size.
  function face(value) {
    if (window.Faces && window.Faces.has(value)) return window.Faces.svg(value);
    return esc(value);
  }

  function avatar(person, size) {
    person = person || {};
    var nm = (person.name == null ? "" : String(person.name)).trim();
    var emoji = person.emoji || (nm ? nm[0].toUpperCase() : "🙂");
    var bg = person.color || colorFor(person.id || nm || "?");
    var cls = "avatar" + (size === "sm" ? " sm" : "");
    // esc(bg): defense-in-depth — the server validates color to hex, but never
    // interpolate a stored value into a style attribute unescaped.
    return '<span class="' + cls + '" style="background:' + esc(bg) + '">' + face(emoji) + "</span>";
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
    // Native Capacitor haptics when wrapped; Web Vibration otherwise.
    try {
      var cap = window.Capacitor;
      if (cap && cap.Plugins && cap.Plugins.Haptics) {
        cap.Plugins.Haptics.impact({ style: "LIGHT" });
        return;
      }
    } catch (_) {}
    try { if (navigator.vibrate) navigator.vibrate(pattern || 12); } catch (_) {}
  }

  // ---- native share (Capacitor Share → Web Share API → clipboard) ----
  function share(opts) {
    opts = opts || {};
    var url = opts.url || location.href;
    var text = opts.text || "";
    var title = opts.title || "Divvy";
    try {
      var cap = window.Capacitor;
      if (cap && cap.Plugins && cap.Plugins.Share) {
        return cap.Plugins.Share.share({ title: title, text: text, url: url }).catch(function () {});
      }
    } catch (_) {}
    if (navigator.share) {
      return navigator.share({ title: title, text: text, url: url }).catch(function () {});
    }
    // Fallback: copy the link.
    return copy(url).then(function () { toast("link copied 📋"); }).catch(function () { toast(url); });
  }

  // ---- Web Push (with a Capacitor native hook) ----
  function urlB64ToUint8Array(base64) {
    var padding = "=".repeat((4 - (base64.length % 4)) % 4);
    var b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(b64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  var push = {
    supported: function () {
      return ("serviceWorker" in navigator) && ("PushManager" in window) && ("Notification" in window);
    },
    permission: function () {
      try { return (window.Notification && Notification.permission) || "default"; } catch (_) { return "default"; }
    },
    // Turn on notifications: request permission, subscribe, register with server.
    enable: function () {
      // Native path: Capacitor PushNotifications plugin (APNs/FCM) if present.
      try {
        var cap = window.Capacitor;
        if (cap && cap.Plugins && cap.Plugins.PushNotifications) {
          var PN = cap.Plugins.PushNotifications;
          return PN.requestPermissions().then(function (p) {
            if (p && p.receive === "granted") {
              PN.addListener("registration", function (t) {
                api.post("/api/push/native-token", { token: t.value, platform: (cap.getPlatform && cap.getPlatform()) || "native" }).catch(function () {});
              });
              return PN.register().then(function () { return true; });
            }
            return false;
          });
        }
      } catch (_) {}
      // Web path.
      if (!push.supported()) return Promise.resolve(false);
      return Notification.requestPermission().then(function (perm) {
        if (perm !== "granted") return false;
        return api.get("/api/push/vapid").then(function (cfg) {
          if (!cfg || !cfg.enabled || !cfg.publicKey) return false;
          return navigator.serviceWorker.ready.then(function (reg) {
            return reg.pushManager.getSubscription().then(function (existing) {
              if (existing) return existing;
              return reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlB64ToUint8Array(cfg.publicKey),
              });
            });
          }).then(function (sub) {
            return api.post("/api/push/subscribe", sub.toJSON ? sub.toJSON() : sub).then(function () { return true; });
          });
        });
      }).catch(function () { return false; });
    },
  };
  function toast(msg) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = "position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:200;" +
      "background:var(--card);border:1px solid var(--line);color:var(--text);font-family:var(--mono);" +
      "font-size:13px;padding:11px 16px;border-radius:999px;box-shadow:0 10px 30px rgba(43,33,24,0.13);opacity:0;transition:opacity .2s;";
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
    // The indicator is a mini mochi: he stretches like taffy as you pull
    // and boings while the refresh runs.
    ind.innerHTML = window.Mascot && window.Mascot.mini
      ? window.Mascot.mini(30)
      : '<div style="width:26px;height:26px;border-radius:50%;background:#3DE8C7;border:2px solid #2B2118;"></div>';
    if (!document.getElementById("divvy-ptr-css")) {
      var s = document.createElement("style");
      s.id = "divvy-ptr-css";
      s.textContent = "@keyframes ptrBoing{0%,100%{transform:scale(1)}50%{transform:scale(1.18,.82)}}" +
        "@media (prefers-reduced-motion: reduce){.divvy-ptr-spin div{animation:none!important}}";
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
      var blob = ind.firstChild;
      // taffy stretch: the further the pull, the longer (and thinner) the blob
      var k = Math.min(pull / MAX, 1);
      if (blob) blob.style.transform = "scaleY(" + (1 + k * 0.4) + ") scaleX(" + (1 - k * 0.18) + ") rotate(" + (pull * 1.2) + "deg)";
    }
    function reset() {
      tracking = false; pull = 0;
      ind.classList.remove("divvy-ptr-spin");
      var blob = ind.firstChild; if (blob) { blob.style.animation = ""; blob.style.transform = ""; }
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
      var blob = ind.firstChild;
      if (blob) { blob.style.transform = ""; blob.style.animation = "ptrBoing .55s ease-in-out infinite"; }
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
  // Every tappable thing gives a tiny haptic tick on touch (native feel).
  if (!window.__divvyPressTick) {
    window.__divvyPressTick = true;
    document.addEventListener("pointerdown", function (e) {
      var b = e.target && e.target.closest && e.target.closest("button, .tabbar a");
      if (b) haptic(6);
    }, { passive: true });
  }

  var lastScreenName = null;
  async function render() {
    var r = parseHash();
    var screen = window.Screens && window.Screens[r.name];
    var view = document.getElementById("view");
    if (!view) return;
    if (!screen) { view.innerHTML = '<div class="empty"><div class="title">screen not found</div></div>'; return; }
    view.scrollTop = 0;
    // Direction-aware entrance: tab→tab fades up, tab→sub-screen pushes in from
    // the right, sub→tab settles back from the left (see divvy.css s-* rules).
    var toTop = !!TOPLEVEL[r.name];
    var fromTop = lastScreenName == null ? true : !!TOPLEVEL[lastScreenName];
    var transition = !toTop ? "s-push" : fromTop ? "s-fade" : "s-pop";
    try { await screen.render(view, r.params); }
    catch (e) { view.innerHTML = '<div class="empty"><div class="title lower">something broke</div><div class="hint">' + esc(e.message) + "</div></div>"; }
    view.classList.remove("s-fade", "s-push", "s-pop");
    void view.offsetWidth; // restart the entrance animation
    view.classList.add(transition);
    lastScreenName = r.name;
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
        (on ? ' aria-current="page"' : "") +
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
          ? 'background:rgba(39,117,202,0.16); border:1px solid rgba(39,117,202,0.5); color:#2775CA;'
          : 'background:#FFFDF7; border:1px solid rgba(43,33,24,0.1); color:#2B2118;') +
        '">' + dollarsLabel(c) + '</button>';
    }).join("");
    var maxHint = (typeof opts.maxCents === "number" && opts.maxCents > 0)
      ? '<div id="' + idp + '-max" style="text-align:center; font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(43,33,24,0.42); margin-top:9px;">balance ' + dollarsLabel(opts.maxCents) + ' available</div>'
      : '';
    return '' +
      '<div style="display:flex; align-items:center; justify-content:center; gap:4px; margin:6px 0 2px;">' +
        '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:34px; color:rgba(43,33,24,0.4);">$</span>' +
        '<input id="' + idp + '-input" inputmode="decimal" autocomplete="off" value="' + (def / 100) + '" ' +
          'style="width:auto; max-width:200px; min-width:60px; background:transparent; border:none; outline:none; ' +
          'font-family:\'Space Mono\',monospace; font-weight:700; font-size:46px; letter-spacing:-2px; ' +
          'color:#2B2118; text-align:center;">' +
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
          b.style.color = "#2775CA";
        } else {
          b.style.background = "#FFFDF7";
          b.style.border = "1px solid rgba(43,33,24,0.1)";
          b.style.color = "#2B2118";
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
    var wasBig = false;
    if (input) input.oninput = function () {
      var c = readCents();
      highlight(c);
      // big number! any mascot on screen does a double-take (once per crossing)
      var big = c >= 50000;
      if (big && !wasBig) {
        document.querySelectorAll(".dmascot-drawn").forEach(function (m) {
          m.classList.remove("mtap"); void m.offsetWidth; m.classList.add("mtap");
        });
        haptic([12, 28, 22]);
      }
      wasBig = big;
    };
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
      '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(43,33,24,0.4);">test mode · no real charge yet</span>' +
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
        '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:20px; color:#2B2118;">add money</div>' +
        '<div style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(43,33,24,0.6); margin-top:10px;">create or connect a wallet first, then come back to fund it.</div>' +
        '</div>');
      return;
    }

    var DEFAULT = 5000;
    var solUrl = "solana:" + wallet;
    var short = wallet.length > 12 ? (wallet.slice(0, 6) + "…" + wallet.slice(-6)) : wallet;

    sheet(
      '<div style="padding:4px 20px 26px;">' +
        '<div style="text-align:center; margin-bottom:6px;">' +
          '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:21px; letter-spacing:-0.3px; color:#2B2118;">add money</div>' +
          '<div style="font-family:\'General Sans\',sans-serif; font-size:13px; color:rgba(43,33,24,0.55); margin-top:4px;">straight to your balance — dollars, just faster.</div>' +
        '</div>' +
        amountEntryHtml({ idp: "dep", default: DEFAULT }) +
        '<button id="depCard" type="button" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:54px; margin-top:20px; border-radius:999px; background:#2775CA; border:2px solid #2B2118; display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>' +
          '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff;">add with card</span>' +
        '</button>' +
        '<div style="text-align:center; margin-top:9px;">' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(43,33,24,0.5);">apple pay · debit · credit</span>' +
        '</div>' +
        '<div id="depTestNote"></div>' +
        '<button id="depMore" type="button" style="appearance:none; border:none; cursor:pointer; background:transparent; display:block; width:100%; text-align:center; margin-top:16px; padding:6px; font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.3px; color:rgba(39,117,202,0.75);">or receive usdc directly ▾</button>' +
        // crypto-native receive block — hidden until "more options" is tapped.
        '<div id="depRecv" style="display:none; margin-top:6px;">' +
          '<div style="text-align:center;">' +
            '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:rgba(43,33,24,0.5);">receive usdc · ' + esc(cluster) + '</div>' +
          '</div>' +
          '<div id="depQrWrap" style="width:206px; margin:14px auto 0; background:#fff; border-radius:16px; padding:8px;">' +
            '<img id="depQr" alt="your wallet qr" width="190" height="190" style="display:block; border-radius:8px;" src="' + esc(qrImg(solUrl)) + '">' +
          '</div>' +
          '<div id="depAddr" style="display:flex; align-items:center; gap:9px; justify-content:center; margin:16px auto 0; max-width:300px; background:#FFFDF7; border:2px solid #2B2118; border-radius:13px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:12px 14px; cursor:pointer;">' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:13px; color:rgba(43,33,24,0.85);">' + esc(short) + '</span>' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.55)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>' +
          '</div>' +
          '<div style="text-align:center; margin-top:12px;">' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(43,33,24,0.42);">send usdc to this address — it shows up in your balance.</span>' +
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
      wrap.style.background = "#FFFDF7";
      wrap.style.border = "1px solid rgba(43,33,24,0.1)";
      wrap.style.width = "auto";
      wrap.style.padding = "16px";
      wrap.innerHTML =
        '<div style="font-family:\'Space Mono\',monospace; font-size:11px; line-height:1.5; ' +
        'word-break:break-all; text-align:center; color:rgba(43,33,24,0.9);">' + esc(wallet) + '</div>';
    };
  }

  // ---- delight primitives ----
  // ---- sound language (synthesized in WebAudio — no assets, ~Cash-App-style
  // tiny chimes). Gated by the "sounds" setting; iOS unlocks audio on first tap.
  var _ac = null, _soundOn = null;
  function soundsEnabled() {
    if (_soundOn === null) {
      try { _soundOn = localStorage.getItem("divvy.sounds") !== "off"; } catch (_) { _soundOn = true; }
    }
    return _soundOn;
  }
  function setSounds(on) {
    _soundOn = !!on;
    try { localStorage.setItem("divvy.sounds", on ? "on" : "off"); } catch (_) {}
  }
  function audioCtx() {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    if (!_ac) { try { _ac = new C(); } catch (_) { return null; } }
    if (_ac.state === "suspended") { try { _ac.resume(); } catch (_) {} }
    return _ac;
  }
  function _tone(ac, t0, freq, dur, type, gain, sweepTo) {
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.05, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function sound(name) {
    if (!soundsEnabled()) return;
    var ac = audioCtx(); if (!ac) return;
    try {
      var t = ac.currentTime + 0.01;
      if (name === "send") {          // soft rising whoosh: money leaving
        _tone(ac, t, 320, 0.2, "sine", 0.05, 760);
      } else if (name === "paid") {   // two-tone cha-ching: money arriving
        _tone(ac, t, 880, 0.12, "triangle", 0.055);
        _tone(ac, t + 0.09, 1318, 0.22, "triangle", 0.055);
      } else if (name === "win") {    // little arpeggio: everyone's square
        _tone(ac, t, 659, 0.12, "triangle", 0.05);
        _tone(ac, t + 0.08, 880, 0.12, "triangle", 0.05);
        _tone(ac, t + 0.16, 1108, 0.26, "triangle", 0.06);
      }
    } catch (_) { /* audio is a garnish — never break a flow over it */ }
  }

  function prefersReduced() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  // celebrate(opts) — a brand-colored confetti burst + celebratory haptic for
  // win moments (settled up, got paid, sent money). Pure canvas, auto-cleans up,
  // no-op (still haptics) under reduced-motion. opts: {x, y, count}.
  function celebrate(opts) {
    opts = opts || {};
    haptic([0, 35, 30, 45, 25, 70]);
    sound("win");
    if (prefersReduced()) return;
    var COLORS = ["#2775CA", "#3DE8C7", "#FF6B5E", "#FFC65C", "#8B5CF6"];
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;z-index:9998;pointer-events:none;";
    canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px"; canvas.style.height = window.innerHeight + "px";
    document.body.appendChild(canvas);
    var ctx = canvas.getContext("2d");
    var ox = (opts.x != null ? opts.x : window.innerWidth / 2) * dpr;
    var oy = (opts.y != null ? opts.y : window.innerHeight * 0.38) * dpr;
    var N = opts.count || 96, parts = [];
    // opts.coins mixes spinning gold coins in with the confetti (money moments).
    var coinCount = opts.coins ? Math.round(N * 0.28) : 0;
    for (var i = 0; i < N; i++) {
      var a = Math.random() * Math.PI * 2, sp = (4 + Math.random() * 9) * dpr;
      var coin = i < coinCount;
      parts.push({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 7 * dpr,
        s: (coin ? 7 + Math.random() * 4 : 5 + Math.random() * 7) * dpr,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * (coin ? 0.6 : 0.45),
        coin: coin,
        c: coin ? (Math.random() < 0.5 ? "#FFC65C" : "#FFD98A") : COLORS[(Math.random() * COLORS.length) | 0] });
    }
    var g = 0.3 * dpr, drag = 0.986, DUR = 1600, start = performance.now();
    function frame(t) {
      var dt = t - start, life = 1 - dt / DUR;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.vy += g; p.vx *= drag; p.vy *= drag; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.globalAlpha = Math.max(0, life); ctx.translate(p.x, p.y);
        if (p.coin) {
          // spinning coin: an ellipse whose width oscillates with rotation
          var w = Math.max(Math.abs(Math.cos(p.rot)) * p.s, p.s * 0.16);
          ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.ellipse(0, 0, w, p.s, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "rgba(11,22,34,0.35)"; ctx.lineWidth = dpr;
          ctx.beginPath(); ctx.ellipse(0, 0, w * 0.62, p.s * 0.62, 0, 0, Math.PI * 2); ctx.stroke();
        } else {
          ctx.rotate(p.rot);
          ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        }
        ctx.restore();
      }
      if (dt < DUR) requestAnimationFrame(frame); else canvas.remove();
    }
    requestAnimationFrame(frame);
  }

  // countUp(el, toCents, render) — animate a money figure from 0 to toCents.
  // `render(cents)` returns the HTML for the element (so each screen keeps its
  // own styling). Snaps to final under reduced-motion.
  function countUp(el, toCents, render) {
    if (!el) return;
    render = render || function (c) { return money(c); };
    if (prefersReduced() || !(toCents > 0)) { el.innerHTML = render(toCents); return; }
    var DUR = 620, start = performance.now();
    function frame(t) {
      var k = Math.min((t - start) / DUR, 1);
      var eased = 1 - Math.pow(1 - k, 3); // easeOutCubic
      el.innerHTML = render(Math.round(toCents * eased));
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // enter(container) — stagger the entrance of a container's direct children so a
  // freshly-rendered list feels alive. No-op under reduced-motion.
  function enter(container) {
    if (!container || prefersReduced()) return;
    var kids = container.children, n = Math.min(kids.length, 14);
    for (var i = 0; i < n; i++) {
      var el = kids[i];
      el.style.animation = "dRise .42s cubic-bezier(.2,.7,.2,1) both";
      el.style.animationDelay = (i * 42) + "ms";
    }
  }

  var app = {
    api: api, esc: esc, money: money, avatar: avatar, face: face, colorFor: colorFor, mascot: mascot,
    toast: toast, sheet: sheet, closeSheet: closeSheet, go: go, render: render,
    depositSheet: depositSheet, copy: copy, haptic: haptic, pullToRefresh: pullToRefresh,
    share: share, push: push, celebrate: celebrate, countUp: countUp, enter: enter,
    sound: sound, soundsEnabled: soundsEnabled, setSounds: setSounds,
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
