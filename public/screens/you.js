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
          '<h1 class="jdoodle" style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:28px; letter-spacing:-0.8px; margin:0; color:#2B2118;">you</h1>' +
          '<div id="yGear" style="width:36px; height:36px; border-radius:50%; background:#FFFDF7; border:1px solid rgba(43,33,24,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.75)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a1.8 1.8 0 0 0 .36 1.98l.07.07a2.2 2.2 0 1 1-3.11 3.11l-.07-.07a1.8 1.8 0 0 0-3.04 1.28V21a2.2 2.2 0 0 1-4.4 0v-.1A1.8 1.8 0 0 0 5.5 19.4l-.07.07a2.2 2.2 0 1 1-3.11-3.11l.07-.07a1.8 1.8 0 0 0-1.28-3.04H1a2.2 2.2 0 0 1 0-4.4h.1A1.8 1.8 0 0 0 2.6 5.5l-.07-.07a2.2 2.2 0 1 1 3.11-3.11l.07.07a1.8 1.8 0 0 0 1.98.36H8a1.8 1.8 0 0 0 1.1-1.65V1a2.2 2.2 0 0 1 4.4 0v.1a1.8 1.8 0 0 0 3.04 1.28l.07-.07a2.2 2.2 0 1 1 3.11 3.11l-.07.07A1.8 1.8 0 0 0 21.9 8H22a2.2 2.2 0 0 1 0 4.4h-.1a1.8 1.8 0 0 0-1.5 1.1z"/></svg></div>' +
        '</div>' +
        // full-body mascot companion (window.Mascot, wave mood), scaled into the
        // 78px header slot the frame reserves. No glow: at this size against the
        // screen edge the blurred halo clips into a visible hard rectangle.
        '<div style="position:relative; width:78px; height:78px; flex:none; display:flex; align-items:center; justify-content:flex-end;">' +
          '<div style="transform:scale(.62); transform-origin:right center;">' +
            app.mascot({ size: 78, mood: "wave", glow: false }) +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ── identity row (72px avatar standalone + you + @handle + wallet pill) ───────
  function identityRow(id) {
    var copyIcon = id.wallet
      ? '<svg id="yCopy" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.5)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="cursor:pointer;"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>'
      : '';
    return '' +
      '<div style="display:flex; align-items:center; gap:15px; padding:6px 2px 2px;">' +
        '<div id="yAvatar" style="width:72px; height:72px; border-radius:22px; background:' + id.color + '; display:flex; align-items:center; justify-content:center; font-size:36px; box-shadow:0 12px 28px rgba(43,33,24,0.13); flex:none; cursor:pointer;">' + app.esc(id.emoji) + '</div>' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="display:flex; align-items:center; gap:8px;"><span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:21px; letter-spacing:-0.4px; color:#2B2118;">' + app.esc((id.name || "you").toLowerCase()) + '</span><span style="font-family:\'Space Mono\',monospace; font-size:12px; color:rgba(39,117,202,0.75);">' + app.esc(id.handle.toLowerCase()) + '</span><span id="yEdit" style="font-family:\'Space Mono\',monospace; font-size:11px; color:rgba(43,33,24,0.4); cursor:pointer;">edit</span></div>' +
          '<div id="yWalletChip" style="display:inline-flex; align-items:center; gap:8px; margin-top:9px; background:#FFFDF7; border:2px solid #2B2118; border-radius:999px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:5px 11px;' + (id.wallet ? ' cursor:pointer;' : '') + '">' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.5px; color:rgba(43,33,24,0.6);">' + app.esc(truncWallet(id.wallet)) + '</span>' +
            copyIcon +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ── balance card (receipt style: money texture, blue→mint top edge, foil
  //    shimmer, perforated middle). Big mono balance with blue glow. ────────────
  function balanceCard(balanceCents) {
    return '' +
      '<div style="position:relative; background:#FFFDF7; border-radius:24px; border:2px solid #2B2118; box-shadow:3px 4px 0 rgba(43,33,24,0.85); margin-top:22px; transform:rotate(0.4deg);">' +
        '<div class="jtape" style="top:-12px; right:12%; background:rgba(255,198,92,0.6);"></div>' +

        '<div style="position:relative; padding:20px 20px 8px;">' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.45);">YOUR BALANCE</div>' +
          '<div style="display:flex; align-items:baseline; gap:10px; margin-top:11px;">' +
            '<div id="yBalance" style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:54px; line-height:.9; letter-spacing:-2.4px; color:#2775CA; text-shadow:none;">' + moneyBig(balanceCents) + '</div>' +
            '<span style="font-family:\'Space Mono\',monospace; font-weight:400; font-size:12px; letter-spacing:1px; color:rgba(43,33,24,0.4);">usdc</span>' +
          '</div>' +
          '<div style="display:inline-flex; align-items:center; gap:7px; margin-top:14px; border:1px solid rgba(39,117,202,0.4); background:rgba(39,117,202,0.1); border-radius:999px; padding:4px 11px;">' +
            '<span style="width:6px; height:6px; border-radius:50%; background:#2775CA; box-shadow:0 0 7px rgba(39,117,202,0.8);"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10px; font-weight:400; letter-spacing:.5px; color:rgba(43,33,24,0.62);">settles instantly · ~$0.001 fee</span>' +
          '</div>' +
        '</div>' +

        // perforation
        '<div style="position:relative; height:1px; margin:18px 0 0; border-top:1.5px dashed rgba(43,33,24,0.14);">' +
          '<div style="position:absolute; left:-9px; top:-9px; width:18px; height:18px; border-radius:50%; background:#F7F1E3;"></div>' +
          '<div style="position:absolute; right:-9px; top:-9px; width:18px; height:18px; border-radius:50%; background:#F7F1E3;"></div>' +
        '</div>' +

        '<div style="position:relative; padding:18px 20px 20px;">' +
          '<div style="display:flex; gap:11px;">' +
            '<button id="yAdd" style="appearance:none; border:none; cursor:pointer; flex:1; min-height:52px; border-radius:999px; background:#2775CA; border:2px solid #2B2118; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">' +
              '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
              '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:15.5px; color:#fff;">add money</span>' +
            '</button>' +
            '<button id="yCash" style="appearance:none; cursor:pointer; flex:1; min-height:52px; border-radius:999px; background:transparent; border:1px solid rgba(43,33,24,0.2); display:flex; align-items:center; justify-content:center; gap:8px; font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:15.5px; color:#2B2118;">' +
              '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.85)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>' +
              'cash out' +
            '</button>' +
          '</div>' +
          '<div style="display:flex; align-items:center; gap:7px; justify-content:center; margin-top:14px;">' +
            '<span style="font-size:12px;">💳</span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.2px; color:rgba(43,33,24,0.42);">spend it with any card. dollars, just faster.</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ── settings list (emoji-icon tile + lowercase label + chevron) ──────────────
  var CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

  // a "coming soon" pill, for rows that aren't wired yet — so they read as
  // not-yet-available instead of looking like a live, tappable row.
  var SOON_TAG = '<span style="display:inline-flex; align-items:center; font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:rgba(43,33,24,0.4); background:rgba(43,33,24,0.06); border:1px solid rgba(43,33,24,0.1); border-radius:999px; padding:3px 9px; margin-right:2px;">soon</span>';

  function row(id, icon, tint, label, right, soon) {
    // soon rows: dimmed, no pointer/chevron, a "soon" pill instead.
    return '' +
      '<div id="' + id + '" style="display:flex; align-items:center; gap:13px; padding:14px 15px;' + (soon ? ' opacity:.55; cursor:default;' : ' cursor:pointer;') + '">' +
        '<div style="width:34px; height:34px; border-radius:11px; background:' + tint + '; display:flex; align-items:center; justify-content:center; font-size:16px; flex:none;">' + icon + '</div>' +
        '<span style="flex:1; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#2B2118;">' + label + '</span>' +
        (soon ? SOON_TAG : ((right || '') + CHEV)) +
      '</div>';
  }
  function divider() {
    return '<div style="height:1px; background:rgba(43,33,24,0.05); margin:0 15px;"></div>';
  }

  function settingsList() {
    var netTag = '<span style="display:inline-flex; align-items:center; gap:6px; background:rgba(61,232,199,0.1); border:1px solid rgba(61,232,199,0.35); border-radius:999px; padding:3px 9px; margin-right:2px;"><span style="width:5px; height:5px; border-radius:50%; background:#3DE8C7; box-shadow:0 0 6px rgba(61,232,199,0.8);"></span><span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:#3DE8C7;">devnet</span></span>';

    return '' +
      '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.42); padding:24px 2px 11px;">SETTINGS</div>' +
      '<div style="background:#FFFDF7; border:2px solid #2B2118; border-radius:18px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); overflow:hidden;">' +
        row("yWallet", "🔑", "rgba(139,92,246,0.16)", "wallet & recovery") + divider() +
        row("yFriends", "🫂", "rgba(39,117,202,0.16)", "friends") + divider() +
        row("yRecurring", "🔁", "rgba(61,232,199,0.14)", "recurring") + divider() +
        row("ySaved", "🧾", "rgba(255,198,92,0.16)", "saved tabs") + divider() +
        // notifications taps through to the activity feed; an unread count badge
        // is patched in after render (best-effort, see wireNotifBadge). help isn't
        // wired yet — render it as "soon" so it reads as not-yet-available.
        row("yNotif", "🔔", "rgba(255,107,94,0.14)", "notifications") + divider() +
        row("yPush", "📣", "rgba(139,92,246,0.16)", "push notifications", '<span id="yPushState" style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:rgba(43,33,24,0.4); margin-right:2px;">off</span>') + divider() +
        row("ySound", "🔊", "rgba(61,232,199,0.14)", "sounds", '<span id="ySoundState" style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:rgba(43,33,24,0.4); margin-right:2px;">on</span>') + divider() +
        row("yNet", "🌐", "rgba(39,117,202,0.16)", "network", netTag) + divider() +
        row("yHelp", "💁", "rgba(43,33,24,0.07)", "help", null, true) +
      '</div>';
  }

  function signOutCard() {
    return '' +
      '<div style="margin-top:11px; background:rgba(255,107,94,0.06); border:1px solid rgba(255,107,94,0.2); border-radius:18px; overflow:hidden;">' +
        '<div id="ySignOut" style="display:flex; align-items:center; gap:13px; padding:14px 15px; cursor:pointer;">' +
          '<div style="width:34px; height:34px; border-radius:11px; background:rgba(255,107,94,0.14); display:flex; align-items:center; justify-content:center; flex:none;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6B5E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg></div>' +
          '<span style="flex:1; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#FF6B5E;">sign out</span>' +
        '</div>' +
        '<div style="height:1px; background:rgba(255,107,94,0.14); margin:0 15px;"></div>' +
        '<div id="yDelete" style="display:flex; align-items:center; gap:13px; padding:14px 15px; cursor:pointer;">' +
          '<div style="width:34px; height:34px; border-radius:11px; background:rgba(255,107,94,0.14); display:flex; align-items:center; justify-content:center; flex:none;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6B5E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></div>' +
          '<span style="flex:1; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#FF6B5E;">delete account</span>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex; gap:14px; justify-content:center; margin-top:16px;">' +
        '<a href="/privacy.html" style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.4px; color:rgba(43,33,24,0.4); text-decoration:none;">privacy</a>' +
        '<span style="color:rgba(43,33,24,0.2);">·</span>' +
        '<a href="/terms.html" style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.4px; color:rgba(43,33,24,0.4); text-decoration:none;">terms</a>' +
      '</div>' +
      '<div style="text-align:center; font-family:\'Space Mono\',monospace; font-size:9.5px; letter-spacing:.5px; color:rgba(43,33,24,0.28); margin-top:12px;">divvy v1.4.0 · made for splitting, not stressing</div>';
  }

  // ── background overlays (money texture + soft accent glow, frame-level) ───────
  function backdrop() {
    return '' +
      '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 84% 2%, rgba(43,33,24,0.025) 0 1px, transparent 1px 8px); opacity:.55; pointer-events:none; z-index:0;"></div>' +
      '<div style="position:absolute; left:50%; top:120px; width:380px; height:280px; transform:translateX(-50%); border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,0.16) 0%, rgba(39,117,202,0) 70%); pointer-events:none; z-index:0;"></div>';
  }

  // ── signed-in ────────────────────────────────────────────────────────────────
  async function signedIn(view, user) {
    // Live on-chain USDC balance of the user's wallet; falls back to "—".
    var balance = null;
    try {
      var w = await app.api.get("/api/me/wallet");
      if (w && typeof w.usdcCents === "number") balance = w.usdcCents;
    } catch (_) { /* show — */ }

    var id = identity(user);
    view.innerHTML =
      '<div class="vfill" style="position:relative; display:flex; flex-direction:column;">' +
        backdrop() +
        header() +
        '<div style="position:relative; z-index:2; flex:1; padding:8px 18px 104px;">' +
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
    wireNotifBadge(); // non-blocking; patches an unread badge in after render
    if (app.countUp && typeof balance === "number") {
      var balEl = document.getElementById("yBalance");
      if (balEl) app.countUp(balEl, Math.abs(balance), moneyBig);
    }
  }

  // best-effort unread badge on the notifications row. the endpoint may not exist
  // yet — if it 404s or fails for any reason, we just leave the row badge-free.
  function wireNotifBadge() {
    var row = document.getElementById("yNotif");
    if (!row) return;
    Promise.resolve().then(function () { return app.api.get("/api/me/notifications"); })
      .then(function (res) {
        var n = res && res.unread;
        if (typeof n !== "number" || !(n > 0)) return;
        // bail if the row got re-rendered out from under us (auth change, nav).
        if (!document.body.contains(row)) return;
        var label = n > 99 ? "99+" : String(n);
        var badge = document.createElement("span");
        badge.style.cssText = "display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; padding:0 5px; border-radius:999px; background:#FF6B5E; font-family:'Space Mono',monospace; font-weight:700; font-size:10px; line-height:1; color:#2B2118; margin-right:2px;";
        badge.textContent = label;
        // tuck the badge just before the chevron (last child of the row).
        row.insertBefore(badge, row.lastChild);
      })
      .catch(function () { /* endpoint missing or failed — leave row badge-free */ });
  }

  // ── signed-out (mascot + connect) ────────────────────────────────────────────
  function signedOut(view) {
    view.innerHTML =
      '<div class="vfill" style="position:relative; display:flex; flex-direction:column;">' +
        backdrop() +
        header() +
        '<div style="position:relative; z-index:2; flex:1; display:flex; flex-direction:column; align-items:center; text-align:center; padding:30px 24px 104px;">' +
          '<div style="margin:10px 0 4px;">' + app.mascot({ size: 128, mood: "happy", glow: true }) + '</div>' +
          '<h1 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:24px; letter-spacing:-0.6px; max-width:300px; margin:10px 0 0; color:#2B2118;">your wallet, your tabs, your money.</h1>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.8px; color:rgba(43,33,24,0.45); margin:16px 0 22px;">connect to see your balance</div>' +
          '<button id="yConnect" style="appearance:none; border:none; cursor:pointer; width:100%; max-width:320px; min-height:52px; border-radius:999px; background:#2775CA; border:2px solid #2B2118; font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">connect a wallet</button>' +
          '<button id="yCreate" style="appearance:none; cursor:pointer; width:100%; max-width:320px; min-height:52px; margin-top:11px; border-radius:999px; background:transparent; border:1px solid rgba(43,33,24,0.2); font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#2B2118;">create a wallet</button>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.8px; color:rgba(43,33,24,0.4); margin-top:22px;">non-custodial · your keys · usdc on solana</div>' +
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
    if (add) add.onclick = function () { app.depositSheet(); };
    if (cash) cash.onclick = cashOutSheet;
  }

  // Real cash-out (off-ramp): pick an amount and send it to your card/bank via a
  // provider. We keep the honest framing — these are real dollars you can also
  // just spend with any card or send to a friend — as a compact secondary note.
  async function cashOutSheet() {
    app.haptic && app.haptic();

    // Best-effort balance for the cap + chip sizing. Skipped silently on failure.
    var maxCents = null;
    try {
      var w = await app.api.get("/api/me/wallet");
      if (w && typeof w.usdcCents === "number") maxCents = w.usdcCents;
    } catch (_) {}

    // Pick a sensible default that doesn't exceed the balance when we know it.
    var DEFAULT = 5000;
    if (typeof maxCents === "number" && maxCents > 0 && maxCents < DEFAULT) {
      DEFAULT = maxCents;
    }

    var entryOpts = { idp: "out", default: DEFAULT };
    if (typeof maxCents === "number" && maxCents > 0) entryOpts.maxCents = maxCents;

    app.sheet(
      '<div style="padding:4px 20px 26px;">' +
        '<div style="text-align:center; margin-bottom:6px;">' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.45);">CASH OUT</div>' +
          '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:21px; letter-spacing:-0.3px; color:#2B2118; margin-top:4px;">cash out to your card</div>' +
        '</div>' +
        app.amountEntryHtml(entryOpts) +
        '<button id="yOut" type="button" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:54px; margin-top:20px; border-radius:999px; background:#2775CA; border:2px solid #2B2118; display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>' +
          '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff;">cash out to card/bank</span>' +
        '</button>' +
        '<div style="text-align:center; margin-top:9px;">' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(43,33,24,0.5);">to your debit card or bank</span>' +
        '</div>' +
        '<div id="yOutTestNote"></div>' +
        // honest secondary framing — compact version of the old explainer.
        '<div style="display:flex; align-items:center; gap:8px; justify-content:center; margin-top:16px; text-align:center;">' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.2px; line-height:1.5; color:rgba(43,33,24,0.42);">these are real dollars — you can also just spend them with any card or send to a friend.</span>' +
        '</div>' +
        '<button id="yOutAdd" type="button" style="appearance:none; border:none; cursor:pointer; background:transparent; display:block; width:100%; text-align:center; margin-top:12px; padding:6px; font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.3px; color:rgba(39,117,202,0.75);">add money instead</button>' +
      '</div>'
    );

    var entry = app.wireAmountEntry("out");

    // Prefetch live flag for the subtle test-mode note.
    app.api.get("/api/me/offramp/" + DEFAULT).then(function (r) {
      if (r && r.live === false) {
        var note = document.getElementById("yOutTestNote");
        if (note) note.innerHTML = app.testModeNote();
      }
    }).catch(function () {});

    var out = document.getElementById("yOut");
    if (out) out.onclick = function () {
      var cents = entry.getCents();
      if (!(cents > 0)) { app.toast("enter an amount first"); return; }
      if (typeof maxCents === "number" && maxCents > 0 && cents > maxCents) {
        app.toast("that's more than your balance");
        return;
      }
      var prev = out.innerHTML;
      out.disabled = true;
      out.innerHTML = '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff;">opening…</span>';
      app.api.get("/api/me/offramp/" + cents).then(function (r) {
        var url = r && (r.moonpay || r.coinbase);
        if (!url) throw new Error("couldn't start cash out");
        app.openProvider(url);
      }).catch(function (e) {
        out.disabled = false;
        out.innerHTML = prev;
        if (e && e.status === 400) app.toast("create or connect a wallet first");
        else app.toast((e && e.message) || "couldn't start cash out");
      });
    };

    var more = document.getElementById("yOutAdd");
    if (more) more.onclick = function () { app.closeSheet(); app.depositSheet(); };
  }

  function wireSettings() {
    var wal = document.getElementById("yWallet");
    if (wal) wal.onclick = function () {
      // Wallet backup/recovery lives in the embedded Privy app (it needs the
      // wallet context). Hand off with an absolute return path back to here.
      window.location.href = "/embedded/?manage=wallet&ret=" + encodeURIComponent("/#/you");
    };
    var f = document.getElementById("yFriends");
    if (f) f.onclick = function () { location.hash = "#/friends"; };
    var r = document.getElementById("yRecurring");
    if (r) r.onclick = function () { location.hash = "#/recurring"; };
    var saved = document.getElementById("ySaved");
    if (saved) saved.onclick = function () { app.go("groups"); };
    var notif = document.getElementById("yNotif");
    if (notif) notif.onclick = function () { location.hash = "#/activity"; };
    // Sounds toggle: little synth chimes on money moments.
    var soundRow = document.getElementById("ySound"),
        soundState = document.getElementById("ySoundState");
    function renderSoundState() {
      if (!soundState) return;
      var on = app.soundsEnabled ? app.soundsEnabled() : false;
      soundState.textContent = on ? "on" : "off";
      soundState.style.color = on ? "#3DE8C7" : "rgba(43,33,24,0.4)";
    }
    renderSoundState();
    if (soundRow) soundRow.onclick = function () {
      var on = !(app.soundsEnabled && app.soundsEnabled());
      if (app.setSounds) app.setSounds(on);
      renderSoundState();
      if (on && app.sound) app.sound("paid"); // audible confirmation
      app.haptic(10);
    };
    // Push notifications toggle: reflect current permission, enable on tap.
    var pushState = document.getElementById("yPushState");
    function renderPushState() {
      if (!pushState) return;
      var p = app.push && app.push.permission ? app.push.permission() : "default";
      var supported = app.push && app.push.supported && app.push.supported();
      var label = !supported ? "n/a" : p === "granted" ? "on" : p === "denied" ? "blocked" : "off";
      pushState.textContent = label;
      pushState.style.color = label === "on" ? "#3DE8C7" : "rgba(43,33,24,0.4)";
    }
    renderPushState();
    var pushRow = document.getElementById("yPush");
    if (pushRow) pushRow.onclick = function () {
      if (!app.push || !app.push.supported()) { app.toast("notifications aren't supported here"); return; }
      if (app.push.permission() === "denied") { app.toast("notifications are blocked — enable them in settings"); return; }
      app.toast("turning on notifications…");
      app.push.enable().then(function (ok) {
        renderPushState();
        app.toast(ok ? "notifications on 🔔" : "couldn't turn on notifications");
      });
    };
    // help is a "soon" row — intentionally not wired (no no-op tap).
    var net = document.getElementById("yNet");
    if (net) net.onclick = function () { app.toast("devnet · usdc on solana 🌐"); };
    var so = document.getElementById("ySignOut");
    if (so) so.onclick = function () {
      if (window.Auth && Auth.signOut) Auth.signOut();
      app.toast("signed out");
      app.go("home");
    };
    var del = document.getElementById("yDelete");
    if (del) del.onclick = function () {
      // Two-step confirm; irreversible. Non-custodial funds stay in the user's own
      // wallet, so the copy is honest about what is (and isn't) deleted.
      if (!window.confirm("Delete your Divvy account? This removes your login and profile. Your wallet and any USDC in it stay yours — this only unlinks the account. This can't be undone.")) return;
      del.style.opacity = "0.5";
      app.api.del("/api/me").then(function () {
        if (window.Auth && Auth.signOut) Auth.signOut();
        app.toast("account deleted");
        app.go("home");
      }).catch(function (e) {
        del.style.opacity = "1";
        app.toast((e && e.message) || "couldn't delete account");
      });
    };
  }

  var authUnsub = null; // single auth listener; released each render so it can't leak
  window.Screens = window.Screens || {};
  window.Screens.you = {
    title: "you",
    render: function (view) {
      if (authUnsub) { authUnsub(); authUnsub = null; }
      var user = window.Auth && window.Auth.user;
      if (user) signedIn(view, user);
      else signedOut(view);
      // re-render when auth resolves / changes (single listener; released next render)
      if (window.Auth && window.Auth.onChange) authUnsub = window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("you") >= 0) {
          if (u) signedIn(view, u); else signedOut(view);
        }
      });
    },
  };
})();
