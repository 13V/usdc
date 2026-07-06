/* screens/friend.js — Friend detail (1:1 ledger).
   Built by lifting the EXACT inline-styled markup from
   design/handoff/Friend Detail Frames.dc.html and wiring live data into it, so
   it pixel-matches the approved design. NO mascot on this screen — a friend's
   identity stands alone.
   Route #/friend/<id> (params[0] = friend user id). Keeps the existing data
   derivation: GET /api/friends (identity), GET /api/me/balances (net), and
   (best-effort) GET /api/trips + /api/trips/:id (shared groups + between-you
   feed). Implements the `direction` state variant (owed / owe). Never crashes. */
(function () {
  "use strict";
  var app = window.app;

  // ---- small shared bits --------------------------------------------------
  function topbar() {
    // lifted top bar: back circle + ⋯ circle (no mascot here)
    return '<div style="position:relative; z-index:6; display:flex; align-items:center; justify-content:space-between; height:50px; padding:0 16px; flex:none;">' +
      '<div id="fdBack" role="button" aria-label="back" tabindex="0" style="width:38px; height:38px; border-radius:50%; background:var(--card); border:1px solid rgba(var(--ink-rgb),0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--border-ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></div>' +
      '<div id="fdMore" role="button" aria-label="options" tabindex="0" style="width:38px; height:38px; border-radius:50%; background:var(--card); border:1px solid rgba(var(--ink-rgb),0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--border-ink)" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></div>' +
    '</div>';
  }
  function texture(glowColor) {
    // faint money texture + per-direction radial glow (lifted)
    return '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 84% 2%, rgba(var(--ink-rgb),0.025) 0 1px, transparent 1px 8px); opacity:.55; pointer-events:none;"></div>' +
      '<div style="position:absolute; left:50%; top:70px; width:380px; height:300px; transform:translateX(-50%); border-radius:50%; background:radial-gradient(circle, ' + glowColor + ' 0%, rgba(39,117,202,0) 70%); pointer-events:none;"></div>';
  }
  function wireBack() {
    var b = document.getElementById("fdBack");
    if (b) b.onclick = function () { if (history.length > 1) history.back(); else app.go("friends"); };
  }
  function truncWallet(w) {
    if (!w) return "no wallet yet";
    if (w.length <= 11) return w;
    return w.slice(0, 4) + "…" + w.slice(-3);
  }
  function monthSince(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d)) return null;
    var m = ["january","february","march","april","may","june","july",
             "august","september","october","november","december"][d.getMonth()];
    return m || null;
  }
  function dollars(cents) {
    return (Math.abs(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // big mono money split into whole + lighter .dec (caller supplies colored prefix)
  function moneyWhole(cents) {
    var n = Math.abs(cents) / 100;
    return Math.floor(n).toLocaleString() + '<span style="font-size:11px; opacity:.5;">' + (n % 1).toFixed(2).slice(1) + '</span>';
  }

  function skeleton(view) {
    var rows = "";
    for (var i = 0; i < 4; i++) rows += '<div class="skeleton" style="height:54px;margin:9px 0;"></div>';
    view.innerHTML =
      '<div class="vfill" style="position:relative;">' +
      texture("rgba(39,117,202,0.20)") +
      topbar() +
      '<div style="position:relative; z-index:2; padding:4px 16px 24px;">' +
        '<div class="skeleton" style="height:84px;width:84px;border-radius:26px;margin:8px auto 16px;"></div>' +
        '<div class="skeleton" style="height:170px;margin:8px 0 18px;"></div>' +
        rows +
      '</div>' +
      '</div>';
    wireBack();
  }

  // ---- data ---------------------------------------------------------------
  // Resolve the friend, the net, the shared groups and the between-you feed.
  async function load(friendId, me) {
    var out = { friend: null, net: 0, owed: 0, owe: 0, groups: [], feed: [], month: null };

    // 1) friends list → identity (name, handle, wallet)
    var friend = null;
    try {
      var fr = await app.api.get("/api/friends");
      var list = (fr && fr.friends) || [];
      friend = list.filter(function (f) { return f.id === friendId; })[0] || null;
    } catch (_) { /* fall through; maybe still derivable from trips */ }
    out.friend = friend;

    var friendWallets = {};
    if (friend) {
      (friend.wallets || []).forEach(function (w) { if (w) friendWallets[w] = 1; });
      if (friend.primaryWallet) friendWallets[friend.primaryWallet] = 1;
    }
    var myId = me && me.id;
    var myWallets = {};
    if (me) {
      (me.wallets || []).forEach(function (w) { if (w) myWallets[w] = 1; });
      if (me.primaryWallet) myWallets[me.primaryWallet] = 1;
    }

    // 2) trips → shared groups + the between-you feed (best effort, bounded)
    try {
      var summaries = await app.api.get("/api/trips");
      if (!Array.isArray(summaries)) summaries = [];
      // newest first, cap detail fetches so a big account never stalls the screen
      summaries.sort(function (a, b) {
        return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      });
      var cap = Math.min(summaries.length, 12);
      for (var i = 0; i < cap; i++) {
        var trip = null;
        try { trip = await app.api.get("/api/trips/" + encodeURIComponent(summaries[i].id)); }
        catch (_) { continue; }
        if (!trip || !trip.members) continue;

        var isMember = function (m) {
          if (friend && m.userId && m.userId === friend.id) return true;
          if (m.wallet && friendWallets[m.wallet]) return true;
          return false;
        };
        var isMe = function (m) {
          if (myId && m.userId && m.userId === myId) return true;
          if (m.wallet && myWallets[m.wallet]) return true;
          return false;
        };
        var fMember = trip.members.filter(isMember)[0];
        if (!fMember) continue; // friend not in this trip → skip
        var meMember = trip.members.filter(isMe)[0];

        var sharedCount = 0;
        (trip.expenses || []).forEach(function (e) {
          var inv = e.participants || [];
          var fIn = inv.indexOf(fMember.id) >= 0 || e.paidBy === fMember.id;
          var meIn = !meMember || inv.indexOf(meMember.id) >= 0 || e.paidBy === meMember.id;
          if (!fIn || !meIn) return;
          sharedCount++;
          // direction: if friend paid → they covered → friend is owed by you (you owe);
          // if I paid → I covered → friend owes me (owed to me). When meMember unknown,
          // fall back to neutral.
          var dir = "";
          if (meMember && e.paidBy === meMember.id && fMember.id !== e.paidBy) dir = "owed";
          else if (e.paidBy === fMember.id && (!meMember || fMember.id !== meMember.id)) dir = "owe";
          out.feed.push({
            title: e.title || "tab",
            amountCents: e.amountCents || 0,
            group: trip.name,
            tripId: trip.id,
            sig: e.id,
            createdAt: e.createdAt,
            dir: dir,
            settled: !!e.settled,
          });
        });

        out.groups.push({
          id: trip.id,
          name: trip.name,
          emoji: clusterEmoji(trip.cluster),
          count: sharedCount,
        });
        if (!out.month) out.month = monthSince(trip.createdAt);
      }
      // newest expenses first
      out.feed.sort(function (a, b) {
        return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      });
    } catch (_) { /* trips unavailable → groups/feed simply stay empty */ }

    // 3) balances → the authoritative net with this friend
    try {
      var bal = await app.api.get("/api/me/balances");
      var cps = (bal && bal.counterparties) || [];
      var match = cps.filter(function (c) {
        if (friend) {
          if (c.wallet && friendWallets[c.wallet]) return true;
          var nm = (friend.displayName || friend.handle || "").toLowerCase();
          if (nm && (c.name || "").toLowerCase() === nm) return true;
        }
        return false;
      })[0];
      if (match) {
        // cents: + = they owe you, − = you owe
        out.net = match.cents || 0;
      }
    } catch (_) { /* no balances → net stays 0 (square) */ }

    // Derive a two-tone breakdown. Balances only give the NET; estimate the
    // gross legs from the between-you feed when we have it, else split the net.
    var legOwed = 0, legOwe = 0;
    out.feed.forEach(function (e) {
      if (e.dir === "owed") legOwed += e.amountCents;
      else if (e.dir === "owe") legOwe += e.amountCents;
    });
    if (legOwed === 0 && legOwe === 0) {
      if (out.net > 0) legOwed = out.net;
      else if (out.net < 0) legOwe = Math.abs(out.net);
    }
    out.owed = legOwed;
    out.owe = legOwe;
    return out;
  }

  function clusterEmoji(cluster) {
    var map = { trip: "🧳", home: "🏠", couple: "💞", event: "🎉", group: "🍜" };
    return map[cluster] || "🍜";
  }

  // ---- render (lifted markup) ---------------------------------------------

  // direction variant resolver — mirrors the frame's renderVals()
  function variant(net) {
    var youOwe = net < 0;
    var square = net === 0;
    return {
      youOwe: youOwe,
      square: square,
      heroLabel: null, // filled in by header() (needs the friend's name)
      sign: youOwe ? "−" : "+",
      accent: youOwe ? "#FF6B5E" : "#2775CA",
      glowColor: youOwe ? "rgba(255,107,94,0.22)" : "rgba(39,117,202,0.20)",
      primaryBg: youOwe ? "linear-gradient(120deg,#FF8A7E,#FF6B5E)" : "linear-gradient(120deg,#3286db,#2775CA)",
      primaryShadow: youOwe ? "0 12px 30px rgba(255,107,94,0.45)" : "0 12px 30px rgba(39,117,202,0.5)",
      primaryEmoji: youOwe ? "✨" : "👀",
      secondaryLabel: youOwe ? "nudge" : "remind",
      pillText: youOwe ? "settles instantly · ~$0.0001 fee" : "they'll get a link · pays in seconds",
    };
  }

  function header(d, friendId) {
    var f = d.friend || {};
    var name = f.displayName || f.handle || "friend";
    var handle = f.handle ? "@" + f.handle : "";
    var wallet = f.primaryWallet || (f.wallets && f.wallets[0]) || null;
    var emoji = f.emoji || "🌸";
    var tabs = d.feed.length;
    var since = d.month ? " · since " + d.month + " 🍜" : "";
    var bg = app.esc(f.color || "linear-gradient(150deg,#3DE8C7,#2775CA)"); // esc: stored color never raw

    // lifted centered header — big standalone 84px avatar (no mascot)
    return '<div style="display:flex; flex-direction:column; align-items:center; text-align:center; padding:8px 0 4px;">' +
      '<div style="position:relative; width:84px; height:84px; border-radius:26px; background:' + bg + '; display:flex; align-items:center; justify-content:center; font-size:42px; box-shadow:3px 3px 0 rgba(var(--shadow-rgb),0.9);">' + app.face(emoji) + '</div>' +
      '<div style="display:flex; align-items:center; gap:8px; margin-top:14px;">' +
        '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:24px; letter-spacing:-0.4px; color:var(--ink);">' + app.esc(name) + '</span>' +
        (handle ? '<span style="font-family:\'Space Mono\',monospace; font-size:12px; color:rgba(39,117,202,0.75);">' + app.esc(handle) + '</span>' : '') +
      '</div>' +
      '<div style="font-family:\'Space Mono\',monospace; font-size:10.5px; letter-spacing:.3px; color:rgba(var(--ink-rgb),0.42); margin-top:7px;">' + tabs + ' tab' + (tabs === 1 ? '' : 's') + ' together' + since + '</div>' +
      (wallet ? '<div id="fdCopy" style="display:inline-flex; align-items:center; gap:8px; margin-top:10px; background:var(--card); border:2px solid var(--border-ink); border-radius:999px; box-shadow:3px 4px 0 rgba(var(--shadow-rgb),0.85); padding:6px 12px; cursor:pointer;">' +
        '<span style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.6);">' + app.esc(truncWallet(wallet)) + '</span>' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--ink-rgb),0.5)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>' +
      '</div>' : '') +
    '</div>';
  }

  function hero(d, v) {
    var net = d.net;
    var name = (d.friend && (d.friend.displayName || d.friend.handle)) || "they";
    var first = String(name).trim().split(/\s+/)[0].toLowerCase();
    var heroLabel = v.square ? "you're square with " + app.esc(first)
      : v.youOwe ? "you owe " + app.esc(first)
      : app.esc(first) + " owes you";

    // two-tone owe-bar — proportional to the derived legs (frame: 30 / 6)
    var owedSeg = Math.max(d.owed, 0), oweSeg = Math.max(d.owe, 0);
    if (owedSeg === 0 && oweSeg === 0) owedSeg = 1; // keep a sliver so the bar isn't empty
    var barInner = (owedSeg > 0 ? '<div style="flex:' + owedSeg + '; background:#2775CA;"></div>' : '') +
      (oweSeg > 0 ? '<div style="flex:' + oweSeg + '; background:#FF6B5E;"></div>' : '');

    var netSign = net > 0 ? "+" : net < 0 ? "−" : "";
    var breakdown = 'they owe you <span style="color:#2775CA;">$' + dollars(d.owed) + '</span>' +
      ' · you owe them <span style="color:#FF6B5E;">$' + dollars(d.owe) + '</span>' +
      ' · net <span style="color:var(--ink); font-weight:700;">' + netSign + '$' + dollars(net) + '</span>';

    return '<div style="text-align:center; margin-top:22px;">' +
      '<div style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(var(--ink-rgb),0.55);">' + heroLabel + '</div>' +
      '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:62px; line-height:.92; letter-spacing:-2.5px; color:' + v.accent + '; text-shadow:0 0 40px ' + v.glowColor + '; margin-top:8px;">' +
        '<span style="font-size:30px; opacity:.5;">' + (v.square ? '$' : v.sign + '$') + '</span>' +
        Math.floor(Math.abs(net) / 100).toLocaleString() +
        '<span style="font-size:30px; opacity:.5;">' + (Math.abs(net) % 100 / 100).toFixed(2).slice(1) + '</span>' +
      '</div>' +
      '<div style="max-width:264px; margin:18px auto 0;">' +
        '<div style="display:flex; gap:3px; height:8px; border-radius:5px; overflow:hidden;">' + barInner + '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.2px; color:rgba(var(--ink-rgb),0.5); margin-top:10px; line-height:1.55;">' + breakdown + '</div>' +
      '</div>' +
      '<div style="display:inline-flex; align-items:center; gap:7px; margin-top:14px; background:rgba(39,117,202,0.1); border:1px solid rgba(39,117,202,0.35); border-radius:999px; padding:4px 12px;">' +
        '<span style="width:6px; height:6px; border-radius:50%; background:#2775CA; box-shadow:0 0 7px rgba(39,117,202,0.8);"></span>' +
        '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.6);">' + v.pillText + '</span>' +
      '</div>' +
    '</div>';
  }

  function actions(d, v) {
    var amt = '$' + Math.round(Math.abs(d.net) / 100).toLocaleString();
    var primaryLabel = v.square ? "all square"
      : v.youOwe ? "settle up " + amt
      : "request " + amt;
    var primaryEmoji = v.square ? "✨" : v.primaryEmoji;

    return '<div style="margin-top:24px;">' +
      '<button id="fdPrimary" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:56px; border-radius:999px; background:' + v.primaryBg + '; display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:' + v.primaryShadow + ';"' + (v.square ? ' disabled' : '') + '>' +
        '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#fff;">' + primaryLabel + '</span>' +
        '<span style="font-size:16px;">' + primaryEmoji + '</span>' +
      '</button>' +
      '<div style="display:flex; gap:11px; margin-top:11px;">' +
        '<button id="fdNewTab" style="appearance:none; cursor:pointer; flex:1; min-height:50px; border-radius:999px; background:var(--card); border:1px solid rgba(var(--ink-rgb),0.12); display:flex; align-items:center; justify-content:center; gap:7px; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:var(--ink);">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2775CA" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' +
          'new tab' +
        '</button>' +
        '<button id="fdRemind" style="appearance:none; cursor:pointer; flex:1; min-height:50px; border-radius:999px; background:var(--card); border:1px solid rgba(var(--ink-rgb),0.12); display:flex; align-items:center; justify-content:center; gap:7px; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:var(--ink);">' +
          '<span style="font-size:14px;">👀</span>' +
          v.secondaryLabel +
        '</button>' +
      '</div>' +
    '</div>';
  }

  // chip cover colors, cycling like the frame (blue / dark / coral …)
  var CHIP_COVERS = [
    "linear-gradient(135deg,#3a93ec,#2775CA)",
    "var(--ink)",
    "linear-gradient(135deg,#ff8073,#FF6B5E)",
    "linear-gradient(135deg,#5cf0d4,#3DE8C7)",
    "linear-gradient(135deg,#ffd98a,#FFC65C)",
  ];
  function chipStrip(d) {
    if (!d.groups.length) return "";
    var chips = d.groups.map(function (g, i) {
      return '<a href="#/group/' + encodeURIComponent(g.id) + '" style="flex:none; display:flex; align-items:center; gap:9px; background:var(--card); border:2px solid var(--border-ink); border-radius:15px; box-shadow:3px 4px 0 rgba(var(--shadow-rgb),0.85); padding:10px 14px 10px 11px; cursor:pointer; text-decoration:none;">' +
        '<div style="width:30px; height:30px; border-radius:10px; background:' + CHIP_COVERS[i % CHIP_COVERS.length] + '; display:flex; align-items:center; justify-content:center; font-size:15px;">' + app.esc(g.emoji) + '</div>' +
        '<div>' +
          '<div style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:13px; color:var(--ink);">' + app.esc(g.name) + '</div>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:9px; color:rgba(var(--ink-rgb),0.42); margin-top:2px;">' + g.count + ' tab' + (g.count === 1 ? '' : 's') + '</div>' +
        '</div>' +
      '</a>';
    }).join("");
    return '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(var(--ink-rgb),0.42); padding:26px 2px 11px;">TABS TOGETHER</div>' +
      '<div class="fd-chips" style="display:flex; gap:9px; overflow-x:auto; scrollbar-width:none; margin:0 -16px; padding:0 16px 4px;">' + chips + '</div>';
  }

  function feedRow(e) {
    var youOwe = e.dir === "owe";
    var color = youOwe ? "#FF6B5E" : "#2775CA";
    var sub, subColor, metaTile;
    if (e.settled) {
      // settled row — mint "SETTLED" tag + view ↗ (lifted)
      metaTile = 'rgba(61,232,199,0.1)';
      sub = '<div style="display:flex; align-items:center; gap:7px; margin-top:3px;">' +
        '<span style="display:inline-flex; align-items:center; gap:4px; background:rgba(61,232,199,0.12); border:1px solid rgba(61,232,199,0.4); border-radius:999px; padding:1px 8px;"><span style="width:4px; height:4px; border-radius:50%; background:#3DE8C7;"></span><span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:8px; letter-spacing:.5px; color:#3DE8C7;">SETTLED</span></span>' +
        '<span style="font-family:\'Space Mono\',monospace; font-size:10px; color:#2775CA;">view ↗</span>' +
      '</div>';
    } else {
      metaTile = 'var(--card)';
      var label = (youOwe ? "you owe · " : (e.dir === "owed" ? "they owe you · " : "")) + relTime(e.createdAt);
      sub = '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:' + color + '; margin-top:3px;">' + label + '</div>';
    }
    var sign = youOwe ? "−$" : "+$";
    return '<a href="#/receipt/' + encodeURIComponent(e.sig) + '" style="display:flex; align-items:center; gap:13px; padding:12px 6px; cursor:pointer; text-decoration:none; color:inherit;">' +
      '<div style="width:42px; height:42px; border-radius:13px; background:' + metaTile + '; display:flex; align-items:center; justify-content:center; font-size:20px; flex:none;">' + (e.settled ? '🫡' : emojiFor(e.title)) + '</div>' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="display:flex; align-items:center; gap:6px;"><span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:500; font-size:15.5px; color:var(--ink);">' + app.esc(e.title) + '</span><span style="font-family:\'Space Mono\',monospace; font-size:9.5px; color:rgba(var(--ink-rgb),0.4);">· ' + app.esc(e.group) + '</span></div>' +
        sub +
      '</div>' +
      '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:16px; letter-spacing:-0.4px; color:' + color + '; flex:none;"><span style="font-size:11px; opacity:.5;">' + sign + '</span>' + moneyWhole(e.amountCents) + '</div>' +
    '</a>';
  }

  function feed(d) {
    var label = '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(var(--ink-rgb),0.42); padding:24px 2px 11px;">BETWEEN YOU</div>';
    if (!d.feed.length) {
      return label +
        '<div style="display:flex; flex-direction:column; align-items:center; text-align:center; padding:20px 12px; color:rgba(var(--ink-rgb),0.5);">' +
          '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:var(--ink);">no shared tabs yet</div>' +
          '<div style="font-family:\'General Sans\',sans-serif; font-size:13px; margin-top:5px;">start a tab and split something 🍜</div>' +
        '</div>';
    }
    var rows = d.feed.map(function (e, i) {
      var sep = i ? '<div style="height:1px; background:rgba(var(--ink-rgb),0.05); margin:0 6px;"></div>' : '';
      return sep + feedRow(e);
    }).join("");
    return label + '<div style="display:flex; flex-direction:column; gap:3px;">' + rows + '</div>';
  }

  function emojiFor(title) {
    var t = (title || "").toLowerCase();
    if (/din|food|lunch|restaurant|🍜|ramen|pizza|🍕/.test(t)) return "🍜";
    if (/taxi|uber|cab|ride|car/.test(t)) return "🚕";
    if (/groc|market|store|shop/.test(t)) return "🛒";
    if (/coffee|cafe|latte/.test(t)) return "☕️";
    if (/hotel|stay|airbnb|room/.test(t)) return "🏨";
    if (/bar|beer|drink|wine/.test(t)) return "🍻";
    return "🧾";
  }

  function relTime(iso) {
    if (!iso) return "recently";
    var t = new Date(iso).getTime();
    if (isNaN(t)) return "recently";
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return "now";
    var m = s / 60; if (m < 60) return Math.round(m) + "m";
    var h = m / 60; if (h < 24) return Math.round(h) + "h";
    var dys = h / 24; if (dys < 7) return Math.round(dys) + "d";
    return Math.round(dys / 7) + "w";
  }

  function removeRow() {
    // quiet coral "remove friend" at the very bottom (lifted)
    return '<div style="display:flex; justify-content:center; margin-top:26px;">' +
      '<span id="fdRemove" style="font-family:\'General Sans\',sans-serif; font-size:13.5px; color:rgba(255,107,94,0.6); cursor:pointer; padding:8px 16px;">remove friend</span>' +
    '</div>';
  }

  function paint(view, d, friendId) {
    var v = variant(d.net);
    view.innerHTML =
      '<div class="vfill" style="position:relative; font-family:\'General Sans\',sans-serif; color:var(--ink);">' +
      texture(v.glowColor) +
      topbar() +
      '<div class="fd-scroll" style="position:relative; z-index:2; padding:4px 16px 24px;">' +
        header(d, friendId) +
        hero(d, v) +
        actions(d, v) +
        chipStrip(d) +
        feed(d) +
        removeRow() +
      '</div>' +
      '</div>';
    wireBack();

    var copy = document.getElementById("fdCopy");
    if (copy) copy.onclick = function () {
      var f = d.friend || {};
      var w = f.primaryWallet || (f.wallets && f.wallets[0]) || "";
      if (w) app.copy(w).then(function () { app.toast("wallet copied"); }, function () { app.toast(w); });
      else app.toast("no wallet");
    };
    var more = document.getElementById("fdMore");
    if (more) more.onclick = function () { confirmRemove(view, d, friendId); };
    // settle/new need a concrete trip — both screens dead-end without one.
    var sharedTripId = (d.groups && d.groups.length) ? d.groups[0].id : null;
    var prim = document.getElementById("fdPrimary");
    if (prim) prim.onclick = function () {
      if (d.net < 0) {
        if (sharedTripId) location.hash = "#/settle/" + encodeURIComponent(sharedTripId);
        else app.toast("no shared tab to settle — start one first");
      } else if (d.net > 0) {
        // no request backend yet — be honest rather than faking a send.
        app.toast("we'll nudge them — coming soon 👀");
      } else {
        app.toast("you're all square ✨");
      }
    };
    var nt = document.getElementById("fdNewTab");
    if (nt) nt.onclick = function () {
      if (sharedTripId) location.hash = "#/new/" + encodeURIComponent(sharedTripId);
      else app.go("new");
    };
    // remind/nudge has no backend yet — say so honestly instead of faking it.
    var rm = document.getElementById("fdRemind");
    if (rm) rm.onclick = function () { app.toast("we'll nudge them — coming soon 👀"); };
    var del = document.getElementById("fdRemove");
    if (del) del.onclick = function () { confirmRemove(view, d, friendId); };
  }

  function confirmRemove(view, d, friendId) {
    var name = (d.friend && (d.friend.displayName || d.friend.handle)) || "this friend";
    app.sheet(
      '<div style="text-align:center;padding:6px 4px 4px;">' +
        '<h2 class="lower" style="font-size:20px;margin:8px 0 6px;">remove ' + app.esc(name) + '?</h2>' +
        '<div class="hint" style="color:var(--muted);font-size:14px;margin-bottom:18px;">your shared tabs stay — you just won\'t be friends anymore.</div>' +
        '<button class="btn coral" id="fdRemoveYes">remove friend</button>' +
        '<button class="btn ghost" id="fdRemoveNo" style="margin-top:10px;">keep</button>' +
      '</div>'
    );
    var no = document.getElementById("fdRemoveNo");
    if (no) no.onclick = function () { app.closeSheet(); };
    var yes = document.getElementById("fdRemoveYes");
    if (yes) yes.onclick = function () {
      app.closeSheet();
      app.api.del("/api/friends/" + encodeURIComponent(friendId)).then(function () {
        app.toast("removed");
        app.go("friends");
      }, function (e) { app.toast((e && e.message) || "couldn't remove"); });
    };
  }

  function signedOut(view) {
    view.innerHTML =
      '<div class="vfill" style="position:relative;">' +
      texture("rgba(39,117,202,0.20)") +
      topbar() +
      '<div class="empty" style="position:relative; z-index:2; padding-top:60px;">' +
        (window.app ? app.mascot({ size: 120, mood: "wave" }) : '') +
        '<div class="title lower">sign in to see your friend</div>' +
        '<div class="hint">your tabs together live behind your account.</div>' +
        '<button class="btn" id="fdConnect" style="max-width:280px;margin-top:8px;">sign in</button>' +
      '</div>' +
      '</div>';
    wireBack();
    var c = document.getElementById("fdConnect");
    if (c) c.onclick = function () { app.signIn(); };
  }

  function notFound(view, title, hint, mood) {
    view.innerHTML =
      '<div class="vfill" style="position:relative;">' +
      texture("rgba(39,117,202,0.20)") +
      topbar() +
      '<div class="empty" style="position:relative; z-index:2; padding-top:60px;">' +
        (window.app ? app.mascot({ size: 110, mood: mood || "sleepy" }) : '') +
        '<div class="title lower">' + app.esc(title) + '</div>' +
        '<div class="hint">' + app.esc(hint) + '</div>' +
        '<button class="btn ghost" style="max-width:240px;margin-top:8px;" onclick="location.hash=\'#/friends\'">back to friends</button>' +
      '</div>' +
      '</div>';
    wireBack();
  }

  async function signedIn(view, friendId, me) {
    skeleton(view);
    var d;
    try { d = await load(friendId, me); }
    catch (e) {
      notFound(view, "couldn't load this friend", (e && e.message) || "try again", "worried");
      return;
    }
    // Still no identity AND nothing shared → soft not-found.
    if (!d.friend && !d.feed.length && !d.groups.length) {
      notFound(view, "friend not found", "they may have removed you, or the link is stale.", "sleepy");
      return;
    }
    paint(view, d, friendId);
  }

  window.Screens = window.Screens || {};
  window.Screens.friend = {
    title: "friend",
    render: function (view, params) {
      var friendId = (params && params[0]) ? decodeURIComponent(params[0]) : "";
      if (!friendId) { signedOut(view); return; }
      var user = window.Auth && window.Auth.user;
      if (user) { signedIn(view, friendId, user); return; }
      signedOut(view);
      if (window.Auth && window.Auth.onChange) window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("friend/") >= 0) {
          if (u) signedIn(view, friendId, u); else signedOut(view);
        }
      });
    },
  };
})();
