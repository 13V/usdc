/* screens/group.js — Group detail / "the ledger". Route #/group/<id>.
   Built by lifting the EXACT inline-styled markup from
   design/handoff/Group Detail Frames.dc.html (frame 1 = ledger,
   frame 2 = tab detail, shown as an app.sheet) and wiring live data into it,
   so it pixel-matches the approved design. Keeps the existing
   GET /api/trips/:id + expense-delete + settle wiring. */
(function () {
  "use strict";
  var app = window.app;

  // server-backed reactions for this trip's money cards: target -> [{emoji,count,mine}]
  var reactionsMap = {};
  // live spendable USDC balance (cents) from /api/me/wallet, or null if unknown
  var walletCents = null;

  // a "you have $X ready" chip shown when you owe in this group — mint if your
  // wallet covers it, coral if you need to top up. Reuses the live balance.
  function walletReadyChip(oweCents) {
    if (walletCents == null) return "";
    var covers = walletCents >= oweCents;
    var col = covers ? "#3DE8C7" : "#FF6B5E";
    var dollars = "$" + (walletCents / 100).toFixed(2);
    var label = covers ? "your balance · ready to settle" : "your balance · top up to settle";
    return '<div style="display:inline-flex; align-items:center; gap:7px; margin-top:14px; border:1px solid ' + col + '55; background:' + col + '1f; border-radius:999px; padding:5px 12px;">' +
      '<span style="width:6px; height:6px; border-radius:50%; background:' + col + '; box-shadow:0 0 7px ' + col + 'cc;"></span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:11px; color:' + col + ';">' + dollars + '</span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(43,33,24,0.55);">' + label + '</span>' +
    '</div>';
  }
  var REACTS = ["😋", "🔥", "🫡"]; // the receipt-sheet chip set (frame style)

  function elFrom(html) {
    var t = document.createElement("template");
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  }

  // persisted reaction row for a money card (target "exp:<id>"). Renders the
  // standard chip set (plus any extra emoji already on the target), toggles via
  // POST /api/trips/:id/reactions, and repaints from the server's fresh array.
  function reactionRowEl(tripId, target) {
    var row = elFrom('<div style="display:flex; align-items:center; gap:8px; margin:14px 20px 0;"></div>');
    var state = {};
    function ingest(list) { state = {}; (list || []).forEach(function (r) { state[r.emoji] = { count: r.count || 0, mine: !!r.mine }; }); }
    ingest(reactionsMap[target] || []);
    var keys = REACTS.slice();
    Object.keys(state).forEach(function (e) { if (keys.indexOf(e) < 0) keys.push(e); });
    var chips = {};
    keys.forEach(function (emoji) {
      var chip = elFrom('<div style="display:inline-flex; align-items:center; gap:5px; background:#FFFDF7; border:2px solid #2B2118; border-radius:999px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:5px 11px; cursor:pointer;"></div>');
      chips[emoji] = chip;
      function paint() {
        var st = state[emoji] || { count: 0, mine: false };
        chip.innerHTML = '<span style="font-size:13px;">' + emoji + '</span>' +
          (st.count > 0 ? '<span style="font-family:\'Space Mono\',monospace; font-size:11px; color:rgba(43,33,24,0.7);">' + st.count + '</span>' : '');
        var on = st.count > 0;
        chip.style.borderColor = st.mine ? "rgba(39,117,202,0.8)" : (on ? "rgba(39,117,202,0.45)" : "rgba(43,33,24,0.1)");
        chip.style.background = st.mine ? "rgba(39,117,202,0.22)" : (on ? "rgba(39,117,202,0.12)" : "#FFFDF7");
      }
      chip.onclick = function () {
        app.api.post("/api/trips/" + encodeURIComponent(tripId) + "/reactions", { target: target, emoji: emoji })
          .then(function (fresh) {
            reactionsMap[target] = (fresh && fresh.reactions) || [];
            ingest(reactionsMap[target]);
            keys.forEach(function (k) { if (chips[k]) chips[k]._paint(); });
          })
          .catch(function (err) { app.toast((err && err.status === 401) ? "sign in to react" : "couldn't react"); });
      };
      chip._paint = paint;
      paint();
      row.appendChild(chip);
    });
    return row;
  }

  // ---------- deterministic identity (api members carry no emoji/color) ----------
  function hash(seed) {
    var h = 0, s = String(seed || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  // emoji pool mirrors the frame's avatar set (🦊 🌸 🐢 🦜 …)
  var MEMBER_EMOJI = ["🦊", "🌸", "🐢", "🦜", "🐼", "🐯", "🐨", "🐸", "🐱", "🦁", "🐵", "🦉"];
  // avatar gradients lifted from the frame
  var MEMBER_GRAD = [
    "linear-gradient(150deg,#FFC65C,#FF6B5E)",
    "linear-gradient(150deg,#3DE8C7,#2775CA)",
    "linear-gradient(150deg,#2775CA,#2775CA)",
    "linear-gradient(150deg,#FF8A7E,#FF6B5E)",
    "linear-gradient(150deg,#a78bfa,#8B5CF6)",
    "linear-gradient(150deg,#5cf0d4,#3DE8C7)",
  ];
  function memberEmoji(m) {
    if (m && m.emoji) return m.emoji;
    return MEMBER_EMOJI[hash((m && (m.id || m.name)) || "") % MEMBER_EMOJI.length];
  }
  function memberGrad(m) {
    if (m && m.color) return m.color;
    return MEMBER_GRAD[hash((m && (m.id || m.name)) || "") % MEMBER_GRAD.length];
  }
  // the group's chosen emoji, else a friendly one derived from name/cluster
  function groupEmoji(t) {
    if (t && t.emoji) return t.emoji;
    var n = String((t && (t.name || t.cluster)) || "").toLowerCase();
    if (/tokyo|japan|trip|travel|flight/.test(n)) return "🗼";
    if (/apart|rent|house|home|flat/.test(n)) return "🏠";
    if (/bali|beach|island|vacation/.test(n)) return "🏝️";
    if (/room|mate/.test(n)) return "🧻";
    if (/food|dinner|lunch|eat/.test(n)) return "🍜";
    var pool = ["🧾", "🍜", "🏝️", "🎟️", "🏠", "🚗", "🍻", "⛺", "🎉", "🌮"];
    return pool[hash((t && (t.id || t.name)) || "") % pool.length];
  }

  // a small gradient-circle avatar (px-sized), exactly like the frame
  function gavatar(m, px) {
    px = px || 28;
    var fs = Math.round(px * 0.5);
    return '<div style="width:' + px + 'px; height:' + px + 'px; border-radius:50%; background:' +
      memberGrad(m) + '; display:flex; align-items:center; justify-content:center; font-size:' + fs + 'px; flex:none;">' +
      app.face(memberEmoji(m)) + '</div>';
  }

  // mono dollars: whole + lighter decimals (frame-style). cents -> inner HTML.
  function moneyParts(cents, decPx, decOpacity) {
    var n = Math.abs(cents) / 100;
    var whole = Math.floor(n).toLocaleString();
    var dec = (n % 1).toFixed(2).slice(1); // ".00"
    return whole + '<span style="font-size:' + decPx + '; opacity:' + (decOpacity == null ? ".5" : decOpacity) + ';">' + dec + '</span>';
  }
  function plain(cents) {
    return "$" + (Math.abs(cents) / 100).toFixed(2);
  }

  // ---------- due dates (journal chip: "🗓️ due sun", coral when overdue) ----------
  function dueLabel(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    var days = Math.ceil((t - Date.now()) / 86400000);
    var dt = new Date(iso);
    try {
      if (days > 0 && days <= 6) return dt.toLocaleDateString(undefined, { weekday: "short" }).toLowerCase();
      return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toLowerCase();
    } catch (_) { return ""; }
  }
  function dueChip(dueAt, overdue) {
    if (!dueAt) return "";
    var col = overdue ? "#FF6B5E" : "#2775CA";
    var label = overdue ? "overdue — was due " + dueLabel(dueAt) : "settle by " + dueLabel(dueAt);
    return '<span style="display:inline-flex; align-items:center; gap:5px; background:' + col + '1a; border:1.5px ' + (overdue ? "solid" : "dashed") + ' ' + col + '88; border-radius:999px; padding:3px 10px;">' +
      '<span style="font-size:10px;">🗓️</span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:' + col + ';">' + app.esc(label.toUpperCase()) + '</span>' +
    '</span>';
  }

  // ---------- top bar (back ‹ · name + emoji · ⋯) ----------
  function topbar(trip, emoji) {
    return '' +
    '<div style="display:flex; align-items:center; justify-content:space-between; height:56px; padding:0 16px; flex:none;">' +
      '<div id="gBack" role="button" aria-label="back" tabindex="0" style="width:38px; height:38px; border-radius:50%; background:#FFFDF7; border:1px solid rgba(43,33,24,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2B2118" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></div>' +
      '<div style="display:flex; align-items:center; gap:7px; min-width:0;">' +
        '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc((trip && trip.name) || "group") + '</span>' +
        '<span id="gEmoji" style="font-size:16px;">' + emoji + '</span>' +
      '</div>' +
      '<div id="gMore" role="button" aria-label="group options" tabindex="0" style="width:38px; height:38px; border-radius:50%; background:#FFFDF7; border:1px solid rgba(43,33,24,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2B2118" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></div>' +
    '</div>';
  }
  function wireBack() {
    var b = document.getElementById("gBack");
    if (b) {
      var goBack = function () { if (history.length > 1) history.back(); else app.go("groups"); };
      b.onclick = goBack;
      b.onkeydown = function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); goBack(); }
      };
    }
  }

  // ---------- cover header (avatar stack + GROUP TOTAL + meta) ----------
  function coverHeader(trip) {
    var members = trip.members || [];
    var stack = members.slice(0, 5).map(function (m, i) {
      return '<div style="width:36px; height:36px; border-radius:50%; background:' + memberGrad(m) +
        '; border:2px solid #2B2118;' + (i ? " margin-left:-10px;" : "") +
        ' display:flex; align-items:center; justify-content:center; font-size:17px;">' + app.face(memberEmoji(m)) + '</div>';
    }).join("");
    var more = members.length > 5
      ? '<span style="font-family:\'Space Mono\',monospace; font-size:11px; color:rgba(43,33,24,0.55); margin-left:8px;">+' + (members.length - 5) + '</span>'
      : "";

    var since = "";
    if (trip.createdAt) {
      try {
        since = " · SINCE " + new Date(trip.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
      } catch (_) {}
    }
    var ntabs = (trip.expenses || []).length;
    var meta = members.length + " " + (members.length === 1 ? "PERSON" : "PEOPLE") +
      " · " + ntabs + " " + (ntabs === 1 ? "TAB" : "TABS") + since;

    return '' +
    '<div style="position:relative; margin:14px 16px 0; border-radius:20px; padding:18px 18px 15px; background:#FFFDF7; border:2px solid #2B2118; box-shadow:3px 4px 0 rgba(43,33,24,0.85); transform:rotate(-0.4deg);">' +
      // washi tape holding the card into the journal
      '<div style="position:absolute; top:-11px; left:50%; width:88px; height:22px; transform:translateX(-50%) rotate(-2deg); background:rgba(61,232,199,0.75); opacity:.9; border-left:1.5px dashed rgba(43,33,24,0.25); border-right:1.5px dashed rgba(43,33,24,0.25);"></div>' +
      '<div style="position:relative; display:flex; align-items:center; justify-content:space-between;">' +
        '<div style="display:flex; align-items:center;">' + stack + more + '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:1.5px; color:rgba(43,33,24,0.5);">GROUP TOTAL</div>' +
          '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:22px; letter-spacing:-1px; color:#2775CA; margin-top:2px;"><span style="font-size:14px; opacity:.55;">$</span>' + moneyParts(trip.totalCents || 0, "14px", ".55") + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="position:relative; display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:12px;">' +
        '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1px; color:rgba(43,33,24,0.55);">' + meta + ' <span style="color:#FF6B5E;">!!</span></span>' +
        dueChip(trip.dueAt, trip.overdue) +
      '</div>' +
    '</div>';
  }

  // who is "you"? match a member to the signed-in user by userId or wallet.
  function findMe(trip) {
    var u = window.Auth && window.Auth.user;
    if (!u || !trip.members) return null;
    var wallets = {};
    (u.wallets || []).forEach(function (w) { if (w) wallets[String(w)] = 1; });
    if (u.primaryWallet) wallets[String(u.primaryWallet)] = 1;
    for (var i = 0; i < trip.members.length; i++) {
      var m = trip.members[i];
      if (m.userId && u.id && m.userId === u.id) return m;
      if (m.wallet && wallets[String(m.wallet)]) return m;
    }
    return null;
  }
  function memberById(trip, id) {
    var ms = trip.members || [];
    for (var i = 0; i < ms.length; i++) if (ms[i].id === id) return ms[i];
    return { id: id, name: id };
  }

  // unclaimed slots = members with no userId (no wallet attached yet).
  function unclaimedSlots(trip) {
    return (trip.members || []).filter(function (m) { return m && !m.userId; });
  }

  // ---------- "claim your spot" card (shown to an unclaimed visitor) ----------
  // When the signed-in viewer isn't already a member of this trip AND there are
  // open slots, invite them to attach their wallet to one. Required before the
  // group can settle up to them. Rendered as a live node so taps wire cleanly.
  function claimCardEl(trip) {
    var slots = unclaimedSlots(trip);
    var rows = slots.map(function (m) {
      return '<div class="gClaimSlot" data-mid="' + app.esc(m.id) + '" role="button" tabindex="0" ' +
        'style="display:flex; align-items:center; gap:12px; background:#F7F1E3; border:1px solid rgba(61,232,199,0.28); border-radius:14px; padding:11px 14px; cursor:pointer;">' +
        gavatar(m, 34) +
        '<span style="flex:1; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(m.name || "someone") + '</span>' +
        '<span style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.5px; color:#3DE8C7;">claim →</span>' +
      '</div>';
    }).join("");

    var html = '' +
    '<div style="margin:22px 0 4px; border-radius:20px; padding:18px 18px 16px; ' +
      'background:linear-gradient(150deg, rgba(61,232,199,0.12), rgba(39,117,202,0.10)); ' +
      'border:1px solid rgba(61,232,199,0.35); box-shadow:3px 3px 0 rgba(43,33,24,0.9);">' +
      '<div style="display:flex; align-items:center; gap:9px;">' +
        '<span style="font-size:20px;">✨</span>' +
        '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:18px; letter-spacing:-0.3px; color:#2B2118;">is one of these you?</span>' +
      '</div>' +
      '<div style="font-family:\'General Sans\',sans-serif; font-size:13.5px; color:rgba(43,33,24,0.65); margin-top:6px;">claim your spot so the group can settle up to you.</div>' +
      '<div style="display:flex; flex-direction:column; gap:9px; margin-top:14px;">' + rows + '</div>' +
    '</div>';

    var el = elFrom(html);
    var slotEls = el.querySelectorAll(".gClaimSlot");
    Array.prototype.forEach.call(slotEls, function (s) {
      function go() { claimSlot(trip, s.getAttribute("data-mid")); }
      s.onclick = go;
      s.onkeydown = function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); go(); }
      };
    });
    return el;
  }

  // POST the claim. Needs the caller signed in; if not, create a wallet (which
  // signs them in) and retry once. On success: toast + reload so findMe() now
  // resolves them as a claimed member with a wallet, unlocking settle-up.
  function claimSlot(trip, memberId, retried) {
    if (!memberId) return;
    var u = window.Auth && window.Auth.user;
    if (!u) {
      if (retried) { app.toast("sign in to claim your spot"); return; }
      app.toast("setting up your account…");
      if (!(window.Auth && window.Auth.createWallet)) { app.toast("sign in to claim your spot"); return; }
      window.Auth.createWallet()
        .then(function () { claimSlot(trip, memberId, true); })
        .catch(function () { app.toast("couldn't set up your account — try again"); });
      return;
    }
    app.api.post("/api/trips/" + encodeURIComponent(trip.id) + "/members/" + encodeURIComponent(memberId) + "/claim")
      .then(function (fresh) {
        app.haptic([30, 40, 30]);
        app.toast("claimed ✨");
        if (fresh && fresh.id) paint(view_, fresh);
        else load(view_, trip.id);
      })
      .catch(function (err) {
        if (err && (err.status === 401 || err.status === 403)) {
          if (retried) { app.toast("sign in to claim your spot"); return; }
          app.toast("sign in to claim your spot");
          if (window.Auth && window.Auth.createWallet) {
            window.Auth.createWallet()
              .then(function () { claimSlot(trip, memberId, true); })
              .catch(function () { app.toast("couldn't set up your account — try again"); });
          }
          return;
        }
        app.toast((err && err.message) || "couldn't claim that spot");
      });
  }

  // ---------- your balance hero (big mono + owe bar) ----------
  function balanceHero(trip, me) {
    // net for "you"
    var net = null, haveNet = false;
    if (me && trip.balances) {
      for (var i = 0; i < trip.balances.length; i++) {
        if (trip.balances[i].memberId === me.id) { net = trip.balances[i].cents; haveNet = true; break; }
      }
    }
    // total owed-to-you / you-owe across the group for the bar split
    var owed = 0, owe = 0;
    (trip.balances || []).forEach(function (b) {
      if (b.cents > 0) owed += b.cents; else if (b.cents < 0) owe += b.cents;
    });
    owe = Math.abs(owe);

    var col, eyebrow, label, bigSign;
    if (haveNet) {
      eyebrow = "YOUR BALANCE";
      col = net > 0 ? "#2775CA" : net < 0 ? "#FF6B5E" : "#3DE8C7";
      label = net > 0 ? "you're owed" : net < 0 ? "you owe" : "all square";
      bigSign = net > 0 ? "+$" : net < 0 ? "−$" : "$";
    } else {
      eyebrow = "GROUP TOTAL";
      col = "#2B2118";
      label = "across this group";
      bigSign = "$";
      net = trip.totalCents || 0;
    }
    var bigCents = haveNet ? net : (trip.totalCents || 0);

    // owe bar — frame shows the owed/you-owe split (blue + soft-blue / coral)
    var bar;
    if (owed > 0 || owe > 0) {
      var yourOwe = (haveNet && net < 0) ? Math.abs(net) : 0;
      var owedToYou = (haveNet && net > 0) ? net : 0;
      var owedRest = Math.max(owed - owedToYou, 0);
      var fOwed = Math.max(Math.round(owedToYou / 100), owedToYou ? 1 : 0);
      var fRest = Math.max(Math.round(owedRest / 100), owedRest ? 1 : 0);
      var fOwe = Math.max(Math.round(owe / 100), owe ? 1 : 0);
      bar = '' +
      '<div style="position:relative; margin-top:18px;">' +
        '<div style="display:flex; gap:4px; height:16px; border-radius:9px; overflow:hidden;">' +
          (fOwed ? '<div style="flex:' + fOwed + '; background:#2775CA;"></div>' : "") +
          (fRest ? '<div style="flex:' + fRest + '; background:#2775CA; opacity:.7;"></div>' : "") +
          (fOwe ? '<div style="flex:' + fOwe + '; background:#FF6B5E;"></div>' : "") +
        '</div>' +
        '<div style="display:flex; justify-content:space-between; margin-top:9px;">' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:#2775CA;">＋ ' + plain(owed) + ' owed to you</span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:#FF6B5E;">− ' + plain(owe) + ' you owe</span>' +
        '</div>' +
      '</div>';
    } else {
      bar = '<div style="font-family:\'Space Mono\',monospace; font-size:12px; color:rgba(43,33,24,0.5); margin-top:14px;">no open tabs yet — start one below ✨</div>';
    }

    return '' +
    '<div style="padding:22px 22px 0;">' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.5);">' + eyebrow + '</span>' +
      '<div style="display:flex; align-items:baseline; gap:11px; margin-top:9px;">' +
        '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:46px; line-height:1; letter-spacing:-2px; color:' + col + '; text-shadow:none;"><span style="font-size:25px; opacity:.55;">' + bigSign + '</span>' + moneyParts(bigCents, "25px", ".55") + '</div>' +
        '<span style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(43,33,24,0.55);">' + label + '</span>' +
      '</div>' +
      bar +
      ((haveNet && net < 0) ? walletReadyChip(Math.abs(net)) : "") +
      pillRow() +
      outsideClaims(trip, me) +
      whoOwesWho(trip, me) +
      tabsFeed(trip, me) +
    '</div>';
  }

  // ---------- settled outside: pending "I paid you in cash" claims ----------
  // The creditor sees confirm ✓ / dispute ✗; the debtor sees a waiting strip
  // with cancel; everyone else sees a quiet info row. A pending claim never
  // moves a balance — only the creditor's confirm records the transfer.
  function outsideClaims(trip, me) {
    var claims = trip.settleOutside || [];
    if (!claims.length) return "";
    var meId = me && me.id;
    var rows = claims.map(function (c) {
      var fromYou = c.from === meId, toYou = c.to === meId;
      var what = "$" + ((c.amountCents || 0) / 100).toFixed(2) + " " + (c.methodPhrase || "");
      var note = c.note ? '<div style="font-family:\'General Sans\',sans-serif; font-size:12px; color:rgba(43,33,24,0.5); margin-top:3px;">“' + app.esc(c.note) + '”</div>' : "";
      if (toYou) {
        return '<div style="background:#FFFDF7; border:2px solid #2B2118; border-radius:16px; box-shadow:3px 4px 0 rgba(43,33,24,0.9); padding:14px 16px;">' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.42);">SETTLED OUTSIDE?</div>' +
          '<div style="font-family:\'General Sans\',sans-serif; font-size:14.5px; line-height:1.4; color:#2B2118; margin-top:7px;">' +
            app.esc((c.fromName || "someone").toLowerCase()) + ' says they paid you <b>' + app.esc(what.trim()) + '</b>' + note +
          '</div>' +
          '<div style="display:flex; gap:9px; margin-top:12px;">' +
            '<button type="button" class="gOutAct" data-cid="' + app.esc(c.id) + '" data-verb="confirm" style="appearance:none; border:2px solid #2B2118; cursor:pointer; flex:1; min-height:44px; border-radius:999px; background:#3DE8C7; font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:14.5px; color:#2B2118; box-shadow:2px 3px 0 rgba(43,33,24,0.85);">confirm ✓</button>' +
            '<button type="button" class="gOutAct" data-cid="' + app.esc(c.id) + '" data-verb="decline" style="appearance:none; cursor:pointer; flex:1; min-height:44px; border-radius:999px; background:transparent; border:1px solid rgba(43,33,24,0.18); font-family:\'General Sans\',sans-serif; font-weight:500; font-size:14.5px; color:rgba(43,33,24,0.7);">dispute ✗</button>' +
          '</div>' +
        '</div>';
      }
      if (fromYou) {
        return '<div style="display:flex; align-items:center; gap:10px; background:rgba(255,198,92,0.16); border:1.5px dashed rgba(43,33,24,0.3); border-radius:14px; padding:11px 14px;">' +
          '<span style="font-size:16px; flex:none;">⏳</span>' +
          '<span style="flex:1; font-family:\'General Sans\',sans-serif; font-size:13px; color:rgba(43,33,24,0.7);">waiting for ' + app.esc((c.toName || "them").toLowerCase()) + ' to confirm your ' + app.esc(what.trim()) + '</span>' +
          '<span class="gOutAct" data-cid="' + app.esc(c.id) + '" data-verb="cancel" role="button" tabindex="0" style="font-family:\'General Sans\',sans-serif; font-size:12.5px; color:rgba(43,33,24,0.5); cursor:pointer; text-decoration:underline; flex:none;">cancel</span>' +
        '</div>';
      }
      return '<div style="display:flex; align-items:center; gap:8px; padding:2px 4px;">' +
        '<span style="font-size:13px; flex:none;">💵</span>' +
        '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(43,33,24,0.5);">' +
          app.esc((c.fromName || "someone").toLowerCase()) + ' says they paid ' + app.esc((c.toName || "someone").toLowerCase()) + ' ' + app.esc(what.trim()) + ' · waiting</span>' +
      '</div>';
    }).join("");
    return '<div style="display:flex; flex-direction:column; gap:9px; margin-top:20px;">' + rows + '</div>';
  }

  // ---------- quick pills: 💬 chat · ✨ recap · ↗ share ----------
  function pillRow() {
    function pill(id, emoji, efs, label, bg, tilt) {
      return '<div id="' + id + '" style="flex:1; display:flex; align-items:center; justify-content:center; gap:6px; min-height:42px; border-radius:13px; background:' + bg + '; border:2px solid #2B2118; box-shadow:2px 3px 0 rgba(43,33,24,0.85); cursor:pointer; transform:rotate(' + tilt + 'deg);">' +
        '<span style="font-size:' + efs + ';">' + emoji + '</span>' +
        '<span style="font-family:\'General Sans\',sans-serif; font-size:13px; font-weight:600; color:#2B2118;">' + label + '</span></div>';
    }
    return '<div style="display:flex; gap:10px; margin-top:18px;">' +
      pill("gChat", "💬", "14px", "chat", "rgba(39,117,202,0.13)", -0.6) +
      pill("gRecap", "✨", "14px", "recap", "rgba(255,198,92,0.35)", 0.5) +
      pill("gShare", "↗", "13px", "share", "rgba(61,232,199,0.28)", -0.4) +
    '</div>';
  }

  // ---------- who owes who — simplified debts ----------
  // Prefer the server's simplified plan (trip.simplify): the same greedy
  // fewest-payments matching the settle flow executes, plus the "N payments
  // instead of M" savings. Falls back to a local greedy on old payloads.
  function simplifiedEdges(trip) {
    var s = trip.simplify;
    if (s && s.transfers) {
      return s.transfers.map(function (t) { return { from: t.from, to: t.to, cents: t.cents }; });
    }
    return settleEdges(trip.balances);
  }
  function settleEdges(balances) {
    var debtors = [], creditors = [];
    (balances || []).forEach(function (b) {
      if (b.cents < 0) debtors.push({ id: b.memberId, name: b.name, cents: -b.cents });
      else if (b.cents > 0) creditors.push({ id: b.memberId, name: b.name, cents: b.cents });
    });
    debtors.sort(function (a, b) { return b.cents - a.cents; });
    creditors.sort(function (a, b) { return b.cents - a.cents; });
    var edges = [], i = 0, j = 0, guard = 0;
    while (i < debtors.length && j < creditors.length && guard++ < 200) {
      var amt = Math.min(debtors[i].cents, creditors[j].cents);
      if (amt > 0) edges.push({ from: debtors[i].id, to: creditors[j].id, cents: amt });
      debtors[i].cents -= amt; creditors[j].cents -= amt;
      if (debtors[i].cents <= 0) i++;
      if (creditors[j].cents <= 0) j++;
    }
    return edges.slice(0, 6);
  }
  function arrowSvg() {
    return '<svg width="20" height="11" viewBox="0 0 26 14" fill="none" stroke="rgba(43,33,24,0.4)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 7h22m-5-5 5 5-5 5"/></svg>';
  }
  function whoOwesWho(trip, me) {
    var edges = simplifiedEdges(trip);
    if (!edges.length) return "";
    var meId = me && me.id;
    var rows = edges.map(function (e) {
      var fromM = memberById(trip, e.from), toM = memberById(trip, e.to);
      var fromYou = e.from === meId, toYou = e.to === meId;
      var fromName = fromYou ? "you" : fromM.name;
      var toName = toYou ? "you" : toM.name;
      // amount color: getting paid to you = blue, you paying out = coral, else blue
      var amtColor = toYou ? "#2775CA" : fromYou ? "#FF6B5E" : "#2775CA";
      var fromNameStyle = fromYou
        ? 'font-family:\'General Sans\',sans-serif; font-size:13px; color:rgba(43,33,24,0.5);'
        : 'font-family:\'General Sans\',sans-serif; font-size:14px; font-weight:500; color:#2B2118;';
      var toNameStyle = toYou
        ? 'font-family:\'General Sans\',sans-serif; font-size:13px; color:rgba(43,33,24,0.5);'
        : 'font-family:\'General Sans\',sans-serif; font-size:14px; font-weight:500; color:#2B2118;';
      // your payment → tappable: deep-links into settle pre-scoped to this person
      var payHint = fromYou
        ? '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:#FF6B5E; white-space:nowrap;">settle →</span>'
        : "";
      var rowAttrs = fromYou
        ? ' class="gSimpPay" data-to="' + app.esc(e.to) + '" role="button" tabindex="0"'
        : "";
      return '<div' + rowAttrs + ' style="display:flex; align-items:center; gap:10px; background:#FFFDF7; border:2px solid #2B2118; border-radius:14px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:11px 14px;' + (fromYou ? ' cursor:pointer;' : '') + '">' +
        gavatar(fromM, 28) +
        '<span style="' + fromNameStyle + '">' + app.esc(fromName) + '</span>' +
        arrowSvg() +
        gavatar(toM, 28) +
        '<span style="' + toNameStyle + '">' + app.esc(toName) + '</span>' +
        '<span style="flex:1; text-align:right; font-family:\'Space Mono\',monospace; font-weight:700; font-size:15px; color:' + amtColor + ';">' + plain(e.cents) + '</span>' +
        payHint +
      '</div>';
    }).join("");
    // "3 payments instead of 6" — the simplification badge (only when it saves)
    var s = trip.simplify;
    var badge = (s && s.summary && s.pairwiseCount > s.count)
      ? '<span style="display:inline-flex; align-items:center; gap:5px; background:rgba(61,232,199,0.22); border:1px solid rgba(61,232,199,0.55); border-radius:999px; padding:3px 10px;">' +
          '<span style="font-size:10px;">✨</span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:#1a9c80;">' + app.esc(s.summary.toUpperCase()) + '</span>' +
        '</span>'
      : "";
    return '' +
    '<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin:24px 0 11px;">' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.5);">WHO OWES WHO</span>' +
      badge +
    '</div>' +
    '<div style="display:flex; flex-direction:column; gap:9px;">' + rows + '</div>';
  }

  // ---------- tabs feed: each expense as a row (emoji + payer · split N · time + total + delta) ----------
  var EMOJI_BY_WORD = [
    [/din|food|lunch|brunch|eat|izakaya|ramen|noodle|sushi|pizza|burger|taco/, "🍜"],
    [/coffee|cafe|latte|espresso/, "☕"],
    [/beer|bar|drink|wine|cocktail|pub/, "🍻"],
    [/taxi|uber|lyft|cab|ride|car/, "🚕"],
    [/hotel|airbnb|stay|room|lodg/, "🏨"],
    [/flight|plane|air|train|bus/, "✈️"],
    [/grocer|market|store|shop/, "🛒"],
    [/ticket|show|movie|concert|game/, "🎟️"],
    [/gas|fuel/, "⛽"],
    [/rent|util/, "🏠"],
  ];
  function tabEmoji(title) {
    var t = String(title || "").toLowerCase();
    for (var i = 0; i < EMOJI_BY_WORD.length; i++) if (EMOJI_BY_WORD[i][0].test(t)) return EMOJI_BY_WORD[i][1];
    return "🧾";
  }
  function ago(iso) {
    if (!iso) return "";
    var ms = Date.now() - new Date(iso).getTime();
    if (!isFinite(ms) || ms < 0) return "";
    var m = Math.floor(ms / 60000);
    if (m < 1) return "now";
    if (m < 60) return m + "m";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h";
    return Math.floor(h / 24) + "d";
  }
  // an itemized expense carries an EXACT per-member breakdown — your share is
  // yours from the receipt (tip & tax proportional), not amount/n.
  function myShareOf(e, meId) {
    if (e.itemized && e.breakdown) {
      for (var i = 0; i < e.breakdown.length; i++) {
        if (e.breakdown[i].memberId === meId) return e.breakdown[i].cents;
      }
      return 0;
    }
    var n = (e.participants || []).length || 1;
    return Math.round((e.amountCents || 0) / n);
  }
  // your delta on this tab: +back if you paid, −share if you owe
  function tabDelta(e, me) {
    if (!me || !e.participants) return null;
    var share = myShareOf(e, me.id);
    var inSplit = e.participants.indexOf(me.id) >= 0;
    var youPaid = e.paidBy === me.id;
    if (youPaid) {
      var back = (e.amountCents || 0) - (inSplit ? share : 0);
      if (back > 0) return { cents: back, color: "#2775CA", sign: "+$" };
    } else if (inSplit && share > 0) {
      return { cents: share, color: "#FF6B5E", sign: "−$" };
    }
    return null;
  }
  function tabRow(e, me) {
    var n = (e.participants || []).length || 1;
    var t = ago(e.createdAt);
    // settled-outside transfers are money history, not spending — render them
    // distinctly ("settled in cash 💵 · confirmed") and keep them un-tappable.
    if (e.kind === "transfer") {
      var toName = ((e.participantNames && e.participantNames[0]) || "someone").toLowerCase();
      return '<div style="display:flex; align-items:center; gap:13px; background:rgba(61,232,199,0.10); border:1.5px dashed rgba(23,162,119,0.5); border-radius:16px; padding:12px 15px;">' +
        '<div style="width:42px; height:42px; border-radius:13px; background:rgba(61,232,199,0.22); display:flex; align-items:center; justify-content:center; font-size:20px; flex:none;">💵</div>' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#17A277; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(e.title || "settled outside") + '</div>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(43,33,24,0.55); margin-top:3px;">' +
            app.esc((e.paidByName || "someone").toLowerCase()) + ' paid ' + app.esc(toName) + ' · confirmed ✓' + (t ? ' · ' + t : "") +
          '</div>' +
        '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:16px; color:#17A277;">' + plain(e.amountCents || 0) + '</div>' +
      '</div>';
    }
    var d = tabDelta(e, me);
    var delta = d
      ? '<div style="font-family:\'Space Mono\',monospace; font-size:9px; color:' + d.color + '; margin-top:2px;">' + d.sign + (d.cents / 100).toFixed(2) + '</div>'
      : "";
    return '' +
    '<div class="gTab" data-eid="' + app.esc(e.id) + '" style="display:flex; align-items:center; gap:13px; background:#FFFDF7; border:2px solid #2B2118; border-radius:16px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:13px 15px; cursor:pointer;">' +
      '<div style="width:42px; height:42px; border-radius:13px; background:#F7F1E3; display:flex; align-items:center; justify-content:center; font-size:21px; flex:none;">' + tabEmoji(e.title) + '</div>' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="display:flex; align-items:center; gap:7px;"><span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:500; font-size:16px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(e.title || "a tab") + '</span></div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(43,33,24,0.6); margin-top:3px;">' +
          app.esc((e.paidByName || "someone").toLowerCase()) + ' paid · ' +
          (e.itemized ? '<span style="color:#2775CA;">itemized 🧾</span> · ' + n : 'split ' + n) + (t ? ' · ' + t : "") +
          (e.dueAt ? ' · <span style="color:' + (e.overdue ? "#FF6B5E" : "#2775CA") + ';">' + (e.overdue ? "overdue" : "due " + app.esc(dueLabel(e.dueAt))) + ' 🗓️</span>' : "") +
        '</div>' +
      '</div>' +
      '<div style="text-align:right;">' +
        '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:16px; color:#2B2118;">' + plain(e.amountCents || 0) + '</div>' +
        delta +
      '</div>' +
    '</div>';
  }
  function tabsFeed(trip, me) {
    var exp = (trip.expenses || []).slice().sort(function (a, b) {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
    if (!exp.length) {
      return '<div style="display:flex; flex-direction:column; align-items:center; text-align:center; padding:30px 20px 6px; gap:8px;">' +
        app.mascot({ size: 90, mood: "happy" }) +
        '<div style="font-family:\'Clash Display\',sans-serif; font-weight:600; font-size:18px;">no tabs yet</div>' +
        '<div style="color:rgba(43,33,24,0.6); font-size:14px;">add the first one and start splitting 🎉</div>' +
      '</div>';
    }
    var header = '<div style="display:flex; align-items:center; justify-content:space-between; margin:24px 0 11px;">' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.5);">TABS</span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:rgba(43,33,24,0.4);">' + exp.length + ' TOTAL</span>' +
    '</div>';
    return header + '<div style="display:flex; flex-direction:column; gap:9px;">' + exp.map(function (e) { return tabRow(e, me); }).join("") + '</div>';
  }

  // ---------- sticky bottom: settle up + add a tab ----------
  function stickyBar() {
    return '' +
    '<div style="position:fixed; left:0; right:0; bottom:0; z-index:40; padding:12px 18px calc(12px + env(safe-area-inset-bottom)); background:linear-gradient(180deg, rgba(247,241,227,0) 0%, #F7F1E3 26%); display:flex; gap:11px; max-width:520px; margin:0 auto;">' +
      '<button id="gSettle" style="appearance:none; cursor:pointer; flex:none; width:128px; min-height:54px; border-radius:999px; background:transparent; border:1px solid rgba(43,33,24,0.18); font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#2B2118;">settle up</button>' +
      '<button id="gAdd" style="appearance:none; border:none; cursor:pointer; flex:1; min-height:54px; border-radius:999px; background:#2775CA; border:2px solid #2B2118; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' +
        '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff;">add a tab</span>' +
      '</button>' +
    '</div>';
  }

  // ====================== FRAME 2 · tab detail (app.sheet) ======================
  function openTab(trip, e, me) {
    var n = (e.participants || []).length || 1;
    var each = Math.round((e.amountCents || 0) / n);
    var meId = me && me.id;
    var youOwe = 0;
    var isItemized = !!(e.itemized && e.breakdown);
    // exact per-member cents for an itemized expense (memberId -> cents)
    var bd = {};
    if (isItemized) e.breakdown.forEach(function (b) { bd[b.memberId] = b.cents; });
    var shareOf = function (pid) { return isItemized ? (bd[pid] || 0) : each; };

    // meta line: "maya paid · jun 22" (frame shows IZAKAYA · SHIBUYA above; we
    // surface the payer/date there since the api has no venue).
    var when = "";
    if (e.createdAt) {
      try { when = " · " + new Date(e.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toLowerCase(); } catch (_) {}
    }
    var payerName = (e.paidByName || "someone").toLowerCase();
    var payerM = memberById(trip, e.paidBy);
    var subline = (e.fxNote ? e.fxNote.toUpperCase()
      : isItemized ? "itemized 🧾 · who had what"
      : "split " + n + " · " + plain(each) + " each").toUpperCase();

    // per-person split rows with PAID / SQUARED / "you owe 👀" tags
    var rowsHtml = (e.participants || []).map(function (pid, idx) {
      var pm = memberById(trip, pid);
      var name = (e.participantNames && e.participantNames[idx]) || pm.name || pid;
      var isYou = pid === meId;
      var isPayer = pid === e.paidBy; // payer fronted the money
      var each = shareOf(pid);
      var amtColor, tag;
      if (isPayer) {
        amtColor = "rgba(43,33,24,0.85)";
        tag = '<span style="display:inline-flex; align-items:center; gap:4px; flex:none; white-space:nowrap; background:rgba(39,117,202,0.16); border:1px solid rgba(39,117,202,0.5); border-radius:999px; padding:3px 9px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#2775CA" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:#2775CA;">PAID</span></span>';
      } else if (isYou) {
        youOwe = each;
        amtColor = "#FF6B5E";
        tag = '<span style="display:inline-flex; align-items:center; gap:4px; flex:none; white-space:nowrap; background:rgba(255,107,94,0.14); border:1px solid rgba(255,107,94,0.5); border-radius:999px; padding:3px 9px;"><span style="font-size:9px;">👀</span><span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:#FF6B5E;">YOU OWE</span></span>';
      } else {
        amtColor = "#2775CA";
        tag = '<span style="display:inline-flex; align-items:center; gap:4px; flex:none; white-space:nowrap; background:rgba(39,117,202,0.16); border:1px solid rgba(39,117,202,0.5); border-radius:999px; padding:3px 9px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#2775CA" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:#2775CA;">SQUARED</span></span>';
      }

      var avatar = '<div style="width:34px; height:34px; border-radius:50%; background:' + memberGrad(pm) + '; display:flex; align-items:center; justify-content:center; font-size:17px; flex:none;">' + memberEmoji(pm) + '</div>';

      if (isYou) {
        // highlighted "you owe" row
        return '<div style="display:flex; align-items:center; gap:11px; padding:11px 8px; margin:4px -4px 0; border-radius:13px; background:rgba(255,107,94,0.07); border:1px solid rgba(255,107,94,0.22);">' +
          avatar +
          '<span style="flex:1; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#2B2118;">you</span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:14px; color:' + amtColor + ';">' + plain(each) + '</span>' +
          tag +
        '</div>';
      }
      return '<div style="display:flex; align-items:center; gap:11px; padding:9px 4px;">' +
          avatar +
          '<span style="flex:1; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#2B2118;">' + app.esc(name) + '</span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:14px; color:' + amtColor + ';">' + plain(each) + '</span>' +
          tag +
        '</div>' +
        '<div style="height:1px; background:rgba(43,33,24,0.06); margin:0 4px;"></div>';
    }).join("");

    var settleBtn = youOwe > 0
      ? '<button id="gTabSettle" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:56px; border-radius:999px; background:linear-gradient(120deg,#FF8A7E,#FF6B5E); display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:3px 3px 0 rgba(43,33,24,0.9); margin-top:14px;">' +
          '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#fff;">settle your ' + plain(youOwe) + '</span>' +
        '</button>'
      : '<button id="gTabSettle" style="appearance:none; cursor:pointer; width:100%; min-height:56px; border-radius:999px; background:transparent; border:1px solid rgba(43,33,24,0.18); font-family:\'General Sans\',sans-serif; font-weight:500; font-size:16px; color:#2B2118; margin-top:14px;">settle up</button>';

    var html = '' +
    '<div style="margin:0 -20px;">' +
      // receipt sheet
      '<div style="position:relative; background:#FFFDF7; border-radius:24px; border:2px solid #2B2118; box-shadow:3px 4px 0 rgba(43,33,24,0.85); overflow:hidden; margin:0 20px;">' +
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 88% 4%, rgba(255,255,255,0.045) 0 1px, transparent 1px 8px); opacity:.7; pointer-events:none;"></div>' +
        '<div style="position:absolute; left:0; right:0; top:0; height:5px; background:linear-gradient(90deg,#2775CA,#3DE8C7);"></div>' +
        // head
        '<div style="position:relative; padding:24px 22px 16px; text-align:center;">' +
          '<div style="width:60px; height:60px; border-radius:18px; background:#F7F1E3; display:flex; align-items:center; justify-content:center; font-size:30px; margin:0 auto;">' + tabEmoji(e.title) + '</div>' +
          '<h2 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:22px; letter-spacing:-0.3px; margin:13px 0 0; color:#2B2118;">' + app.esc(e.title || "a tab") + '</h2>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:10.5px; letter-spacing:1px; color:rgba(43,33,24,0.5); margin-top:4px;">' + app.esc(subline) + '</div>' +
          '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:46px; line-height:1; letter-spacing:-2px; color:#2B2118; margin-top:16px;"><span style="font-size:25px; opacity:.5;">$</span>' + moneyParts(e.amountCents || 0, "25px", ".5") + '</div>' +
          '<div style="display:inline-flex; align-items:center; gap:8px; margin-top:12px; background:#F7F1E3; border:1px solid rgba(43,33,24,0.09); border-radius:999px; padding:5px 12px;">' +
            '<div style="width:20px; height:20px; border-radius:50%; background:' + memberGrad(payerM) + '; display:flex; align-items:center; justify-content:center; font-size:11px;">' + memberEmoji(payerM) + '</div>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:rgba(43,33,24,0.7);">' + app.esc(payerName + " paid" + when) + '</span>' +
          '</div>' +
        '</div>' +
        // perforation
        '<div style="position:relative; height:1px; margin:6px 0 0; border-top:1.5px dashed rgba(43,33,24,0.14);"><div style="position:absolute; left:-9px; top:-9px; width:18px; height:18px; border-radius:50%; background:#F7F1E3;"></div><div style="position:absolute; right:-9px; top:-9px; width:18px; height:18px; border-radius:50%; background:#F7F1E3;"></div></div>' +
        // itemized: the receipt lines (qty× label · who had it · price) + the
        // "everything else" strip (tip & tax, split by what each person had)
        (isItemized ?
          '<div style="position:relative; padding:8px 16px 0;">' +
            '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:1.5px; color:rgba(43,33,24,0.42); padding:8px 4px 4px;">WHO HAD WHAT 🧾</div>' +
            (e.items || []).map(function (it) {
              var qty = it.qty > 1 ? it.qty + '× ' : '';
              var who = (it.names || []).map(function (nm, wi) {
                var mid = (it.memberIds || [])[wi];
                return mid === meId ? "you" : String(nm || "").toLowerCase();
              }).join(", ");
              return '<div style="display:flex; align-items:baseline; gap:10px; padding:6px 4px;">' +
                '<div style="flex:1; min-width:0;">' +
                  '<div style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:14px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + qty + app.esc(it.label || "item") + '</div>' +
                  '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.3px; color:' + (who ? 'rgba(43,33,24,0.5)' : 'rgba(255,107,94,0.8)') + ';">' + (who ? app.esc(who) : "unassigned → tip &amp; tax pot") + '</div>' +
                '</div>' +
                '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:13px; color:#2B2118; flex:none;">' + plain(it.cents || 0) + '</span>' +
              '</div>';
            }).join("") +
            '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:4px; padding:8px 10px; background:rgba(39,117,202,0.07); border:1.5px dashed rgba(39,117,202,0.4); border-radius:11px;">' +
              '<span style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.5px; color:rgba(43,33,24,0.55);">INCL. TIP &amp; TAX — SPLIT BY WHAT YOU HAD</span>' +
              '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:12px; color:#2775CA; flex:none;">' + plain(e.extrasCents || 0) + '</span>' +
            '</div>' +
          '</div>' : '') +
        // per-person
        '<div style="position:relative; padding:8px 16px 16px;">' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:1.5px; color:rgba(43,33,24,0.42); padding:8px 4px 4px;">' +
            (isItemized ? 'EACH PERSON OWES · EXACT' : 'SPLIT ' + n + ' · ' + plain(each) + ' EACH') + '</div>' +
          rowsHtml +
        '</div>' +
      '</div>' +
      // reactions (server-backed; injected as a live node after app.sheet)
      '<div id="gTabReacts"></div>' +
      // actions
      '<div style="margin:0 20px;">' + settleBtn + '</div>' +
      '<div style="display:flex; align-items:center; justify-content:center; gap:22px; margin-top:14px;">' +
        // itemized expenses can't be partially edited (exact per-person shares
        // would desync from the items) — delete & re-add instead.
        (isItemized ? '' :
          '<span id="gTabEdit" style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(43,33,24,0.5); cursor:pointer;">edit</span>' +
          '<span style="width:3px; height:3px; border-radius:50%; background:rgba(43,33,24,0.3);"></span>') +
        '<span id="gTabDelete" style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(43,33,24,0.5); cursor:pointer;">delete</span>' +
      '</div>' +
    '</div>';

    app.sheet(html);

    var reactsHost = document.getElementById("gTabReacts");
    if (reactsHost && e && e.id) reactsHost.appendChild(reactionRowEl(trip.id, "exp:" + e.id));

    var s = document.getElementById("gTabSettle");
    if (s) s.onclick = function () { app.closeSheet(); location.hash = "#/settle/" + encodeURIComponent(trip.id); };
    var edit = document.getElementById("gTabEdit");
    if (edit) edit.onclick = function () {
      app.closeSheet();
      // Hand the expense to the form so it opens pre-filled for editing instead
      // of as a blank "add" (which looked like it lost your data).
      try { if (e && e.id) sessionStorage.setItem("divvy.editExpense", JSON.stringify({ tripId: trip.id, id: e.id })); } catch (_) {}
      location.hash = "#/new/" + encodeURIComponent(trip.id);
    };
    var del = document.getElementById("gTabDelete");
    if (del) {
      var armed = false, armTimer = null;
      del.onclick = function () {
        if (!armed) {
          // first tap: arm + give a way back, so a single tap can't nuke a tab.
          armed = true;
          del.textContent = "tap again to delete";
          del.style.color = "#FF6B5E";
          armTimer = setTimeout(function () { armed = false; del.textContent = "delete"; del.style.color = "rgba(43,33,24,0.5)"; }, 3000);
          return;
        }
        if (armTimer) clearTimeout(armTimer);
        del.textContent = "deleting…";
        app.api.del("/api/trips/" + encodeURIComponent(trip.id) + "/expenses/" + encodeURIComponent(e.id))
          .then(function () { app.closeSheet(); app.toast("tab deleted"); load(view_, trip.id); })
          .catch(function (err) { app.toast(err.message); del.textContent = "delete"; del.style.color = "rgba(43,33,24,0.5)"; armed = false; });
      };
    }
  }

  // ====================== group settings (app.sheet) ======================
  // the group emoji palette (chosen emoji is highlighted; current is included)
  var GROUP_EMOJI = ["🧾", "🍜", "🏝️", "🎟️", "🏠", "🚗", "🍻", "⛺", "🎉", "🌮", "✈️", "🛒"];

  // a member can be removed only with a clean money history: zero balance AND
  // absent from every expense (mirrors the server's 409 guard).
  function memberRemovable(trip, m) {
    var bal = null;
    (trip.balances || []).forEach(function (b) { if (b.memberId === m.id) bal = b; });
    if (bal && bal.cents !== 0) return false;
    var exps = trip.expenses || [];
    for (var i = 0; i < exps.length; i++) {
      var e = exps[i];
      if (e.paidBy === m.id) return false;
      if ((e.participants || []).indexOf(m.id) >= 0) return false;
    }
    return true;
  }

  function openSettings(trip) {
    var me = findMe(trip);
    var cur = groupEmoji(trip);
    var emojiPool = GROUP_EMOJI.slice();
    if (emojiPool.indexOf(cur) < 0) emojiPool.unshift(cur);

    var emojiChips = emojiPool.map(function (em) {
      var on = em === cur;
      return '<button class="gsEmoji" data-em="' + app.esc(em) + '" style="appearance:none; cursor:pointer; width:44px; height:44px; border-radius:13px; background:' +
        (on ? "#3DE8C7" : "#FFFDF7") + '; border:2px solid #2B2118; box-shadow:' + (on ? "3px 4px 0 rgba(43,33,24,0.85)" : "2px 3px 0 rgba(43,33,24,0.85)") +
        '; font-size:22px; display:flex; align-items:center; justify-content:center; flex:none;">' + em + '</button>';
    }).join("");

    var memberRows = (trip.members || []).map(function (m) {
      var canRemove = memberRemovable(trip, m);
      var isMe = me && m.id === me.id;
      var right;
      if (canRemove) {
        right = '<button class="gsRemove" data-mid="' + app.esc(m.id) + '" data-name="' + app.esc(m.name || "") + '" ' +
          'style="appearance:none; cursor:pointer; border:1px solid rgba(255,107,94,0.5); background:rgba(255,107,94,0.1); color:#FF6B5E; border-radius:999px; padding:5px 12px; font-family:\'General Sans\',sans-serif; font-weight:600; font-size:12.5px; flex:none;">remove</button>';
      } else {
        right = '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(43,33,24,0.5); text-align:right; flex:none; white-space:nowrap;">in a tab</span>';
      }
      return '<div style="display:flex; align-items:center; gap:11px; padding:9px 2px;">' +
        gavatar(m, 32) +
        '<span style="flex:1; min-width:0; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' +
          app.esc(m.name || "someone") + (isMe ? ' <span style="color:rgba(43,33,24,0.4); font-size:12px;">· you</span>' : "") + '</span>' +
        right +
      '</div>';
    }).join("");

    var archived = !!trip.archived;
    var archiveLabel = archived ? "unarchive group" : "archive group";

    // am I owed money here? (auto-remind is a creditor-only control)
    var myNet = 0;
    if (me) (trip.balances || []).forEach(function (b) { if (b.memberId === me.id) myNet = b.cents; });
    var minDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    var maxDate = new Date(Date.now() + 364 * 86400000).toISOString().slice(0, 10);
    var dueVal = trip.dueAt ? String(trip.dueAt).slice(0, 10) : "";
    var dueSection =
      '<label style="display:block; margin-top:18px; font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1px; color:rgba(43,33,24,0.5);">SETTLE BY</label>' +
      '<div style="display:flex; gap:8px; margin-top:8px; align-items:center;">' +
        '<input id="gsDue" type="date" value="' + app.esc(dueVal) + '" min="' + minDate + '" max="' + maxDate + '" ' +
          'style="flex:1; min-height:44px; padding:8px 14px; border-radius:13px; background:#FBF6EA; border:1px solid rgba(43,33,24,0.12); outline:none; font-family:\'Space Mono\',monospace; font-size:14px; color:#2B2118;">' +
        '<button id="gsDueSave" style="appearance:none; border:2px solid #2B2118; cursor:pointer; padding:0 16px; min-height:44px; border-radius:12px; background:#FFC65C; font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:14px; color:#2B2118; box-shadow:2px 3px 0 rgba(43,33,24,0.85);">set</button>' +
        (dueVal ? '<span id="gsDueClear" role="button" tabindex="0" style="font-family:\'General Sans\',sans-serif; font-size:12.5px; color:rgba(43,33,24,0.5); cursor:pointer; text-decoration:underline; flex:none;">clear</span>' : '') +
      '</div>' +
      '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.3px; color:rgba(43,33,24,0.35); margin-top:6px;">the group\'s "square up by" date — chips turn coral when it passes</div>';
    // mochi auto-remind: shown only when the viewer is owed money (creditor).
    var CADENCES = [
      ["off", "off", "mochi stays out of it"],
      ["gentle", "gentle 🌱", "a reminder every 5 days · very polite"],
      ["standard", "standard 🐸", "every 3 days · friendly but firm"],
      ["spicy", "spicy 🌶️", "daily. mochi shows no mercy"],
    ];
    var remindSection = (me && myNet > 0)
      ? '<label style="display:block; margin-top:18px; font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1px; color:rgba(43,33,24,0.5);">MOCHI AUTO-REMINDS WHO OWES YOU</label>' +
        '<div id="gsCadRow" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:9px;">' +
          CADENCES.map(function (c) {
            return '<button type="button" class="gsCad" data-c="' + c[0] + '" disabled style="appearance:none; cursor:pointer; padding:0 13px; min-height:38px; border-radius:999px; background:#FFFDF7; border:1px solid rgba(43,33,24,0.16); color:rgba(43,33,24,0.6); font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:13.5px; opacity:.55;">' + c[1] + '</button>';
          }).join("") +
        '</div>' +
        '<div id="gsCadHint" style="font-family:\'General Sans\',sans-serif; font-size:12px; color:rgba(43,33,24,0.5); margin-top:8px; min-height:16px;">loading…</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.3px; color:rgba(43,33,24,0.35); margin-top:4px;">starts after the settle-by date · pauses on "i paid you" claims · caps at the duck 🦆</div>'
      : "";

    // household: move-in / move-out dates per member (day granularity) — a
    // mid-month move prorates that month's recurring bills in the hub.
    var isHousehold = trip.kind === "household";
    var residencySection = isHousehold
      ? '<label style="display:block; margin-top:18px; font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1px; color:rgba(43,33,24,0.5);">MOVE-IN / MOVE-OUT 🏠</label>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.3px; color:rgba(43,33,24,0.35); margin-top:4px;">a mid-month move prorates that month\'s bills by days lived here</div>' +
        '<div style="margin-top:8px; border:2px solid #2B2118; border-radius:16px; background:#FFFDF7; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:10px 12px;">' +
          (trip.members || []).map(function (m, i) {
            var inVal = m.movedInAt ? String(m.movedInAt).slice(0, 10) : "";
            var outVal = m.movedOutAt ? String(m.movedOutAt).slice(0, 10) : "";
            return '<div style="padding:8px 0;' + (i ? " border-top:1px dashed rgba(43,33,24,0.1);" : "") + '">' +
              '<div style="display:flex; align-items:center; gap:9px;">' + gavatar(m, 26) +
                '<span style="flex:1; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:14px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(m.name || "someone") + '</span>' +
                (outVal ? '<span style="font-family:\'Space Mono\',monospace; font-size:8.5px; letter-spacing:.5px; color:#FF6B5E; flex:none;">MOVED OUT</span>' : "") +
              '</div>' +
              '<div style="display:flex; gap:8px; margin-top:7px;">' +
                '<label style="flex:1; display:block;"><span style="display:block; font-family:\'Space Mono\',monospace; font-size:8px; letter-spacing:1px; color:rgba(43,33,24,0.42);">MOVED IN</span>' +
                  '<input type="date" class="gsResIn" data-mid="' + app.esc(m.id) + '" value="' + app.esc(inVal) + '" style="width:100%; min-height:38px; margin-top:3px; padding:5px 9px; border-radius:10px; background:#FBF6EA; border:1px solid rgba(43,33,24,0.12); outline:none; font-family:\'Space Mono\',monospace; font-size:12px; color:#2B2118;"></label>' +
                '<label style="flex:1; display:block;"><span style="display:block; font-family:\'Space Mono\',monospace; font-size:8px; letter-spacing:1px; color:rgba(43,33,24,0.42);">MOVED OUT</span>' +
                  '<input type="date" class="gsResOut" data-mid="' + app.esc(m.id) + '" value="' + app.esc(outVal) + '" style="width:100%; min-height:38px; margin-top:3px; padding:5px 9px; border-radius:10px; background:#FBF6EA; border:1px solid rgba(43,33,24,0.12); outline:none; font-family:\'Space Mono\',monospace; font-size:12px; color:#2B2118;"></label>' +
              '</div>' +
            '</div>';
          }).join("") +
        '</div>'
      : "";

    var html = '' +
      '<h2 class="lower" style="font-size:22px; margin:2px 0 14px;">group settings</h2>' +
      // rename
      '<label style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1px; color:rgba(43,33,24,0.5);">NAME</label>' +
      '<div style="display:flex; gap:8px; margin-top:8px;">' +
        '<input class="input" id="gsName" autocomplete="off" style="flex:1;" value="' + app.esc(trip.name || "") + '" placeholder="group name">' +
        '<button id="gsSave" style="appearance:none; border:2px solid #2B2118; cursor:pointer; padding:0 16px; border-radius:12px; background:#FFC65C; font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:14px; color:#2B2118; box-shadow:2px 3px 0 rgba(43,33,24,0.85);">save</button>' +
      '</div>' +
      // emoji
      '<label style="display:block; margin-top:18px; font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1px; color:rgba(43,33,24,0.5);">EMOJI</label>' +
      '<div id="gsEmojiRow" style="display:flex; flex-wrap:wrap; gap:9px; margin-top:9px;">' + emojiChips + '</div>' +
      // settle-by date + mochi auto-remind
      dueSection +
      remindSection +
      // members
      '<label style="display:block; margin-top:20px; font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1px; color:rgba(43,33,24,0.5);">MEMBERS</label>' +
      '<div style="margin-top:6px; border:2px solid #2B2118; border-radius:16px; background:#FFFDF7; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:6px 12px;">' + memberRows + '</div>' +
      // household residency (move-in / move-out) — household groups only
      residencySection +
      // household on/off — unlocks the "this month" bills hub on this screen
      '<button id="gsHouse" style="appearance:none; cursor:pointer; width:100%; margin-top:18px; min-height:48px; border-radius:14px; background:' + (isHousehold ? "transparent" : "rgba(61,232,199,0.16)") + '; border:' + (isHousehold ? "1px solid rgba(43,33,24,0.18)" : "2px solid #2B2118") + ';' + (isHousehold ? "" : " box-shadow:2px 3px 0 rgba(43,33,24,0.85);") + ' display:flex; align-items:center; justify-content:center; gap:8px; font-family:\'General Sans\',sans-serif; font-weight:600; font-size:15px; color:#2B2118;"><span style="font-size:16px;">🏠</span> ' + (isHousehold ? "not a household anymore" : "make this a household") + '</button>' +
      (isHousehold ? "" : '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.3px; color:rgba(43,33,24,0.35); margin-top:6px; text-align:center;">roommates? get rent, utilities &amp; shared subs in one monthly view</div>') +
      // chat (keep the old ⋯ → chat path alive)
      '<button id="gsChat" style="appearance:none; cursor:pointer; width:100%; margin-top:11px; min-height:48px; border-radius:14px; background:rgba(39,117,202,0.1); border:2px solid #2B2118; box-shadow:2px 3px 0 rgba(43,33,24,0.85); display:flex; align-items:center; justify-content:center; gap:8px; font-family:\'General Sans\',sans-serif; font-weight:600; font-size:15px; color:#2B2118;"><span style="font-size:16px;">💬</span> open chat</button>' +
      // archive
      '<button id="gsArchive" style="appearance:none; cursor:pointer; width:100%; margin-top:11px; min-height:48px; border-radius:14px; background:transparent; border:1px solid rgba(255,107,94,0.6); color:#FF6B5E; font-family:\'General Sans\',sans-serif; font-weight:600; font-size:15px;">' + archiveLabel + '</button>';

    var el = app.sheet(html);

    // settle-by date — PATCH dueAt (server validates: future, ≤ 1 year)
    function saveDue(v) {
      app.api.patch("/api/trips/" + encodeURIComponent(trip.id), { dueAt: v })
        .then(function (fresh) {
          app.haptic && app.haptic(15);
          app.toast(v ? "settle-by date set 🗓️" : "due date cleared");
          app.closeSheet();
          paint(view_, fresh);
        })
        .catch(function (err) { app.toast((err && err.message) || "couldn't set that date"); });
    }
    var dueSave = el.querySelector("#gsDueSave");
    if (dueSave) dueSave.onclick = function () {
      var inp = el.querySelector("#gsDue");
      var v = inp && inp.value;
      if (!v) { app.toast("pick a date first"); return; }
      dueSave.disabled = true; dueSave.textContent = "…";
      saveDue(v);
    };
    var dueClear = el.querySelector("#gsDueClear");
    if (dueClear) dueClear.onclick = function () { saveDue(null); };

    // mochi auto-remind cadence (creditor only) — hydrate then wire the chips
    var cadHint = el.querySelector("#gsCadHint");
    var cadChips = el.querySelectorAll(".gsCad");
    function paintCad(cur) {
      Array.prototype.forEach.call(cadChips, function (c) {
        var on = c.getAttribute("data-c") === cur;
        c.disabled = false;
        c.style.opacity = "1";
        c.style.background = on ? "rgba(61,232,199,0.2)" : "#FFFDF7";
        c.style.border = on ? "2px solid #17A277" : "1px solid rgba(43,33,24,0.16)";
        c.style.color = on ? "#17A277" : "rgba(43,33,24,0.6)";
      });
      if (cadHint) {
        for (var i = 0; i < CADENCES.length; i++) if (CADENCES[i][0] === cur) cadHint.textContent = CADENCES[i][2];
      }
    }
    if (cadChips.length) {
      app.api.get("/api/autonudge/trip/" + encodeURIComponent(trip.id))
        .then(function (r) {
          var cur = (r && r.mine && r.mine.cadence) || "off";
          paintCad(cur);
          if (cadHint && r && r.mine && r.mine.sendCount) {
            cadHint.textContent += " · " + r.mine.sendCount + " sent so far";
          }
        })
        .catch(function () { paintCad("off"); });
      Array.prototype.forEach.call(cadChips, function (chip) {
        chip.onclick = function () {
          var c = chip.getAttribute("data-c") || "off";
          app.api.put("/api/autonudge/trip/" + encodeURIComponent(trip.id), { cadence: c })
            .then(function (r) {
              app.haptic && app.haptic(15);
              paintCad((r && r.cadence) || c);
              app.toast(c === "off" ? "mochi stands down" : "set & forget — mochi's on it 🐸");
            })
            .catch(function (err) { app.toast((err && err.message) || "couldn't set that"); });
        };
      });
    }

    // rename
    var nameInp = el.querySelector("#gsName");
    var saveBtn = el.querySelector("#gsSave");
    if (saveBtn) saveBtn.onclick = function () {
      var v = (nameInp.value || "").trim();
      if (!v) { app.toast("give it a name"); nameInp.focus(); return; }
      if (v === trip.name) { app.toast("that's already the name"); return; }
      saveBtn.disabled = true; saveBtn.textContent = "…";
      app.api.patch("/api/trips/" + encodeURIComponent(trip.id), { name: v })
        .then(function (fresh) {
          app.haptic && app.haptic(20);
          app.toast("renamed ✨");
          app.closeSheet();
          paint(view_, fresh);
        })
        .catch(function (err) { saveBtn.disabled = false; saveBtn.textContent = "save"; app.toast((err && err.message) || "couldn't rename"); });
    };

    // emoji picker — set live, keep the sheet open so you can try a few
    Array.prototype.forEach.call(el.querySelectorAll(".gsEmoji"), function (btn) {
      btn.onclick = function () {
        var em = btn.getAttribute("data-em");
        app.api.patch("/api/trips/" + encodeURIComponent(trip.id), { emoji: em })
          .then(function (fresh) {
            app.haptic && app.haptic(15);
            trip.emoji = fresh.emoji || em;
            // re-highlight in the sheet
            Array.prototype.forEach.call(el.querySelectorAll(".gsEmoji"), function (b) {
              var on = b.getAttribute("data-em") === em;
              b.style.background = on ? "#3DE8C7" : "#FFFDF7";
              b.style.boxShadow = on ? "3px 4px 0 rgba(43,33,24,0.85)" : "2px 3px 0 rgba(43,33,24,0.85)";
            });
            // live-update the header emoji
            var hdr = document.getElementById("gEmoji");
            if (hdr) hdr.textContent = trip.emoji;
          })
          .catch(function (err) { app.toast((err && err.message) || "couldn't set emoji"); });
      };
    });

    // remove member
    Array.prototype.forEach.call(el.querySelectorAll(".gsRemove"), function (btn) {
      btn.onclick = function () {
        var mid = btn.getAttribute("data-mid");
        var nm = btn.getAttribute("data-name") || "them";
        btn.disabled = true; btn.textContent = "…";
        app.api.del("/api/trips/" + encodeURIComponent(trip.id) + "/members/" + encodeURIComponent(mid))
          .then(function (fresh) {
            app.haptic && app.haptic(20);
            app.toast("removed " + nm.toLowerCase());
            app.closeSheet();
            paint(view_, fresh);
          })
          .catch(function (err) {
            btn.disabled = false; btn.textContent = "remove";
            // 409 → they're in the money history
            app.toast((err && err.message) || "couldn't remove them");
          });
      };
    });

    // household on/off — PATCH the flag, then reload so the hub (dis)appears
    var houseBtn = el.querySelector("#gsHouse");
    if (houseBtn) houseBtn.onclick = function () {
      houseBtn.disabled = true; houseBtn.textContent = "…";
      app.api.patch("/api/trips/" + encodeURIComponent(trip.id) + "/household", { household: !isHousehold })
        .then(function () {
          app.haptic && app.haptic([20, 30, 20]);
          app.toast(isHousehold ? "back to a plain group" : "it's a household now 🏠");
          app.closeSheet();
          load(view_, trip.id);
        })
        .catch(function (err) {
          houseBtn.disabled = false;
          houseBtn.textContent = isHousehold ? "🏠 not a household anymore" : "🏠 make this a household";
          app.toast((err && err.message) || ((err && err.status === 401) ? "sign in first" : "couldn't update"));
        });
    };

    // residency dates — save on change (PATCH …/members/:mid/residency); the
    // server validates dates + out-not-before-in and we repaint from truth.
    function wireResidency(cls, field) {
      Array.prototype.forEach.call(el.querySelectorAll(cls), function (inp) {
        inp.onchange = function () {
          var mid = inp.getAttribute("data-mid");
          var body = {};
          body[field] = inp.value || null;
          inp.disabled = true;
          app.api.patch("/api/trips/" + encodeURIComponent(trip.id) + "/members/" + encodeURIComponent(mid) + "/residency", body)
            .then(function (r) {
              inp.disabled = false;
              app.haptic && app.haptic(15);
              app.toast(inp.value ? "dates saved 🏠" : "date cleared");
              // keep local truth so the next repaint of this sheet is right
              (trip.members || []).forEach(function (m) {
                if (m.id === mid && r && r.member) { m.movedInAt = r.member.movedInAt; m.movedOutAt = r.member.movedOutAt; }
              });
            })
            .catch(function (err) {
              inp.disabled = false;
              inp.value = "";
              app.toast((err && err.message) || "couldn't save that date");
            });
        };
      });
    }
    wireResidency(".gsResIn", "movedInAt");
    wireResidency(".gsResOut", "movedOutAt");

    // chat
    var chatBtn = el.querySelector("#gsChat");
    if (chatBtn) chatBtn.onclick = function () { app.closeSheet(); location.hash = "#/chat/" + encodeURIComponent(trip.id); };

    // archive / unarchive — confirm by second tap (mirrors the delete pattern)
    var arch = el.querySelector("#gsArchive");
    if (arch) {
      var armed = false, armTimer = null;
      arch.onclick = function () {
        if (!archived && !armed) {
          armed = true;
          arch.textContent = "tap again to archive";
          armTimer = setTimeout(function () { armed = false; arch.textContent = archiveLabel; }, 3000);
          return;
        }
        if (armTimer) clearTimeout(armTimer);
        arch.disabled = true; arch.textContent = archived ? "unarchiving…" : "archiving…";
        app.api.patch("/api/trips/" + encodeURIComponent(trip.id), { archived: !archived })
          .then(function () {
            app.haptic && app.haptic([20, 30, 20]);
            app.closeSheet();
            if (!archived) { app.toast("archived — find it under archived"); location.hash = "#/groups"; }
            else { app.toast("unarchived ✨"); load(view_, trip.id); }
          })
          .catch(function (err) { arch.disabled = false; arch.textContent = archiveLabel; app.toast((err && err.message) || "couldn't update"); });
      };
    }
  }

  // ====================== household hub ("this month" bills) ======================
  // A group flagged kind="household" gets a THIS MONTH ledger card: rent +
  // recurring utilities + shared subscriptions, each with amount, your share
  // (prorated by days-in-residence on a move month), next charge and posted/
  // upcoming state — plus the "your month: $X" strip. Pure aggregation of
  // GET /api/trips/:id/household; the ledger itself is untouched.
  function hubMonthLabel(monthStr) {
    try {
      var p = String(monthStr || "").split("-");
      var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, 1));
      return d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase();
    } catch (_) { return ""; }
  }
  function hubDayLabel(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toLowerCase();
    } catch (_) { return ""; }
  }
  function hubBillRow(b, isLast) {
    var emoji = b.source === "subscription" ? (b.icon || "🔁") : tabEmoji(b.title);
    var yours = b.yourShareFmt
      ? ' · <span style="color:#2775CA;">yours ' + app.esc(b.yourShareFmt) + '</span>'
      : "";
    var prorated = b.prorated
      ? ' <span style="display:inline-flex; align-items:center; gap:3px; background:rgba(255,198,92,0.22); border:1px solid rgba(255,198,92,0.6); border-radius:999px; padding:1px 7px; font-family:\'Space Mono\',monospace; font-weight:700; font-size:8px; letter-spacing:.5px; color:#a06a00;">PRORATED 🏠</span>'
      : "";
    var status = b.paid
      ? '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:#17A277; white-space:nowrap;">ON THE TAB ✓</span>'
      : '<span style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.5px; color:#2775CA; white-space:nowrap;">→ ' + app.esc(hubDayLabel(b.nextChargeAt)) + '</span>';
    var adjust = b.canAdjust
      ? '<div style="margin-top:6px;"><span class="hubAdjust" data-eid="' + app.esc(b.adjustExpenseId || "") + '" role="button" tabindex="0" ' +
          'style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:#FF6B5E; cursor:pointer; text-decoration:underline;">someone moved — prorate this month\'s split →</span></div>'
      : "";
    return '<div style="padding:11px 2px;' + (isLast ? "" : " border-bottom:1.5px dashed rgba(43,33,24,0.12);") + '">' +
      '<div style="display:flex; align-items:center; gap:11px;">' +
        '<div style="width:30px; height:30px; border-radius:9px; background:#F7F1E3; display:flex; align-items:center; justify-content:center; font-size:15px; flex:none;">' + emoji + '</div>' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="display:flex; align-items:center; gap:6px;"><span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:500; font-size:14.5px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(b.title) + '</span>' + prorated + '</div>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:9.5px; letter-spacing:.3px; color:rgba(43,33,24,0.55); margin-top:2px;">' + app.esc(b.monthlyFmt) + '/mo' + yours + '</div>' +
        '</div>' +
        '<div style="text-align:right; flex:none;">' + status + '</div>' +
      '</div>' + adjust +
    '</div>';
  }
  function householdHubEl(trip, hub) {
    var bills = (hub && hub.bills) || [];
    var inner;
    if (!bills.length) {
      inner =
        '<div style="display:flex; flex-direction:column; align-items:center; text-align:center; padding:14px 8px 6px; gap:7px;">' +
          app.mascot({ size: 74, mood: "happy" }) +
          '<div style="font-family:\'Clash Display\',sans-serif; font-weight:600; font-size:15.5px; color:#2B2118;">no bills yet — add rent to get started 🏠</div>' +
          '<div style="font-family:\'General Sans\',sans-serif; font-size:12.5px; color:rgba(43,33,24,0.55);">recurring bills and shared subs land here every month.</div>' +
          '<button id="hubAddBill" style="appearance:none; border:2px solid #2B2118; cursor:pointer; margin-top:4px; min-height:40px; border-radius:999px; background:#FFC65C; padding:0 18px; font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:13.5px; color:#2B2118; box-shadow:2px 3px 0 rgba(43,33,24,0.85);">＋ add rent</button>' +
        '</div>';
    } else {
      var rows = bills.map(function (b, i) { return hubBillRow(b, i === bills.length - 1); }).join("");
      var haveYours = bills.some(function (b) { return b.yourShareCents != null; });
      var stripLabel = haveYours ? "YOUR MONTH" : "HOUSEHOLD MONTH";
      var stripAmt = haveYours ? hub.totals.yourMonthFmt : hub.totals.monthFmt;
      inner = rows +
        '<div style="display:flex; align-items:center; justify-content:space-between; margin-top:13px; background:rgba(39,117,202,0.08); border:1.5px dashed rgba(39,117,202,0.45); border-radius:12px; padding:10px 14px;">' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:1.5px; color:rgba(43,33,24,0.55);">' + stripLabel + '</span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:18px; letter-spacing:-0.5px; color:#2775CA;">' + app.esc(stripAmt || "$0.00") + '</span>' +
        '</div>' +
        '<div style="display:flex; gap:14px; justify-content:center; margin-top:11px;">' +
          '<span id="hubAddRec" role="button" tabindex="0" style="font-family:\'Space Mono\',monospace; font-size:10px; color:rgba(43,33,24,0.5); cursor:pointer; text-decoration:underline;">＋ recurring bill</span>' +
          '<span id="hubAddSub" role="button" tabindex="0" style="font-family:\'Space Mono\',monospace; font-size:10px; color:rgba(43,33,24,0.5); cursor:pointer; text-decoration:underline;">＋ subscription</span>' +
        '</div>';
    }
    var html =
      '<div style="position:relative; margin:22px 0 0; border-radius:20px; padding:16px 16px 13px; background:#FFFDF7; border:2px solid #2B2118; box-shadow:3px 4px 0 rgba(43,33,24,0.85); transform:rotate(0.35deg);">' +
        '<div style="position:absolute; top:-11px; left:50%; width:84px; height:22px; transform:translateX(-50%) rotate(1.8deg); background:rgba(255,107,94,0.6); opacity:.9; border-left:1.5px dashed rgba(43,33,24,0.25); border-right:1.5px dashed rgba(43,33,24,0.25);"></div>' +
        '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:2px;">' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.5);">THIS MONTH 🏠</span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.5px; color:rgba(43,33,24,0.4);">' + app.esc(hubMonthLabel(hub && hub.month)) + '</span>' +
        '</div>' +
        inner +
      '</div>';
    var el = elFrom(html);
    var addBill = el.querySelector("#hubAddBill");
    if (addBill) addBill.onclick = function () { location.hash = "#/recurring"; };
    var addRec = el.querySelector("#hubAddRec");
    if (addRec) addRec.onclick = function () { location.hash = "#/recurring"; };
    var addSub = el.querySelector("#hubAddSub");
    if (addSub) addSub.onclick = function () { location.hash = "#/subscriptions"; };
    // one-tap proration for a transition month: the server voids the even
    // split and writes exact per-member prorated expenses, then we repaint.
    Array.prototype.forEach.call(el.querySelectorAll(".hubAdjust"), function (a) {
      a.onclick = function () {
        var eid = a.getAttribute("data-eid");
        if (!eid) return;
        a.style.pointerEvents = "none";
        a.textContent = "prorating…";
        app.api.post("/api/trips/" + encodeURIComponent(trip.id) + "/household/adjust", { expenseId: eid })
          .then(function () {
            app.haptic && app.haptic([20, 30, 20]);
            app.toast("prorated — ledger updated ✓");
            load(view_, trip.id);
          })
          .catch(function (err) {
            app.toast((err && err.message) || "couldn't prorate that");
            load(view_, trip.id);
          });
      };
    });
    return el;
  }
  function loadHub(trip) {
    var host = document.getElementById("gHubHost");
    if (!host) return;
    app.api.get("/api/trips/" + encodeURIComponent(trip.id) + "/household")
      .then(function (hub) {
        var h = document.getElementById("gHubHost");
        if (!h) return; // navigated away
        h.innerHTML = "";
        h.appendChild(householdHubEl(trip, hub));
      })
      .catch(function () {
        var h = document.getElementById("gHubHost");
        if (h) h.innerHTML = ""; // hub is best-effort; the ledger still renders
      });
  }

  // ====================== states ======================
  function skeleton(view) {
    var rows = "";
    for (var i = 0; i < 4; i++) rows += '<div class="skeleton" style="height:66px; margin:9px 16px;"></div>';
    view.innerHTML = topbar(null, "🧾") +
      '<div class="appscroll" style="padding:0;">' +
        '<div class="skeleton" style="height:96px; margin:6px 16px 18px; border-radius:22px;"></div>' +
        '<div class="skeleton" style="height:120px; margin:0 22px 18px;"></div>' +
        rows +
      '</div>';
    wireBack();
  }

  function errorState(view, name, msg, hint) {
    view.innerHTML = topbar({ name: name || "group" }, "🧾") +
      '<div class="empty" style="padding-top:60px;">' +
        app.mascot({ size: 116, mood: "worried", glow: true }) +
        '<div class="title lower">' + app.esc(msg || "can\'t find this group") + '</div>' +
        '<div class="hint">' + app.esc(hint || "the link might be dead, or it isn\'t yours.") + '</div>' +
        '<button class="btn" style="max-width:240px; margin-top:8px;" onclick="location.hash=\'#/groups\'">your groups</button>' +
      '</div>';
    wireBack();
  }

  var view_ = null;

  function paint(view, trip) {
    var me = findMe(trip);
    var emoji = groupEmoji(trip);
    // Show the "claim your spot" card to a signed-in (or about-to-sign-in)
    // visitor who isn't yet a member, when open slots exist. Injected as a live
    // node into a placeholder so its tap handlers wire cleanly.
    var showClaim = !me && unclaimedSlots(trip).length > 0;
    var isHousehold = trip.kind === "household";
    view.innerHTML =
      topbar(trip, emoji) +
      '<div class="appscroll gd-scroll" style="padding:0 0 140px;">' +
        coverHeader(trip) +
        (showClaim ? '<div id="gClaimHost" style="padding:0 22px;"></div>' : "") +
        (isHousehold ? '<div id="gHubHost" style="padding:0 22px;"></div>' : "") +
        balanceHero(trip, me) +
      '</div>' +
      stickyBar();

    wireBack();

    if (showClaim) {
      var claimHost = document.getElementById("gClaimHost");
      if (claimHost) claimHost.appendChild(claimCardEl(trip));
    }
    // the household "this month" hub — best-effort second fetch, never blocks
    if (isHousehold) loadHub(trip);

    var more = document.getElementById("gMore");
    if (more) {
      more.onclick = function () { openSettings(trip); };
      more.onkeydown = function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); openSettings(trip); }
      };
    }

    // quick pills
    var chat = document.getElementById("gChat");
    if (chat) chat.onclick = function () { location.hash = "#/chat/" + encodeURIComponent(trip.id); };
    var recap = document.getElementById("gRecap");
    if (recap) recap.onclick = function () {
      if (window.Recap && typeof window.Recap.open === "function") window.Recap.open(trip.id);
      else app.toast("recap coming soon ✨");
    };
    var share = document.getElementById("gShare");
    if (share) share.onclick = async function () {
      var url = location.origin + (trip.shareUrlPath || ("/t/" + (trip.shareToken || trip.id)));
      try {
        if (navigator.share) await navigator.share({ title: trip.name, url: url });
        else { await navigator.clipboard.writeText(url); app.toast("link copied 🔗"); }
      } catch (_) {}
    };

    // sticky actions
    var add = document.getElementById("gAdd");
    if (add) add.onclick = function () { location.hash = "#/new/" + encodeURIComponent(trip.id); };
    var settle = document.getElementById("gSettle");
    if (settle) settle.onclick = function () { location.hash = "#/settle/" + encodeURIComponent(trip.id); };

    // your simplified payments -> settle flow pre-scoped to that counterparty.
    // The hint is consumed once by screens/settle.js (findMyTransfer) so the
    // settle screen opens on THIS leg when the plan has several for you.
    Array.prototype.forEach.call(view.querySelectorAll(".gSimpPay"), function (el) {
      function goSettle() {
        try {
          sessionStorage.setItem("divvy.settle.target", JSON.stringify({ tripId: trip.id, to: el.getAttribute("data-to") }));
        } catch (_) {}
        location.hash = "#/settle/" + encodeURIComponent(trip.id);
      }
      el.onclick = goSettle;
      el.onkeydown = function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); goSettle(); }
      };
    });

    // tab rows -> detail sheet
    var byId = {};
    (trip.expenses || []).forEach(function (e) { byId[e.id] = e; });
    Array.prototype.forEach.call(view.querySelectorAll(".gTab"), function (el) {
      el.onclick = function () { var e = byId[el.getAttribute("data-eid")]; if (e) openTab(trip, e, me); };
    });

    // settled-outside claim actions: confirm ✓ / dispute ✗ (creditor) and
    // cancel (debtor). The server re-checks everything; we just repaint truth.
    Array.prototype.forEach.call(view.querySelectorAll(".gOutAct"), function (el) {
      el.onclick = function () {
        var cid = el.getAttribute("data-cid"), verb = el.getAttribute("data-verb");
        if (!cid || !verb) return;
        el.style.pointerEvents = "none";
        el.style.opacity = "0.6";
        app.api.post("/api/trips/" + encodeURIComponent(trip.id) + "/settle-outside/" + encodeURIComponent(cid) + "/" + verb)
          .then(function (fresh) {
            if (verb === "confirm") { if (app.celebrate) app.celebrate({ coins: true }); app.toast("confirmed — ledger updated ✓"); }
            else if (verb === "decline") app.toast("okay — the ledger stays as-is");
            else app.toast("claim cancelled");
            if (fresh && fresh.id) paint(view, fresh);
            else load(view, trip.id);
          })
          .catch(function (e) {
            app.toast((e && e.message) || "couldn't do that");
            load(view, trip.id); // the claim may have moved under us
          });
      };
    });
  }

  async function load(view, id) {
    view_ = view;
    if (!id) { errorState(view, "group", "no group", "open one from your groups."); return; }
    skeleton(view);
    // Wait for auth so findMe() resolves "you" on a deep-link/refresh instead of
    // painting a signed-out ledger that never recovers when the session loads.
    if (window.Auth && window.Auth.ready) { try { await window.Auth.ready; } catch (_) {} }
    var trip;
    try {
      trip = await app.api.get("/api/trips/" + encodeURIComponent(id));
    } catch (e) {
      if (e && (e.status === 404 || e.status === 403)) { errorState(view, "group", "can't find this group", "the link might be dead, or it isn't yours."); return; }
      errorState(view, "group", "couldn't load", (e && e.message) || "try again");
      return;
    }
    if (!trip || !trip.id) { errorState(view, "group", "can't find this group", "it might be gone."); return; }
    // money-card reactions + live wallet balance (best-effort; the ledger still
    // renders without either).
    try {
      var rx = await app.api.get("/api/trips/" + encodeURIComponent(trip.id) + "/reactions");
      reactionsMap = (rx && rx.reactions) || {};
    } catch (_) { reactionsMap = {}; }
    try {
      var w = await app.api.get("/api/me/wallet");
      walletCents = (w && typeof w.usdcCents === "number") ? w.usdcCents : null;
    } catch (_) { walletCents = null; }
    paint(view, trip);
  }

  window.Screens = window.Screens || {};
  window.Screens.group = {
    title: "group",
    render: function (view, params) {
      var id = params && params[0];
      load(view, id);
    },
  };
})();
