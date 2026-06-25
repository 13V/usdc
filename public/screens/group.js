/* screens/group.js — Group detail / "the ledger". Route #/group/<id>.
   Matches design/frames/Group Detail Frames.dc.html (frame 1 = ledger,
   frame 2 = tab detail, shown as a bottom sheet). See design/BUILD.md. */
(function () {
  "use strict";
  var app = window.app;

  // a friendly group emoji derived from the trip's cluster/name (api has none yet)
  var GROUP_EMOJI = ["🧾", "🍜", "🏝️", "🎟️", "🏠", "🚗", "🍻", "⛺", "🎉", "🌮"];
  function groupEmoji(t) {
    var seed = String((t && (t.id || t.name)) || "");
    var h = 0;
    for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return GROUP_EMOJI[h % GROUP_EMOJI.length];
  }

  function backbar(name, emoji) {
    return '<div class="topbar">' +
      '<span class="pill" id="gBack" style="width:38px;height:38px;padding:0;justify-content:center;border-radius:50%;">‹</span>' +
      '<div style="display:flex;align-items:center;gap:7px;min-width:0;">' +
        '<span class="display lower" style="font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + app.esc(name || "group") + '</span>' +
        (emoji ? '<span style="font-size:16px;">' + app.esc(emoji) + '</span>' : "") +
      '</div>' +
      '<span style="width:38px;"></span>' +
      '</div>';
  }
  function wireBack() {
    var b = document.getElementById("gBack");
    if (b) b.onclick = function () { if (history.length > 1) history.back(); else app.go("groups"); };
  }

  function skeleton(view) {
    var rows = "";
    for (var i = 0; i < 4; i++) rows += '<div class="skeleton" style="height:66px;margin:9px 0;"></div>';
    view.innerHTML = backbar("", "") +
      '<div class="appscroll">' +
        '<div class="skeleton" style="height:96px;margin:6px 0 18px;border-radius:22px;"></div>' +
        '<div class="skeleton" style="height:120px;margin:0 0 18px;"></div>' +
        rows +
      "</div>";
  }

  function empty(view, msg, hint) {
    view.innerHTML = backbar("group", "") +
      '<div class="empty" style="padding-top:60px;">' +
        app.mascot({ size: 116, mood: "worried", glow: true }) +
        '<div class="title lower">' + app.esc(msg || "can't find this group") + '</div>' +
        '<div class="hint">' + app.esc(hint || "the link might be dead, or it isn't yours.") + '</div>' +
        '<button class="btn" style="max-width:240px;margin-top:8px;" onclick="location.hash=\'#/groups\'">your groups</button>' +
      "</div>";
    wireBack();
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

  // ---- arrow svg between two avatars ----
  function arrow() {
    return '<svg width="20" height="11" viewBox="0 0 26 14" fill="none" stroke="var(--faint)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 7h22m-5-5 5 5-5 5"/></svg>';
  }

  // ---- header cover card ----
  function coverCard(trip, emoji) {
    var members = trip.members || [];
    var stack = members.slice(0, 5).map(function (m) {
      return app.avatar({ name: m.name, id: m.id }, "sm");
    }).join("");
    var more = members.length > 5 ? '<span class="eyebrow" style="margin-left:8px;color:rgba(255,255,255,.8);">+' + (members.length - 5) + '</span>' : "";
    var since = "";
    if (trip.createdAt) {
      try {
        since = " · since " + new Date(trip.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toLowerCase();
      } catch (_) {}
    }
    var ntabs = (trip.expenses || []).length;
    return '<div class="receipt paper" style="margin:6px 0 0;border:none;background:linear-gradient(135deg,#2775CA 0%,#2f7fd6 55%,#1f63ab 100%);box-shadow:0 14px 34px rgba(39,117,202,.4);">' +
      '<div style="position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
        '<div style="display:flex;align-items:center;min-width:0;">' +
          '<span style="font-size:24px;margin-right:8px;">' + app.esc(emoji) + '</span>' +
          '<span class="avatar-stack">' + stack + '</span>' + more +
        '</div>' +
        '<div style="text-align:right;flex:none;">' +
          '<div class="eyebrow" style="color:rgba(255,255,255,.72);letter-spacing:1.5px;">group total</div>' +
          '<div style="margin-top:2px;color:#fff;">' + app.money(trip.totalCents || 0, "").replace('class="money "', 'class="money" style="color:#fff;"') + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="position:relative;font-family:var(--mono);font-size:10px;letter-spacing:1px;color:rgba(255,255,255,.78);margin-top:12px;text-transform:lowercase;">' +
        members.length + ' ' + (members.length === 1 ? "person" : "people") + ' · ' + ntabs + ' ' + (ntabs === 1 ? "tab" : "tabs") + since +
      '</div>' +
    '</div>';
  }

  // ---- your-balance hero with two-tone owebar ----
  function heroCard(trip, me) {
    // net for "you": from balances if we found you, else fall back to group total.
    var net = null, haveNet = false;
    if (me && trip.balances) {
      for (var i = 0; i < trip.balances.length; i++) {
        if (trip.balances[i].memberId === me.id) { net = trip.balances[i].cents; haveNet = true; break; }
      }
    }
    var owed = 0, owe = 0;
    (trip.balances || []).forEach(function (b) {
      if (b.cents > 0) owed += b.cents; else if (b.cents < 0) owe += b.cents;
    });
    owe = Math.abs(owe);

    var eyebrow, big, bigColor, label;
    if (haveNet) {
      var kind = net > 0 ? "pos" : net < 0 ? "neg" : "settled";
      bigColor = net > 0 ? "var(--blue-bright)" : net < 0 ? "var(--coral)" : "var(--mint)";
      eyebrow = "your balance";
      label = net > 0 ? "you're owed" : net < 0 ? "you owe" : "all square";
      big = (net === 0 ? "" : (net > 0 ? "+$" : "−$")) + Math.abs(net / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });
      if (net === 0) big = "$0.00";
    } else {
      eyebrow = "group total";
      bigColor = "var(--text)";
      label = "across this group";
      big = "$" + ((trip.totalCents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });
    }

    var tot = owed + owe;
    var bar = tot > 0
      ? '<div class="owebar" style="margin:16px 0 9px;">' +
          '<div class="pos" style="width:' + (owed / tot * 100) + '%"></div>' +
          '<div class="neg" style="width:' + (owe / tot * 100) + '%"></div>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;">' +
          '<span class="mono" style="font-size:10px;color:var(--blue-bright);">＋ $' + (owed / 100).toFixed(2) + ' owed</span>' +
          '<span class="mono" style="font-size:10px;color:var(--coral);">− $' + (owe / 100).toFixed(2) + ' owed</span>' +
        '</div>'
      : '<div class="sub mono" style="margin-top:12px;color:var(--muted);font-size:12px;">no open tabs yet — start one below ✨</div>';

    return '<div style="padding:22px 2px 0;">' +
      '<span class="eyebrow">' + eyebrow + '</span>' +
      '<div style="display:flex;align-items:baseline;gap:11px;margin-top:8px;">' +
        '<div class="hero-amount" style="font-size:46px;color:' + bigColor + ';text-shadow:0 0 26px rgba(39,117,202,.35);">' + big + '</div>' +
        '<span style="font-size:14px;color:var(--muted);" class="lower">' + label + '</span>' +
      '</div>' +
      bar +
    '</div>';
  }

  // ---- quick pills: chat · recap · share ----
  function pillRow() {
    return '<div style="display:flex;gap:9px;margin-top:18px;">' +
      '<div class="pill" id="gChat" style="flex:1;justify-content:center;min-height:42px;">💬 chat</div>' +
      '<div class="pill" id="gRecap" style="flex:1;justify-content:center;min-height:42px;">✨ recap</div>' +
      '<div class="pill" id="gShare" style="flex:1;justify-content:center;min-height:42px;">↗ share</div>' +
    '</div>';
  }

  // ---- who owes who (minimized): debtor -> creditor -> amount ----
  // greedy settle-down of the trip balances into a small set of transfers.
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
      if (amt > 0) edges.push({ from: debtors[i], to: creditors[j], cents: amt });
      debtors[i].cents -= amt; creditors[j].cents -= amt;
      if (debtors[i].cents <= 0) i++;
      if (creditors[j].cents <= 0) j++;
    }
    return edges.slice(0, 6);
  }
  function whoOwesWho(trip, me) {
    var edges = settleEdges(trip.balances);
    if (!edges.length) return "";
    var meId = me && me.id;
    var rows = edges.map(function (e) {
      var fromYou = e.from.id === meId, toYou = e.to.id === meId;
      var fromName = fromYou ? "you" : e.from.name;
      var toName = toYou ? "you" : e.to.name;
      var amtColor = toYou ? "var(--blue-bright)" : fromYou ? "var(--coral)" : "var(--text)";
      return '<div style="display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:11px 14px;">' +
        app.avatar({ name: e.from.name, id: e.from.id }, "sm") +
        '<span class="lower" style="font-size:14px;font-weight:500;color:' + (fromYou ? "var(--muted)" : "var(--text)") + ';">' + app.esc(fromName) + '</span>' +
        arrow() +
        app.avatar({ name: e.to.name, id: e.to.id }, "sm") +
        '<span class="lower" style="font-size:14px;font-weight:500;color:' + (toYou ? "var(--muted)" : "var(--text)") + ';">' + app.esc(toName) + '</span>' +
        '<span style="flex:1;text-align:right;font-family:var(--mono);font-weight:700;font-size:15px;color:' + amtColor + ';">$' + (e.cents / 100).toFixed(2) + '</span>' +
      '</div>';
    }).join("");
    return '<div class="eyebrow" style="margin:24px 0 11px;">who owes who</div>' +
      '<div style="display:flex;flex-direction:column;gap:9px;">' + rows + '</div>';
  }

  // ---- tabs feed: each expense as a .receipt row ----
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
    var d = Math.floor(h / 24);
    return d + "d";
  }
  function tabRow(e, me) {
    var n = (e.participants || []).length || 1;
    var t = ago(e.createdAt);
    // your slice on this tab, if we can tell
    var mineNote = "";
    if (me && e.participants) {
      var share = Math.round((e.amountCents || 0) / n);
      var inSplit = e.participants.indexOf(me.id) >= 0;
      var youPaid = e.paidBy === me.id;
      if (youPaid) {
        var back = (e.amountCents || 0) - (inSplit ? share : 0);
        if (back > 0) mineNote = '<div style="font-family:var(--mono);font-size:9px;color:var(--blue-bright);margin-top:2px;">+$' + (back / 100).toFixed(2) + '</div>';
      } else if (inSplit) {
        mineNote = '<div style="font-family:var(--mono);font-size:9px;color:var(--coral);margin-top:2px;">−$' + (share / 100).toFixed(2) + '</div>';
      }
    }
    return '<div class="gTab" data-eid="' + app.esc(e.id) + '" style="display:flex;align-items:center;gap:13px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:13px 15px;cursor:pointer;">' +
      '<div class="avatar" style="background:var(--ink);border-radius:13px;">' + tabEmoji(e.title) + '</div>' +
      '<div style="flex:1;min-width:0;">' +
        '<div class="display lower" style="font-weight:500;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + app.esc(e.title || "a tab") + '</div>' +
        '<div style="font-family:var(--mono);font-size:10px;color:var(--faint);margin-top:3px;">' +
          app.esc((e.paidByName || "someone").toLowerCase()) + ' paid · split ' + n + (t ? ' · ' + t : "") +
        '</div>' +
      '</div>' +
      '<div style="text-align:right;">' +
        '<div style="font-family:var(--mono);font-weight:700;font-size:16px;">' + app.esc(e.amountFmt || ("$" + ((e.amountCents || 0) / 100).toFixed(2))) + '</div>' +
        mineNote +
      '</div>' +
    '</div>';
  }
  function tabsFeed(trip, me) {
    var exp = (trip.expenses || []).slice().sort(function (a, b) {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
    if (!exp.length) {
      return '<div class="empty" style="padding:30px 20px 6px;">' +
        app.mascot({ size: 90, mood: "happy" }) +
        '<div class="title lower">no tabs yet</div>' +
        '<div class="hint">add the first one and start splitting 🎉</div>' +
      '</div>';
    }
    var header = '<div style="display:flex;align-items:center;justify-content:space-between;margin:24px 0 11px;">' +
      '<span class="eyebrow">tabs</span>' +
      '<span class="eyebrow" style="color:var(--faint);">' + exp.length + ' total</span>' +
    '</div>';
    return header + '<div style="display:flex;flex-direction:column;gap:9px;">' + exp.map(function (e) { return tabRow(e, me); }).join("") + '</div>';
  }

  // ---- tab detail sheet (frame 2) ----
  function openTab(trip, e, me) {
    var n = (e.participants || []).length || 1;
    var each = Math.round((e.amountCents || 0) / n);
    var meId = me && me.id;
    var youOwe = 0;

    var rows = (e.participants || []).map(function (pid) {
      var name = (e.participantNames && e.participantNames[(e.participants || []).indexOf(pid)]) || pid;
      var isYou = pid === meId;
      var paidThis = pid === e.paidBy; // the payer's own share is covered
      // pick a status pill
      var pill;
      if (paidThis) {
        pill = '<span class="state settled" style="font-size:9px;padding:3px 9px;">paid ✓</span>';
      } else if (isYou) {
        youOwe = each;
        pill = '<span class="state owes" style="font-size:9px;padding:3px 9px;">you owe</span>';
      } else {
        pill = '<span class="state owes" style="font-size:9px;padding:3px 9px;">owes</span>';
      }
      var amtColor = paidThis ? "var(--mint)" : isYou ? "var(--coral)" : "var(--text)";
      var wrap = isYou
        ? 'background:rgba(255,107,94,.07);border:1px solid rgba(255,107,94,.22);border-radius:13px;margin:4px -6px 0;padding:11px 10px;'
        : 'padding:9px 4px;border-bottom:1px solid var(--line);';
      return '<div style="display:flex;align-items:center;gap:11px;' + wrap + '">' +
        app.avatar({ name: name, id: pid }, "sm") +
        '<span class="lower" style="flex:1;font-weight:500;font-size:15px;">' + app.esc(isYou ? "you" : name) + '</span>' +
        '<span style="font-family:var(--mono);font-weight:700;font-size:14px;color:' + amtColor + ';">$' + (each / 100).toFixed(2) + '</span>' +
        pill +
      '</div>';
    }).join("");

    var meta = (e.paidByName ? e.paidByName.toLowerCase() + " paid" : "split");
    if (e.createdAt) {
      try { meta += " · " + new Date(e.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toLowerCase(); } catch (_) {}
    }

    var fx = e.fxNote ? '<div class="eyebrow" style="text-align:center;margin-top:10px;color:var(--faint);text-transform:none;">' + app.esc(e.fxNote) + '</div>' : "";

    var settleBtn = youOwe > 0
      ? '<button class="btn coral" id="gTabSettle" style="margin-top:16px;">settle your $' + (youOwe / 100).toFixed(2) + '</button>'
      : '<button class="btn ghost" id="gTabSettle" style="margin-top:16px;">settle up</button>';

    var html =
      '<div style="text-align:center;padding:6px 4px 0;">' +
        '<div class="avatar" style="width:60px;height:60px;border-radius:18px;font-size:30px;background:var(--ink);margin:0 auto;">' + tabEmoji(e.title) + '</div>' +
        '<h2 class="display lower" style="font-size:22px;margin:13px 0 0;">' + app.esc(e.title || "a tab") + '</h2>' +
        '<div class="eyebrow" style="margin-top:4px;">' + app.esc(meta) + '</div>' +
        '<div class="hero-amount" style="font-size:44px;margin-top:14px;">' + app.money(e.amountCents || 0, "") + '</div>' +
      '</div>' +
      '<hr style="border:none;border-top:1.5px dashed var(--line-2);margin:18px 0 6px;">' +
      '<div class="eyebrow" style="margin:6px 2px 6px;">split ' + n + ' · $' + (each / 100).toFixed(2) + ' each</div>' +
      '<div>' + rows + '</div>' +
      fx +
      settleBtn +
      '<div style="display:flex;align-items:center;justify-content:center;gap:18px;margin-top:14px;">' +
        '<span id="gTabDelete" class="lower" style="font-size:14px;color:var(--muted);cursor:pointer;">delete</span>' +
        '<span style="width:3px;height:3px;border-radius:50%;background:var(--faint);"></span>' +
        '<span class="lower" style="font-size:14px;color:var(--muted);cursor:pointer;" onclick="app.closeSheet()">close</span>' +
      '</div>';

    app.sheet(html);
    var s = document.getElementById("gTabSettle");
    if (s) s.onclick = function () { app.closeSheet(); location.hash = "#/settle/" + encodeURIComponent(trip.id); };
    var del = document.getElementById("gTabDelete");
    if (del) del.onclick = function () {
      del.textContent = "deleting…";
      app.api.del("/api/trips/" + encodeURIComponent(trip.id) + "/expenses/" + encodeURIComponent(e.id))
        .then(function () { app.closeSheet(); app.toast("tab deleted"); load(view_, trip.id); })
        .catch(function (err) { app.toast(err.message); del.textContent = "delete"; });
    };
  }

  // ---- sticky bottom: add a tab + settle up ----
  function stickyBar(trip) {
    return '<div style="position:fixed;left:0;right:0;bottom:0;z-index:40;padding:12px 18px calc(18px + env(safe-area-inset-bottom));' +
      'background:linear-gradient(180deg,rgba(11,22,34,0) 0%,var(--ink) 26%);display:flex;gap:11px;max-width:520px;margin:0 auto;">' +
      '<button class="btn ghost" id="gSettle" style="flex:none;width:128px;min-height:54px;">settle up</button>' +
      '<button class="btn" id="gAdd" style="flex:1;min-height:54px;">+ add a tab</button>' +
    '</div>';
  }

  var view_ = null;

  function paint(view, trip) {
    var me = findMe(trip);
    var emoji = groupEmoji(trip);
    view.innerHTML =
      backbar(trip.name, emoji) +
      '<div class="appscroll" style="padding-bottom:140px;">' +
        coverCard(trip, emoji) +
        heroCard(trip, me) +
        pillRow() +
        whoOwesWho(trip, me) +
        tabsFeed(trip, me) +
      '</div>' +
      stickyBar(trip);

    wireBack();

    // pills
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
    if (!id) { empty(view, "no group", "open one from your groups."); return; }
    skeleton(view);
    var trip;
    try {
      trip = await app.api.get("/api/trips/" + encodeURIComponent(id));
    } catch (e) {
      if (e && (e.status === 404 || e.status === 403)) { empty(view, "can't find this group", "the link might be dead, or it isn't yours."); return; }
      view.innerHTML = backbar("group", "") +
        '<div class="empty" style="padding-top:60px;">' + app.mascot({ size: 110, mood: "worried" }) +
        '<div class="title lower">couldn\'t load</div><div class="hint">' + app.esc(e.message || "try again") + '</div></div>';
      wireBack();
      return;
    }
    if (!trip || !trip.id) { empty(view, "can't find this group", "it might be gone."); return; }
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
