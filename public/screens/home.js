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
      '<a href="#/you" style="text-decoration:none; width:34px; height:34px; border-radius:50%; background:' + me.color + '; display:flex; align-items:center; justify-content:center; font-size:17px; border:2px solid #2B2118;">' + app.face(me.emoji) + '</a>' +
    '</div>';
  }

  // exact "people" row from the frame — now tappable. owed → nudge, owes → settle.
  function personRow(c, i) {
    var pos = c.direction === "owed", neg = c.direction === "owes";
    var col = pos ? "#2775CA" : neg ? "#FF6B5E" : "rgba(43,33,24,0.5)";
    var sub = pos ? "owes you" : neg ? "you owe" : "square ✨";
    var subcol = neg ? "rgba(255,107,94,0.8)" : "rgba(43,33,24,0.4)";
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
        '<div style="font-family:\'General Sans\',sans-serif; font-weight:600; font-size:15.5px; color:#2B2118;">' + app.esc(c.name) + '</div>' +
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
    var subcol = neg ? "rgba(255,107,94,0.8)" : "rgba(43,33,24,0.42)";
    return '<a href="#/group/' + encodeURIComponent(t.tripId || t.id) + '" style="text-decoration:none; display:flex; align-items:center; gap:13px; background:#FFFDF7; border:2px solid #2B2118; border-radius:15px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:11px 14px 11px 11px;">' +
      '<div style="position:relative; width:48px; height:48px; border-radius:13px; background:' + cover + '; display:flex; align-items:center; justify-content:center; font-size:24px; flex:none; overflow:hidden;">' +
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 20% 120%, rgba(255,255,255,0.12) 0 1px, transparent 1px 6px); opacity:.5;"></div>' +
        '<span style="position:relative;">' + emoji + '</span></div>' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; letter-spacing:-0.2px; color:#2B2118;">' + app.esc(name) + '</div>' +
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
    var label = covers ? "in your wallet · ready to settle" : "in your wallet · top up to settle";
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
        return '<div style="width:23px;height:23px;border-radius:50%;background:rgba(11,22,34,0.5);border:2px solid rgba(255,255,255,0.85);' + (i ? "margin-left:-8px;" : "") + 'display:flex;align-items:center;justify-content:center;font-size:12px;">' + app.face(c.emoji || (c.name || "?")[0]) + '</div>';
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
          '<span style="font-family:\'Space Mono\',monospace; font-weight:400; font-size:12px; letter-spacing:1px; color:rgba(43,33,24,0.4);">usdc</span>' +
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
        '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; letter-spacing:-0.2px; color:#2B2118;">' + app.esc(b.title) + '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:0.5px; color:rgba(43,33,24,0.42); margin-top:3px;">' + sub + '</div>' +
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
        '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; letter-spacing:-0.2px; color:#2B2118;">' + app.esc(b.title) + '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:0.5px; color:rgba(43,33,24,0.42); margin-top:3px;">' + sub + '</div>' +
      '</div>' + right + '</div>';
  }

  function sectionLabel(name, count) {
    return '<div style="display:flex; align-items:baseline; gap:10px; margin:30px 2px 14px;">' +
      '<span class="jdoodle" style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:18px; letter-spacing:-0.2px; color:#2B2118;">' + name + '</span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:11px; font-weight:700; color:#FF6B5E;">' + count + ' going!!</span></div>';
  }

  // Onboarding (signed-out): EXACT markup lifted from
  // design/handoff/Onboarding Playful.dc.html — full-bleed welcome with ambient
  // glow + guilloché, the featured mascot, the "divvy" wordmark, a mono kicker,
  // a lowercase value headline, then the action stack. This screen has no
  // bottom tab bar (router hides it for non-toplevel; home stays toplevel so we
  // build a self-contained full-bleed welcome and skip the topbar/tabbar here).
  function signedOut(view) {
    view.innerHTML = '' +
      // ambient glow + guilloché texture over the canvas
      '<div class="vfill" style="position:relative; display:flex; flex-direction:column; padding:0 26px; overflow:hidden;">' +
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 50% 22%, rgba(43,33,24,0.03) 0 1px, transparent 1px 8px); opacity:.7; pointer-events:none;"></div>' +
        '<div style="position:absolute; left:50%; top:24%; width:340px; height:340px; transform:translate(-50%,-50%); border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,0.22), transparent 70%); filter:blur(8px); pointer-events:none;"></div>' +

        // flexible top spacer (capped): on tall phones the hero drifts down
        // instead of hugging the notch; on short viewports it collapses to 12px.
        '<div style="flex:1 1 0; min-height:12px; max-height:90px;"></div>' +

        // ── HERO ── (compact enough to fit short/desktop viewports without scroll)
        '<div style="position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; padding-top:14px;">' +
          // featured mascot (glow) — canonical asset
          app.mascot({ size: 96, mood: "happy", glow: true }) +

          // wordmark: div [slash] vy
          '<div style="display:flex; align-items:center; gap:1px; margin-top:10px;">' +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:700; font-size:40px; line-height:1; letter-spacing:-1.5px; color:#2B2118;">div</span>' +
            '<span style="display:inline-block; width:11px; height:38px; background:#2775CA; border-radius:2px; transform:skewX(-13deg); margin:0 6px; box-shadow:0 0 16px rgba(39,117,202,0.5);"></span>' +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:700; font-size:40px; line-height:1; letter-spacing:-1.5px; color:#2B2118;">vy</span>' +
          '</div>' +

          // mono kicker
          '<span style="font-family:\'Space Mono\',monospace; font-size:11px; font-weight:400; letter-spacing:1.5px; color:rgba(43,33,24,0.45); margin-top:12px;">split bills · settle in seconds</span>' +

          // lowercase value headline
          '<h1 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:23px; line-height:1.16; letter-spacing:-0.6px; text-align:center; text-wrap:pretty; max-width:320px; margin:8px 0 0; color:#2B2118;">split the bill. get your money back — before you leave the table.</h1>' +

          // 3-step strip
          '<div style="display:flex; align-items:center; gap:9px; margin-top:16px;">' +
            '<span style="width:7px; height:7px; border-radius:50%; background:#3DE8C7; box-shadow:0 0 8px rgba(61,232,199,0.7);"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:11px; font-weight:400; letter-spacing:1.5px; color:rgba(43,33,24,0.62);">scan</span>' +
            '<span style="width:24px; height:1.5px; background:rgba(43,33,24,0.16);"></span>' +
            '<span style="width:7px; height:7px; border-radius:50%; background:rgba(43,33,24,0.4);"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:11px; font-weight:400; letter-spacing:1.5px; color:rgba(43,33,24,0.62);">split</span>' +
            '<span style="width:24px; height:1.5px; background:rgba(43,33,24,0.16);"></span>' +
            '<span style="width:7px; height:7px; border-radius:50%; background:rgba(43,33,24,0.4);"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:11px; font-weight:400; letter-spacing:1.5px; color:rgba(43,33,24,0.62);">settle</span>' +
          '</div>' +
        '</div>' +

        '<div style="flex:1; min-height:14px;"></div>' +

        // ── ACTIONS ──
        '<div style="position:relative; z-index:2; display:flex; flex-direction:column; gap:10px; padding-bottom:calc(14px + env(safe-area-inset-bottom));">' +
          // primary: create a wallet (with mono subline)
          '<button id="hCreate" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:56px; border-radius:999px; background:#2775CA; border:2px solid #2B2118; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">' +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#fff;">create a wallet</span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10px; font-weight:400; letter-spacing:0.8px; color:rgba(255,255,255,0.78);">~10 seconds, no app</span>' +
          '</button>' +

          // divider
          '<div style="display:flex; align-items:center; gap:12px; padding:3px 0;">' +
            '<span style="flex:1; height:1px; background:rgba(43,33,24,0.10);"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10px; font-weight:400; letter-spacing:1px; color:rgba(43,33,24,0.4);">or continue with</span>' +
            '<span style="flex:1; height:1px; background:rgba(43,33,24,0.10);"></span>' +
          '</div>' +

          // secondary: apple / google
          '<div style="display:flex; gap:11px;">' +
            '<button id="hApple" style="appearance:none; cursor:pointer; flex:1; min-height:50px; border-radius:999px; background:transparent; border:1px solid rgba(43,33,24,0.18); display:flex; align-items:center; justify-content:center; gap:8px; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#2B2118;">' +
              '<svg width="17" height="17" viewBox="0 0 24 24" fill="#2B2118" aria-hidden="true"><path d="M17.05 12.54c-.02-2.13 1.74-3.15 1.82-3.2-1-1.45-2.54-1.65-3.09-1.67-1.31-.13-2.57.77-3.24.77-.67 0-1.7-.75-2.8-.73-1.44.02-2.77.84-3.51 2.12-1.5 2.6-.38 6.44 1.07 8.55.71 1.03 1.55 2.19 2.66 2.15 1.07-.04 1.47-.69 2.76-.69s1.65.69 2.78.67c1.15-.02 1.87-1.05 2.57-2.09.81-1.2 1.14-2.36 1.16-2.42-.03-.01-2.22-.85-2.24-3.38zM14.94 5.69c.59-.72.99-1.71.88-2.69-.85.03-1.88.57-2.49 1.28-.55.63-1.03 1.64-.9 2.6.95.07 1.92-.48 2.51-1.19z"/></svg>' +
              'apple' +
            '</button>' +
            '<button id="hGoogle" style="appearance:none; cursor:pointer; flex:1; min-height:50px; border-radius:999px; background:transparent; border:1px solid rgba(43,33,24,0.18); display:flex; align-items:center; justify-content:center; gap:8px; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#2B2118;">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.52 12.27c0-.82-.07-1.6-.21-2.36H12v4.46h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.72z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3c-1.08.72-2.45 1.16-4.06 1.16-3.12 0-5.77-2.11-6.71-4.95H1.28v3.09A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.29 14.3a7.21 7.21 0 0 1 0-4.6V6.62H1.28a12 12 0 0 0 0 10.77l4.01-3.09z"/><path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.62l4.01 3.09C6.23 6.86 8.88 4.75 12 4.75z"/></svg>' +
              'google' +
            '</button>' +
          '</div>' +

          // quiet: i already have one
          '<button id="hConnect" style="appearance:none; border:none; background:transparent; cursor:pointer; width:100%; padding:7px 0 2px; font-family:\'General Sans\',sans-serif; font-weight:400; font-size:14.5px; color:rgba(43,33,24,0.55);">i already have one</button>' +

          // reassurance — dollars, just faster (never crypto / seed phrase)
          '<div style="text-align:center; margin-top:4px;">' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10px; font-weight:400; letter-spacing:1px; color:rgba(43,33,24,0.38);">dollars, just faster · settles in seconds</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    var c = document.getElementById("hCreate"), n = document.getElementById("hConnect"),
        ap = document.getElementById("hApple"), gg = document.getElementById("hGoogle");
    // Onboarding goes through the Privy embedded-wallet flow at /embedded: log in
    // with email/social, get an auto-provisioned Solana wallet, and come back
    // signed in (the flow stashes the session token in shared localStorage).
    function privyOnboard(method) {
      // No return param → the Privy flow lands on the "wallet ready" celebration.
      window.location.href = "/embedded/?" + (method ? "method=" + method : "");
    }
    if (c) c.onclick = function () { privyOnboard(); };
    if (ap) ap.onclick = function () { privyOnboard("apple"); };
    if (gg) gg.onclick = function () { privyOnboard("google"); };
    // "i already have one" → connect an injected wallet (Phantom) via SIWS, then
    // show the wallet-ready celebration (connected variant).
    if (n) n.onclick = function () {
      Auth.signInWithWallet().then(function () {
        try { sessionStorage.setItem("divvy.onboardVia", "phantom"); } catch (_) {}
        location.hash = "#/welcome";
      }).catch(function (e) { app.toast(e.message); });
    };
  }

  async function signedIn(view) {
    view.innerHTML = topbar() + '<div class="appscroll"><div class="skeleton" style="height:230px;border-radius:23px;margin:14px 0;"></div><div class="skeleton" style="height:54px;margin:10px 0;"></div><div class="skeleton" style="height:54px;margin:10px 0;"></div></div>';
    var d, bills = [], incoming = [], walletCents = null;
    try {
      var both = await Promise.all([
        app.api.get("/api/me/balances"),
        app.api.get("/api/me/bills").catch(function () { return { bills: [], incoming: [] }; }),
        app.api.get("/api/me/wallet").catch(function () { return null; }),
      ]);
      d = both[0];
      bills = (both[1] && both[1].bills) || [];
      incoming = (both[1] && both[1].incoming) || [];
      if (both[2] && typeof both[2].usdcCents === "number") walletCents = both[2].usdcCents;
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
    var billsHtml = orderedBills.length ? sectionLabel("tabs", orderedBills.length) + '<div style="display:flex; flex-direction:column; gap:11px;">' + orderedBills.map(billCard).join("") + "</div>" : "";

    // Tabs to pay: splits others sent you. Unpaid first, then paid (history).
    var openIncoming = incoming.filter(function (b) { return !(b.mine && b.mine.paid); });
    var paidIncoming = incoming.filter(function (b) { return b.mine && b.mine.paid; });
    var orderedIncoming = openIncoming.concat(paidIncoming);
    var incomingHtml = orderedIncoming.length ? sectionLabel("tabs to pay", orderedIncoming.length) + '<div style="display:flex; flex-direction:column; gap:11px;">' + orderedIncoming.map(incomingCard).join("") + "</div>" : "";
    var groupsHtml = grp.length ? sectionLabel("groups", grp.length) + '<div style="display:flex; flex-direction:column; gap:11px;">' + grp.map(groupCard).join("") + "</div>" : "";

    var emptyHtml = (orderedBills.length || grp.length || orderedIncoming.length) ? "" :
      '<div class="empty" style="padding-top:30px;">' + app.mascot({ size: 96, mood: "happy" }) + '<div class="title lower">no tabs yet</div><div class="hint">start a group and split something 🎉</div><button class="btn" style="max-width:240px;margin-top:8px;" onclick="location.hash=\'#/new\'">new tab</button></div>';

    view.innerHTML = topbar() + '<div class="appscroll" style="padding-top:0;">' + hero(net, owed, owe, ppl, walletCents, quick) + incomingHtml + peopleHtml + billsHtml + groupsHtml + emptyHtml + "</div>";
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
