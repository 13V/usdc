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
    var label = covers ? "in your wallet · ready to settle" : "in your wallet · top up to settle";
    return '<div style="display:inline-flex; align-items:center; gap:7px; margin-top:14px; border:1px solid ' + col + '55; background:' + col + '1f; border-radius:999px; padding:5px 12px;">' +
      '<span style="width:6px; height:6px; border-radius:50%; background:' + col + '; box-shadow:0 0 7px ' + col + 'cc;"></span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:11px; color:' + col + ';">' + dollars + '</span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(244,247,250,0.55);">' + label + '</span>' +
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
      var chip = elFrom('<div style="display:inline-flex; align-items:center; gap:5px; background:#13212E; border:1px solid rgba(244,247,250,0.1); border-radius:999px; padding:5px 11px; cursor:pointer;"></div>');
      chips[emoji] = chip;
      function paint() {
        var st = state[emoji] || { count: 0, mine: false };
        chip.innerHTML = '<span style="font-size:13px;">' + emoji + '</span>' +
          (st.count > 0 ? '<span style="font-family:\'Space Mono\',monospace; font-size:11px; color:rgba(244,247,250,0.7);">' + st.count + '</span>' : '');
        var on = st.count > 0;
        chip.style.borderColor = st.mine ? "rgba(39,117,202,0.8)" : (on ? "rgba(39,117,202,0.45)" : "rgba(244,247,250,0.1)");
        chip.style.background = st.mine ? "rgba(39,117,202,0.22)" : (on ? "rgba(39,117,202,0.12)" : "#13212E");
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
    "linear-gradient(150deg,#7fc0ff,#2775CA)",
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
  // a friendly group emoji derived from the trip's name/cluster (api has none)
  function groupEmoji(t) {
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
      memberEmoji(m) + '</div>';
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

  // ---------- top bar (back ‹ · name + emoji · ⋯) ----------
  function topbar(trip, emoji) {
    return '' +
    '<div style="display:flex; align-items:center; justify-content:space-between; height:56px; padding:0 16px; flex:none;">' +
      '<div id="gBack" style="width:38px; height:38px; border-radius:50%; background:#13212E; border:1px solid rgba(244,247,250,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F4F7FA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></div>' +
      '<div style="display:flex; align-items:center; gap:7px; min-width:0;">' +
        '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#F4F7FA; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc((trip && trip.name) || "group") + '</span>' +
        '<span style="font-size:16px;">' + emoji + '</span>' +
      '</div>' +
      '<div id="gMore" style="width:38px; height:38px; border-radius:50%; background:#13212E; border:1px solid rgba(244,247,250,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F4F7FA" stroke-width="2.4" stroke-linecap="round"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></div>' +
    '</div>';
  }
  function wireBack() {
    var b = document.getElementById("gBack");
    if (b) b.onclick = function () { if (history.length > 1) history.back(); else app.go("groups"); };
  }

  // ---------- cover header (avatar stack + GROUP TOTAL + meta) ----------
  function coverHeader(trip) {
    var members = trip.members || [];
    var stack = members.slice(0, 5).map(function (m, i) {
      return '<div style="width:36px; height:36px; border-radius:50%; background:' + memberGrad(m) +
        '; border:2px solid #2a72c0;' + (i ? " margin-left:-10px;" : "") +
        ' display:flex; align-items:center; justify-content:center; font-size:17px;">' + memberEmoji(m) + '</div>';
    }).join("");
    var more = members.length > 5
      ? '<span style="font-family:\'Space Mono\',monospace; font-size:11px; color:rgba(255,255,255,0.8); margin-left:8px;">+' + (members.length - 5) + '</span>'
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
    '<div style="position:relative; margin:6px 16px 0; border-radius:22px; overflow:hidden; padding:18px 18px; background:linear-gradient(135deg,#2775CA 0%,#2f7fd6 55%,#1f63ab 100%); box-shadow:0 14px 34px rgba(39,117,202,0.4);">' +
      '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 88% 10%, rgba(255,255,255,0.10) 0 1px, transparent 1px 9px); opacity:.5; pointer-events:none;"></div>' +
      '<div style="position:relative; display:flex; align-items:center; justify-content:space-between;">' +
        '<div style="display:flex; align-items:center;">' + stack + more + '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:1.5px; color:rgba(255,255,255,0.7);">GROUP TOTAL</div>' +
          '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:22px; letter-spacing:-1px; color:#fff; margin-top:2px;"><span style="font-size:14px; opacity:.6;">$</span>' + moneyParts(trip.totalCents || 0, "14px", ".6") + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="position:relative; font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1px; color:rgba(255,255,255,0.78); margin-top:12px;">' + meta + '</div>' +
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
      col = "#F4F7FA";
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
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:#7fc0ff;">＋ ' + plain(owed) + ' owed to you</span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:#FF6B5E;">− ' + plain(owe) + ' you owe</span>' +
        '</div>' +
      '</div>';
    } else {
      bar = '<div style="font-family:\'Space Mono\',monospace; font-size:12px; color:rgba(244,247,250,0.5); margin-top:14px;">no open tabs yet — start one below ✨</div>';
    }

    return '' +
    '<div style="padding:22px 22px 0;">' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.5);">' + eyebrow + '</span>' +
      '<div style="display:flex; align-items:baseline; gap:11px; margin-top:9px;">' +
        '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:46px; line-height:1; letter-spacing:-2px; color:' + col + '; text-shadow:0 0 26px rgba(39,117,202,0.45);"><span style="font-size:25px; opacity:.55;">' + bigSign + '</span>' + moneyParts(bigCents, "25px", ".55") + '</div>' +
        '<span style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(244,247,250,0.55);">' + label + '</span>' +
      '</div>' +
      bar +
      ((haveNet && net < 0) ? walletReadyChip(Math.abs(net)) : "") +
      pillRow() +
      whoOwesWho(trip, me) +
      tabsFeed(trip, me) +
    '</div>';
  }

  // ---------- quick pills: 💬 chat · ✨ recap · ↗ share ----------
  function pillRow() {
    function pill(id, emoji, efs, label) {
      return '<div id="' + id + '" style="flex:1; display:flex; align-items:center; justify-content:center; gap:6px; min-height:42px; border-radius:13px; background:#13212E; border:1px solid rgba(244,247,250,0.09); cursor:pointer;">' +
        '<span style="font-size:' + efs + ';">' + emoji + '</span>' +
        '<span style="font-family:\'General Sans\',sans-serif; font-size:13px; font-weight:500; color:rgba(244,247,250,0.85);">' + label + '</span></div>';
    }
    return '<div style="display:flex; gap:9px; margin-top:18px;">' +
      pill("gChat", "💬", "14px", "chat") +
      pill("gRecap", "✨", "14px", "recap") +
      pill("gShare", "↗", "13px", "share") +
    '</div>';
  }

  // ---------- who owes who (greedy settle-down -> debtor → creditor → amount) ----------
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
    return '<svg width="20" height="11" viewBox="0 0 26 14" fill="none" stroke="rgba(244,247,250,0.4)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 7h22m-5-5 5 5-5 5"/></svg>';
  }
  function whoOwesWho(trip, me) {
    var edges = settleEdges(trip.balances);
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
        ? 'font-family:\'General Sans\',sans-serif; font-size:13px; color:rgba(244,247,250,0.5);'
        : 'font-family:\'General Sans\',sans-serif; font-size:14px; font-weight:500; color:#F4F7FA;';
      var toNameStyle = toYou
        ? 'font-family:\'General Sans\',sans-serif; font-size:13px; color:rgba(244,247,250,0.5);'
        : 'font-family:\'General Sans\',sans-serif; font-size:14px; font-weight:500; color:#F4F7FA;';
      return '<div style="display:flex; align-items:center; gap:10px; background:#13212E; border:1px solid rgba(244,247,250,0.09); border-radius:14px; padding:11px 14px;">' +
        gavatar(fromM, 28) +
        '<span style="' + fromNameStyle + '">' + app.esc(fromName) + '</span>' +
        arrowSvg() +
        gavatar(toM, 28) +
        '<span style="' + toNameStyle + '">' + app.esc(toName) + '</span>' +
        '<span style="flex:1; text-align:right; font-family:\'Space Mono\',monospace; font-weight:700; font-size:15px; color:' + amtColor + ';">' + plain(e.cents) + '</span>' +
      '</div>';
    }).join("");
    return '' +
    '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.5); margin:24px 0 11px;">WHO OWES WHO</div>' +
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
  // your delta on this tab: +back if you paid, −share if you owe
  function tabDelta(e, me) {
    if (!me || !e.participants) return null;
    var n = e.participants.length || 1;
    var share = Math.round((e.amountCents || 0) / n);
    var inSplit = e.participants.indexOf(me.id) >= 0;
    var youPaid = e.paidBy === me.id;
    if (youPaid) {
      var back = (e.amountCents || 0) - (inSplit ? share : 0);
      if (back > 0) return { cents: back, color: "#2775CA", sign: "+$" };
    } else if (inSplit) {
      return { cents: share, color: "#FF6B5E", sign: "−$" };
    }
    return null;
  }
  function tabRow(e, me) {
    var n = (e.participants || []).length || 1;
    var t = ago(e.createdAt);
    var d = tabDelta(e, me);
    var delta = d
      ? '<div style="font-family:\'Space Mono\',monospace; font-size:9px; color:' + d.color + '; margin-top:2px;">' + d.sign + (d.cents / 100).toFixed(2) + '</div>'
      : "";
    return '' +
    '<div class="gTab" data-eid="' + app.esc(e.id) + '" style="display:flex; align-items:center; gap:13px; background:#13212E; border:1px solid rgba(244,247,250,0.09); border-radius:16px; padding:13px 15px; cursor:pointer;">' +
      '<div style="width:42px; height:42px; border-radius:13px; background:#0B1622; display:flex; align-items:center; justify-content:center; font-size:21px; flex:none;">' + tabEmoji(e.title) + '</div>' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="display:flex; align-items:center; gap:7px;"><span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:500; font-size:16px; color:#F4F7FA; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(e.title || "a tab") + '</span></div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(244,247,250,0.45); margin-top:3px;">' +
          app.esc((e.paidByName || "someone").toLowerCase()) + ' paid · split ' + n + (t ? ' · ' + t : "") +
        '</div>' +
      '</div>' +
      '<div style="text-align:right;">' +
        '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:16px; color:#F4F7FA;">' + plain(e.amountCents || 0) + '</div>' +
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
        '<div style="color:rgba(244,247,250,0.6); font-size:14px;">add the first one and start splitting 🎉</div>' +
      '</div>';
    }
    var header = '<div style="display:flex; align-items:center; justify-content:space-between; margin:24px 0 11px;">' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.5);">TABS</span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:rgba(244,247,250,0.4);">' + exp.length + ' TOTAL</span>' +
    '</div>';
    return header + '<div style="display:flex; flex-direction:column; gap:9px;">' + exp.map(function (e) { return tabRow(e, me); }).join("") + '</div>';
  }

  // ---------- sticky bottom: settle up + add a tab ----------
  function stickyBar() {
    return '' +
    '<div style="position:fixed; left:0; right:0; bottom:0; z-index:40; padding:12px 18px calc(12px + env(safe-area-inset-bottom)); background:linear-gradient(180deg, rgba(11,22,34,0) 0%, #0B1622 26%); display:flex; gap:11px; max-width:520px; margin:0 auto;">' +
      '<button id="gSettle" style="appearance:none; cursor:pointer; flex:none; width:128px; min-height:54px; border-radius:999px; background:transparent; border:1px solid rgba(244,247,250,0.18); font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#F4F7FA;">settle up</button>' +
      '<button id="gAdd" style="appearance:none; border:none; cursor:pointer; flex:1; min-height:54px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 10px 26px rgba(39,117,202,0.45);">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
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

    // meta line: "maya paid · jun 22" (frame shows IZAKAYA · SHIBUYA above; we
    // surface the payer/date there since the api has no venue).
    var when = "";
    if (e.createdAt) {
      try { when = " · " + new Date(e.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toLowerCase(); } catch (_) {}
    }
    var payerName = (e.paidByName || "someone").toLowerCase();
    var payerM = memberById(trip, e.paidBy);
    var subline = (e.fxNote ? e.fxNote.toUpperCase() : "split " + n + " · " + plain(each) + " each").toUpperCase();

    // per-person split rows with PAID / SQUARED / "you owe 👀" tags
    var rowsHtml = (e.participants || []).map(function (pid, idx) {
      var pm = memberById(trip, pid);
      var name = (e.participantNames && e.participantNames[idx]) || pm.name || pid;
      var isYou = pid === meId;
      var isPayer = pid === e.paidBy; // payer fronted the money
      var amtColor, tag;
      if (isPayer) {
        amtColor = "rgba(244,247,250,0.85)";
        tag = '<span style="display:inline-flex; align-items:center; gap:4px; flex:none; white-space:nowrap; background:rgba(39,117,202,0.16); border:1px solid rgba(39,117,202,0.5); border-radius:999px; padding:3px 9px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#7fc0ff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:#7fc0ff;">PAID</span></span>';
      } else if (isYou) {
        youOwe = each;
        amtColor = "#FF6B5E";
        tag = '<span style="display:inline-flex; align-items:center; gap:4px; flex:none; white-space:nowrap; background:rgba(255,107,94,0.14); border:1px solid rgba(255,107,94,0.5); border-radius:999px; padding:3px 9px;"><span style="font-size:9px;">👀</span><span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:#FF6B5E;">YOU OWE</span></span>';
      } else {
        amtColor = "#2775CA";
        tag = '<span style="display:inline-flex; align-items:center; gap:4px; flex:none; white-space:nowrap; background:rgba(39,117,202,0.16); border:1px solid rgba(39,117,202,0.5); border-radius:999px; padding:3px 9px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#7fc0ff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:#7fc0ff;">SQUARED</span></span>';
      }

      var avatar = '<div style="width:34px; height:34px; border-radius:50%; background:' + memberGrad(pm) + '; display:flex; align-items:center; justify-content:center; font-size:17px; flex:none;">' + memberEmoji(pm) + '</div>';

      if (isYou) {
        // highlighted "you owe" row
        return '<div style="display:flex; align-items:center; gap:11px; padding:11px 8px; margin:4px -4px 0; border-radius:13px; background:rgba(255,107,94,0.07); border:1px solid rgba(255,107,94,0.22);">' +
          avatar +
          '<span style="flex:1; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#F4F7FA;">you</span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:14px; color:' + amtColor + ';">' + plain(each) + '</span>' +
          tag +
        '</div>';
      }
      return '<div style="display:flex; align-items:center; gap:11px; padding:9px 4px;">' +
          avatar +
          '<span style="flex:1; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#F4F7FA;">' + app.esc(name) + '</span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:14px; color:' + amtColor + ';">' + plain(each) + '</span>' +
          tag +
        '</div>' +
        '<div style="height:1px; background:rgba(244,247,250,0.06); margin:0 4px;"></div>';
    }).join("");

    var settleBtn = youOwe > 0
      ? '<button id="gTabSettle" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:56px; border-radius:999px; background:linear-gradient(120deg,#FF8A7E,#FF6B5E); display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 12px 30px rgba(255,107,94,0.38); margin-top:14px;">' +
          '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#fff;">settle your ' + plain(youOwe) + '</span>' +
        '</button>'
      : '<button id="gTabSettle" style="appearance:none; cursor:pointer; width:100%; min-height:56px; border-radius:999px; background:transparent; border:1px solid rgba(244,247,250,0.18); font-family:\'General Sans\',sans-serif; font-weight:500; font-size:16px; color:#F4F7FA; margin-top:14px;">settle up</button>';

    var html = '' +
    '<div style="margin:0 -20px;">' +
      // receipt sheet
      '<div style="position:relative; background:#13212E; border-radius:24px; border:1px solid rgba(244,247,250,0.08); box-shadow:0 18px 44px rgba(0,0,0,0.36); overflow:hidden; margin:0 20px;">' +
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 88% 4%, rgba(255,255,255,0.045) 0 1px, transparent 1px 8px); opacity:.7; pointer-events:none;"></div>' +
        '<div style="position:absolute; left:0; right:0; top:0; height:5px; background:linear-gradient(90deg,#2775CA,#3DE8C7);"></div>' +
        // head
        '<div style="position:relative; padding:24px 22px 16px; text-align:center;">' +
          '<div style="width:60px; height:60px; border-radius:18px; background:#0B1622; display:flex; align-items:center; justify-content:center; font-size:30px; margin:0 auto;">' + tabEmoji(e.title) + '</div>' +
          '<h2 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:22px; letter-spacing:-0.3px; margin:13px 0 0; color:#F4F7FA;">' + app.esc(e.title || "a tab") + '</h2>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:10.5px; letter-spacing:1px; color:rgba(244,247,250,0.5); margin-top:4px;">' + app.esc(subline) + '</div>' +
          '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:46px; line-height:1; letter-spacing:-2px; color:#F4F7FA; margin-top:16px;"><span style="font-size:25px; opacity:.5;">$</span>' + moneyParts(e.amountCents || 0, "25px", ".5") + '</div>' +
          '<div style="display:inline-flex; align-items:center; gap:8px; margin-top:12px; background:#0B1622; border:1px solid rgba(244,247,250,0.09); border-radius:999px; padding:5px 12px;">' +
            '<div style="width:20px; height:20px; border-radius:50%; background:' + memberGrad(payerM) + '; display:flex; align-items:center; justify-content:center; font-size:11px;">' + memberEmoji(payerM) + '</div>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:rgba(244,247,250,0.7);">' + app.esc(payerName + " paid" + when) + '</span>' +
          '</div>' +
        '</div>' +
        // perforation
        '<div style="position:relative; height:1px; margin:6px 0 0; border-top:1.5px dashed rgba(244,247,250,0.14);"><div style="position:absolute; left:-9px; top:-9px; width:18px; height:18px; border-radius:50%; background:#0B1622;"></div><div style="position:absolute; right:-9px; top:-9px; width:18px; height:18px; border-radius:50%; background:#0B1622;"></div></div>' +
        // per-person
        '<div style="position:relative; padding:8px 16px 16px;">' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:1.5px; color:rgba(244,247,250,0.42); padding:8px 4px 4px;">SPLIT ' + n + ' · ' + plain(each) + ' EACH</div>' +
          rowsHtml +
        '</div>' +
      '</div>' +
      // reactions (server-backed; injected as a live node after app.sheet)
      '<div id="gTabReacts"></div>' +
      // actions
      '<div style="margin:0 20px;">' + settleBtn + '</div>' +
      '<div style="display:flex; align-items:center; justify-content:center; gap:22px; margin-top:14px;">' +
        '<span id="gTabEdit" style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(244,247,250,0.5); cursor:pointer;">edit</span>' +
        '<span style="width:3px; height:3px; border-radius:50%; background:rgba(244,247,250,0.3);"></span>' +
        '<span id="gTabDelete" style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(244,247,250,0.5); cursor:pointer;">delete</span>' +
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
          armTimer = setTimeout(function () { armed = false; del.textContent = "delete"; del.style.color = "rgba(244,247,250,0.5)"; }, 3000);
          return;
        }
        if (armTimer) clearTimeout(armTimer);
        del.textContent = "deleting…";
        app.api.del("/api/trips/" + encodeURIComponent(trip.id) + "/expenses/" + encodeURIComponent(e.id))
          .then(function () { app.closeSheet(); app.toast("tab deleted"); load(view_, trip.id); })
          .catch(function (err) { app.toast(err.message); del.textContent = "delete"; del.style.color = "rgba(244,247,250,0.5)"; armed = false; });
      };
    }
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
    view.innerHTML =
      topbar(trip, emoji) +
      '<div class="appscroll gd-scroll" style="padding:0 0 140px;">' +
        coverHeader(trip) +
        balanceHero(trip, me) +
      '</div>' +
      stickyBar();

    wireBack();

    var more = document.getElementById("gMore");
    if (more) more.onclick = function () { location.hash = "#/chat/" + encodeURIComponent(trip.id); };

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

    // tab rows -> detail sheet
    var byId = {};
    (trip.expenses || []).forEach(function (e) { byId[e.id] = e; });
    Array.prototype.forEach.call(view.querySelectorAll(".gTab"), function (el) {
      el.onclick = function () { var e = byId[el.getAttribute("data-eid")]; if (e) openTab(trip, e, me); };
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
