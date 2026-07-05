/* screens/tab.js — One tab: the running ledger with a single friend.
   Route #/tab/<friendUserId> (params[0] = friend user id).
   Data: GET /api/tabs/:id (friend, net balance, viewer-normalized entries,
   open settlement). Quick-add composer (direction toggle + big amount + note)
   posts /api/tabs/:id/entries; settle-up reuses the Solana Pay request flow
   (POST /api/tabs/:id/settle → url + reference; POST .../settle/verify polls
   the chain, exactly like settle.js does for trips). Journal aesthetic: the
   ledger is ruled notebook lines with a coral margin, entries as handwritten
   ledger rows. Money rule: they-owe-you = blue, you-owe = coral, settled =
   mint. lowercase + dry. Never crashes. */
(function () {
  "use strict";
  var app = window.app;

  var S = null; // { view, friendId, d, dir, pollTimer }

  var PEN = "#2B2118", BLUE = "#2775CA", CORAL = "#FF6B5E", MINT = "#3DE8C7";

  function topbar() {
    return '<div style="position:relative; z-index:6; display:flex; align-items:center; gap:12px; height:50px; padding:0 16px; flex:none;">' +
      '<div id="t1Back" role="button" aria-label="back" tabindex="0" style="width:38px; height:38px; border-radius:50%; background:#FFFDF7; border:1px solid rgba(43,33,24,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2B2118" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></div>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:1.5px; color:rgba(43,33,24,0.5);">tab</span>' +
    '</div>';
  }
  function wireBack() {
    var b = document.getElementById("t1Back");
    if (b) b.onclick = function () { if (history.length > 1) history.back(); else location.hash = "#/tabs"; };
  }
  function money3(cents) {
    var n = Math.abs(cents) / 100, whole = Math.floor(n).toLocaleString(), dec = (n % 1).toFixed(2).slice(1);
    return whole + '<span style="font-size:.55em; opacity:.5;">' + dec + '</span>';
  }
  // parse a dollar string -> integer cents (mirrors screens/settle.js toCents)
  function toCents(str) {
    var v = String(str == null ? "" : str).replace(/[^0-9.]/g, "");
    var parts = v.split(".");
    if (parts.length > 2) v = parts[0] + "." + parts.slice(1).join("");
    var n = parseFloat(v);
    if (!isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
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
  function friendName(d) { return (d.friend && (d.friend.displayName || d.friend.handle)) || "friend"; }
  function firstName(d) { return String(friendName(d)).trim().split(/\s+/)[0].toLowerCase(); }

  // ---- header + hero --------------------------------------------------------
  function header(d) {
    var f = d.friend || {};
    var owed = d.direction === "owed", owes = d.direction === "owes";
    var col = owed ? BLUE : owes ? CORAL : MINT;
    var label = owed ? firstName(d) + " owes you" : owes ? "you owe " + firstName(d) : "you're square with " + firstName(d);
    var big = d.balanceCents === 0
      ? '<span style="font-size:26px; opacity:.5;">$</span>0<span style="font-size:26px; opacity:.5;">.00</span>'
      : '<span style="font-size:26px; opacity:.5;">' + (owed ? "+$" : "−$") + '</span>' + money3(d.balanceCents);
    return '<div style="display:flex; flex-direction:column; align-items:center; text-align:center; padding:2px 0 0;">' +
      '<div style="width:64px; height:64px; border-radius:20px; background:' + app.esc(f.color || "rgba(39,117,202,0.18)") + '; display:flex; align-items:center; justify-content:center; font-size:32px; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">' + app.face(f.emoji || (friendName(d)[0] || "?").toUpperCase()) + '</div>' +
      '<div style="display:flex; align-items:center; gap:7px; margin-top:10px;">' +
        '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:20px; letter-spacing:-0.3px; color:' + PEN + ';">' + app.esc(friendName(d)) + '</span>' +
        (f.handle ? '<span style="font-family:\'Space Mono\',monospace; font-size:11px; color:rgba(39,117,202,0.75);">@' + app.esc(f.handle) + '</span>' : '') +
      '</div>' +
      '<div style="font-family:\'General Sans\',sans-serif; font-size:13px; color:rgba(43,33,24,0.55); margin-top:10px;">' + app.esc(label) + '</div>' +
      '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:52px; line-height:.95; letter-spacing:-2px; color:' + col + '; margin-top:6px;">' + big + '</div>' +
    '</div>';
  }

  // ---- quick-add composer (speed first: toggle · big amount · note · add) ----
  function dirBtn(id, label, on, color) {
    return '<button id="' + id + '" type="button" style="appearance:none; cursor:pointer; flex:1; min-height:44px; border-radius:999px; ' +
      'font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:14px; ' +
      (on ? 'background:' + color + '1f; border:2px solid ' + color + '; color:' + color + ';'
          : 'background:#FFFDF7; border:1px solid rgba(43,33,24,0.14); color:rgba(43,33,24,0.6);') +
      '">' + label + '</button>';
  }
  function composer(d) {
    var they = S.dir !== "i_owe";
    return '<div style="position:relative; background:#FFFDF7; border:2px solid ' + PEN + '; border-radius:18px; box-shadow:4px 5px 0 rgba(43,33,24,0.9); padding:16px 16px 15px; margin-top:20px;">' +
      '<div style="position:absolute; top:-12px; left:36%; width:80px; height:22px; background:rgba(255,198,92,0.6); transform:rotate(-4deg); border-left:1.5px dashed rgba(43,33,24,0.25); border-right:1.5px dashed rgba(43,33,24,0.25); pointer-events:none;"></div>' +
      '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.42);">ADD TO THE TAB</div>' +
      '<div style="display:flex; gap:8px; margin-top:11px;">' +
        dirBtn("t1DirThey", "they owe me", they, BLUE) +
        dirBtn("t1DirI", "i owe them", !they, CORAL) +
      '</div>' +
      '<div style="display:flex; align-items:center; justify-content:center; gap:3px; margin:12px 0 2px;">' +
        '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:26px; color:rgba(43,33,24,0.35);">$</span>' +
        '<input id="t1Amt" inputmode="decimal" autocomplete="off" placeholder="0" ' +
          'style="width:auto; max-width:170px; min-width:64px; background:transparent; border:none; outline:none; ' +
          'font-family:\'Space Mono\',monospace; font-weight:700; font-size:40px; letter-spacing:-1.5px; ' +
          'color:' + PEN + '; text-align:center;">' +
      '</div>' +
      '<input id="t1Note" maxlength="140" autocomplete="off" placeholder="for what? — coffee ☕️ (optional)" ' +
        'style="width:100%; min-height:44px; margin-top:8px; padding:10px 14px; border-radius:13px; background:#FBF6EA; ' +
        'border:1px solid rgba(43,33,24,0.12); outline:none; font-family:\'General Sans\',sans-serif; font-size:14px; color:' + PEN + ';">' +
      '<button id="t1Add" type="button" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:50px; margin-top:12px; border-radius:999px; ' +
        'background:' + (they ? BLUE : CORAL) + '; border:2px solid ' + PEN + '; box-shadow:3px 3px 0 rgba(43,33,24,0.9); ' +
        'font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff;">add to tab</button>' +
    '</div>';
  }

  // ---- settle button ----------------------------------------------------------
  function settleBtn(d) {
    if (d.balanceCents === 0) return "";
    var owes = d.direction === "owes";
    var amt = "$" + (Math.abs(d.balanceCents) / 100).toFixed(2);
    return '<button id="t1Settle" type="button" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:54px; margin-top:14px; border-radius:999px; ' +
      'background:' + (owes ? "linear-gradient(120deg,#FF8A7E,#FF6B5E)" : "linear-gradient(120deg,#3286db,#2775CA)") + '; ' +
      'box-shadow:0 12px 30px ' + (owes ? "rgba(255,107,94,0.45)" : "rgba(39,117,202,0.5)") + '; ' +
      'font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#fff;">' +
      (owes ? "settle up " + amt + " ✨" : "request " + amt + " 👀") + '</button>';
  }

  // ---- the ledger (ruled notebook lines + coral margin) -------------------------
  var ROW = 52; // px per ruled line
  function ledgerRow(e, d) {
    var mine = e.signedCents >= 0; // they owe me
    var col = mine ? BLUE : CORAL;
    var paid = e.status !== "open";
    var who = e.addedByMe ? "you" : firstName(d);
    var note = e.note || "(no note)";
    var del = (e.addedByMe && !paid)
      ? '<button type="button" data-del="' + app.esc(e.id) + '" aria-label="remove entry" style="appearance:none; border:none; cursor:pointer; background:transparent; padding:6px; margin-left:2px; color:rgba(43,33,24,0.3); font-size:13px; flex:none; line-height:1;">✕</button>'
      : '';
    return '<div style="display:flex; align-items:center; gap:10px; height:' + ROW + 'px; padding:0 6px 0 46px;' + (paid ? ' opacity:.5;' : '') + '">' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:14.5px; color:' + PEN + '; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;' + (paid ? ' text-decoration:line-through rgba(43,33,24,0.35) 1.5px;' : '') + '">' + app.esc(note) + '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:9.5px; letter-spacing:.3px; color:rgba(43,33,24,0.42); margin-top:1px;">' + app.esc(who) + ' · ' + relTime(e.createdAt) + (paid ? ' · <span style="color:' + MINT + ';">settled ✓</span>' : '') + '</div>' +
      '</div>' +
      '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:16px; letter-spacing:-0.4px; color:' + col + '; flex:none;"><span style="font-size:11px; opacity:.5;">' + (mine ? "+$" : "−$") + '</span>' + money3(e.signedCents) + '</div>' +
      del +
    '</div>';
  }
  function ledger(d) {
    var label = '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.42); padding:26px 2px 11px;">THE LEDGER</div>';
    if (!d.entries.length) {
      return label + '<div class="empty" style="padding:18px 12px 6px;">' +
        app.mascot({ size: 90, mood: "happy" }) +
        '<div class="title lower">fresh page 🐸</div>' +
        '<div class="hint">jot the first entry above — "+$7 coffee" style.</div>' +
      '</div>';
    }
    // ruled paper: horizontal lines every ROW px + a coral margin rule, like a
    // real ledger page. Rows are exactly ROW px tall so they sit on the lines.
    var rows = d.entries.map(function (e) { return ledgerRow(e, d); }).join("");
    return label +
      '<div style="background:#FFFDF7; border:2px solid ' + PEN + '; border-radius:16px; box-shadow:3.5px 4.5px 0 rgba(43,33,24,0.9); overflow:hidden;">' +
        '<div style="background-image:' +
          'linear-gradient(90deg, transparent 0 36px, rgba(255,107,94,0.35) 36px 37.5px, transparent 37.5px),' +
          'repeating-linear-gradient(0deg, transparent 0 ' + (ROW - 1) + 'px, rgba(43,33,24,0.09) ' + (ROW - 1) + 'px ' + ROW + 'px);">' +
          rows +
        '</div>' +
      '</div>';
  }

  // ---- paint ------------------------------------------------------------------
  function paint() {
    var d = S.d;
    S.view.innerHTML = '<div class="vfill">' + topbar() +
      '<div class="appscroll" style="padding-top:0;">' +
        header(d) + composer(d) + settleBtn(d) + ledger(d) +
      '</div></div>';
    wireBack();

    // direction toggle — repaint just the composer state by re-rendering
    var they = document.getElementById("t1DirThey"), io = document.getElementById("t1DirI");
    function setDir(dir) {
      if (S.dir === dir) return;
      S.dir = dir;
      var amt = document.getElementById("t1Amt"), note = document.getElementById("t1Note");
      S.keepAmt = amt ? amt.value : ""; S.keepNote = note ? note.value : "";
      paint();
    }
    if (they) they.onclick = function () { setDir("they_owe"); };
    if (io) io.onclick = function () { setDir("i_owe"); };
    // restore in-progress input across a toggle repaint
    var amtEl = document.getElementById("t1Amt"), noteEl = document.getElementById("t1Note");
    if (S.keepAmt && amtEl) amtEl.value = S.keepAmt;
    if (S.keepNote && noteEl) noteEl.value = S.keepNote;
    S.keepAmt = S.keepNote = "";

    // add entry
    var add = document.getElementById("t1Add");
    if (add) add.onclick = function () {
      var cents = toCents(amtEl && amtEl.value);
      if (!(cents > 0)) { app.toast("enter an amount first"); if (amtEl) amtEl.focus(); return; }
      var note = (noteEl && noteEl.value ? String(noteEl.value).trim() : "").slice(0, 140);
      add.disabled = true;
      app.api.post("/api/tabs/" + encodeURIComponent(S.friendId) + "/entries", {
        direction: S.dir === "i_owe" ? "i_owe" : "they_owe",
        amountCents: cents,
        note: note || undefined,
      }).then(function () {
        app.haptic([12, 28, 22]);
        app.toast("on the tab ✍️");
        return load(); // repaint with the fresh balance + ledger
      }).catch(function (e) {
        add.disabled = false;
        app.toast((e && e.message) || "couldn't add that");
      });
    };
    // enter in the note field submits too (fast path: amount → note → enter)
    if (noteEl) noteEl.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); if (add) add.click(); } };

    // delete one of my open entries
    Array.prototype.forEach.call(S.view.querySelectorAll("[data-del]"), function (btn) {
      btn.onclick = function () {
        btn.disabled = true;
        app.api.del("/api/tabs/entries/" + encodeURIComponent(btn.getAttribute("data-del"))).then(function () {
          app.toast("crossed out");
          return load();
        }).catch(function (e) {
          btn.disabled = false;
          app.toast((e && e.message) || "couldn't remove");
        });
      };
    });

    // settle up
    var settle = document.getElementById("t1Settle");
    if (settle) settle.onclick = function () {
      settle.disabled = true;
      app.api.post("/api/tabs/" + encodeURIComponent(S.friendId) + "/settle").then(function (s) {
        settle.disabled = false;
        openSettleSheet(s);
      }).catch(function (e) {
        settle.disabled = false;
        app.toast((e && e.message) || "couldn't build the settle-up");
      });
    };

    if (app.pullToRefresh) {
      var scrollEl = S.view.querySelector(".appscroll");
      if (scrollEl) app.pullToRefresh(scrollEl, function () { return load(); });
    }
  }

  // ---- settle sheet (QR + open-in-wallet + verify poll, like settle.js) --------
  function stopPoll() { if (S && S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; } }
  function openSettleSheet(s) {
    var iPay = !!s.iAmPayer;
    var name = firstName(S.d);
    var qr = s.url ? '<div style="width:196px; margin:14px auto 0; background:#fff; border-radius:16px; padding:8px;">' +
      '<img alt="payment qr" width="180" height="180" style="display:block; border-radius:8px;" src="' + app.esc(app.qrImg(s.url)) + '"></div>' : '';
    app.sheet('<div id="t1Sheet" style="padding:4px 4px 10px; text-align:center;">' +
      '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:20px; color:' + PEN + ';">' +
        (iPay ? "settle up with " + app.esc(name) : "request from " + app.esc(name)) + '</div>' +
      '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:40px; letter-spacing:-1.5px; color:' + (iPay ? CORAL : BLUE) + '; margin-top:8px;"><span style="font-size:20px; opacity:.5;">$</span>' + money3(s.amountCents) + '</div>' +
      '<div style="font-family:\'General Sans\',sans-serif; font-size:13px; color:rgba(43,33,24,0.55); margin-top:6px;">' +
        (iPay ? "pays their wallet directly — settles in seconds." : "show " + app.esc(name) + " the QR, or send them the link.") + '</div>' +
      qr +
      (iPay && s.url ? '<button class="btn" id="t1Pay" style="margin-top:16px;">open in wallet</button>' : '') +
      (s.url ? '<button class="btn ghost" id="t1Copy" style="margin-top:10px;">copy payment link</button>' : '') +
      '<button class="btn ghost" id="t1Check" style="margin-top:10px;">' + (iPay ? "i paid — check ✓" : "check for payment ✓") + '</button>' +
    '</div>');
    S.checkLabel = iPay ? "i paid — check ✓" : "check for payment ✓";

    var pay = document.getElementById("t1Pay");
    if (pay) pay.onclick = function () { try { window.location.href = s.url; } catch (_) {} };
    var cp = document.getElementById("t1Copy");
    if (cp) cp.onclick = function () {
      app.copy(s.url).then(function () { app.toast("link copied 📋"); }, function () { app.toast(s.url); });
    };
    var check = document.getElementById("t1Check");
    if (check) check.onclick = function () { verify(true); };

    // gentle auto-poll while the sheet is open (5s, ~2 min max)
    stopPoll();
    var tries = 0;
    S.pollTimer = setInterval(function () {
      if (!document.getElementById("t1Sheet") || ++tries > 24) { stopPoll(); return; }
      verify(false);
    }, 5000);
  }
  var verifying = false;
  function verify(manual) {
    if (verifying) return;
    verifying = true;
    var check = document.getElementById("t1Check");
    if (manual && check) { check.disabled = true; check.textContent = "checking…"; }
    app.api.post("/api/tabs/" + encodeURIComponent(S.friendId) + "/settle/verify").then(function (r) {
      verifying = false;
      if (r && r.verified) {
        stopPoll();
        app.closeSheet();
        app.celebrate({ coins: true });
        app.toast("tab settled 🎉");
        return load();
      }
      if (check) { check.disabled = false; check.textContent = (S && S.checkLabel) || "check ✓"; }
      if (manual) app.toast("no payment yet — give it a sec 👀");
    }).catch(function (e) {
      verifying = false;
      if (check) { check.disabled = false; check.textContent = (S && S.checkLabel) || "check ✓"; }
      if (manual) app.toast((e && e.message) || "couldn't check");
    });
  }
  window.addEventListener("hashchange", stopPoll);

  // ---- load / states ------------------------------------------------------------
  function skeleton() {
    S.view.innerHTML = '<div class="vfill">' + topbar() +
      '<div class="appscroll" style="padding-top:4px;">' +
        '<div class="skeleton" style="height:64px;width:64px;border-radius:20px;margin:6px auto 14px;"></div>' +
        '<div class="skeleton" style="height:70px;max-width:240px;margin:0 auto 18px;"></div>' +
        '<div class="skeleton" style="height:210px;border-radius:18px;"></div>' +
        '<div class="skeleton" style="height:170px;border-radius:16px;margin-top:20px;"></div>' +
      '</div></div>';
    wireBack();
  }
  function notFound(title, hint) {
    S.view.innerHTML = '<div class="vfill">' + topbar() +
      '<div class="empty" style="padding-top:60px;">' +
        app.mascot({ size: 110, mood: "sleepy" }) +
        '<div class="title lower">' + app.esc(title) + '</div>' +
        '<div class="hint">' + app.esc(hint) + '</div>' +
        '<button class="btn ghost" id="t1NF" style="max-width:240px;margin-top:8px;">back to tabs</button>' +
      '</div></div>';
    wireBack();
    var b = document.getElementById("t1NF");
    if (b) b.onclick = function () { location.hash = "#/tabs"; };
  }
  function signedOut(view) {
    view.innerHTML = '<div class="vfill">' + topbar() +
      '<div class="empty" style="padding-top:60px;">' +
        app.mascot({ size: 120, mood: "wave" }) +
        '<div class="title lower">sign in to see this tab</div>' +
        '<div class="hint">tabs with friends live behind your account.</div>' +
        '<button class="btn" id="t1SignIn" style="max-width:280px;margin-top:8px;">sign in</button>' +
      '</div></div>';
    wireBack();
    var c = document.getElementById("t1SignIn");
    if (c) c.onclick = function () { app.signIn(); };
  }
  function load() {
    return app.api.get("/api/tabs/" + encodeURIComponent(S.friendId)).then(function (d) {
      if (!S || location.hash.indexOf("tab/") < 0) return;
      S.d = d;
      paint();
    }).catch(function (e) {
      if (!S) return;
      if (e && e.status === 404) notFound("no tab here", "you two need to be friends first — add them, then start the tab.");
      else notFound("couldn't load this tab", (e && e.message) || "try again in a sec.");
    });
  }

  window.Screens = window.Screens || {};
  window.Screens.tab = {
    title: "tab",
    render: function (view, params) {
      stopPoll();
      var friendId = (params && params[0]) ? decodeURIComponent(params[0]) : "";
      S = { view: view, friendId: friendId, d: null, dir: "they_owe", pollTimer: null, keepAmt: "", keepNote: "" };
      if (!friendId) { notFound("no tab here", "pick a friend from your tabs list."); return; }
      var user = window.Auth && window.Auth.user;
      if (user) { skeleton(); load(); return; }
      signedOut(view);
      if (window.Auth && window.Auth.onChange) window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("tab/") >= 0) {
          if (u) { skeleton(); load(); } else signedOut(view);
        }
      });
    },
  };
})();
