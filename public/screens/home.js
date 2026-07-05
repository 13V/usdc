/* screens/home.js — Home / balances.
   Built by lifting the EXACT markup from design/frames/Home Playful.dc.html and
   wiring live data into it, so it pixel-matches the approved design. */
(function () {
  "use strict";
  var app = window.app;

  function meIdentity() {
    var u = (window.Auth && window.Auth.user) || {};
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem("divvy.profile") || "{}") || {}; } catch (_) {}
    return { emoji: u.emoji || saved.emoji || "🦊", color: u.color || saved.color || "#2775CA" };
  }

  function topbar() {
    var me = meIdentity();
    return '' +
    '<div style="display:flex; align-items:center; justify-content:space-between; height:56px; padding:0 18px; flex:none;">' +
      '<div style="display:flex; align-items:center; gap:9px;">' +
        '<div style="width:32px; height:32px; border-radius:10px; background:linear-gradient(150deg,#3286db,#2775CA 60%,#1f5fa8); display:flex; align-items:center; justify-content:center; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">' +
          '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:700; font-size:21px; color:#fff; transform:translateY(-1px);">/</span></div>' +
        '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:21px; letter-spacing:-0.5px; color:#2B2118;">divvy</span>' +
      '</div>' +
      '<a href="#/you" aria-label="your profile" style="text-decoration:none; width:34px; height:34px; border-radius:50%; background:' + me.color + '; display:flex; align-items:center; justify-content:center; font-size:17px; border:2px solid #2B2118;">' + app.face(me.emoji) + '</a>' +
    '</div>';
  }

  // exact "people" row from the frame — now tappable. owed → nudge, owes → settle.
  function personRow(c, i) {
    var pos = c.direction === "owed", neg = c.direction === "owes";
    var col = pos ? "#2775CA" : neg ? "#FF6B5E" : "rgba(43,33,24,0.5)";
    var sub = pos ? "owes you" : neg ? "you owe" : "square ✨";
    var subcol = neg ? "rgba(255,107,94,0.8)" : "rgba(43,33,24,0.6)";
    var av = app.avatar({ name: c.name, emoji: c.emoji, color: c.color });
    // recolor the avatar bg to a soft tint like the frame
    var amt = c.direction === "settled" ? '<span style="font-family:\'Space Mono\',monospace; font-size:13px; color:#3DE8C7;">square ✨</span>'
      : '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:18px; letter-spacing:-0.4px; color:' + col + ';"><span style="opacity:.5;">' + (pos ? "+$" : "−$") + '</span>' + money3(Math.abs(c.cents)) + '</div>';
    // tap affordance: nudge pill for owed, chevron for owes. settled rows stay inert.
    var tappable = pos || neg;
    var affordance = pos
      ? '<span class="pr-nudge" style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:0.5px; color:#2775CA; opacity:.85; margin-left:2px; flex:none;">nudge</span>'
      : neg
      ? '<span style="display:flex; align-items:center; color:rgba(43,33,24,0.28); margin-left:2px; flex:none;"><svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true"><path d="M1 1l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'
      : "";
    var tag = tappable ? "button" : "div";
    var tapAttrs = tappable
      ? ' type="button" data-person="' + i + '" style="appearance:none; border:none; text-align:left; width:100%; background:transparent; cursor:pointer;'
      : ' style="';
    return '<' + tag + tapAttrs + ' display:flex; align-items:center; gap:13px; padding:11px 4px;">' +
      '<div style="width:40px;height:40px;border-radius:50%;background:rgba(39,117,202,0.18);display:flex;align-items:center;justify-content:center;font-size:19px;flex:none;">' + app.face(c.emoji || (c.name||"?")[0]) + '</div>' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="font-family:\'General Sans\',sans-serif; font-weight:600; font-size:15.5px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(c.name) + '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:0.5px; color:' + subcol + '; margin-top:2px;">' + sub + '</div>' +
      '</div>' + amt + affordance + '</' + tag + '>';
  }

  // $ split into whole + .dec, frame-style (caller adds the colored $ prefix)
  function money3(cents) {
    var n = cents / 100, whole = Math.floor(n).toLocaleString(), dec = (n % 1).toFixed(2).slice(1);
    return whole + '<span style="opacity:.5;">' + dec + '</span>';
  }

  var COVERS = [
    "linear-gradient(135deg,#3a93ec,#2775CA 60%,#1d5697)",
    "linear-gradient(135deg,#ff8073,#FF6B5E 60%,#e0493c)",
    "linear-gradient(135deg,#5cf0d4,#3DE8C7 55%,#1fbfa3)",
    "linear-gradient(135deg,#ffd98a,#FFC65C 60%,#e0a83c)",
    "linear-gradient(135deg,#a78bfa,#8B5CF6 60%,#6d28d9)",
  ];
  // Stable per-item cover: hash the id/title so colors vary even when a list
  // has one item (index-based picking made every first card blue).
  function coverSeed(s) {
    var h = 0, str = String(s || "");
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }
  function coverFor(key, i) { return COVERS[(coverSeed(key) + (i || 0)) % COVERS.length]; }
  function groupCard(t, i) {
    var pos = t.netCents > 0, neg = t.netCents < 0, settled = t.netCents === 0;
    var name = t.name || t.tripName || "group";
    var cover = coverFor((t.tripId || t.id || name) + "g", i);
    var emoji = t.emoji || groupEmoji(name);
    var right = settled
      ? '<span style="display:inline-flex; align-items:center; gap:5px; background:rgba(61,232,199,0.14); border:1px solid rgba(61,232,199,0.4); border-radius:999px; padding:5px 11px; flex:none; font-family:\'Space Mono\',monospace; font-size:11px; color:#3DE8C7;">square ✨</span>'
      : '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:17px; letter-spacing:-0.4px; color:' + (pos ? "#2775CA" : "#FF6B5E") + ';"><span style="opacity:.5;">' + (pos ? "+$" : "−$") + '</span>' + money3(Math.abs(t.netCents)) + '</div>';
    var sub = settled ? (t.memberCount ? t.memberCount + " people" : "all square") : (pos ? "owed to you" : "you owe");
    var subcol = neg ? "rgba(255,107,94,0.8)" : "rgba(43,33,24,0.6)";
    return '<a href="#/group/' + encodeURIComponent(t.tripId || t.id) + '" style="text-decoration:none; display:flex; align-items:center; gap:13px; background:#FFFDF7; border:2px solid #2B2118; border-radius:15px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:11px 14px 11px 11px;">' +
      '<div style="position:relative; width:48px; height:48px; border-radius:13px; background:' + cover + '; display:flex; align-items:center; justify-content:center; font-size:24px; flex:none; overflow:hidden;">' +
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 20% 120%, rgba(255,255,255,0.12) 0 1px, transparent 1px 6px); opacity:.5;"></div>' +
        '<span style="position:relative;">' + emoji + '</span></div>' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; letter-spacing:-0.2px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(name) + '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:0.5px; color:' + subcol + '; margin-top:3px;">' + sub + '</div>' +
      '</div>' + right + '</a>';
  }
  function groupEmoji(name) {
    var n = (name || "").toLowerCase();
    if (/tokyo|japan|trip|travel|flight/.test(n)) return "🗼";
    if (/apart|rent|house|home|flat/.test(n)) return "🏠";
    if (/bali|beach|island|vacation/.test(n)) return "🏝️";
    if (/room|mate/.test(n)) return "🧻";
    if (/food|dinner|lunch|eat/.test(n)) return "🍜";
    return "✨";
  }

  // "$X in your wallet · ready to settle / top up to settle" — shown when you
  // owe money, so you instantly know whether you can clear it now. Mirrors
  // group.js walletReadyChip.
  function heroWalletChip(walletCents, oweCents) {
    if (walletCents == null || oweCents <= 0) return "";
    var covers = walletCents >= oweCents;
    var c = covers ? "#3DE8C7" : "#FF6B5E";
    var label = covers ? "your balance · ready to settle" : "your balance · top up to settle";
    return '<div style="display:inline-flex; align-items:center; gap:7px; margin-top:10px; margin-left:8px; border:1px solid ' + c + '55; background:' + c + '1f; border-radius:999px; padding:4px 11px;">' +
      '<span style="width:6px; height:6px; border-radius:50%; background:' + c + '; box-shadow:0 0 7px ' + c + 'cc;"></span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:10px; color:' + c + ';">$' + (walletCents / 100).toFixed(2) + '</span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(43,33,24,0.55);">' + label + '</span>' +
    '</div>';
  }
  // Inner HTML for the big hero figure at a given (absolute) cents value — the
  // $/−$ prefix and .xx suffix stay small; the whole-dollar part is the headline.
  // Shared by first paint and app.countUp so the animated frames match exactly.
  function heroBalanceInner(absCents, pos) {
    return '<span style="font-size:34px; opacity:.5;">' + (pos ? "$" : "−$") + '</span>' +
      Math.floor(absCents / 100).toLocaleString() +
      '<span style="font-size:34px; opacity:.5;">' + (absCents % 100 / 100).toFixed(2).slice(1) + '</span>';
  }

  function hero(net, owed, owe, ppl, walletCents, quick) {
    var pos = net >= 0;
    var col = pos ? "#2775CA" : "#FF6B5E";
    var owedSeg = Math.max(owed, 1), oweSeg = Math.max(owe, 1);
    // avatars riding the bar (those who owe you on blue, you-owe on coral)
    function av(list) {
      return list.slice(0, 3).map(function (c, i) {
        return '<div style="width:23px;height:23px;border-radius:50%;background:rgba(11,22,34,0.5);border:2px solid rgba(255,255,255,0.85);' + (i ? "margin-left:-8px;" : "") + 'display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;font-family:\'Space Mono\',monospace;font-weight:700;">' + app.face(c.emoji || (c.name || "?")[0].toUpperCase()) + '</div>';
      }).join("");
    }
    var owers = ppl.filter(function (c) { return c.direction === "owed"; });
    var owees = ppl.filter(function (c) { return c.direction === "owes"; });
    var bar = (owe > 0 || owed > 0) ? '<div style="display:flex; height:30px; border-radius:999px; overflow:hidden; gap:3px; margin-top:18px;">' +
        (owed > 0 ? '<div style="flex:' + owedSeg + '; background:linear-gradient(90deg,#2775CA,#3f97ee); display:flex; align-items:center; padding-left:9px;">' + av(owers) + '</div>' : '') +
        (owe > 0 ? '<div style="flex:' + oweSeg + '; background:linear-gradient(90deg,#FF6B5E,#ff8073); display:flex; align-items:center; justify-content:flex-end; padding-right:7px;">' + av(owees) + '</div>' : '') +
      '</div>' : "";

    return '<div style="position:relative; background:#FFFDF7; border:2px solid #2B2118; border-radius:18px; box-shadow:4px 5px 0 rgba(43,33,24,0.9); padding:22px 20px 22px; margin-top:14px; transform:rotate(-0.5deg);">' +
      // washi tape holding the page down
      '<div style="position:absolute; top:-13px; left:34%; width:86px; height:24px; background:rgba(61,232,199,0.55); transform:rotate(-5deg); border-left:1.5px dashed rgba(43,33,24,0.25); border-right:1.5px dashed rgba(43,33,24,0.25); pointer-events:none;"></div>' +
      '<div style="position:relative;">' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:1.5px; color:rgba(43,33,24,0.5);">' + (pos ? "the squad owes u" : "u owe the squad") + ' · ' + (window.__grpCount || 0) + ' groups</div>' +
        '<div style="display:flex; align-items:baseline; gap:9px; margin-top:10px;">' +
          '<div id="hBalance" style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:64px; line-height:.9; letter-spacing:-2.5px; color:' + col + ';">' + heroBalanceInner(Math.abs(net), pos) + '</div>' +
          '<span style="font-family:\'Space Mono\',monospace; font-weight:400; font-size:12px; letter-spacing:1px; color:rgba(43,33,24,0.6);">usdc</span>' +
        '</div>' +
        (owe > 0 && pos ? '<div style="font-family:\'General Sans\',sans-serif; font-weight:400; font-size:14px; color:rgba(43,33,24,0.55); margin-top:12px;">you owe <span style="font-family:\'Space Mono\',monospace; font-weight:700; color:#FF6B5E;">$' + (owe / 100).toFixed(2) + '</span> elsewhere</div>' : '<div style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(43,33,24,0.55); margin-top:12px;">' + (net === 0 ? "you're all square ✨" : pos ? "everyone owes you 🤑" : "time to settle up 💸") + '</div>') +
        '<div style="display:inline-flex; align-items:center; gap:7px; margin-top:14px; border:1px solid rgba(39,117,202,0.4); background:rgba(39,117,202,0.10); border-radius:999px; padding:4px 11px;">' +
          '<span style="width:6px; height:6px; border-radius:50%; background:#2775CA; box-shadow:0 0 7px rgba(39,117,202,0.8);"></span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:0.5px; color:rgba(43,33,24,0.62);">settles instantly · ~$0.001 fee</span>' +
        '</div>' + heroWalletChip(walletCents, owe) + bar +
        '<div style="position:relative; height:1px; margin:20px -20px 16px; border-top:1.5px dashed rgba(43,33,24,0.16);">' +
          '<div style="position:absolute; left:-7px; top:-8px; width:15px; height:15px; border-radius:50%; background:#F7F1E3;"></div>' +
          '<div style="position:absolute; right:-7px; top:-8px; width:15px; height:15px; border-radius:50%; background:#F7F1E3;"></div>' +
        '</div>' +
        '<div style="display:flex; gap:11px;">' +
          '<button id="hSettle" style="appearance:none; cursor:pointer; flex:1; min-height:52px; border-radius:999px; background:#2775CA; border:2px solid #2B2118; box-shadow:3px 3px 0 rgba(43,33,24,0.9); font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding:0 12px;">' + (quick ? "settle " + app.esc(String(quick.tripName || "up").toLowerCase().slice(0, 14)) : "settle up") + '</button>' +
          '<button id="hRequest" style="appearance:none; cursor:pointer; flex:1; min-height:52px; border-radius:999px; background:#FFFDF7; border:2px solid #2B2118; font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#2B2118;">request</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // A standalone "tab" (bill) the user sent — a shareable split that isn't a
  // persistent group. Tapping opens its collect screen to track who's paid.
  function billCard(b, i) {
    var cover = coverFor((b.id || b.title || "") + "b", i);
    var emoji = groupEmoji(b.title);
    var done = b.settled;
    var paid = b.paidCount || 0, ppl = b.peopleCount || 0;
    var right = done
      ? '<span style="display:inline-flex; align-items:center; gap:5px; background:rgba(61,232,199,0.14); border:1px solid rgba(61,232,199,0.4); border-radius:999px; padding:5px 11px; flex:none; font-family:\'Space Mono\',monospace; font-size:11px; color:#3DE8C7;">paid ✨</span>'
      : '<div style="text-align:right; flex:none;"><div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:17px; letter-spacing:-0.4px; color:#2775CA;"><span style="opacity:.5;">$</span>' + money3(b.outstandingCents) + '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:0.5px; color:rgba(43,33,24,0.4); margin-top:2px;">left</div></div>';
    var sub = done ? (ppl + (ppl === 1 ? " person" : " people")) : (paid + " of " + ppl + " paid");
    return '<a href="#/collect/' + encodeURIComponent(b.id) + '" style="text-decoration:none; display:flex; align-items:center; gap:13px; background:#FFFDF7; border:2px solid #2B2118; border-radius:15px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:11px 14px 11px 11px;">' +
      '<div style="position:relative; width:48px; height:48px; border-radius:13px; background:' + cover + '; display:flex; align-items:center; justify-content:center; font-size:24px; flex:none; overflow:hidden;">' +
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 20% 120%, rgba(255,255,255,0.12) 0 1px, transparent 1px 6px); opacity:.5;"></div>' +
        '<span style="position:relative;">' + emoji + '</span></div>' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; letter-spacing:-0.2px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(b.title) + '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:0.5px; color:rgba(43,33,24,0.6); margin-top:3px;">' + sub + '</div>' +
      '</div>' + right + '</a>';
  }

  // An INCOMING "tab" — a split someone else sent you where a share is yours.
  // Shows the title + your share, and a "pay" button that opens the in-app pay
  // flow (mine.payPath → /pay/<billId>/<yourName>). Paid shares show a chip.
  function incomingCard(b, i) {
    var cover = coverFor((b.id || b.title || "") + "b", i);
    var emoji = groupEmoji(b.title);
    var mine = b.mine || {};
    var paid = !!mine.paid;
    var right = paid
      ? '<span style="display:inline-flex; align-items:center; gap:5px; background:rgba(61,232,199,0.14); border:1px solid rgba(61,232,199,0.4); border-radius:999px; padding:5px 11px; flex:none; font-family:\'Space Mono\',monospace; font-size:11px; color:#3DE8C7;">paid ✨</span>'
      : '<a href="' + app.esc(mine.payPath || ("/pay/" + encodeURIComponent(b.id))) + '" style="text-decoration:none; display:inline-flex; align-items:center; gap:6px; background:#2775CA; border:2px solid #2B2118; border-radius:999px; padding:9px 16px; flex:none; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">' +
          '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:14px; color:#fff;">pay <span style="font-family:\'Space Mono\',monospace;">' + app.esc(mine.amountFmt || "") + '</span></span>' +
        '</a>';
    var sub = paid ? "you paid your share" : "your share";
    return '<div style="display:flex; align-items:center; gap:13px; background:#FFFDF7; border:2px solid #2B2118; border-radius:15px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:11px 14px 11px 11px;">' +
      '<div style="position:relative; width:48px; height:48px; border-radius:13px; background:' + cover + '; display:flex; align-items:center; justify-content:center; font-size:24px; flex:none; overflow:hidden;">' +
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 20% 120%, rgba(255,255,255,0.12) 0 1px, transparent 1px 6px); opacity:.5;"></div>' +
        '<span style="position:relative;">' + emoji + '</span></div>' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; letter-spacing:-0.2px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(b.title) + '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:0.5px; color:rgba(43,33,24,0.6); margin-top:3px;">' + sub + '</div>' +
      '</div>' + right + '</div>';
  }

  function sectionLabel(name, count) {
    return '<div style="display:flex; align-items:baseline; gap:10px; margin:30px 2px 14px;">' +
      '<span class="jdoodle" style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:18px; letter-spacing:-0.2px; color:#2B2118;">' + name + '</span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:11px; font-weight:700; color:#FF6B5E;">' + count + ' going!!</span></div>';
  }

  // ── DEMO PLAYGROUND ─────────────────────────────────────────────────────────
  // "try it first": one tap → burner wallet (Auth.createWallet) → seed a lively
  // sample world VIA THE REAL API so every screen has life → land on a signed-in
  // home with the dismissible demo banner (managed by app.js render()).
  //
  // Seeding is idempotent-ish (localStorage flag divvy.demoSeeded) and resilient:
  // any API hiccup toasts once and we STILL land on home. Money stays integer
  // cents throughout. This never runs for a plain Auth.createWallet() (e2e path)
  // — only via the try-it button below.
  var DEMO_MODE_KEY = "divvy.demoMode";
  var DEMO_SEEDED_KEY = "divvy.demoSeeded";
  function demoModeOn() {
    try { return localStorage.getItem(DEMO_MODE_KEY) === "1"; } catch (_) { return false; }
  }

  async function seedDemoWorld() {
    // idempotent-ish: if a previous tap already seeded on this device, skip.
    try { if (localStorage.getItem(DEMO_SEEDED_KEY) === "1") return; } catch (_) {}

    // 1) a group with 3 guest friends + 4 fun expenses. members[0] ("you") is
    //    auto-linked to the demo account server-side, so home's hero picks it up.
    var trip = await app.api.post("/api/trips", {
      name: "tokyo trip 🗼",
      members: [{ name: "you" }, { name: "kenji" }, { name: "mei" }, { name: "leo" }],
    });
    var idOf = {};
    (trip.members || []).forEach(function (m) { idOf[m.name] = m.id; });
    var everyone = (trip.members || []).map(function (m) { return m.id; });
    // integer-dollar totals (server converts to cents); "you" fronts the big ones
    // so the demo home shows a healthy "owed to you" hero.
    var expenses = [
      { title: "sushi omakase 🍣", total: 240, paidBy: idOf["you"], participants: everyone },
      { title: "shibuya karaoke 🎤", total: 88, paidBy: idOf["kenji"], participants: everyone },
      { title: "shinkansen tickets 🚅", total: 520, paidBy: idOf["you"], participants: everyone },
      { title: "convini snacks 🍙", total: 36, paidBy: idOf["mei"], participants: everyone },
    ];
    for (var i = 0; i < expenses.length; i++) {
      await app.api.post("/api/trips/" + encodeURIComponent(trip.id) + "/expenses", expenses[i]);
    }

    // 2) one standalone itemized tab (bills API supports `items` — "who had what").
    //    The demo account's wallet is bound as collector automatically.
    await app.api.post("/api/bills", {
      title: "izakaya night 🏮",
      total: 96,
      names: ["kenji", "mei", "leo"],
      items: [
        { label: "yakitori skewers", qty: 3, cents: 2700, names: ["kenji", "mei", "leo"] },
        { label: "highballs", qty: 4, cents: 3200, names: ["kenji", "leo"] },
        { label: "gyoza", qty: 1, cents: 900, names: ["mei"] },
        { label: "tako wasabi", qty: 1, cents: 800, names: ["kenji"] },
      ],
    });

    try { localStorage.setItem(DEMO_SEEDED_KEY, "1"); } catch (_) {}
  }

  async function startDemo(btn) {
    if (btn) {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.dataset.label = btn.textContent;
      btn.textContent = "setting up your demo…";
    }
    app.track("try_demo");
    // burner wallet + SIWS. If even this fails there's nothing to explore, so bail.
    try {
      await Auth.createWallet();
    } catch (e) {
      app.toast((e && e.message) || "couldn't start the demo");
      if (btn) { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
      return;
    }
    // Flag demo mode BEFORE the final render so app.js paints the demo banner.
    try { localStorage.setItem(DEMO_MODE_KEY, "1"); } catch (_) {}
    // Seed the sample world. Resilient: a failure toasts but we still land home.
    try {
      await seedDemoWorld();
    } catch (e) {
      app.toast("demo data hiccup — you're still in ✨");
    }
    // Re-render through the router so the signed-in home shows the seeded world
    // AND the demo banner gets injected.
    try { location.hash = "#/home"; } catch (_) {}
    app.render();
  }

  // A hand-built mini UI vignette (not a screenshot): a small journal card with a
  // kicker, a bespoke mock, and a caption. Used for the below-the-fold story.
  function vignette(kicker, mock, caption) {
    return '<div style="background:#FFFDF7; border:2px solid #2B2118; border-radius:18px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:16px 16px 15px;">' +
      '<div style="font-family:\'Space Mono\',monospace; font-size:10px; font-weight:700; letter-spacing:2px; color:#3DE8C7; margin-bottom:11px;">' + kicker + '</div>' +
      mock +
      '<div style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:14.5px; line-height:1.35; color:#2B2118; margin-top:13px;">' + caption + '</div>' +
    '</div>';
  }
  // person chip: soft-tinted avatar + name, for the "who had what" mock.
  function tag(emoji, name) {
    return '<span style="display:inline-flex; align-items:center; gap:5px; background:rgba(39,117,202,0.10); border:1px solid rgba(39,117,202,0.28); border-radius:999px; padding:3px 9px 3px 5px;">' +
      '<span style="width:18px; height:18px; border-radius:50%; background:rgba(39,117,202,0.18); display:inline-flex; align-items:center; justify-content:center; font-size:11px;">' + app.face(emoji) + '</span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:10px; color:rgba(43,33,24,0.7);">' + app.esc(name) + '</span></span>';
  }
  // vignette 1 — a receipt with two item rows, each tagged to who had it.
  function mockReceipt() {
    function row(label, price, tags) {
      return '<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 0; border-bottom:1.5px dashed rgba(43,33,24,0.14);">' +
        '<div style="min-width:0;">' +
          '<div style="font-family:\'General Sans\',sans-serif; font-weight:600; font-size:12.5px; color:#2B2118;">' + label + '</div>' +
          '<div style="display:flex; gap:5px; margin-top:5px;">' + tags + '</div>' +
        '</div>' +
        '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:12.5px; color:#2B2118; flex:none;">' + price + '</span>' +
      '</div>';
    }
    return '<div style="background:#F7F1E3; border:2px solid #2B2118; border-radius:12px; padding:12px 13px 10px; box-shadow:inset 0 0 0 1px rgba(255,255,255,0.4);">' +
      '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">' +
        '<span style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:1px; color:rgba(43,33,24,0.45);">RECEIPT · 3 items</span>' +
        '<span style="font-size:13px;">🧾</span>' +
      '</div>' +
      row("sushi omakase", "$48", tag("🦊", "you") + tag("🐹", "mei")) +
      row("karaoke room", "$22", tag("🐢", "leo") + tag("🐼", "kenji")) +
    '</div>';
  }
  // vignette 2 — an iMessage-style bubble with a pay-your-share link, no app.
  function mockText() {
    return '<div style="display:flex; flex-direction:column; gap:8px;">' +
      '<div style="align-self:flex-start; max-width:82%; background:#EDE7D8; border:1.5px solid rgba(43,33,24,0.14); border-radius:15px 15px 15px 4px; padding:9px 12px;">' +
        '<span style="font-family:\'General Sans\',sans-serif; font-size:12.5px; color:#2B2118;">you owe $24 for karaoke 🎤</span>' +
      '</div>' +
      '<div style="align-self:flex-end; max-width:88%; background:#2775CA; border:2px solid #2B2118; border-radius:15px 15px 4px 15px; padding:10px 13px; box-shadow:2px 3px 0 rgba(43,33,24,0.85);">' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.5px; color:rgba(255,255,255,0.7);">divvy.app/pay ↗</div>' +
        '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:5px;">' +
          '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:14px; color:#fff;">pay $24</span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:9px; color:rgba(255,255,255,0.85); background:rgba(255,255,255,0.18); border-radius:999px; padding:3px 8px;">tap to pay →</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }
  // vignette 3 — a mini balance card + a cash-out chip.
  function mockBalance() {
    return '<div style="background:linear-gradient(150deg,#3286db,#2775CA 65%,#1f5fa8); border:2px solid #2B2118; border-radius:14px; padding:14px 15px; box-shadow:2px 3px 0 rgba(43,33,24,0.85);">' +
      '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:1px; color:rgba(255,255,255,0.7);">YOUR BALANCE</div>' +
      '<div style="display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-top:4px;">' +
        '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:30px; letter-spacing:-1.5px; color:#fff;"><span style="opacity:.55; font-size:18px;">$</span>128<span style="opacity:.55; font-size:18px;">.00</span></div>' +
        '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:12px; color:#2B2118; background:#3DE8C7; border:1.5px solid #2B2118; border-radius:999px; padding:5px 11px;">cash out →</span>' +
      '</div>' +
    '</div>';
  }
  // The small trust chip row. "built on solana" appears here ONCE (this audience
  // loves it) and stays subtle.
  function trustChip(label) {
    return '<span style="display:inline-flex; align-items:center; gap:6px; font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(43,33,24,0.6); border:1px solid rgba(43,33,24,0.14); border-radius:999px; padding:5px 11px;">' +
      '<span style="width:5px; height:5px; border-radius:50%; background:#3DE8C7;"></span>' + label + '</span>';
  }

  // ---- friend tabs (running 1:1 ledgers — see screens/tabs.js) ----
  function friendTabsLabel(count) {
    return '<div style="display:flex; align-items:baseline; gap:10px; margin:30px 2px 14px;">' +
      '<span class="jdoodle" style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:18px; letter-spacing:-0.2px; color:#2B2118;">friend tabs</span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:11px; font-weight:700; color:#FF6B5E;">' + count + ' running</span>' +
      '<a href="#/tabs" style="margin-left:auto; text-decoration:none; font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.5px; color:#2775CA;">all →</a></div>';
  }
  function friendTabRow(t) {
    var f = t.friend || {};
    var name = f.displayName || f.handle || "friend";
    var first = String(name).trim().split(/\s+/)[0].toLowerCase();
    var pos = t.direction === "owed", neg = t.direction === "owes";
    var col = pos ? "#2775CA" : neg ? "#FF6B5E" : "#3DE8C7";
    var sub = pos ? first + " owes you" : neg ? "you owe " + first : "square ✨";
    var amt = t.direction === "settled"
      ? '<span style="font-family:\'Space Mono\',monospace; font-size:12px; color:#3DE8C7; flex:none;">square ✨</span>'
      : '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:18px; letter-spacing:-0.4px; color:' + col + '; flex:none;"><span style="opacity:.5;">' + (pos ? "+$" : "−$") + '</span>' + money3(Math.abs(t.balanceCents)) + '</div>';
    return '<a href="#/tab/' + encodeURIComponent(f.id || "") + '" style="text-decoration:none; display:flex; align-items:center; gap:13px; padding:11px 4px;">' +
      '<div style="width:40px;height:40px;border-radius:50%;background:rgba(39,117,202,0.18);display:flex;align-items:center;justify-content:center;font-size:19px;flex:none;">' + app.face(f.emoji || (name || "?")[0]) + '</div>' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="font-family:\'General Sans\',sans-serif; font-weight:600; font-size:15.5px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(name) + '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:0.5px; color:' + (neg ? "rgba(255,107,94,0.8)" : "rgba(43,33,24,0.6)") + '; margin-top:2px;">' + app.esc(sub) + '</div>' +
      '</div>' + amt +
      '<span style="display:flex; align-items:center; color:rgba(43,33,24,0.28); margin-left:2px; flex:none;"><svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true"><path d="M1 1l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
    '</a>';
  }
  // ---- shared subscriptions (auto-split netflix & co — see screens/subscriptions.js) ----
  // With none yet: a quiet dashed entry card. With some: a compact summary card
  // showing the count and what they cost you per month.
  function subsCard(subsData) {
    var subs = (subsData && subsData.subscriptions) || [];
    if (!subs.length) {
      return '<a href="#/subscriptions" style="display:flex; align-items:center; gap:11px; margin-top:14px; padding:13px 15px; border:1.5px dashed rgba(43,33,24,0.28); border-radius:15px; text-decoration:none; cursor:pointer;">' +
        '<span style="font-size:19px; flex:none;">🍿</span>' +
        '<span style="flex:1; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:14px; color:rgba(43,33,24,0.7);">shared subscriptions — split netflix & co automatically</span>' +
        '<span style="font-family:\'Space Mono\',monospace; font-size:12px; color:#2775CA; flex:none;">→</span>' +
      '</a>';
    }
    var t = subsData.totals || {};
    var mine = (t.yourMonthlyCents || 0) > 0;
    var cents = mine ? t.yourMonthlyCents : (t.monthlyCents || 0);
    var label = mine ? "cost you" : "run";
    return '<a href="#/subscriptions" style="text-decoration:none; display:flex; align-items:center; gap:13px; margin-top:14px; background:#FFFDF7; border:2px solid #2B2118; border-radius:15px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:11px 14px 11px 11px;">' +
      '<div style="width:48px; height:48px; border-radius:13px; background:rgba(39,117,202,0.14); display:flex; align-items:center; justify-content:center; font-size:24px; flex:none;">🍿</div>' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; letter-spacing:-0.2px; color:#2B2118;">subscriptions</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:0.5px; color:rgba(43,33,24,0.6); margin-top:3px;">' + subs.length + ' on autopilot · ' + label + '</div>' +
      '</div>' +
      '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:17px; letter-spacing:-0.4px; color:#FF6B5E;"><span style="opacity:.5;">$</span>' + money3(cents) + '<span style="font-size:10px; opacity:.45;">/mo</span></div>' +
    '</a>';
  }

  // ---- ask mochi (natural-language entry — see screens/mochi.js) ----
  // A journal-note card: type "add $7 coffee with sam" and mochi handles it.
  function askMochiCard() {
    return '<a href="#/mochi" style="text-decoration:none; display:flex; align-items:center; gap:12px; margin-top:14px; background:#FFFDF7; border:2px solid #2B2118; border-radius:15px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:11px 14px 11px 11px;">' +
      '<div style="width:48px; height:48px; border-radius:13px; background:rgba(61,232,199,0.18); display:flex; align-items:center; justify-content:center; flex:none;">' + (window.Mascot ? window.Mascot.mini(30) : "🐸") + '</div>' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; letter-spacing:-0.2px; color:#2B2118;">ask mochi</div>' +
        '<div style="font-family:\'General Sans\',sans-serif; font-style:italic; font-size:12.5px; color:rgba(43,33,24,0.6); margin-top:3px;">&ldquo;add $7 coffee with sam&rdquo; · &ldquo;who owes me?&rdquo;</div>' +
      '</div>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:12px; color:#2775CA; flex:none;">→</span>' +
    '</a>';
  }
  // floating mochi bubble: quick jump to the ask screen from anywhere on home.
  function mochiFab() {
    return '<button id="mochiFab" aria-label="ask mochi" style="position:fixed; right:16px; bottom:calc(96px + env(safe-area-inset-bottom)); z-index:45; appearance:none; cursor:pointer; width:54px; height:54px; border-radius:50%; background:#FFFDF7; border:2px solid #2B2118; box-shadow:3px 3.5px 0 rgba(43,33,24,0.9); display:flex; align-items:center; justify-content:center; transform:rotate(3deg);">' +
      (window.Mascot ? window.Mascot.mini(30) : "🐸") +
    '</button>';
  }

  // quiet dashed entry point so tabs stay reachable from home before the first one
  function startTabCard() {
    return '<a href="#/tabs" style="display:flex; align-items:center; gap:11px; margin-top:26px; padding:13px 15px; border:1.5px dashed rgba(43,33,24,0.28); border-radius:15px; text-decoration:none; cursor:pointer;">' +
      '<span style="font-size:19px; flex:none;">☕️</span>' +
      '<span style="flex:1; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:14px; color:rgba(43,33,24,0.7);">running tabs — keep a "+$7 coffee" ledger with a friend</span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:12px; color:#2775CA; flex:none;">→</span>' +
    '</a>';
  }

  // Onboarding (signed-out): a mobile-first MINI-LANDING for cold traffic.
  // Above the fold: waving Mochi, the value headline, a one-line subhead, the
  // primary sign-in CTA (unchanged), and a high-visibility "try it first" button.
  // Below the fold (scrollable): three hand-built UI vignettes telling the
  // product story, a trust-chip row, then footer links. The router hides the tab
  // bar on the signed-out home, so this is a self-contained full-bleed screen.
  function signedOut(view) {
    var ios = app.isIOS && app.isIOS();
    var primaryLabel = ios ? "continue with apple" : "sign in";
    var appleIcon = ios
      ? '<svg width="19" height="19" viewBox="0 0 24 24" fill="#fff" aria-hidden="true" style="margin-top:-1px;"><path d="M17.05 12.54c-.02-2.13 1.74-3.15 1.82-3.2-1-1.45-2.54-1.65-3.09-1.67-1.31-.13-2.57.77-3.24.77-.67 0-1.7-.75-2.8-.73-1.44.02-2.77.84-3.51 2.12-1.5 2.6-.38 6.44 1.07 8.55.71 1.03 1.55 2.19 2.66 2.15 1.07-.04 1.47-.69 2.76-.69s1.65.69 2.78.67c1.15-.02 1.87-1.05 2.57-2.09.81-1.2 1.14-2.36 1.16-2.42-.03-.01-2.22-.85-2.24-3.38zM14.94 5.69c.59-.72.99-1.71.88-2.69-.85.03-1.88.57-2.49 1.28-.55.63-1.03 1.64-.9 2.6.95.07 1.92-.48 2.51-1.19z"/></svg>'
      : "";

    view.innerHTML = '' +
      // ── ABOVE THE FOLD ── a full-viewport hero (min-height:100% resolves
      // against #view). Direct child of #view so the % height works.
      '<section style="position:relative; box-sizing:border-box; min-height:100%; display:flex; flex-direction:column; align-items:center; padding:0 24px; overflow:hidden;">' +
        // ambient glow + guilloché texture
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 50% 20%, rgba(43,33,24,0.03) 0 1px, transparent 1px 8px); opacity:.7; pointer-events:none;"></div>' +
        '<div style="position:absolute; left:50%; top:22%; width:340px; height:340px; transform:translate(-50%,-50%); border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,0.22), transparent 70%); filter:blur(8px); pointer-events:none;"></div>' +

        '<div style="flex:1 1 0; min-height:12px; max-height:80px;"></div>' +

        '<div style="position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; padding-top:12px;">' +
          // waving mascot
          app.mascot({ size: 96, mood: "wave", glow: true }) +

          // wordmark: div [slash] vy
          '<div style="display:flex; align-items:center; gap:1px; margin-top:8px;">' +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:700; font-size:40px; line-height:1; letter-spacing:-1.5px; color:#2B2118;">div</span>' +
            '<span style="display:inline-block; width:11px; height:38px; background:#2775CA; border-radius:2px; transform:skewX(-13deg); margin:0 6px; box-shadow:0 0 16px rgba(39,117,202,0.5);"></span>' +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:700; font-size:40px; line-height:1; letter-spacing:-1.5px; color:#2B2118;">vy</span>' +
          '</div>' +

          // value headline
          '<h1 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:25px; line-height:1.14; letter-spacing:-0.6px; text-align:center; text-wrap:pretty; max-width:320px; margin:14px 0 0; color:#2B2118;">split bills. settle in dollars. instantly.</h1>' +

          // one-liner subhead
          '<p style="font-family:\'General Sans\',sans-serif; font-weight:400; font-size:14.5px; line-height:1.45; text-align:center; text-wrap:pretty; max-width:300px; margin:10px 0 0; color:rgba(43,33,24,0.6);">scan the receipt, tap who had what, and your friends pay from a text — no app needed.</p>' +
        '</div>' +

        '<div style="flex:1 1 0; min-height:16px;"></div>' +

        // ── ACTIONS ──
        '<div style="position:relative; z-index:2; width:100%; display:flex; flex-direction:column; gap:11px; padding-bottom:14px;">' +
          // primary: sign in (unchanged flow)
          '<button id="hSignIn" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:56px; border-radius:999px; background:#2775CA; border:2px solid #2B2118; display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">' +
            appleIcon +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#fff;">' + primaryLabel + '</span>' +
          '</button>' +

          // high-visibility secondary: try it first — no sign up
          '<button id="hTry" style="appearance:none; cursor:pointer; width:100%; min-height:54px; border-radius:999px; background:#FFFDF7; border:2px solid #2B2118; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:3px 3px 0 rgba(43,33,24,0.85);">' +
            '<span style="font-size:17px;">👀</span>' +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#2B2118;">try it first — no sign up</span>' +
          '</button>' +

          // tertiary: phone or email → same sign-in flow
          '<div style="text-align:center; margin-top:2px;">' +
            '<button id="hPhone" style="appearance:none; border:none; background:transparent; cursor:pointer; padding:5px 8px; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:13px; color:rgba(43,33,24,0.6); text-decoration:underline; text-underline-offset:2px;">or continue with phone or email</button>' +
          '</div>' +
        '</div>' +

        // scroll cue
        '<div style="position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; gap:3px; padding-bottom:10px;">' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1px; color:rgba(43,33,24,0.35);">how it works</span>' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.35)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
        '</div>' +
      '</section>' +

      // ── BELOW THE FOLD ── (scrolls into view)
      '<section style="position:relative; padding:6px 20px calc(30px + env(safe-area-inset-bottom)); display:flex; flex-direction:column; gap:13px;">' +
        vignette("STEP ONE", mockReceipt(), "scan the receipt → tap who had what. no math, no spreadsheet.") +
        vignette("STEP TWO", mockText(), "friends pay from a text — no app, no sign-up, just a link.") +
        vignette("STEP THREE", mockBalance(), "money lands in your balance. cash out to your bank anytime.") +

        // trust chips (built on solana appears once, subtle)
        '<div style="display:flex; flex-wrap:wrap; gap:7px; justify-content:center; margin-top:6px;">' +
          trustChip("instant") + trustChip("~$0.001 fee") + trustChip("built on solana") + trustChip("non-custodial") +
        '</div>' +

        // footer links (server-rendered pages)
        '<div style="text-align:center; margin-top:14px; font-family:\'Space Mono\',monospace; font-size:11px; color:rgba(43,33,24,0.45);">' +
          '<a href="/terms" style="color:rgba(43,33,24,0.5); text-decoration:none;">terms</a>' +
          '<span style="opacity:.4;"> · </span>' +
          '<a href="/privacy" style="color:rgba(43,33,24,0.5); text-decoration:none;">privacy</a>' +
          '<span style="opacity:.4;"> · </span>' +
          '<a href="/support" style="color:rgba(43,33,24,0.5); text-decoration:none;">support</a>' +
        '</div>' +
      '</section>';

    var si = document.getElementById("hSignIn"),
        ph = document.getElementById("hPhone"),
        tryBtn = document.getElementById("hTry");
    // Onboarding goes through the Privy embedded-wallet flow at /embedded.
    if (si) si.onclick = function () { app.signIn(); };
    if (ph) ph.onclick = function () { app.signIn("phone"); };
    // "try it first": instant burner + seeded demo world (see startDemo).
    if (tryBtn) tryBtn.onclick = function () { startDemo(tryBtn.querySelector("span:last-child") || tryBtn); };
  }

  // First-run "how it works" journal card — shown once, right after the first
  // sign-in, then dismissed for good via localStorage. Three plain-English steps,
  // zero crypto words: split → they pay their share → money's yours.
  var HOW_KEY = "divvy.seenHowItWorks";
  function seenHow() {
    try { return localStorage.getItem(HOW_KEY) === "1"; } catch (_) { return true; }
  }
  function markHowSeen() {
    try { localStorage.setItem(HOW_KEY, "1"); } catch (_) {}
  }
  function howStep(n, emoji, text) {
    return '<div style="display:flex; align-items:center; gap:11px;">' +
      '<div style="width:30px; height:30px; border-radius:9px; background:#F7F1E3; border:2px solid #2B2118; display:flex; align-items:center; justify-content:center; font-size:15px; flex:none; box-shadow:2px 2px 0 rgba(43,33,24,0.85);">' + emoji + '</div>' +
      '<div style="flex:1; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:14px; color:#2B2118;">' + text + '</div>' +
      '<div style="font-family:\'Space Mono\',monospace; font-size:11px; font-weight:700; color:rgba(43,33,24,0.32); flex:none;">' + n + '</div>' +
    '</div>';
  }
  function howItWorksCard() {
    return '<div id="howCard" style="position:relative; background:#FFFDF7; border:2px solid #2B2118; border-radius:18px; box-shadow:4px 5px 0 rgba(43,33,24,0.9); padding:18px 18px 16px; margin-top:14px;">' +
      '<div id="howClose" role="button" aria-label="close" tabindex="0" style="position:absolute; top:11px; right:11px; width:28px; height:28px; border-radius:50%; background:rgba(43,33,24,0.05); border:1px solid rgba(43,33,24,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.55)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></div>' +
      '<div style="font-family:\'Space Mono\',monospace; font-size:10px; font-weight:700; letter-spacing:2px; color:#3DE8C7;">HOW IT WORKS</div>' +
      '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:19px; letter-spacing:-0.4px; color:#2B2118; margin:5px 0 15px;">three taps, you\'re square.</div>' +
      '<div style="display:flex; flex-direction:column; gap:12px;">' +
        howStep("1", "🧾", "split a bill with your people") +
        howStep("2", "💸", "they pay their share") +
        howStep("3", "🎉", "the money\'s yours — in dollars") +
      '</div>' +
      '<button id="howGot" style="appearance:none; cursor:pointer; width:100%; min-height:44px; margin-top:16px; border-radius:999px; background:#2775CA; border:2px solid #2B2118; box-shadow:3px 3px 0 rgba(43,33,24,0.9); font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:15px; color:#fff;">got it ✨</button>' +
    '</div>';
  }
  function wireHowCard(view) {
    var card = view.querySelector("#howCard");
    if (!card) return;
    function dismiss() { markHowSeen(); if (card && card.parentNode) card.parentNode.removeChild(card); }
    var close = view.querySelector("#howClose"), got = view.querySelector("#howGot");
    if (close) { close.onclick = dismiss; close.onkeydown = function (e) { if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); dismiss(); } }; }
    if (got) got.onclick = dismiss;
  }

  async function signedIn(view) {
    view.innerHTML = topbar() + '<div class="appscroll"><div class="skeleton" style="height:230px;border-radius:23px;margin:14px 0;"></div><div class="skeleton" style="height:54px;margin:10px 0;"></div><div class="skeleton" style="height:54px;margin:10px 0;"></div></div>';
    var d, bills = [], incoming = [], walletCents = null, friendTabs = [], subsData = null;
    try {
      var both = await Promise.all([
        app.api.get("/api/me/balances"),
        app.api.get("/api/me/bills").catch(function () { return { bills: [], incoming: [] }; }),
        app.api.get("/api/me/wallet").catch(function () { return null; }),
        app.api.get("/api/tabs").catch(function () { return { tabs: [] }; }),
        app.api.get("/api/subscriptions").catch(function () { return null; }),
      ]);
      d = both[0];
      bills = (both[1] && both[1].bills) || [];
      incoming = (both[1] && both[1].incoming) || [];
      if (both[2] && typeof both[2].usdcCents === "number") walletCents = both[2].usdcCents;
      friendTabs = (both[3] && both[3].tabs) || [];
      subsData = both[4];
    }
    catch (e) { view.innerHTML = topbar() + '<div class="empty"><div class="title lower">couldn\'t load balances</div><div class="hint">' + app.esc(e.message) + "</div></div>"; return; }
    var t = d.totals || {}, net = t.netCents || 0, owed = t.owedCents || 0, owe = t.owesCents || 0;
    // Archived groups stay out of the home hub (they live behind the groups
    // screen's "archived" toggle).
    var ppl = d.counterparties || [], grp = (d.trips || []).filter(function (g) { return !(g && g.archived); });
    window.__grpCount = grp.length;

    // Quick-settle: if you owe money in EXACTLY one group, the hero's settle
    // button jumps straight there instead of bouncing through the groups list.
    var oweGroups = grp.filter(function (g) { return (g.netCents || 0) < 0; });
    var quick = (owe > 0 && oweGroups.length === 1) ? oweGroups[0] : null;

    // Open tabs first (most recent), then settled ones — they collapse out of
    // sight once everyone's paid but stay tappable in history.
    var openBills = bills.filter(function (b) { return !b.settled; });
    var doneBills = bills.filter(function (b) { return b.settled; });
    var orderedBills = openBills.concat(doneBills);

    var peopleHtml = ppl.length ? sectionLabel("people", ppl.length) + '<div style="display:flex; flex-direction:column; gap:3px;">' + ppl.map(personRow).join("") + "</div>" : "";
    // friend tabs: running 1:1 ledgers. With none yet, a quiet dashed card keeps
    // the tabs screen reachable from home.
    var friendTabsHtml = friendTabs.length
      ? friendTabsLabel(friendTabs.length) + '<div style="display:flex; flex-direction:column; gap:3px;">' + friendTabs.map(friendTabRow).join("") + "</div>"
      : startTabCard();
    var billsHtml = orderedBills.length ? sectionLabel("tabs", orderedBills.length) + '<div style="display:flex; flex-direction:column; gap:11px;">' + orderedBills.map(billCard).join("") + "</div>" : "";

    // Tabs to pay: splits others sent you. Unpaid first, then paid (history).
    var openIncoming = incoming.filter(function (b) { return !(b.mine && b.mine.paid); });
    var paidIncoming = incoming.filter(function (b) { return b.mine && b.mine.paid; });
    var orderedIncoming = openIncoming.concat(paidIncoming);
    var incomingHtml = orderedIncoming.length ? sectionLabel("tabs to pay", orderedIncoming.length) + '<div style="display:flex; flex-direction:column; gap:11px;">' + orderedIncoming.map(incomingCard).join("") + "</div>" : "";
    var groupsHtml = grp.length ? sectionLabel("groups", grp.length) + '<div style="display:flex; flex-direction:column; gap:11px;">' + grp.map(groupCard).join("") + "</div>" : "";

    var emptyHtml = (orderedBills.length || grp.length || orderedIncoming.length) ? "" :
      '<div class="empty" style="padding-top:30px;">' + app.mascot({ size: 96, mood: "happy" }) + '<div class="title lower">no tabs yet</div><div class="hint">start a group and split something 🎉</div><button class="btn" style="max-width:240px;margin-top:8px;" onclick="location.hash=\'#/new\'">new tab</button></div>';

    // Suppress the first-run "how it works" card for demo-mode users — the demo
    // banner (injected by app.js) already carries the orientation, and stacking
    // both reads as clutter.
    var howHtml = (seenHow() || demoModeOn()) ? "" : howItWorksCard();
    view.innerHTML = topbar() + '<div class="appscroll" style="padding-top:0;">' + howHtml + hero(net, owed, owe, ppl, walletCents, quick) + askMochiCard() + incomingHtml + peopleHtml + friendTabsHtml + subsCard(subsData) + billsHtml + groupsHtml + emptyHtml + "</div>" + mochiFab();
    wireHowCard(view);
    var fab = view.querySelector("#mochiFab");
    if (fab) fab.onclick = function () { location.hash = "#/mochi"; };
    // count the hero balance up from zero, and stagger the card list in.
    if (app.countUp) {
      var balEl = document.getElementById("hBalance");
      if (balEl) app.countUp(balEl, Math.abs(net), function (c) { return heroBalanceInner(c, net >= 0); });
    }
    if (app.enter) app.enter(view.querySelector(".appscroll"));
    var s = document.getElementById("hSettle"), rq = document.getElementById("hRequest");
    if (s) s.onclick = function () {
      if (quick) location.hash = "#/settle/" + encodeURIComponent(quick.tripId);
      else app.go("groups");
    };
    if (rq) rq.onclick = function () { app.go("new"); };

    // people rows are tappable: owed → nudge, owes → settle (resolve a single group or fall back to groups).
    function settlePerson(c) {
      // try to resolve the one group this debt maps to; otherwise just open groups.
      var pid = c.tripId || c.groupId;
      if (!pid) {
        var matches = grp.filter(function (g) { return (g.netCents || 0) < 0; });
        if (matches.length === 1) pid = matches[0].tripId || matches[0].id;
      }
      if (pid) location.hash = "#/settle/" + encodeURIComponent(pid);
      else app.go("groups");
    }
    function nudgePerson(c, btn) {
      if (btn) btn.disabled = true;
      // pass the wallet too so the nudge can resolve to a real user and land in
      // their notifications (name alone usually can't be resolved).
      app.api.post("/api/nudge", { name: c.name, wallet: c.wallet || undefined, kind: "owed" }).then(function (r) {
        app.toast(r && r.sent ? (r.nudgeNumber >= 4 ? "🦆 deployed" : "nudge sent ✨") : "reminder saved 📌");
        app.haptic(20);
      }).catch(function (e) {
        app.toast((e && e.message) || "couldn't nudge");
      }).then(function () {
        if (btn) btn.disabled = false;
      });
    }
    var personBtns = view.querySelectorAll("[data-person]");
    Array.prototype.forEach.call(personBtns, function (btn) {
      btn.onclick = function () {
        var c = ppl[+btn.getAttribute("data-person")];
        if (!c) return;
        if (c.direction === "owed") nudgePerson(c, btn);
        else if (c.direction === "owes") settlePerson(c);
      };
    });

    // pull-to-refresh: re-run signedIn (which returns a promise) on the scroll area.
    if (app.pullToRefresh) {
      var scrollEl = view.querySelector(".appscroll");
      if (scrollEl) app.pullToRefresh(scrollEl, function () { return signedIn(view); });
    }
  }

  window.Screens = window.Screens || {};
  var authUnsub = null; // single auth listener; released each render so it can't leak
  window.Screens.home = {
    title: "home",
    render: function (view) {
      if (authUnsub) { authUnsub(); authUnsub = null; }
      var user = window.Auth && window.Auth.user;
      if (user) return signedIn(view);
      signedOut(view);
      if (window.Auth && window.Auth.onChange) authUnsub = window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("home") >= 0) { if (u) signedIn(view); else signedOut(view); }
      });
    },
  };
})();
