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

  // ---- settled outside: pending claim card ------------------------------------
  // A debtor's "I paid you in cash" claim. Creditor sees confirm ✓ / dispute ✗;
  // the debtor sees a waiting strip with cancel. Pending claims never move the
  // balance — only the creditor's confirm does (server-enforced).
  function outsideCard(d) {
    var c = d.outsideClaim;
    if (!c) return "";
    var name = firstName(d);
    var what = "$" + (Math.abs(c.amountCents || 0) / 100).toFixed(2) + " " + (c.methodPhrase || "");
    if (c.iAmCreditor) {
      return '<div style="background:#FFFDF7; border:2px solid ' + PEN + '; border-radius:16px; box-shadow:3px 4px 0 rgba(43,33,24,0.9); padding:14px 16px; margin-top:14px;">' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.42);">SETTLED OUTSIDE?</div>' +
        '<div style="font-family:\'General Sans\',sans-serif; font-size:14.5px; line-height:1.4; color:' + PEN + '; margin-top:7px;">' +
          app.esc(name) + ' says they paid you <b>' + app.esc(what.trim()) + '</b>' +
          (c.note ? '<div style="font-size:12.5px; color:rgba(43,33,24,0.55); margin-top:3px;">“' + app.esc(c.note) + '”</div>' : '') +
        '</div>' +
        '<div style="display:flex; gap:9px; margin-top:12px;">' +
          '<button id="t1OutYes" type="button" style="appearance:none; border:2px solid ' + PEN + '; cursor:pointer; flex:1; min-height:44px; border-radius:999px; background:#3DE8C7; font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:14.5px; color:' + PEN + '; box-shadow:2px 3px 0 rgba(43,33,24,0.85);">confirm ✓</button>' +
          '<button id="t1OutNo" type="button" style="appearance:none; cursor:pointer; flex:1; min-height:44px; border-radius:999px; background:transparent; border:1px solid rgba(43,33,24,0.18); font-family:\'General Sans\',sans-serif; font-weight:500; font-size:14.5px; color:rgba(43,33,24,0.7);">dispute ✗</button>' +
        '</div>' +
      '</div>';
    }
    // I'm the debtor — waiting on their confirm.
    return '<div style="display:flex; align-items:center; gap:10px; background:rgba(255,198,92,0.16); border:1.5px dashed rgba(43,33,24,0.3); border-radius:14px; padding:11px 14px; margin-top:14px;">' +
      '<span style="font-size:16px; flex:none;">⏳</span>' +
      '<span style="flex:1; font-family:\'General Sans\',sans-serif; font-size:13px; color:rgba(43,33,24,0.7);">waiting for ' + app.esc(name) + ' to confirm your ' + app.esc(what.trim()) + '</span>' +
      '<span id="t1OutCancel" role="button" tabindex="0" style="font-family:\'General Sans\',sans-serif; font-size:12.5px; color:rgba(43,33,24,0.5); cursor:pointer; text-decoration:underline; flex:none;">cancel</span>' +
    '</div>';
  }
  function outsideAct(verb, btn) {
    var c = S.d && S.d.outsideClaim;
    if (!c) return;
    if (btn) btn.disabled = true;
    app.api.post("/api/tabs/" + encodeURIComponent(S.friendId) + "/settle-outside/" + encodeURIComponent(c.id) + "/" + verb)
      .then(function () {
        if (verb === "confirm") { app.celebrate({ coins: true }); app.toast("confirmed — tab updated ✓"); }
        else if (verb === "decline") app.toast("okay — the tab stays as-is");
        else app.toast("claim cancelled");
        return load();
      }).catch(function (e) {
        if (btn) btn.disabled = false;
        app.toast((e && e.message) || "couldn't do that");
        return load(); // the claim may have moved under us — repaint truth
      });
  }

  // ---- the ledger (ruled notebook lines + coral margin) -------------------------
  var ROW = 52; // px per ruled line
  function ledgerRow(e, d) {
    var mine = e.signedCents >= 0; // they owe me
    var col = mine ? BLUE : CORAL;
    var paid = e.status !== "open";
    if (e.payment) {
      // a settlement payment — money actually moved (on-chain partial), or a
      // creditor-CONFIRMED off-app payment (e.cash: "settled $20 in cash 💵").
      // Render it as a payment, not an IOU: mint, no +/− sign.
      var payWho = e.addedByMe ? "you" : firstName(d);
      var INK = "#17A277"; // readable mint ink on the cream page
      var payTitle = e.cash
        ? (e.note || ("settled $" + (e.amountCents / 100).toFixed(2) + " 💵"))
        : "settled $" + (e.amountCents / 100).toFixed(2) + " 💸";
      var paySub = e.cash
        ? app.esc(payWho) + " paid outside the app · confirmed ✓ · " + relTime(e.createdAt)
        : app.esc(payWho) + " paid · " + relTime(e.createdAt);
      return '<div style="display:flex; align-items:center; gap:10px; height:' + ROW + 'px; padding:0 6px 0 46px;' + (paid ? ' opacity:.5;' : '') + '">' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="font-family:\'General Sans\',sans-serif; font-weight:600; font-size:14.5px; color:' + INK + '; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;' + (paid ? ' text-decoration:line-through rgba(43,33,24,0.35) 1.5px;' : '') + '">' + app.esc(payTitle) + '</div>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:9.5px; letter-spacing:.3px; color:rgba(43,33,24,0.42); margin-top:1px;">' + paySub + '</div>' +
        '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:16px; letter-spacing:-0.4px; color:' + INK + '; flex:none;"><span style="font-size:11px; opacity:.5;">$</span>' + money3(e.amountCents) + '</div>' +
      '</div>';
    }
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
        header(d) + composer(d) + settleBtn(d) + outsideCard(d) + ledger(d) +
      '</div></div>';
    wireBack();

    // settled-outside claim actions (confirm / dispute / cancel)
    var outYes = document.getElementById("t1OutYes");
    if (outYes) outYes.onclick = function () { outsideAct("confirm", outYes); };
    var outNo = document.getElementById("t1OutNo");
    if (outNo) outNo.onclick = function () { outsideAct("decline", outNo); };
    var outCancel = document.getElementById("t1OutCancel");
    if (outCancel) outCancel.onclick = function () { outsideAct("cancel", null); };

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
  function dollarsOf(cents) { return (Math.abs(cents || 0) / 100).toFixed(2); }
  function openSettleSheet(s) {
    var iPay = !!s.iAmPayer;
    var name = firstName(S.d);
    // The tab's CURRENT net — partial-payment clamping + "of $Y" labels are
    // relative to it (a partial settlement's amountCents is smaller).
    var fullCents = Math.abs((S.d && S.d.balanceCents) || 0);
    if (s.amountCents > fullCents) fullCents = s.amountCents;
    var isPartial = !!s.partial && s.amountCents < fullCents;

    // "pay part of it →": same affordance as trips' settle.js — inline amount
    // clamped to (0, net]; a partial shows "paying $X of $Y" + a reset link.
    var partialHtml = "";
    if (isPartial) {
      partialHtml = '<div style="margin-top:10px; display:flex; flex-direction:column; align-items:center; gap:4px;">' +
        '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:#e0a63a;">paying $' + dollarsOf(s.amountCents) + ' of $' + dollarsOf(fullCents) + '</span>' +
        (iPay
          ? '<span id="t1PartialReset" role="button" tabindex="0" style="font-family:\'General Sans\',sans-serif; font-size:12px; color:rgba(43,33,24,0.5); cursor:pointer; text-decoration:underline;">pay the full amount instead</span>'
          : '<span style="font-family:\'General Sans\',sans-serif; font-size:11.5px; color:rgba(43,33,24,0.45);">the rest stays on the tab</span>') +
      '</div>';
    } else if (iPay && s.amountCents > 1) {
      partialHtml = '<div style="margin-top:10px;">' +
        '<span id="t1PartialToggle" role="button" tabindex="0" style="font-family:\'General Sans\',sans-serif; font-size:12.5px; color:' + BLUE + '; cursor:pointer;">pay part of it →</span>' +
        '<div id="t1PartialBox" style="display:none; margin-top:10px;">' +
          '<div style="display:flex; align-items:center; justify-content:center; gap:8px;">' +
            '<div style="display:inline-flex; align-items:center; gap:4px; background:#FFFDF7; border:2px solid ' + PEN + '; border-radius:12px; box-shadow:2px 3px 0 rgba(43,33,24,0.85); padding:8px 12px;">' +
              '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:16px; color:rgba(43,33,24,0.5);">$</span>' +
              '<input id="t1PartialInput" inputmode="decimal" enterkeyhint="done" placeholder="0.00" style="width:80px; border:none; outline:none; background:transparent; font-family:\'Space Mono\',monospace; font-weight:700; font-size:16px; color:' + PEN + ';">' +
            '</div>' +
            '<button id="t1PartialSet" type="button" style="appearance:none; border:2px solid ' + PEN + '; cursor:pointer; padding:0 14px; min-height:40px; border-radius:12px; background:#FFC65C; font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:14px; color:' + PEN + '; box-shadow:2px 3px 0 rgba(43,33,24,0.85);">set</button>' +
          '</div>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.3px; color:rgba(43,33,24,0.35); margin-top:7px;">the rest stays on the tab</div>' +
        '</div>' +
      '</div>';
    }

    var qr = s.url ? '<div style="width:196px; margin:14px auto 0; background:#fff; border-radius:16px; padding:8px;">' +
      '<img alt="payment qr" width="180" height="180" style="display:block; border-radius:8px;" src="' + app.esc(app.qrImg(s.url)) + '"></div>' : '';
    app.sheet('<div id="t1Sheet" style="padding:4px 4px 10px; text-align:center;">' +
      '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:20px; color:' + PEN + ';">' +
        (iPay ? "settle up with " + app.esc(name) : "request from " + app.esc(name)) + '</div>' +
      '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:40px; letter-spacing:-1.5px; color:' + (iPay ? CORAL : BLUE) + '; margin-top:8px;"><span style="font-size:20px; opacity:.5;">$</span>' + money3(s.amountCents) + '</div>' +
      '<div style="font-family:\'General Sans\',sans-serif; font-size:13px; color:rgba(43,33,24,0.55); margin-top:6px;">' +
        (iPay ? "pays their wallet directly — settles in seconds." : "show " + app.esc(name) + " the QR, or send them the link.") + '</div>' +
      partialHtml +
      qr +
      (iPay && s.url ? '<button class="btn" id="t1Pay" style="margin-top:16px;">open in wallet</button>' : '') +
      (s.url ? '<button class="btn ghost" id="t1Copy" style="margin-top:10px;">copy payment link</button>' : '') +
      '<button class="btn ghost" id="t1Check" style="margin-top:10px;">' + (iPay ? "i paid — check ✓" : "check for payment ✓") + '</button>' +
      (iPay
        ? '<div style="margin-top:12px;"><span id="t1Outside" role="button" tabindex="0" style="font-family:\'General Sans\',sans-serif; font-size:12.5px; color:rgba(43,33,24,0.5); cursor:pointer; text-decoration:underline;">settled another way? 💵</span></div>'
        : '') +
    '</div>');
    S.checkLabel = iPay ? "i paid — check ✓" : "check for payment ✓";

    var outside = document.getElementById("t1Outside");
    if (outside) outside.onclick = function () {
      stopPoll();
      app.closeSheet();
      openOutsideSheet(fullCents);
    };

    // partial-payment controls — re-build the settlement at the chosen amount
    // (fresh reference + Solana Pay url), then re-open the sheet on it.
    function rebuildAt(cents) {
      app.api.post("/api/tabs/" + encodeURIComponent(S.friendId) + "/settle", { partialCents: cents })
        .then(function (next) { openSettleSheet(next); })
        .catch(function (e) {
          var btn = document.getElementById("t1PartialSet");
          if (btn) { btn.disabled = false; btn.textContent = "set"; }
          app.toast((e && e.message) || "couldn't set that amount");
        });
    }
    var pToggle = document.getElementById("t1PartialToggle");
    if (pToggle) pToggle.onclick = function () {
      var box = document.getElementById("t1PartialBox");
      if (box) box.style.display = "block";
      pToggle.style.display = "none";
      var inp = document.getElementById("t1PartialInput");
      if (inp) inp.focus();
    };
    function commitPartial() {
      var inp = document.getElementById("t1PartialInput");
      if (!inp) return;
      var cents = toCents(inp.value);
      if (!(cents > 0)) { app.toast("enter an amount"); inp.focus(); return; }
      if (cents > fullCents) cents = fullCents; // clamp to the net
      var btn = document.getElementById("t1PartialSet");
      if (btn) { btn.disabled = true; btn.textContent = "setting…"; }
      rebuildAt(cents);
    }
    var pSet = document.getElementById("t1PartialSet");
    if (pSet) pSet.onclick = commitPartial;
    var pInp = document.getElementById("t1PartialInput");
    if (pInp) pInp.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); commitPartial(); } };
    var pReset = document.getElementById("t1PartialReset");
    if (pReset) pReset.onclick = function () { rebuildAt(fullCents); }; // = the full net → plain settle

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
  // ---- settled another way (cash / venmo / zelle) ------------------------------
  // Files a PENDING claim ("I paid you $X in cash") — nothing moves until the
  // friend confirms it from their side. Quiet path for mixed-adoption groups.
  function openOutsideSheet(owedCents) {
    var name = firstName(S.d);
    var methods = [["cash", "💵 cash"], ["venmo", "venmo"], ["zelle", "zelle"], ["other", "other"]];
    var chips = methods.map(function (m, i) {
      return '<button type="button" class="t1OMethod" data-m="' + m[0] + '" style="appearance:none; cursor:pointer; padding:0 13px; min-height:38px; border-radius:999px; ' +
        (i === 0
          ? 'background:rgba(39,117,202,0.12); border:2px solid ' + BLUE + '; color:' + BLUE + ';'
          : 'background:#FFFDF7; border:1px solid rgba(43,33,24,0.16); color:rgba(43,33,24,0.6);') +
        ' font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:13.5px;">' + m[1] + '</button>';
    }).join("");
    app.sheet('<div id="t1OSheet" style="padding:4px 4px 10px; text-align:center;">' +
      '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:20px; color:' + PEN + ';">settled another way?</div>' +
      '<div style="font-family:\'General Sans\',sans-serif; font-size:13px; color:rgba(43,33,24,0.55); margin-top:6px;">already paid ' + app.esc(name) + ' off-app? they confirm it, then the tab updates.</div>' +
      '<div style="display:flex; justify-content:center; gap:8px; flex-wrap:wrap; margin-top:14px;">' + chips + '</div>' +
      '<div style="display:flex; align-items:center; justify-content:center; gap:4px; margin-top:14px;">' +
        '<div style="display:inline-flex; align-items:center; gap:4px; background:#FFFDF7; border:2px solid ' + PEN + '; border-radius:12px; box-shadow:2px 3px 0 rgba(43,33,24,0.85); padding:8px 12px;">' +
          '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:16px; color:rgba(43,33,24,0.5);">$</span>' +
          '<input id="t1OAmt" inputmode="decimal" enterkeyhint="done" value="' + dollarsOf(owedCents) + '" style="width:86px; border:none; outline:none; background:transparent; font-family:\'Space Mono\',monospace; font-weight:700; font-size:16px; color:' + PEN + ';">' +
        '</div>' +
      '</div>' +
      '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.3px; color:rgba(43,33,24,0.35); margin-top:6px;">pay less and the rest stays on the tab</div>' +
      '<input id="t1ONote" maxlength="140" autocomplete="off" placeholder="note — “at the bar” (optional)" ' +
        'style="width:100%; min-height:44px; margin-top:12px; padding:10px 14px; border-radius:13px; background:#FBF6EA; border:1px solid rgba(43,33,24,0.12); outline:none; font-family:\'General Sans\',sans-serif; font-size:14px; color:' + PEN + ';">' +
      '<button class="btn" id="t1OSend" style="margin-top:14px;">ask ' + app.esc(name) + ' to confirm</button>' +
      '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.3px; color:rgba(43,33,24,0.35); margin-top:8px;">nothing changes until they confirm</div>' +
    '</div>');
    var method = "cash";
    Array.prototype.forEach.call(document.querySelectorAll(".t1OMethod"), function (chip) {
      chip.onclick = function () {
        method = chip.getAttribute("data-m") || "cash";
        Array.prototype.forEach.call(document.querySelectorAll(".t1OMethod"), function (c2) {
          var on = c2 === chip;
          c2.style.background = on ? "rgba(39,117,202,0.12)" : "#FFFDF7";
          c2.style.border = on ? "2px solid " + BLUE : "1px solid rgba(43,33,24,0.16)";
          c2.style.color = on ? BLUE : "rgba(43,33,24,0.6)";
        });
      };
    });
    var send = document.getElementById("t1OSend");
    if (send) send.onclick = function () {
      var amtEl = document.getElementById("t1OAmt");
      var cents = toCents(amtEl && amtEl.value);
      if (!(cents > 0)) { app.toast("enter an amount"); if (amtEl) amtEl.focus(); return; }
      if (cents > owedCents) cents = owedCents; // clamp to what's owed
      var noteEl = document.getElementById("t1ONote");
      var note = (noteEl && noteEl.value ? String(noteEl.value).trim() : "").slice(0, 140);
      send.disabled = true;
      send.textContent = "sending…";
      app.api.post("/api/tabs/" + encodeURIComponent(S.friendId) + "/settle-outside", {
        method: method,
        amountCents: cents,
        note: note || undefined,
      }).then(function () {
        app.closeSheet();
        app.haptic([12, 28, 22]);
        app.toast("asked " + name + " to confirm 👀");
        return load();
      }).catch(function (e) {
        send.disabled = false;
        send.textContent = "ask " + name + " to confirm";
        app.toast((e && e.message) || "couldn't send that");
      });
    };
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
        app.toast(r.partial ? "payment in 💸 the rest stays on the tab" : "tab settled 🎉");
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
