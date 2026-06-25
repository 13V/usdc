/* screens/friend.js — Friend detail. Net with one friend, shared groups, and a
   "between you" feed. Matches design/frames/Friend Detail Frames.dc.html.
   Route #/friend/<id> (params[0] = friend user id). Wires to GET /api/friends
   to identify the friend, GET /api/me/balances for the net, and (best-effort)
   GET /api/trips + /api/trips/:id to derive shared groups + shared expenses.
   Degrades gracefully when data is thin; never crashes. */
(function () {
  "use strict";
  var app = window.app;

  // ---- small shared bits --------------------------------------------------
  function topbar(friendId) {
    return '<div class="topbar">' +
      '<a class="pill" id="fdBack" style="cursor:pointer;padding:8px 12px;" aria-label="back">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
      '</a>' +
      '<div class="brand"><span class="mark"><span>/</span></span><span class="word">divvy</span></div>' +
      '<span style="width:38px;"></span>' +
      '</div>';
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
  function moneyPlain(cents) { // mono money inline, no kind color
    return app.money(cents, "");
  }

  function skeleton(view, friendId) {
    var rows = "";
    for (var i = 0; i < 4; i++) rows += '<div class="skeleton" style="height:54px;margin:9px 0;"></div>';
    view.innerHTML = topbar(friendId) +
      '<div class="appscroll">' +
        '<div class="skeleton" style="height:84px;width:84px;border-radius:26px;margin:8px auto 16px;"></div>' +
        '<div class="skeleton" style="height:160px;margin:8px 0 18px;"></div>' +
        rows +
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

  // ---- render -------------------------------------------------------------
  function header(d, friendId) {
    var f = d.friend || {};
    var name = f.displayName || f.handle || "friend";
    var handle = f.handle ? "@" + f.handle : "";
    var wallet = f.primaryWallet || (f.wallets && f.wallets[0]) || null;
    var tabs = d.feed.length;
    var since = d.month ? " · since " + d.month + " 🍜" : "";
    var av = app.avatar({ name: name, id: friendId }, "");
    // bump the avatar to the frame's big 84px tile by extending its inline style
    av = av.replace('style="background:',
      'style="width:84px;height:84px;border-radius:26px;font-size:42px;box-shadow:0 14px 34px rgba(39,117,202,0.4);background:');

    return '<div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:8px 0 2px;">' +
      av +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:14px;">' +
        '<span class="display lower" style="font-size:24px;">' + app.esc(name) + '</span>' +
        (handle ? '<span class="mono" style="font-size:12px;color:var(--blue-bright);opacity:.85;">' + app.esc(handle) + '</span>' : '') +
      '</div>' +
      '<div class="mono" style="font-size:10.5px;letter-spacing:.3px;color:var(--faint);margin-top:7px;">' +
        tabs + ' tab' + (tabs === 1 ? '' : 's') + ' together' + since +
      '</div>' +
      (wallet ? '<button class="pill" id="fdCopy" style="margin-top:10px;padding:6px 12px;cursor:pointer;">' +
        '<span class="mono" style="font-size:11px;letter-spacing:.5px;color:var(--muted);">' + app.esc(truncWallet(wallet)) + '</span>' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.5)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>' +
      '</button>' : '') +
    '</div>';
  }

  function hero(d) {
    var net = d.net;
    var youOwe = net < 0;
    var square = net === 0;
    var name = (d.friend && (d.friend.displayName || d.friend.handle)) || "they";
    var first = String(name).trim().split(/\s+/)[0].toLowerCase();
    var label = square ? "you're square" : youOwe ? "you owe " + app.esc(first) : app.esc(first) + " owes you";
    var heroColor = square ? "var(--mint)" : youOwe ? "var(--coral)" : "var(--blue-bright)";
    var heroKind = square ? "settled" : youOwe ? "neg" : "pos";

    var tot = (d.owed + d.owe) || 1;
    var owedPct = d.owed / tot * 100, owePct = d.owe / tot * 100;

    var netSign = net > 0 ? "+" : net < 0 ? "−" : "";
    var netStr = '<span style="color:var(--text);font-weight:700;">' + netSign + '$' +
      Math.abs(net / 100).toLocaleString(undefined, { minimumFractionDigits: 2 }) + '</span>';
    var breakdown =
      'she owes you <span style="color:var(--blue-bright);">$' + (d.owed / 100).toLocaleString(undefined, { minimumFractionDigits: 2 }) + '</span>' +
      ' · you owe her <span style="color:var(--coral);">$' + (d.owe / 100).toLocaleString(undefined, { minimumFractionDigits: 2 }) + '</span>' +
      ' · net ' + netStr;

    return '<div class="receipt glow-blue" style="text-align:center;margin:18px 0 2px;">' +
      '<div class="eyebrow">' + label + '</div>' +
      '<div class="hero-amount ' + heroKind + '" style="margin:8px 0 0;color:' + heroColor + ';">' +
        '<span style="font-size:30px;opacity:.5;">' + (square ? '' : (youOwe ? '−' : '+')) + '$</span>' +
        Math.floor(Math.abs(net) / 100).toLocaleString() +
        '<span style="font-size:30px;opacity:.5;">' + (Math.abs(net) % 100 / 100).toFixed(2).slice(1) + '</span>' +
      '</div>' +
      '<div class="owebar" style="max-width:264px;margin:16px auto 0;height:8px;">' +
        '<div class="pos" style="width:' + owedPct + '%"></div>' +
        '<div class="neg" style="width:' + owePct + '%"></div>' +
      '</div>' +
      '<div class="mono" style="font-size:10px;letter-spacing:.2px;color:var(--muted);margin-top:10px;line-height:1.55;">' +
        breakdown +
      '</div>' +
    '</div>';
  }

  function actions(d) {
    var youOwe = d.net < 0;
    var square = d.net === 0;
    var amtStr = '$' + Math.abs(d.net / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });
    var primaryLabel, primaryEmoji, primaryCoral = false;
    if (youOwe) { primaryLabel = "settle up " + amtStr; primaryEmoji = "✨"; primaryCoral = true; }
    else if (square) { primaryLabel = "all square"; primaryEmoji = "✨"; }
    else { primaryLabel = "request " + amtStr; primaryEmoji = "👀"; }

    return '<div style="margin-top:18px;">' +
      '<button class="btn' + (primaryCoral ? ' coral' : '') + '" id="fdPrimary"' + (square ? ' disabled style="opacity:.55;"' : '') + '>' +
        app.esc(primaryLabel) + ' <span>' + primaryEmoji + '</span>' +
      '</button>' +
      '<div style="display:flex;gap:11px;margin-top:11px;">' +
        '<button class="btn ghost" id="fdNewTab" style="flex:1;min-height:50px;font-size:15px;">＋ new tab</button>' +
        '<button class="btn ghost" id="fdRemind" style="flex:1;min-height:50px;font-size:15px;">👀 ' + (youOwe ? 'nudge' : 'remind') + '</button>' +
      '</div>' +
    '</div>';
  }

  function chipStrip(d) {
    if (!d.groups.length) return "";
    var chips = d.groups.map(function (g) {
      return '<a class="chip" style="flex:none;padding:10px 14px 10px 11px;border-radius:15px;gap:9px;text-decoration:none;color:inherit;" href="#/group/' + encodeURIComponent(g.id) + '">' +
        '<span class="avatar sm" style="width:30px;height:30px;border-radius:10px;font-size:15px;">' + app.esc(g.emoji) + '</span>' +
        '<span style="display:flex;flex-direction:column;align-items:flex-start;">' +
          '<span style="font-weight:500;font-size:13px;">' + app.esc(g.name) + '</span>' +
          '<span class="mono" style="font-size:9px;color:var(--faint);margin-top:2px;">' + g.count + ' tab' + (g.count === 1 ? '' : 's') + '</span>' +
        '</span>' +
      '</a>';
    }).join("");
    return '<div class="eyebrow" style="letter-spacing:1.5px;padding:26px 2px 11px;">tabs together</div>' +
      '<div style="display:flex;gap:9px;overflow-x:auto;scrollbar-width:none;margin:0 -20px;padding:0 20px 4px;">' + chips + '</div>';
  }

  function feedRow(e) {
    var youOwe = e.dir === "owe";
    var color = youOwe ? "var(--coral)" : "var(--blue-bright)";
    var sub = youOwe ? "you owe · " : (e.dir === "owed" ? "she owes you · " : "");
    var when = relTime(e.createdAt);
    return '<a style="display:flex;align-items:center;gap:13px;padding:12px 6px;cursor:pointer;text-decoration:none;color:inherit;" href="#/receipt/' + encodeURIComponent(e.sig) + '">' +
      '<span class="avatar" style="width:42px;height:42px;border-radius:13px;font-size:20px;background:var(--card);">' + emojiFor(e.title) + '</span>' +
      '<span style="flex:1;min-width:0;">' +
        '<span style="display:flex;align-items:center;gap:6px;">' +
          '<span class="display" style="font-weight:500;font-size:15.5px;">' + app.esc(e.title) + '</span>' +
          '<span class="mono" style="font-size:9.5px;color:var(--faint);">· ' + app.esc(e.group) + '</span>' +
        '</span>' +
        '<span class="mono" style="display:block;font-size:10px;letter-spacing:.3px;color:' + color + ';margin-top:3px;">' + sub + when + '</span>' +
      '</span>' +
      '<span style="flex:none;">' + app.money(youOwe ? -e.amountCents : e.amountCents, youOwe ? "neg" : "pos", true) + '</span>' +
    '</a>';
  }

  function feed(d) {
    if (!d.feed.length) {
      return '<div class="eyebrow" style="letter-spacing:1.5px;padding:24px 2px 11px;">between you</div>' +
        '<div class="empty" style="padding:20px 12px;">' +
          (window.app ? app.mascot({ size: 84, mood: "sleepy" }) : '') +
          '<div class="title lower">no shared tabs yet</div>' +
          '<div class="hint">start a tab and split something 🍜</div>' +
        '</div>';
    }
    var rows = d.feed.map(function (e, i) {
      var sep = i ? '<div style="height:1px;background:var(--line);margin:0 6px;"></div>' : '';
      return sep + feedRow(e);
    }).join("");
    return '<div class="eyebrow" style="letter-spacing:1.5px;padding:24px 2px 11px;">between you</div>' +
      '<div style="display:flex;flex-direction:column;">' + rows + '</div>';
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
    return '<div style="display:flex;justify-content:center;margin-top:26px;">' +
      '<span id="fdRemove" style="font-size:13.5px;color:rgba(255,107,94,0.6);cursor:pointer;padding:8px 16px;">remove friend</span>' +
    '</div>';
  }

  function paint(view, d, friendId) {
    view.innerHTML = topbar(friendId) + '<div class="appscroll">' +
      header(d, friendId) +
      hero(d) +
      actions(d) +
      chipStrip(d) +
      feed(d) +
      removeRow() +
    '</div>';
    wireBack();

    var copy = document.getElementById("fdCopy");
    if (copy) copy.onclick = function () {
      var f = d.friend || {};
      var w = f.primaryWallet || (f.wallets && f.wallets[0]) || "";
      if (w && navigator.clipboard) navigator.clipboard.writeText(w).then(function () { app.toast("wallet copied"); }, function () { app.toast(w); });
      else app.toast(w || "no wallet");
    };
    var prim = document.getElementById("fdPrimary");
    if (prim) prim.onclick = function () {
      if (d.net < 0) app.go("settle"); // you owe → settle up
      else if (d.net > 0) app.toast("request sent 👀");
    };
    var nt = document.getElementById("fdNewTab");
    if (nt) nt.onclick = function () { app.go("new"); };
    var rm = document.getElementById("fdRemind");
    if (rm) rm.onclick = function () { app.toast(d.net < 0 ? "you got the nudge 👀" : "remind sent 👀"); };
    var del = document.getElementById("fdRemove");
    if (del) del.onclick = function () { confirmRemove(view, d, friendId); };
  }

  function confirmRemove(view, d, friendId) {
    var name = (d.friend && (d.friend.displayName || d.friend.handle)) || "this friend";
    app.sheet(
      '<div style="text-align:center;padding:6px 4px 4px;">' +
        (window.app ? app.mascot({ size: 96, mood: "worried" }) : '') +
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
      '<div class="topbar"><div class="brand"><span class="mark"><span>/</span></span><span class="word">divvy</span></div></div>' +
      '<div class="empty" style="padding-top:60px;">' +
        (window.app ? app.mascot({ size: 120, mood: "wave" }) : '') +
        '<div class="title lower">connect to see your friend</div>' +
        '<div class="hint">your tabs together live behind your wallet.</div>' +
        '<button class="btn" id="fdConnect" style="max-width:280px;margin-top:8px;">create a wallet</button>' +
      '</div>';
    var c = document.getElementById("fdConnect");
    if (c) c.onclick = function () { if (window.Auth) Auth.createWallet().catch(function (e) { app.toast(e.message); }); };
  }

  async function signedIn(view, friendId, me) {
    skeleton(view, friendId);
    var d;
    try { d = await load(friendId, me); }
    catch (e) {
      view.innerHTML = topbar(friendId) +
        '<div class="empty" style="padding-top:60px;">' +
          (window.app ? app.mascot({ size: 110, mood: "worried" }) : '') +
          '<div class="title lower">couldn\'t load this friend</div>' +
          '<div class="hint">' + app.esc((e && e.message) || "try again") + '</div>' +
        '</div>';
      wireBack();
      return;
    }
    // Still no identity AND nothing shared → soft not-found.
    if (!d.friend && !d.feed.length && !d.groups.length) {
      view.innerHTML = topbar(friendId) +
        '<div class="empty" style="padding-top:60px;">' +
          (window.app ? app.mascot({ size: 110, mood: "sleepy" }) : '') +
          '<div class="title lower">friend not found</div>' +
          '<div class="hint">they may have removed you, or the link is stale.</div>' +
          '<button class="btn ghost" style="max-width:240px;margin-top:8px;" onclick="location.hash=\'#/friends\'">back to friends</button>' +
        '</div>';
      wireBack();
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
