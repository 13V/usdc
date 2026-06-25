/* screens/you.js — You / profile. Identity, USDC balance, and settings.
   Built by LIFTING the exact inline-styled markup from
   design/handoff/You Profile Frames.dc.html and wiring live data into it, so it
   pixel-matches the approved design (see home.js for the same lift+wire pattern).

   Live wiring: GET /api/me (window.Auth.user) for identity + handle + wallet;
   the user's emoji/color avatar (Auth.user.emoji/color or localStorage
   'divvy.profile'); best-effort balance from /api/me/balances. */
(function () {
  "use strict";
  var app = window.app;

  var PROFILE_KEY = "divvy.profile"; // local emoji/color, bridged from /api/me

  function localProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}") || {}; }
    catch (_) { return {}; }
  }

  // the signed-in user's real identity (emoji/color come from /api/me or local).
  function identity(user) {
    var u = user || {};
    var saved = localProfile();
    return {
      emoji: u.emoji || saved.emoji || "🦊",
      color: u.color || saved.color || "linear-gradient(150deg,#FFC65C,#FF6B5E)",
      name: (u.displayName || "you"),
      handle: u.handle ? "@" + u.handle : "@yourname",
      wallet: u.primaryWallet || null,
    };
  }

  function truncWallet(w) {
    if (!w) return "no wallet linked";
    if (w.length <= 11) return w;
    return w.slice(0, 4) + "…" + w.slice(-4);
  }

  // money split frame-style: big integer + smaller, lighter $ and decimals.
  function moneyBig(cents) {
    if (typeof cents !== "number" || !isFinite(cents)) {
      return '<span style="font-size:28px; opacity:.5;">$</span>—';
    }
    var n = Math.abs(cents) / 100;
    var whole = Math.floor(n).toLocaleString();
    var dec = (n % 1).toFixed(2).slice(1); // ".50"
    return '<span style="font-size:28px; opacity:.5;">$</span>' + whole +
      '<span style="font-size:28px; opacity:.5;">' + dec + '</span>';
  }

  // ── header: "you" 28px Clash + inline settings gear (left), full-body mascot
  //    companion waving top-right (lifted from the frame). ──────────────────────
  function header() {
    return '' +
      '<div style="position:relative; z-index:6; display:flex; align-items:center; justify-content:space-between; height:88px; padding:0 20px; flex:none;">' +
        '<div style="display:flex; align-items:center; gap:12px;">' +
          '<h1 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:28px; letter-spacing:-0.8px; margin:0; color:#F4F7FA;">you</h1>' +
          '<div id="yGear" style="width:36px; height:36px; border-radius:50%; background:#13212E; border:1px solid rgba(244,247,250,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.75)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a1.8 1.8 0 0 0 .36 1.98l.07.07a2.2 2.2 0 1 1-3.11 3.11l-.07-.07a1.8 1.8 0 0 0-3.04 1.28V21a2.2 2.2 0 0 1-4.4 0v-.1A1.8 1.8 0 0 0 5.5 19.4l-.07.07a2.2 2.2 0 1 1-3.11-3.11l.07-.07a1.8 1.8 0 0 0-1.28-3.04H1a2.2 2.2 0 0 1 0-4.4h.1A1.8 1.8 0 0 0 2.6 5.5l-.07-.07a2.2 2.2 0 1 1 3.11-3.11l.07.07a1.8 1.8 0 0 0 1.98.36H8a1.8 1.8 0 0 0 1.1-1.65V1a2.2 2.2 0 0 1 4.4 0v.1a1.8 1.8 0 0 0 3.04 1.28l.07-.07a2.2 2.2 0 1 1 3.11 3.11l-.07.07A1.8 1.8 0 0 0 21.9 8H22a2.2 2.2 0 0 1 0 4.4h-.1a1.8 1.8 0 0 0-1.5 1.1z"/></svg></div>' +
        '</div>' +
        // full-body mascot companion (window.Mascot, wave mood), scaled into the
        // 78px header slot the frame reserves; floats top-right with soft glow.
        '<div style="position:relative; width:78px; height:78px; flex:none; display:flex; align-items:center; justify-content:flex-end;">' +
          '<div style="transform:scale(.62); transform-origin:right center;">' +
            app.mascot({ size: 78, mood: "wave", glow: true }) +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ── identity row (72px avatar standalone + you + @handle + wallet pill) ───────
  function identityRow(id) {
    var copyIcon = id.wallet
      ? '<svg id="yCopy" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.5)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="cursor:pointer;"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>'
      : '';
    return '' +
      '<div style="display:flex; align-items:center; gap:15px; padding:6px 2px 2px;">' +
        '<div id="yAvatar" style="width:72px; height:72px; border-radius:22px; background:' + id.color + '; display:flex; align-items:center; justify-content:center; font-size:36px; box-shadow:0 12px 28px rgba(0,0,0,0.3); flex:none; cursor:pointer;">' + app.esc(id.emoji) + '</div>' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="display:flex; align-items:center; gap:8px;"><span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:21px; letter-spacing:-0.4px; color:#F4F7FA;">' + app.esc((id.name || "you").toLowerCase()) + '</span><span style="font-family:\'Space Mono\',monospace; font-size:12px; color:rgba(127,192,255,0.75);">' + app.esc(id.handle.toLowerCase()) + '</span><span id="yEdit" style="font-family:\'Space Mono\',monospace; font-size:11px; color:rgba(244,247,250,0.4); cursor:pointer;">edit</span></div>' +
          '<div id="yWalletChip" style="display:inline-flex; align-items:center; gap:8px; margin-top:9px; background:#13212E; border:1px solid rgba(244,247,250,0.09); border-radius:999px; padding:5px 11px;' + (id.wallet ? ' cursor:pointer;' : '') + '">' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.5px; color:rgba(244,247,250,0.6);">' + app.esc(truncWallet(id.wallet)) + '</span>' +
            copyIcon +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ── balance card (receipt style: money texture, blue→mint top edge, foil
  //    shimmer, perforated middle). Big mono balance with blue glow. ────────────
  function balanceCard(balanceCents) {
    return '' +
      '<div style="position:relative; background:#13212E; border-radius:24px; border:1px solid rgba(244,247,250,0.08); box-shadow:0 16px 40px rgba(0,0,0,0.36); overflow:hidden; margin-top:22px;">' +
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 90% 5%, rgba(255,255,255,0.04) 0 1px, transparent 1px 8px); opacity:.7; pointer-events:none;"></div>' +
        '<div style="position:absolute; left:0; right:0; top:0; height:4px; background:linear-gradient(90deg,#2775CA,#3DE8C7);"></div>' +
        '<div style="position:absolute; top:0; bottom:0; right:0; width:130px; background:linear-gradient(102deg, transparent 0%, rgba(127,192,255,0.045) 50%, rgba(255,255,255,0.03) 60%, transparent 100%); pointer-events:none;"></div>' +

        '<div style="position:relative; padding:20px 20px 8px;">' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.45);">YOUR BALANCE</div>' +
          '<div style="display:flex; align-items:baseline; gap:10px; margin-top:11px;">' +
            '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:54px; line-height:.9; letter-spacing:-2.4px; color:#3B92E8; text-shadow:0 0 34px rgba(59,146,232,0.45);">' + moneyBig(balanceCents) + '</div>' +
            '<span style="font-family:\'Space Mono\',monospace; font-weight:400; font-size:12px; letter-spacing:1px; color:rgba(244,247,250,0.4);">usdc</span>' +
          '</div>' +
          '<div style="display:inline-flex; align-items:center; gap:7px; margin-top:14px; border:1px solid rgba(39,117,202,0.4); background:rgba(39,117,202,0.1); border-radius:999px; padding:4px 11px;">' +
            '<span style="width:6px; height:6px; border-radius:50%; background:#3B92E8; box-shadow:0 0 7px rgba(59,146,232,0.8);"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10px; font-weight:400; letter-spacing:.5px; color:rgba(244,247,250,0.62);">settles instantly · ~$0.001 fee</span>' +
          '</div>' +
        '</div>' +

        // perforation
        '<div style="position:relative; height:1px; margin:18px 0 0; border-top:1.5px dashed rgba(244,247,250,0.14);">' +
          '<div style="position:absolute; left:-9px; top:-9px; width:18px; height:18px; border-radius:50%; background:#0B1622;"></div>' +
          '<div style="position:absolute; right:-9px; top:-9px; width:18px; height:18px; border-radius:50%; background:#0B1622;"></div>' +
        '</div>' +

        '<div style="position:relative; padding:18px 20px 20px;">' +
          '<div style="display:flex; gap:11px;">' +
            '<button id="yAdd" style="appearance:none; border:none; cursor:pointer; flex:1; min-height:52px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 8px 24px rgba(39,117,202,0.45), inset 0 1px 0 rgba(255,255,255,0.25);">' +
              '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
              '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:15.5px; color:#fff;">add money</span>' +
            '</button>' +
            '<button id="yCash" style="appearance:none; cursor:pointer; flex:1; min-height:52px; border-radius:999px; background:transparent; border:1px solid rgba(244,247,250,0.2); display:flex; align-items:center; justify-content:center; gap:8px; font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:15.5px; color:#F4F7FA;">' +
              '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.85)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>' +
              'cash out' +
            '</button>' +
          '</div>' +
          '<div style="display:flex; align-items:center; gap:7px; justify-content:center; margin-top:14px;">' +
            '<span style="font-size:12px;">💳</span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.2px; color:rgba(244,247,250,0.42);">spend it with any card. dollars, just faster.</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ── settings list (emoji-icon tile + lowercase label + chevron) ──────────────
  var CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

  function row(id, icon, tint, label, right) {
    return '' +
      '<div id="' + id + '" style="display:flex; align-items:center; gap:13px; padding:14px 15px; cursor:pointer;">' +
        '<div style="width:34px; height:34px; border-radius:11px; background:' + tint + '; display:flex; align-items:center; justify-content:center; font-size:16px; flex:none;">' + icon + '</div>' +
        '<span style="flex:1; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#F4F7FA;">' + label + '</span>' +
        (right || '') + CHEV +
      '</div>';
  }
  function divider() {
    return '<div style="height:1px; background:rgba(244,247,250,0.05); margin:0 15px;"></div>';
  }

  function settingsList() {
    var notifTag = '<span style="font-family:\'Space Mono\',monospace; font-size:10px; color:rgba(244,247,250,0.4); margin-right:2px;">on</span>';
    var netTag = '<span style="display:inline-flex; align-items:center; gap:6px; background:rgba(61,232,199,0.1); border:1px solid rgba(61,232,199,0.35); border-radius:999px; padding:3px 9px; margin-right:2px;"><span style="width:5px; height:5px; border-radius:50%; background:#3DE8C7; box-shadow:0 0 6px rgba(61,232,199,0.8);"></span><span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:#3DE8C7;">mainnet</span></span>';

    return '' +
      '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.42); padding:24px 2px 11px;">SETTINGS</div>' +
      '<div style="background:#13212E; border:1px solid rgba(244,247,250,0.07); border-radius:18px; overflow:hidden;">' +
        row("yFriends", "🫂", "rgba(39,117,202,0.16)", "friends") + divider() +
        row("yRecurring", "🔁", "rgba(61,232,199,0.14)", "recurring") + divider() +
        row("ySaved", "🧾", "rgba(255,198,92,0.16)", "saved tabs") + divider() +
        row("yNotif", "🔔", "rgba(255,107,94,0.14)", "notifications", notifTag) + divider() +
        row("yNet", "🌐", "rgba(39,117,202,0.16)", "network", netTag) + divider() +
        row("yHelp", "💁", "rgba(244,247,250,0.07)", "help") +
      '</div>';
  }

  function signOutCard() {
    return '' +
      '<div style="margin-top:11px; background:rgba(255,107,94,0.06); border:1px solid rgba(255,107,94,0.2); border-radius:18px; overflow:hidden;">' +
        '<div id="ySignOut" style="display:flex; align-items:center; gap:13px; padding:14px 15px; cursor:pointer;">' +
          '<div style="width:34px; height:34px; border-radius:11px; background:rgba(255,107,94,0.14); display:flex; align-items:center; justify-content:center; flex:none;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6B5E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg></div>' +
          '<span style="flex:1; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#FF6B5E;">sign out</span>' +
        '</div>' +
      '</div>' +
      '<div style="text-align:center; font-family:\'Space Mono\',monospace; font-size:9.5px; letter-spacing:.5px; color:rgba(244,247,250,0.28); margin-top:18px;">divvy v1.4.0 · made for splitting, not stressing</div>';
  }

  // ── background overlays (money texture + soft accent glow, frame-level) ───────
  function backdrop() {
    return '' +
      '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 84% 2%, rgba(244,247,250,0.025) 0 1px, transparent 1px 8px); opacity:.55; pointer-events:none; z-index:0;"></div>' +
      '<div style="position:absolute; left:50%; top:120px; width:380px; height:280px; transform:translateX(-50%); border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,0.16) 0%, rgba(39,117,202,0) 70%); pointer-events:none; z-index:0;"></div>';
  }

  // ── signed-in ────────────────────────────────────────────────────────────────
  async function signedIn(view, user) {
    // best-effort balance; spec says fall back gracefully if unavailable.
    var balance = null;
    try {
      var b = await app.api.get("/api/me/balances");
      var t = (b && b.totals) || {};
      if (typeof t.walletCents === "number") balance = t.walletCents;
      else if (typeof t.balanceCents === "number") balance = t.balanceCents;
      else if (typeof t.netCents === "number") balance = t.netCents;
    } catch (_) { /* show — */ }

    var id = identity(user);
    view.innerHTML =
      '<div style="position:relative; min-height:100%; display:flex; flex-direction:column;">' +
        backdrop() +
        header() +
        '<div style="position:relative; z-index:2; flex:1; padding:8px 18px 24px;">' +
          identityRow(id) +
          balanceCard(balance) +
          settingsList() +
          signOutCard() +
        '</div>' +
      '</div>';

    wireGear();
    wireIdentity(id);
    wireBalance();
    wireSettings();
  }

  // ── signed-out (mascot + connect) ────────────────────────────────────────────
  function signedOut(view) {
    view.innerHTML =
      '<div style="position:relative; min-height:100%; display:flex; flex-direction:column;">' +
        backdrop() +
        header() +
        '<div style="position:relative; z-index:2; flex:1; display:flex; flex-direction:column; align-items:center; text-align:center; padding:30px 24px 24px;">' +
          '<div style="margin:10px 0 4px;">' + app.mascot({ size: 128, mood: "happy", glow: true }) + '</div>' +
          '<h1 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:24px; letter-spacing:-0.6px; max-width:300px; margin:10px 0 0; color:#F4F7FA;">your wallet, your tabs, your money.</h1>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.8px; color:rgba(244,247,250,0.45); margin:16px 0 22px;">connect to see your balance</div>' +
          '<button id="yConnect" style="appearance:none; border:none; cursor:pointer; width:100%; max-width:320px; min-height:52px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff; box-shadow:0 8px 24px rgba(39,117,202,0.45), inset 0 1px 0 rgba(255,255,255,0.25);">connect a wallet</button>' +
          '<button id="yCreate" style="appearance:none; cursor:pointer; width:100%; max-width:320px; min-height:52px; margin-top:11px; border-radius:999px; background:transparent; border:1px solid rgba(244,247,250,0.2); font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#F4F7FA;">create a wallet</button>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.8px; color:rgba(244,247,250,0.4); margin-top:22px;">non-custodial · your keys · usdc on solana</div>' +
        '</div>' +
      '</div>';

    wireGear();
    var c = document.getElementById("yConnect"), n = document.getElementById("yCreate");
    if (c) c.onclick = function () { if (window.Auth) Auth.signInWithWallet().catch(function (e) { app.toast(e.message); }); };
    if (n) n.onclick = function () { if (window.Auth) Auth.createWallet().catch(function (e) { app.toast(e.message); }); };
  }

  // ── wiring ───────────────────────────────────────────────────────────────────
  function wireGear() {
    var g = document.getElementById("yGear");
    if (g) g.onclick = function () { app.go("customize"); };
  }

  function wireIdentity(id) {
    var av = document.getElementById("yAvatar"), ed = document.getElementById("yEdit");
    if (av) av.onclick = function () { app.go("customize"); };
    if (ed) ed.onclick = function () { app.go("customize"); };
    var chip = document.getElementById("yWalletChip");
    if (chip && id.wallet) chip.onclick = function () {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(id.wallet).then(
            function () { app.toast("wallet copied ✨"); },
            function () { app.toast(id.wallet); });
        } else { app.toast(id.wallet); }
      } catch (_) { app.toast(id.wallet); }
    };
  }

  function wireBalance() {
    var add = document.getElementById("yAdd"), cash = document.getElementById("yCash");
    if (add) add.onclick = function () { app.toast("add money — coming soon 💳"); };
    if (cash) cash.onclick = function () { app.toast("cash out — coming soon"); };
  }

  function wireSettings() {
    var f = document.getElementById("yFriends");
    if (f) f.onclick = function () { location.hash = "#/friends"; };
    var r = document.getElementById("yRecurring");
    if (r) r.onclick = function () { location.hash = "#/recurring"; };
    var saved = document.getElementById("ySaved");
    if (saved) saved.onclick = function () { app.go("groups"); };
    var notif = document.getElementById("yNotif");
    if (notif) notif.onclick = function () { app.toast("notifications — coming soon 🔔"); };
    var net = document.getElementById("yNet");
    if (net) net.onclick = function () { app.toast("on mainnet · usdc on solana 🌐"); };
    var help = document.getElementById("yHelp");
    if (help) help.onclick = function () { app.toast("need a hand? we got you 💁"); };
    var so = document.getElementById("ySignOut");
    if (so) so.onclick = function () {
      if (window.Auth && Auth.signOut) Auth.signOut();
      app.toast("signed out");
      app.go("home");
    };
  }

  window.Screens = window.Screens || {};
  window.Screens.you = {
    title: "you",
    render: function (view) {
      var user = window.Auth && window.Auth.user;
      if (user) signedIn(view, user);
      else signedOut(view);
      // re-render when auth resolves / changes
      if (window.Auth && window.Auth.onChange) window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("you") >= 0) {
          if (u) signedIn(view, u); else signedOut(view);
        }
      });
    },
  };
})();
