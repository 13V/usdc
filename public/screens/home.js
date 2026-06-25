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
        '<div style="width:32px; height:32px; border-radius:10px; background:linear-gradient(150deg,#3286db,#2775CA 60%,#1f5fa8); display:flex; align-items:center; justify-content:center; box-shadow:0 5px 14px rgba(39,117,202,0.4), inset 0 1px 0 rgba(255,255,255,0.25);">' +
          '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:700; font-size:21px; color:#fff; transform:translateY(-1px);">/</span></div>' +
        '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:21px; letter-spacing:-0.5px; color:#F4F7FA;">divvy</span>' +
      '</div>' +
      '<a href="#/you" style="text-decoration:none; width:34px; height:34px; border-radius:50%; background:' + me.color + '; display:flex; align-items:center; justify-content:center; font-size:17px; border:2px solid #0B1622;">' + app.esc(me.emoji) + '</a>' +
    '</div>';
  }

  // exact "people" row from the frame
  function personRow(c) {
    var pos = c.direction === "owed", neg = c.direction === "owes";
    var col = pos ? "#3B92E8" : neg ? "#FF6B5E" : "rgba(244,247,250,0.5)";
    var sub = pos ? "owes you" : neg ? "you owe" : "square ✨";
    var subcol = neg ? "rgba(255,107,94,0.8)" : "rgba(244,247,250,0.4)";
    var av = app.avatar({ name: c.name, emoji: c.emoji, color: c.color });
    // recolor the avatar bg to a soft tint like the frame
    var amt = c.direction === "settled" ? '<span style="font-family:\'Space Mono\',monospace; font-size:13px; color:#3DE8C7;">square ✨</span>'
      : '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:18px; letter-spacing:-0.4px; color:' + col + ';"><span style="opacity:.5;">' + (pos ? "+$" : "−$") + '</span>' + money3(Math.abs(c.cents)) + '</div>';
    return '<div style="display:flex; align-items:center; gap:13px; padding:11px 4px;">' +
      '<div style="width:40px;height:40px;border-radius:50%;background:rgba(39,117,202,0.18);display:flex;align-items:center;justify-content:center;font-size:19px;flex:none;">' + (c.emoji || app.esc((c.name||"?")[0])) + '</div>' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="font-family:\'General Sans\',sans-serif; font-weight:600; font-size:15.5px; color:#F4F7FA;">' + app.esc(c.name) + '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:0.5px; color:' + subcol + '; margin-top:2px;">' + sub + '</div>' +
      '</div>' + amt + '</div>';
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
  function groupCard(t, i) {
    var pos = t.netCents > 0, neg = t.netCents < 0, settled = t.netCents === 0;
    var cover = COVERS[i % COVERS.length];
    var emoji = t.emoji || groupEmoji(t.name);
    var right = settled
      ? '<span style="display:inline-flex; align-items:center; gap:5px; background:rgba(61,232,199,0.14); border:1px solid rgba(61,232,199,0.4); border-radius:999px; padding:5px 11px; flex:none; font-family:\'Space Mono\',monospace; font-size:11px; color:#3DE8C7;">square ✨</span>'
      : '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:17px; letter-spacing:-0.4px; color:' + (pos ? "#3B92E8" : "#FF6B5E") + ';"><span style="opacity:.5;">' + (pos ? "+$" : "−$") + '</span>' + money3(Math.abs(t.netCents)) + '</div>';
    var sub = settled ? (t.memberCount ? t.memberCount + " people" : "all square") : (pos ? "owed to you" : "you owe");
    var subcol = neg ? "rgba(255,107,94,0.8)" : "rgba(244,247,250,0.42)";
    return '<a href="#/group/' + encodeURIComponent(t.tripId || t.id) + '" style="text-decoration:none; display:flex; align-items:center; gap:13px; background:#13212E; border:1px solid rgba(244,247,250,0.06); border-radius:18px; padding:11px 14px 11px 11px;">' +
      '<div style="position:relative; width:48px; height:48px; border-radius:13px; background:' + cover + '; display:flex; align-items:center; justify-content:center; font-size:24px; flex:none; overflow:hidden;">' +
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 20% 120%, rgba(255,255,255,0.12) 0 1px, transparent 1px 6px); opacity:.5;"></div>' +
        '<span style="position:relative;">' + emoji + '</span></div>' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; letter-spacing:-0.2px; color:#F4F7FA;">' + app.esc(t.name) + '</div>' +
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

  function hero(net, owed, owe, ppl) {
    var pos = net >= 0;
    var col = pos ? "#3B92E8" : "#FF6B5E";
    var owedSeg = Math.max(owed, 1), oweSeg = Math.max(owe, 1);
    // avatars riding the bar (those who owe you on blue, you-owe on coral)
    function av(list) {
      return list.slice(0, 3).map(function (c, i) {
        return '<div style="width:23px;height:23px;border-radius:50%;background:rgba(11,22,34,0.5);border:2px solid rgba(255,255,255,0.85);' + (i ? "margin-left:-8px;" : "") + 'display:flex;align-items:center;justify-content:center;font-size:12px;">' + (c.emoji || (c.name || "?")[0]) + '</div>';
      }).join("");
    }
    var owers = ppl.filter(function (c) { return c.direction === "owed"; });
    var owees = ppl.filter(function (c) { return c.direction === "owes"; });
    var bar = (owe > 0 || owed > 0) ? '<div style="display:flex; height:30px; border-radius:999px; overflow:hidden; gap:3px; margin-top:18px;">' +
        (owed > 0 ? '<div style="flex:' + owedSeg + '; background:linear-gradient(90deg,#2775CA,#3f97ee); display:flex; align-items:center; padding-left:9px;">' + av(owers) + '</div>' : '') +
        (owe > 0 ? '<div style="flex:' + oweSeg + '; background:linear-gradient(90deg,#FF6B5E,#ff8073); display:flex; align-items:center; justify-content:flex-end; padding-right:7px;">' + av(owees) + '</div>' : '') +
      '</div>' : "";

    return '<div style="position:relative; background:#13212E; border-radius:23px 23px 0 0; box-shadow:0 14px 36px rgba(0,0,0,0.32); padding:20px 20px 30px; overflow:hidden;">' +
      '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 88% 0%, rgba(255,255,255,0.045) 0 1px, transparent 1px 8px); opacity:.7; pointer-events:none;"></div>' +
      '<div style="position:absolute; top:18px; bottom:18px; right:14px; width:3px; background:repeating-linear-gradient(180deg, rgba(39,117,202,0.65) 0 5px, transparent 5px 11px); opacity:.5; pointer-events:none;"></div>' +
      '<div style="position:relative;">' +
        '<div style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:12.5px; color:rgba(244,247,250,0.5);">' + (pos ? "you're owed" : "you're down") + ' · across ' + (window.__grpCount || 0) + ' groups</div>' +
        '<div style="display:flex; align-items:baseline; gap:9px; margin-top:10px;">' +
          '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:64px; line-height:.9; letter-spacing:-2.5px; color:' + col + '; text-shadow:0 0 36px ' + (pos ? "rgba(59,146,232,0.5)" : "rgba(255,107,94,0.45)") + ';"><span style="font-size:34px; opacity:.5;">' + (pos ? "$" : "−$") + '</span>' + Math.floor(Math.abs(net) / 100).toLocaleString() + '<span style="font-size:34px; opacity:.5;">' + (Math.abs(net) % 100 / 100).toFixed(2).slice(1) + '</span></div>' +
          '<span style="font-family:\'Space Mono\',monospace; font-weight:400; font-size:12px; letter-spacing:1px; color:rgba(244,247,250,0.4);">usdc</span>' +
        '</div>' +
        (owe > 0 && pos ? '<div style="font-family:\'General Sans\',sans-serif; font-weight:400; font-size:14px; color:rgba(244,247,250,0.55); margin-top:12px;">you owe <span style="font-family:\'Space Mono\',monospace; font-weight:700; color:#FF6B5E;">$' + (owe / 100).toFixed(2) + '</span> elsewhere</div>' : '<div style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(244,247,250,0.55); margin-top:12px;">' + (net === 0 ? "you're all square ✨" : pos ? "everyone owes you 🤑" : "time to settle up 💸") + '</div>') +
        '<div style="display:inline-flex; align-items:center; gap:7px; margin-top:14px; border:1px solid rgba(39,117,202,0.4); background:rgba(39,117,202,0.10); border-radius:999px; padding:4px 11px;">' +
          '<span style="width:6px; height:6px; border-radius:50%; background:#3B92E8; box-shadow:0 0 7px rgba(59,146,232,0.8);"></span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:0.5px; color:rgba(244,247,250,0.62);">settles instantly · ~$0.001 fee</span>' +
        '</div>' + bar +
        '<div style="position:relative; height:1px; margin:20px -20px 16px; border-top:1.5px dashed rgba(244,247,250,0.16);">' +
          '<div style="position:absolute; left:-7px; top:-8px; width:15px; height:15px; border-radius:50%; background:#0B1622;"></div>' +
          '<div style="position:absolute; right:-7px; top:-8px; width:15px; height:15px; border-radius:50%; background:#0B1622;"></div>' +
        '</div>' +
        '<div style="display:flex; gap:11px;">' +
          '<button id="hSettle" style="appearance:none; border:none; cursor:pointer; flex:1; min-height:52px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff; box-shadow:0 8px 24px rgba(39,117,202,0.42);">settle up</button>' +
          '<button id="hRequest" style="appearance:none; cursor:pointer; flex:1; min-height:52px; border-radius:999px; background:transparent; border:1px solid rgba(244,247,250,0.2); font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#F4F7FA;">request</button>' +
        '</div>' +
      '</div>' +
      '<div style="position:absolute; bottom:-1px; left:0; right:0; height:13px; background:radial-gradient(circle at 9px 13px, #0B1622 0 6px, transparent 6.5px); background-size:18px 13px; background-repeat:repeat-x;"></div>' +
    '</div>';
  }

  function sectionLabel(name, count) {
    return '<div style="display:flex; align-items:baseline; gap:10px; margin:30px 2px 14px;">' +
      '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:18px; letter-spacing:-0.2px; color:#F4F7FA;">' + name + '</span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:11px; color:rgba(244,247,250,0.4);">' + count + '</span></div>';
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
      '<div style="position:relative; min-height:100%; display:flex; flex-direction:column; padding:0 26px; overflow:hidden;">' +
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 50% 22%, rgba(244,247,250,0.03) 0 1px, transparent 1px 8px); opacity:.7; pointer-events:none;"></div>' +
        '<div style="position:absolute; left:50%; top:24%; width:340px; height:340px; transform:translate(-50%,-50%); border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,0.22), transparent 70%); filter:blur(8px); pointer-events:none;"></div>' +

        // ── HERO ──
        '<div style="position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; padding-top:48px;">' +
          // featured mascot (big, glow) — canonical asset
          app.mascot({ size: 132, mood: "happy", glow: true }) +

          // wordmark: div [slash] vy
          '<div style="display:flex; align-items:center; gap:1px; margin-top:18px;">' +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:700; font-size:40px; line-height:1; letter-spacing:-1.5px; color:#F4F7FA;">div</span>' +
            '<span style="display:inline-block; width:11px; height:38px; background:#2775CA; border-radius:2px; transform:skewX(-13deg); margin:0 6px; box-shadow:0 0 16px rgba(39,117,202,0.5);"></span>' +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:700; font-size:40px; line-height:1; letter-spacing:-1.5px; color:#F4F7FA;">vy</span>' +
          '</div>' +

          // mono kicker
          '<span style="font-family:\'Space Mono\',monospace; font-size:11px; font-weight:400; letter-spacing:1.5px; color:rgba(244,247,250,0.45); margin-top:20px;">split bills · settle in seconds</span>' +

          // lowercase value headline
          '<h1 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:27px; line-height:1.22; letter-spacing:-0.6px; text-align:center; text-wrap:pretty; max-width:320px; margin:12px 0 0; color:#F4F7FA;">split the bill. get your money back — before you leave the table.</h1>' +

          // 3-step strip
          '<div style="display:flex; align-items:center; gap:9px; margin-top:26px;">' +
            '<span style="width:7px; height:7px; border-radius:50%; background:#3DE8C7; box-shadow:0 0 8px rgba(61,232,199,0.7);"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:11px; font-weight:400; letter-spacing:1.5px; color:rgba(244,247,250,0.62);">scan</span>' +
            '<span style="width:24px; height:1.5px; background:rgba(244,247,250,0.16);"></span>' +
            '<span style="width:7px; height:7px; border-radius:50%; background:rgba(244,247,250,0.4);"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:11px; font-weight:400; letter-spacing:1.5px; color:rgba(244,247,250,0.62);">split</span>' +
            '<span style="width:24px; height:1.5px; background:rgba(244,247,250,0.16);"></span>' +
            '<span style="width:7px; height:7px; border-radius:50%; background:rgba(244,247,250,0.4);"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:11px; font-weight:400; letter-spacing:1.5px; color:rgba(244,247,250,0.62);">settle</span>' +
          '</div>' +
        '</div>' +

        '<div style="flex:1; min-height:34px;"></div>' +

        // ── ACTIONS ──
        '<div style="position:relative; z-index:2; display:flex; flex-direction:column; gap:11px; padding-bottom:26px;">' +
          // primary: create a wallet (with mono subline)
          '<button id="hCreate" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:62px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; box-shadow:0 10px 30px rgba(39,117,202,0.45);">' +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#fff;">create a wallet</span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10px; font-weight:400; letter-spacing:0.8px; color:rgba(255,255,255,0.78);">~10 seconds, no app</span>' +
          '</button>' +

          // divider
          '<div style="display:flex; align-items:center; gap:12px; padding:3px 0;">' +
            '<span style="flex:1; height:1px; background:rgba(244,247,250,0.10);"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10px; font-weight:400; letter-spacing:1px; color:rgba(244,247,250,0.4);">or continue with</span>' +
            '<span style="flex:1; height:1px; background:rgba(244,247,250,0.10);"></span>' +
          '</div>' +

          // secondary: apple / google
          '<div style="display:flex; gap:11px;">' +
            '<button id="hApple" style="appearance:none; cursor:pointer; flex:1; min-height:50px; border-radius:999px; background:transparent; border:1px solid rgba(244,247,250,0.18); display:flex; align-items:center; justify-content:center; gap:8px; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#F4F7FA;">' +
              '<svg width="17" height="17" viewBox="0 0 24 24" fill="#F4F7FA" aria-hidden="true"><path d="M17.05 12.54c-.02-2.13 1.74-3.15 1.82-3.2-1-1.45-2.54-1.65-3.09-1.67-1.31-.13-2.57.77-3.24.77-.67 0-1.7-.75-2.8-.73-1.44.02-2.77.84-3.51 2.12-1.5 2.6-.38 6.44 1.07 8.55.71 1.03 1.55 2.19 2.66 2.15 1.07-.04 1.47-.69 2.76-.69s1.65.69 2.78.67c1.15-.02 1.87-1.05 2.57-2.09.81-1.2 1.14-2.36 1.16-2.42-.03-.01-2.22-.85-2.24-3.38zM14.94 5.69c.59-.72.99-1.71.88-2.69-.85.03-1.88.57-2.49 1.28-.55.63-1.03 1.64-.9 2.6.95.07 1.92-.48 2.51-1.19z"/></svg>' +
              'apple' +
            '</button>' +
            '<button id="hGoogle" style="appearance:none; cursor:pointer; flex:1; min-height:50px; border-radius:999px; background:transparent; border:1px solid rgba(244,247,250,0.18); display:flex; align-items:center; justify-content:center; gap:8px; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#F4F7FA;">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.52 12.27c0-.82-.07-1.6-.21-2.36H12v4.46h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.72z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3c-1.08.72-2.45 1.16-4.06 1.16-3.12 0-5.77-2.11-6.71-4.95H1.28v3.09A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.29 14.3a7.21 7.21 0 0 1 0-4.6V6.62H1.28a12 12 0 0 0 0 10.77l4.01-3.09z"/><path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.62l4.01 3.09C6.23 6.86 8.88 4.75 12 4.75z"/></svg>' +
              'google' +
            '</button>' +
          '</div>' +

          // quiet: i already have one
          '<button id="hConnect" style="appearance:none; border:none; background:transparent; cursor:pointer; width:100%; padding:7px 0 2px; font-family:\'General Sans\',sans-serif; font-weight:400; font-size:14.5px; color:rgba(244,247,250,0.55);">i already have one</button>' +

          // reassurance — dollars, just faster (never crypto / seed phrase)
          '<div style="text-align:center; margin-top:4px;">' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10px; font-weight:400; letter-spacing:1px; color:rgba(244,247,250,0.38);">dollars, just faster · settles in seconds</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    var c = document.getElementById("hCreate"), n = document.getElementById("hConnect"),
        ap = document.getElementById("hApple"), gg = document.getElementById("hGoogle");
    if (c) c.onclick = function () { Auth.createWallet().catch(function (e) { app.toast(e.message); }); };
    if (n) n.onclick = function () { Auth.signInWithWallet().catch(function (e) { app.toast(e.message); }); };
    // social sign-in is best-effort (Privy); surface a friendly toast if not wired.
    function social() {
      try {
        if (window.Auth && Auth.signInWithPrivy) Auth.signInWithPrivy().catch(function (e) { app.toast(e.message); });
        else app.toast("email sign-in isn't ready yet — create a wallet instead");
      } catch (e) { app.toast("couldn't start sign-in — create a wallet instead"); }
    }
    if (ap) ap.onclick = social;
    if (gg) gg.onclick = social;
  }

  async function signedIn(view) {
    view.innerHTML = topbar() + '<div class="appscroll"><div class="skeleton" style="height:230px;border-radius:23px;margin:14px 0;"></div><div class="skeleton" style="height:54px;margin:10px 0;"></div><div class="skeleton" style="height:54px;margin:10px 0;"></div></div>';
    var d;
    try { d = await app.api.get("/api/me/balances"); }
    catch (e) { view.innerHTML = topbar() + '<div class="empty"><div class="title lower">couldn\'t load balances</div><div class="hint">' + app.esc(e.message) + "</div></div>"; return; }
    var t = d.totals || {}, net = t.netCents || 0, owed = t.owedCents || 0, owe = t.owesCents || 0;
    var ppl = d.counterparties || [], grp = d.trips || [];
    window.__grpCount = grp.length;

    var peopleHtml = ppl.length ? sectionLabel("people", ppl.length) + '<div style="display:flex; flex-direction:column; gap:3px;">' + ppl.map(personRow).join("") + "</div>" : "";
    var groupsHtml;
    if (grp.length) groupsHtml = sectionLabel("groups", grp.length) + '<div style="display:flex; flex-direction:column; gap:11px;">' + grp.map(groupCard).join("") + "</div>";
    else groupsHtml = '<div class="empty" style="padding-top:30px;">' + app.mascot({ size: 96, mood: "happy" }) + '<div class="title lower">no tabs yet</div><div class="hint">start a group and split something 🎉</div><button class="btn" style="max-width:240px;margin-top:8px;" onclick="location.hash=\'#/new\'">new tab</button></div>';

    view.innerHTML = topbar() + '<div class="appscroll" style="padding-top:0;">' + hero(net, owed, owe, ppl) + peopleHtml + groupsHtml + "</div>";
    var s = document.getElementById("hSettle"), rq = document.getElementById("hRequest");
    if (s) s.onclick = function () { app.go("groups"); };
    if (rq) rq.onclick = function () { app.go("new"); };
  }

  window.Screens = window.Screens || {};
  window.Screens.home = {
    title: "home",
    render: function (view) {
      var user = window.Auth && window.Auth.user;
      if (user) return signedIn(view);
      signedOut(view);
      if (window.Auth && window.Auth.onChange) window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("home") >= 0) { if (u) signedIn(view); else signedOut(view); }
      });
    },
  };
})();
