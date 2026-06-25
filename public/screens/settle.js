/* screens/settle.js — Settle up. A 5-state machine (ready · waiting · retry ·
   needs-funds · settled) matching design/frames/Settle Up Frames.dc.html.
   Route: #/settle/<tripId> ; params[0] = tripId. See design/BUILD.md. */
(function () {
  "use strict";
  var app = window.app;

  // ---- module state (per render) ----
  var S = null; // { view, tripId, state, transfer, toName, fromName, trip, pollTimer, polling, tries, ticking }

  function esc(s) { return app.esc(s); }
  function trunc(s) {
    s = String(s || "");
    if (s.length <= 11) return s;
    return s.slice(0, 4) + "…" + s.slice(-4);
  }
  function encURL(u) { return encodeURIComponent(String(u || "")); }
  function phantomLink(u) {
    // Phantom universal link wraps the solana: pay url in its browse deeplink.
    return "https://phantom.app/ul/browse/" + encURL(u) + "?ref=" + encURL("https://divvy.app");
  }
  function qrSrc(u) {
    return "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encURL(u);
  }
  function openUrl(u) {
    if (!u) return;
    try { window.location.href = u; } catch (_) { /* ignore */ }
  }

  // ---- chrome ----
  function header(showCancel) {
    return '<div class="statusbar" style="height:46px;">' +
      '<span class="mono" style="font-size:11px;letter-spacing:1.5px;color:var(--faint);">settle up</span>' +
      (showCancel
        ? '<span id="stCancel" style="font-size:14px;color:var(--muted);cursor:pointer;">cancel</span>'
        : '<span></span>') +
      '</div>';
  }
  function wireCancel() {
    var c = document.getElementById("stCancel");
    if (c) c.onclick = function () { history.length > 1 ? history.back() : app.go("groups"); };
  }
  function wrap(inner) {
    return header(S.state === "ready" || S.state === "needs-funds") +
      '<div class="appscroll" style="display:flex;flex-direction:column;align-items:center;text-align:center;min-height:70vh;justify-content:center;">' +
      inner + '</div>';
  }

  // ---- avatars for the you → name card ----
  function meAvatar() {
    var u = (window.Auth && window.Auth.user) || {};
    return app.avatar({ name: u.handle || u.displayName || "you", id: u.id }, "sm");
  }
  function themAvatar() {
    return app.avatar({ name: S.toName || "them", id: S.transfer && S.transfer.to }, "sm");
  }

  // ---- states ---------------------------------------------------------------
  function renderReady() {
    var t = S.transfer;
    var amount = app.money(-Math.abs(t.amountCents), "neg", false); // coral, − sign
    var solUrl = t.url;
    var card =
      '<div class="card" style="width:100%;max-width:340px;position:relative;overflow:hidden;">' +
        // you → name
        '<div style="display:flex;align-items:center;justify-content:center;gap:12px;">' +
          '<div style="display:flex;flex-direction:column;align-items:center;gap:5px;">' + meAvatar() +
            '<span class="mono" style="font-size:9px;color:var(--faint);">you</span></div>' +
          '<span style="color:var(--faint);font-size:18px;">→</span>' +
          '<div style="display:flex;flex-direction:column;align-items:center;gap:5px;">' + themAvatar() +
            '<span class="mono" style="font-size:9px;color:var(--muted);">' + esc(S.toName) + '</span></div>' +
        '</div>' +
        // amount
        '<div style="margin-top:16px;"><span class="hero-amount neg" style="font-size:46px;color:var(--coral);">' +
          amount + '</span></div>' +
        '<div style="margin-top:8px;display:flex;align-items:center;justify-content:center;gap:8px;">' +
          '<span style="font-size:13px;color:var(--muted);">you owe ' + esc(S.toName) + '</span>' +
          '<span class="mono" style="font-size:9px;letter-spacing:1px;color:var(--faint);border:1px solid var(--line);border-radius:5px;padding:1px 5px;">in usdc</span>' +
        '</div>' +
        // pay paths
        '<div style="display:flex;flex-direction:column;gap:9px;margin-top:18px;">' +
          '<button class="btn" id="stPhantom" style="min-height:52px;font-size:16px;">pay with phantom</button>' +
          '<button class="btn ghost" id="stWallet" style="min-height:50px;flex-direction:column;gap:1px;">' +
            '<span style="font-size:15px;">open in another wallet</span>' +
            '<span class="mono" style="font-size:9px;letter-spacing:.5px;color:var(--faint);">solflare · backpack · any solana pay</span>' +
          '</button>' +
          // QR
          '<div style="display:flex;align-items:center;gap:13px;background:rgba(238,241,244,0.04);border:1px solid var(--line);border-radius:15px;padding:11px 13px;text-align:left;">' +
            '<div style="width:64px;height:64px;background:#EEF1F4;border-radius:11px;padding:5px;flex:none;">' +
              '<img alt="solana pay qr" width="100%" height="100%" style="display:block;border-radius:6px;" src="' + esc(qrSrc(solUrl)) + '">' +
            '</div>' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:13px;font-weight:500;color:var(--text);">or scan with any solana wallet</div>' +
              '<div class="mono" style="font-size:9.5px;letter-spacing:.5px;color:var(--faint);margin-top:3px;">pay from your phone on desktop</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        // ref + reassurance
        '<div style="margin-top:16px;padding-top:13px;border-top:1px solid var(--line);">' +
          '<div class="mono" style="font-size:10px;letter-spacing:.5px;color:var(--faint);">ref ' + esc(trunc(t.reference)) + '</div>' +
          '<div class="mono" style="font-size:9.5px;color:var(--faint);opacity:.85;margin-top:5px;">irreversible · arrives in seconds · ~$0.0001 fee</div>' +
        '</div>' +
      '</div>';

    S.view.innerHTML = wrap(
      '<div style="margin-bottom:14px;">' + app.mascot({ size: 88, mood: "happy", glow: false }) + '</div>' +
      card +
      '<button class="btn ghost" id="stPaid" style="max-width:340px;margin-top:14px;min-height:48px;">i\'ve paid — check now</button>'
    );
    wireCancel();
    var ph = document.getElementById("stPhantom");
    if (ph) ph.onclick = function () { openUrl(phantomLink(solUrl)); go("waiting"); };
    var w = document.getElementById("stWallet");
    if (w) w.onclick = function () { openUrl(solUrl); go("waiting"); };
    var paid = document.getElementById("stPaid");
    if (paid) paid.onclick = function () { go("waiting"); poll(); };
  }

  function renderWaiting() {
    var t = S.transfer;
    S.view.innerHTML = wrap(
      '<div style="margin-bottom:26px;">' + app.mascot({ size: 96, mood: "watching", glow: true }) + '</div>' +
      '<span class="state" id="stPill" style="color:var(--blue-bright);background:rgba(39,117,202,0.12);border-color:rgba(39,117,202,0.5);">waiting for payment</span>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:11px;">' +
        '<span class="mono" style="font-size:9px;font-weight:700;color:var(--blue-bright);">waiting</span>' +
        '<span style="width:18px;height:2px;border-radius:2px;background:repeating-linear-gradient(90deg,rgba(127,192,255,0.7) 0 3px,transparent 3px 6px);"></span>' +
        '<span class="mono" style="font-size:9px;color:var(--faint);">confirmed</span>' +
      '</div>' +
      '<h2 class="display" style="font-size:23px;margin-top:22px;max-width:280px;">watching the chain<br>for your payment…</h2>' +
      '<div class="mono" style="font-size:11px;color:var(--muted);margin-top:11px;">' +
        esc((t.amountFmt || "")) + ' → ' + esc(S.toName) + (t.toWallet ? ' · ' + esc(trunc(t.toWallet)) : '') + '</div>' +
      '<div style="width:100%;max-width:340px;margin-top:30px;display:flex;flex-direction:column;gap:11px;">' +
        '<button class="btn" id="stCheck" style="min-height:54px;">i\'ve paid — check now</button>' +
        '<button class="btn ghost" id="stWalletAgain" style="min-height:44px;border:none;color:var(--muted);box-shadow:none;">open wallet again</button>' +
      '</div>'
    );
    var c = document.getElementById("stCheck");
    if (c) c.onclick = function () { poll(true); };
    var wa = document.getElementById("stWalletAgain");
    if (wa) wa.onclick = function () { openUrl(t.url); };
    startAutoPoll();
  }

  function renderRetry() {
    var t = S.transfer;
    S.view.innerHTML = wrap(
      '<div style="margin-bottom:26px;">' + app.mascot({ size: 96, mood: "worried", glow: false }) + '</div>' +
      '<span class="state" style="color:var(--sunshine);background:rgba(255,198,92,0.10);border-color:rgba(255,198,92,0.4);">not seen yet</span>' +
      '<h2 class="display" style="font-size:25px;margin-top:22px;">still looking 👀</h2>' +
      '<p style="font-size:14px;color:var(--muted);margin-top:11px;max-width:280px;">paid already? give it a sec — solana\'s fast, but your wallet might still be broadcasting.</p>' +
      '<div style="width:100%;max-width:340px;margin-top:30px;display:flex;flex-direction:column;gap:11px;">' +
        '<button class="btn" id="stAgain" style="min-height:54px;">check again</button>' +
        '<button class="btn ghost" id="stOpenAgain" style="min-height:50px;">open wallet again</button>' +
      '</div>'
    );
    var a = document.getElementById("stAgain");
    if (a) a.onclick = function () { go("waiting"); poll(); };
    var o = document.getElementById("stOpenAgain");
    if (o) o.onclick = function () { openUrl(t.url); go("waiting"); };
  }

  function renderNeedsFunds() {
    var t = S.transfer;
    var amt = '<span class="mono" style="font-weight:700;color:var(--coral);">' + esc(t.amountFmt || "") + '</span>';
    S.view.innerHTML = wrap(
      '<div style="margin-bottom:24px;">' + app.mascot({ size: 92, mood: "worried", glow: false }) + '</div>' +
      '<span class="state" style="color:var(--coral);background:rgba(255,107,94,0.1);border-color:rgba(255,107,94,0.45);">balance too low</span>' +
      '<h2 class="display" style="font-size:24px;margin-top:20px;max-width:280px;">you need ' + amt + ' usdc to settle this</h2>' +
      '<div style="width:100%;max-width:340px;margin-top:30px;display:flex;flex-direction:column;gap:11px;">' +
        '<button class="btn coral" id="stAdd" style="min-height:56px;flex-direction:column;gap:1px;">' +
          '<span style="font-size:17px;">add money</span>' +
          '<span class="mono" style="font-size:9px;letter-spacing:1px;color:rgba(255,255,255,0.8);">debit card · apple pay · instant</span>' +
        '</button>' +
        '<button class="btn ghost" id="stOther" style="min-height:50px;">use another wallet</button>' +
        '<div class="mono" style="font-size:10px;color:var(--faint);margin-top:4px;">dollars, just faster.</div>' +
      '</div>'
    );
    wireCancel();
    var add = document.getElementById("stAdd");
    if (add) add.onclick = function () { app.toast("add money — coming soon"); };
    var oth = document.getElementById("stOther");
    if (oth) oth.onclick = function () { go("ready"); };
  }

  function renderSettled() {
    var t = S.transfer;
    var card =
      '<div class="receipt" id="stShare" style="width:100%;max-width:340px;position:relative;overflow:hidden;color:#fff;' +
        'background:linear-gradient(125deg,#2775CA 0%,#2aa5cf 48%,#3DE8C7 100%);background-size:200% 200%;' +
        'animation:stGrad 6s ease-in-out infinite;box-shadow:0 22px 52px rgba(39,117,202,0.45);border:none;padding:18px 22px 24px;">' +
        // squared stamp
        '<div style="position:absolute;top:16px;right:14px;transform:rotate(-11deg);animation:stStamp .6s ease-out .15s both;">' +
          '<span style="display:inline-flex;align-items:center;gap:5px;border:2px dashed rgba(255,255,255,0.85);border-radius:999px;padding:5px 11px;">' +
            '<span class="mono" style="font-weight:700;font-size:12px;letter-spacing:1px;color:#fff;">SQUARED</span><span style="font-size:12px;">✨</span>' +
          '</span>' +
        '</div>' +
        '<div style="position:relative;text-align:left;">' +
          '<span class="state" style="color:#fff;border-color:rgba(255,255,255,0.45);background:rgba(11,22,34,0.22);">finalized</span>' +
          '<div style="display:flex;align-items:center;gap:6px;margin-top:9px;">' +
            '<span class="mono" style="font-size:9px;color:rgba(255,255,255,0.6);">waiting</span>' +
            '<span style="width:14px;height:1px;background:rgba(255,255,255,0.4);"></span>' +
            '<span class="mono" style="font-size:9px;color:rgba(255,255,255,0.6);">confirmed</span>' +
            '<span style="width:14px;height:1px;background:rgba(255,255,255,0.7);"></span>' +
            '<span class="mono" style="font-size:9px;font-weight:700;color:#fff;">finalized</span>' +
          '</div>' +
          '<h2 class="display" style="font-size:28px;margin:18px 0 0;color:#fff;">you\'re square with ' + esc(S.toName) + '</h2>' +
          '<div class="mono" id="stTick" style="font-weight:700;font-size:52px;line-height:1;letter-spacing:-2px;color:#fff;margin-top:14px;">' +
            '<span style="font-size:28px;opacity:.6;">$</span>0<span style="font-size:28px;opacity:.6;">.00</span></div>' +
          '<div class="mono" style="font-size:12px;color:rgba(255,255,255,0.92);margin-top:15px;">settled. &lt;1 second. &lt;1 cent.</div>' +
          '<div id="stSolscan" style="display:inline-flex;align-items:center;gap:5px;margin-top:9px;cursor:pointer;">' +
            '<span class="mono" style="font-size:10.5px;color:rgba(255,255,255,0.72);">view on solscan</span>' +
            '<span class="mono" style="font-size:13px;color:rgba(255,255,255,0.72);">›</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    S.view.innerHTML = wrap(
      '<div style="margin-bottom:16px;">' + app.mascot({ size: 96, mood: "sparkle", glow: true }) + '</div>' +
      card +
      '<div style="display:flex;gap:11px;width:100%;max-width:340px;margin-top:14px;">' +
        '<button class="btn" id="stShareBtn" style="flex:1;min-height:52px;background:linear-gradient(120deg,#3DE8C7,#2aa5cf);color:#0B1622;box-shadow:0 8px 22px rgba(61,232,199,0.3);">share ✨</button>' +
        '<button class="btn ghost" id="stDone" style="flex:1;min-height:52px;background:var(--card);">done</button>' +
      '</div>'
    );
    ensureKeyframes();
    tickToZero();
    var sol = document.getElementById("stSolscan");
    if (sol) sol.onclick = function () {
      var cluster = (S.trip && S.trip.cluster) || "devnet";
      var q = cluster === "mainnet-beta" ? "" : "?cluster=" + encodeURIComponent(cluster);
      if (t.reference) window.open("https://solscan.io/account/" + encodeURIComponent(t.reference) + q, "_blank");
    };
    var sh = document.getElementById("stShareBtn");
    if (sh) sh.onclick = function () {
      var text = "squared up with " + (S.toName || "a friend") + " ✨ — settled in usdc, <1 second, <1 cent.";
      if (navigator.share) navigator.share({ text: text }).catch(function () {});
      else { try { navigator.clipboard.writeText(text); } catch (_) {} app.toast("copied ✨"); }
    };
    var dn = document.getElementById("stDone");
    if (dn) dn.onclick = function () { history.length > 1 ? history.back() : app.go("groups"); };
  }

  // amount ticks to $0.00 (kinetic) — start from the owed amount, count down.
  function tickToZero() {
    var el = document.getElementById("stTick");
    if (!el || !S.transfer) return;
    var start = Math.abs(S.transfer.amountCents || 0);
    if (!start) return;
    var t0 = null, dur = 900;
    function frame(ts) {
      if (location.hash.indexOf("settle") < 0 || S.state !== "settled") return;
      if (t0 == null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var cents = Math.round(start * (1 - p));
      var n = cents / 100;
      var whole = Math.floor(n).toLocaleString();
      var dec = (n % 1).toFixed(2).slice(1);
      el.innerHTML = '<span style="font-size:28px;opacity:.6;">$</span>' + whole + '<span style="font-size:28px;opacity:.6;">' + dec + '</span>';
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  var _kf = false;
  function ensureKeyframes() {
    if (_kf) return; _kf = true;
    var s = document.createElement("style");
    s.textContent =
      "@keyframes stGrad{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}" +
      "@keyframes stStamp{0%{transform:rotate(-11deg) scale(1.7);opacity:0}55%{opacity:1}100%{transform:rotate(-11deg) scale(1);opacity:1}}";
    document.head.appendChild(s);
  }

  // ---- state transitions ----------------------------------------------------
  function go(state) {
    if (location.hash.indexOf("settle") < 0) return; // navigated away
    stopAutoPoll();
    S.state = state;
    switch (state) {
      case "ready": renderReady(); break;
      case "waiting": renderWaiting(); break;
      case "retry": renderRetry(); break;
      case "needs-funds": renderNeedsFunds(); break;
      case "settled": renderSettled(); break;
      default: renderReady();
    }
  }

  // ---- polling (debounced) --------------------------------------------------
  function startAutoPoll() {
    stopAutoPoll();
    S.pollTimer = setTimeout(function () { poll(); }, 4000);
  }
  function stopAutoPoll() {
    if (S && S.pollTimer) { clearTimeout(S.pollTimer); S.pollTimer = null; }
  }
  // poll the chain; manual=true comes from a button (shows feedback, resets tries window)
  function poll(manual) {
    if (!S || S.polling) return;          // debounce overlapping calls
    if (location.hash.indexOf("settle") < 0) return;
    S.polling = true;
    var btn = document.getElementById("stCheck") || document.getElementById("stAgain");
    if (btn) btn.textContent = "checking…";
    app.api.post("/api/trips/" + encodeURIComponent(S.tripId) + "/settle/verify")
      .then(function (trip) {
        S.polling = false;
        S.trip = trip;
        var mine = findMyTransfer(trip);
        if (mine) S.transfer = mine;
        if (mine && mine.paid) { go("settled"); return; }
        S.tries = (S.tries || 0) + 1;
        if (S.state === "waiting") {
          if (manual || S.tries >= 3) { go("retry"); }   // after a few silent tries, surface retry
          else { if (btn) btn.textContent = "i've paid — check now"; startAutoPoll(); }
        }
      })
      .catch(function () {
        S.polling = false;
        if (S.state === "waiting") go("retry");
      });
  }

  // ---- find the transfer where the signed-in user is the payer --------------
  function findMyTransfer(trip) {
    var settle = trip && trip.settle;
    if (!settle || !settle.transfers || !settle.transfers.length) return null;
    var u = (window.Auth && window.Auth.user) || {};
    var wallets = (u.wallets || []).slice();
    if (u.primaryWallet) wallets.push(u.primaryWallet);
    var members = trip.members || [];
    // member id(s) that are "me": claimed by my userId, or holding one of my wallets.
    var myIds = members.filter(function (m) {
      return (u.id && m.userId === u.id) || (m.wallet && wallets.indexOf(m.wallet) >= 0);
    }).map(function (m) { return m.id; });

    var byPayer = settle.transfers.filter(function (t) { return myIds.indexOf(t.from) >= 0; });
    var pick = byPayer[0];
    // Fallback: if we can't identify the user (signed out / unclaimed), take the
    // first payable transfer so the screen is still useful.
    if (!pick) pick = settle.transfers.filter(function (t) { return !t.needsWallet; })[0] || settle.transfers[0];
    if (!pick) return null;
    // decorate with recipient wallet (for the waiting line)
    var rec = members.filter(function (m) { return m.id === pick.to; })[0];
    pick.toWallet = rec && rec.wallet;
    return pick;
  }

  // ---- error / empty chrome -------------------------------------------------
  function loading() {
    S.view.innerHTML = header(true) +
      '<div class="appscroll" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:14px;">' +
      app.mascot({ size: 92, mood: "watching", glow: true }) +
      '<div class="skeleton" style="height:200px;width:100%;max-width:340px;"></div></div>';
    wireCancel();
  }
  function friendly(title, hint, btnLabel, btnGo) {
    S.view.innerHTML = header(true) +
      '<div class="empty" style="padding-top:60px;">' + app.mascot({ size: 110, mood: "worried" }) +
      '<div class="title lower">' + esc(title) + '</div>' +
      '<div class="hint">' + esc(hint) + '</div>' +
      (btnLabel ? '<button class="btn" id="stBack" style="max-width:260px;margin-top:8px;">' + esc(btnLabel) + '</button>' : '') +
      '</div>';
    wireCancel();
    var b = document.getElementById("stBack");
    if (b) b.onclick = function () { btnGo ? btnGo() : app.go("groups"); };
  }

  // ---- entry ----------------------------------------------------------------
  async function start() {
    if (!(window.Auth && window.Auth.user)) {
      friendly("sign in to settle", "connect a wallet to pay your share 👀", "connect a wallet", function () {
        if (window.Auth) window.Auth.createWallet().catch(function (e) { app.toast(e.message); });
      });
      return;
    }
    loading();
    var trip;
    try {
      trip = await app.api.post("/api/trips/" + encodeURIComponent(S.tripId) + "/settle");
    } catch (e) {
      friendly("couldn't load this settle", e.message || "try again in a sec", "back to groups");
      return;
    }
    S.trip = trip;
    var mine = findMyTransfer(trip);
    if (!mine) {
      // Either everything's already square, or no payable transfer for this user.
      var settle = trip.settle;
      if (settle && settle.allPaid) { go("settled"); return; }
      friendly("nothing to settle", "you're all square here ✨", "back to groups");
      return;
    }
    S.transfer = mine;
    if (mine.paid) { go("settled"); return; }
    if (mine.needsWallet || !mine.url) {
      friendly("can't build a payment yet", "the person you owe hasn't added a wallet — nudge them to claim their spot.", "back to groups");
      return;
    }
    go("ready");
  }

  window.Screens = window.Screens || {};
  window.Screens.settle = {
    title: "settle",
    render: function (view, params) {
      var tripId = (params && params[0]) || "";
      if (S) stopAutoPoll();
      S = {
        view: view, tripId: tripId, state: "loading",
        transfer: null, trip: null,
        pollTimer: null, polling: false, tries: 0,
      };
      // keep toName fresh from whatever transfer is current
      Object.defineProperty(S, "toName", {
        get: function () { return (S.transfer && S.transfer.toName) || "them"; },
        configurable: true,
      });
      if (!tripId) { friendly("no trip", "missing a trip to settle", "back to groups"); return; }
      start();
    },
  };
})();
