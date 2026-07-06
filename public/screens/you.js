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
  var STREAK_KEY = "divvy.settleStreak"; // per-session cache of the computed streak

  function localProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}") || {}; }
    catch (_) { return {}; }
  }

  // ── settle streak ────────────────────────────────────────────────────────────
  // Metric: consecutive-WEEK settle streak. Each settle-up in /api/activity carries
  // a reliable `at` timestamp; we bucket those into Monday-based weeks and count the
  // run of consecutive weeks (back from the most recent settle) that each had a
  // settlement. A settlement's stored data has only a single createdAt and no
  // per-transfer/per-member paid time, so a "settled within 24h" metric would be
  // noisier — weekly buckets give a clean, Duolingo-style "N-week settle streak".
  // Only counts as live if the latest settle week is this week or last week, so a
  // long-abandoned streak doesn't linger; the chip shows only when streak >= 2.
  function weekIndex(dateLike) {
    var d = new Date(dateLike);
    if (isNaN(d.getTime())) return null;
    // Monday-based, in UTC to avoid timezone drift across the bucket edges.
    var day = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    var mondayMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * 86400000;
    return Math.floor(mondayMs / (7 * 86400000));
  }

  function streakFromEvents(events) {
    if (!Array.isArray(events)) return 0;
    var weeks = {};
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e || e.type !== "settlement" || !e.at) continue;
      var w = weekIndex(e.at);
      if (w != null) weeks[w] = true;
    }
    var keys = Object.keys(weeks).map(Number).sort(function (a, b) { return a - b; });
    if (!keys.length) return 0;
    var latest = keys[keys.length - 1];
    var now = weekIndex(Date.now());
    if (now != null && now - latest > 1) return 0; // stale — streak has lapsed
    var streak = 1, w = latest;
    while (weeks[w - 1]) { streak++; w--; }
    return streak;
  }

  // Cached per session (sessionStorage): the streak is computed once and reused
  // across re-renders/nav within the session. Never rejects — resolves 0 on error.
  function computeSettleStreak() {
    try {
      var cached = sessionStorage.getItem(STREAK_KEY);
      if (cached != null) return Promise.resolve(parseInt(cached, 10) || 0);
    } catch (_) {}
    return Promise.resolve()
      .then(function () { return app.api.get("/api/activity"); })
      .then(function (events) {
        var n = streakFromEvents(events);
        try { sessionStorage.setItem(STREAK_KEY, String(n)); } catch (_) {}
        return n;
      })
      .catch(function () { return 0; });
  }

  function streakChipHtml(n) {
    return '' +
      '<div style="display:inline-flex; align-items:center; gap:8px; padding:6px 12px; background:#FFFDF7; border:2px solid #2B2118; border-radius:999px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); transform:rotate(-1.2deg);">' +
        '<span style="font-size:14px; line-height:1;">🔥</span>' +
        '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:11px; letter-spacing:.4px; color:#2B2118;">' + n + '-week settle streak</span>' +
      '</div>';
  }

  // ── invites (friends brought) ────────────────────────────────────────────────
  // Growth loop: GET /api/me/invites → { count } of friends this user brought to
  // Divvy via their share links. A little journal chip, shown only when count > 0
  // (so a zero never nags). Mirrors the streak chip's look + wiring pattern.
  function invitesChipHtml(n) {
    return '' +
      '<div style="display:inline-flex; align-items:center; gap:8px; padding:6px 12px; background:#FFFDF7; border:2px solid #2B2118; border-radius:999px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); transform:rotate(1deg);">' +
        '<span style="font-size:14px; line-height:1;">🌱</span>' +
        '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:11px; letter-spacing:.4px; color:#2B2118;">friends brought: ' + n + '</span>' +
      '</div>';
  }

  // best-effort: fill the invites slot after render when count > 0. Non-blocking;
  // silent if the endpoint is missing/empty. Same shape as wireStreak/wireNotifBadge.
  function wireInvites() {
    var slot = document.getElementById("yInvitesSlot");
    if (!slot) return;
    Promise.resolve().then(function () { return app.api.get("/api/me/invites"); })
      .then(function (res) {
        var n = res && res.count;
        if (typeof n !== "number" || !(n > 0)) return;
        if (!document.body.contains(slot)) return; // re-rendered out from under us
        slot.style.margin = "10px 2px 0";
        slot.innerHTML = invitesChipHtml(n);
      })
      .catch(function () { /* endpoint missing or failed — leave slot empty */ });
  }

  // best-effort: fill the streak slot after render if the streak is >= 2. Mirrors
  // wireNotifBadge — non-blocking and silent if the activity feed is empty/absent.
  function wireStreak() {
    var slot = document.getElementById("yStreakSlot");
    if (!slot) return;
    computeSettleStreak().then(function (n) {
      if (!(n >= 2)) return;
      if (!document.body.contains(slot)) return; // re-rendered out from under us
      slot.style.margin = "10px 2px 0";
      slot.innerHTML = streakChipHtml(n);
    }).catch(function () {});
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
          '<div id="yGear" role="button" aria-label="settings" tabindex="0" style="width:36px; height:36px; border-radius:50%; background:#FFFDF7; border:2px solid #2B2118; box-shadow:2px 2px 0 rgba(43,33,24,0.35); display:flex; align-items:center; justify-content:center; cursor:pointer;">' +
            // Hand-inked spoke gear (hub + 8 ticks) — stays crisp at small sizes,
            // unlike the lobed feather cog it replaces.
            '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2B2118" stroke-width="2" stroke-linecap="round">' +
              '<circle cx="12" cy="12" r="3.4"/>' +
              '<path d="M18.3 12h3M5.7 12h-3M12 5.7v-3M12 18.3v3M16.46 7.54l2.12-2.12M7.54 7.54 5.42 5.42M16.46 16.46l2.12 2.12M7.54 16.46l-2.12 2.12"/>' +
            '</svg></div>' +
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
      ? '<svg id="yCopy" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.5)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="cursor:pointer;"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>'
      : '';
    return '' +
      '<div style="display:flex; align-items:center; gap:15px; padding:6px 2px 2px;">' +
        '<div id="yAvatar" role="button" aria-label="edit profile" tabindex="0" style="width:72px; height:72px; border-radius:22px; background:' + id.color + '; display:flex; align-items:center; justify-content:center; font-size:36px; box-shadow:0 12px 28px rgba(43,33,24,0.13); flex:none; cursor:pointer;">' + app.face(id.emoji) + '</div>' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="display:flex; align-items:center; gap:8px; min-width:0;"><span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:21px; letter-spacing:-0.4px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0;">' + app.esc((id.name || "you").toLowerCase()) + '</span><span style="font-family:\'Space Mono\',monospace; font-size:12px; color:rgba(39,117,202,0.75);">' + app.esc(id.handle.toLowerCase()) + '</span><span id="yEdit" style="font-family:\'Space Mono\',monospace; font-size:11px; color:rgba(43,33,24,0.6); cursor:pointer;">edit</span></div>' +
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
            '<span style="font-family:\'Space Mono\',monospace; font-weight:400; font-size:12px; letter-spacing:1px; color:rgba(43,33,24,0.6);">usdc</span>' +
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
  var CHEV = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

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
        // link more ways to sign in (apple/google/email/phone) so they all open
        // THIS account — lives in the embedded Privy app (needs the Privy session).
        row("yLogins", "🔐", "rgba(39,117,202,0.16)", "sign-in methods") + divider() +
        row("yFriends", "🫂", "rgba(39,117,202,0.16)", "friends") + divider() +
        row("yRecurring", "🔁", "rgba(61,232,199,0.14)", "recurring") + divider() +
        // spending journal: the warm monthly digest ("you spent $214 going out").
        row("yJournal", "📔", "rgba(255,198,92,0.16)", "spending journal") + divider() +
        row("ySaved", "🧾", "rgba(255,198,92,0.16)", "saved tabs") + divider() +
        // notifications taps through to the activity feed; an unread count badge
        // is patched in after render (best-effort, see wireNotifBadge).
        row("yNotif", "🔔", "rgba(255,107,94,0.14)", "notifications") + divider() +
        row("yPush", "📣", "rgba(139,92,246,0.16)", "push notifications", '<span id="yPushState" style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:rgba(43,33,24,0.4); margin-right:2px;">off</span>') + divider() +
        row("ySound", "🔊", "rgba(61,232,199,0.14)", "sounds", '<span id="ySoundState" style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:rgba(43,33,24,0.4); margin-right:2px;">on</span>') + divider() +
        row("yNet", "🌐", "rgba(39,117,202,0.16)", "network", netTag) + divider() +
        // export a CSV of the user's history (built client-side from /api/activity)
        // and help & support (FAQs + contact + links to /terms and /privacy).
        row("yExport", "📄", "rgba(255,198,92,0.16)", "export my history (csv)") + divider() +
        // fun / growth: opens the public Mochi meme generator (/memes) in a new tab.
        row("yMeme", "🐸", "rgba(61,232,199,0.14)", "make a mochi meme") + divider() +
        row("yHelp", "💁", "rgba(43,33,24,0.07)", "help & support") +
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
          // settle-streak chip slot — filled by wireStreak() only when streak >= 2
          // (stays a zero-height empty div otherwise, so it never shows a sad zero).
          '<div id="yStreakSlot"></div>' +
          // invites chip slot — filled by wireInvites() only when count > 0.
          '<div id="yInvitesSlot"></div>' +
          // "add to home screen" chip slot — filled by wireInstall() only when
          // the app is installable and not already installed/dismissed.
          '<div id="yInstallSlot"></div>' +
          balanceCard(balance) +
          settingsList() +
          signOutCard() +
        '</div>' +
      '</div>';

    wireGear();
    wireIdentity(id);
    wireBalance();
    wireSettings();
    wireStreak();     // non-blocking; drops in the settle-streak chip when >= 2
    wireInvites();    // non-blocking; drops in the "friends brought: N" chip when > 0
    wireNotifBadge(); // non-blocking; patches an unread badge in after render
    wireInstall();    // "add to home screen" chip when installable
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

  // "add divvy to your home screen" — a small dismissible journal chip (not a
  // popup). Renders only when the app is installable and hasn't been installed
  // or dismissed. On Android/desktop it triggers the stashed native install
  // prompt; on iOS Safari it opens the share → add-to-home-screen steps sheet.
  function renderInstallChip() {
    var slot = document.getElementById("yInstallSlot");
    if (!slot) return;
    if (!app.install || !app.install.shouldOffer()) { slot.innerHTML = ""; return; }
    var ios = app.install.iosManual && app.install.iosManual();
    slot.innerHTML =
      '<div id="yInstallChip" style="display:flex; align-items:center; gap:11px; margin:2px 0 14px; padding:11px 11px 11px 13px; ' +
        'border:2px solid #2B2118; border-radius:15px; background:#FFFDF7; box-shadow:3px 3px 0 rgba(43,33,24,0.85);">' +
        '<span style="font-size:19px; flex:none;">📲</span>' +
        '<span style="flex:1; min-width:0; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:13px; line-height:1.3; color:#2B2118;">add divvy to your home screen</span>' +
        '<button id="yInstallGo" style="appearance:none; border:2px solid #2B2118; cursor:pointer; flex:none; background:#2775CA; color:#fff; border-radius:999px; padding:7px 13px; font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:12.5px; box-shadow:2px 2px 0 rgba(43,33,24,0.85);">' + (ios ? "how" : "add") + '</button>' +
        '<button id="yInstallX" aria-label="dismiss" style="appearance:none; border:none; cursor:pointer; flex:none; background:transparent; padding:4px; display:flex; align-items:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.55)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
      '</div>';
    var go = document.getElementById("yInstallGo");
    var x = document.getElementById("yInstallX");
    if (go) go.onclick = function () {
      app.track && app.track("install_chip_go", ios ? "ios" : "prompt");
      if (ios) { app.install.iosSheet(); return; }
      app.install.prompt().then(function (ok) {
        if (ok) { app.toast("installing divvy ✨"); renderInstallChip(); }
      });
    };
    if (x) x.onclick = function () {
      app.install.dismiss();
      app.track && app.track("install_chip_dismiss");
      renderInstallChip();
    };
  }
  function wireInstall() {
    renderInstallChip();
    // If beforeinstallprompt lands after this screen painted, re-render the chip.
    window.addEventListener("divvy:installready", function onReady() {
      if (!document.getElementById("yInstallSlot")) {
        window.removeEventListener("divvy:installready", onReady);
        return;
      }
      renderInstallChip();
    });
  }

  // ── signed-out (mascot + connect) ────────────────────────────────────────────
  function signedOut(view) {
    view.innerHTML =
      '<div class="vfill" style="position:relative; display:flex; flex-direction:column;">' +
        backdrop() +
        header() +
        '<div style="position:relative; z-index:2; flex:1; display:flex; flex-direction:column; align-items:center; text-align:center; padding:30px 24px 104px;">' +
          '<div style="margin:10px 0 4px;">' + app.mascot({ size: 128, mood: "happy", glow: true }) + '</div>' +
          '<h1 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:24px; letter-spacing:-0.6px; max-width:300px; margin:10px 0 0; color:#2B2118;">your tabs, your money, your people.</h1>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.8px; color:rgba(43,33,24,0.45); margin:16px 0 22px;">sign in to see your balance</div>' +
          '<button id="yConnect" style="appearance:none; border:none; cursor:pointer; width:100%; max-width:320px; min-height:52px; border-radius:999px; background:#2775CA; border:2px solid #2B2118; font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">sign in</button>' +
          '<div style="margin-top:16px;"><button id="yCreate" style="appearance:none; border:none; background:transparent; cursor:pointer; padding:5px 8px; font-family:\'General Sans\',sans-serif; font-weight:400; font-size:12.5px; color:rgba(43,33,24,0.6); text-decoration:underline; text-underline-offset:2px;">just exploring? try a demo account</button></div>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.8px; color:rgba(43,33,24,0.4); margin-top:20px;">dollars, just faster · settles in seconds</div>' +
        '</div>' +
      '</div>';

    wireGear();
    var c = document.getElementById("yConnect"), n = document.getElementById("yCreate");
    if (c) c.onclick = function () { app.signIn(); };
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

    // Default to cashing out the whole balance (the common intent); falls back
    // to $50 when we couldn't read the balance.
    var DEFAULT = (typeof maxCents === "number" && maxCents > 0) ? maxCents : 5000;

    var entryOpts = { idp: "out", default: DEFAULT };
    if (typeof maxCents === "number" && maxCents > 0) entryOpts.maxCents = maxCents;

    app.sheet(
      '<div style="padding:4px 20px 26px;">' +
        '<div style="text-align:center; margin-bottom:6px;">' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.45);">CASH OUT</div>' +
          '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:21px; letter-spacing:-0.3px; color:#2B2118; margin-top:4px;">cash out to your bank</div>' +
        '</div>' +
        app.amountEntryHtml(entryOpts) +
        '<button id="yOut" type="button" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:54px; margin-top:20px; border-radius:999px; background:#2775CA; border:2px solid #2B2118; display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="10" width="18" height="10" rx="1.5"/><path d="M12 3L3 8h18z"/><path d="M7 14v2M12 14v2M17 14v2"/></svg>' +
          '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff;">cash out to your bank</span>' +
        '</button>' +
        '<div style="text-align:center; margin-top:9px;">' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(43,33,24,0.5);">arrives in 1-2 business days</span>' +
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
    var railsLive = true;
    var out = document.getElementById("yOut");

    // Prefetch live flag. No provider keys → degrade to a soft "coming soon"
    // state instead of a broken payout link.
    app.api.get("/api/me/offramp/" + DEFAULT).then(function (r) {
      if (r && r.live === false) {
        railsLive = false;
        if (out) {
          out.disabled = true;
          out.style.opacity = "0.45";
          out.style.cursor = "not-allowed";
          out.style.boxShadow = "none";
          var lbl = out.querySelector("span:last-child");
          if (lbl) lbl.textContent = "coming soon";
        }
        var note = document.getElementById("yOutTestNote");
        if (note) note.innerHTML =
          '<div style="text-align:center; margin-top:12px;"><span style="font-family:\'Space Mono\',monospace; font-size:10.5px; letter-spacing:.3px; color:rgba(43,33,24,0.5);">coming soon in your region ✨</span></div>';
      }
    }).catch(function () {});

    if (out) out.onclick = function () {
      if (!railsLive) { app.toast("coming soon in your region ✨"); return; }
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

  // ── help & support ───────────────────────────────────────────────────────────
  // A journal-styled sheet: a "where's my money" explainer, a handful of honest
  // FAQs (non-custodial in plain words), a mailto to support, and links out to
  // the server-rendered /terms and /privacy pages (new tab). Self-contained.
  var SUPPORT_EMAIL = "support@divvysol.com";

  function faqBlock(q, a) {
    return '' +
      '<div style="border-top:1px solid rgba(43,33,24,0.08); padding:13px 2px 3px;">' +
        '<div style="font-family:\'General Sans\',sans-serif; font-weight:600; font-size:14.5px; color:#2B2118;">' + q + '</div>' +
        '<div style="font-family:\'General Sans\',sans-serif; font-size:13.5px; line-height:1.55; color:rgba(43,33,24,0.66); margin-top:5px;">' + a + '</div>' +
      '</div>';
  }

  function openHelpSheet() {
    app.haptic && app.haptic();
    var faqs =
      faqBlock("where does my money live?",
        "in your own wallet — never with divvy. we're non-custodial, so we never hold your funds or your keys. your balance is USDC, a digital dollar, and only you can move it.") +
      faqBlock("how do i get paid?",
        "when a friend settles up, the money lands straight in your wallet, usually within seconds. your balance here updates automatically, and you can cash out to your bank or card any time.") +
      faqBlock("what does it cost?",
        "splitting and settling is free. the network fee is a fraction of a cent. if you add or cash out money with a card, our partner moonpay charges a small fee, shown before you confirm.") +
      faqBlock("is this a bank?",
        "no. divvy isn't a bank and doesn't hold your money. it's a tool for splitting bills and settling up in USDC, a digital dollar, that stays in your own wallet the whole time.") +
      faqBlock("how do i delete my account?",
        "scroll to the bottom of this screen and tap “delete account.” that removes your login and profile — your wallet and any money in it stay yours.");

    app.sheet(
      '<div style="padding:4px 20px 28px; max-height:72vh; overflow:auto;">' +
        '<div style="text-align:center; margin-bottom:6px;">' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.45);">HELP &amp; SUPPORT</div>' +
          '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:21px; letter-spacing:-0.3px; color:#2B2118; margin-top:4px;">how divvy works</div>' +
        '</div>' +
        // "where's my money" explainer
        '<div style="background:#FFFDF7; border:2px solid #2B2118; border-radius:16px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:15px 16px; margin-top:12px;">' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.2px; color:rgba(43,33,24,0.45);">WHERE’S MY MONEY?</div>' +
          '<div style="font-family:\'General Sans\',sans-serif; font-size:13.5px; line-height:1.55; color:rgba(43,33,24,0.72); margin-top:7px;">your money lives in <b>your own wallet</b>, not with divvy. every balance is <b>USDC — a digital dollar</b> — sitting in a wallet only you control. divvy just does the math and helps you send. spend it with any card, cash out to your bank, or send it to a friend.</div>' +
        '</div>' +
        // FAQs
        '<div style="margin-top:16px;">' + faqs + '</div>' +
        // mailto
        '<a href="mailto:' + SUPPORT_EMAIL + '" style="display:flex; align-items:center; justify-content:center; gap:9px; text-decoration:none; margin-top:20px; min-height:50px; border-radius:999px; background:#2775CA; border:2px solid #2B2118; box-shadow:3px 3px 0 rgba(43,33,24,0.9); font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:15px; color:#fff;">email support</a>' +
        // legal links (new tab)
        '<div style="display:flex; gap:14px; justify-content:center; margin-top:16px;">' +
          '<a href="/terms" target="_blank" rel="noopener" style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.4px; color:rgba(43,33,24,0.5); text-decoration:none;">terms</a>' +
          '<span style="color:rgba(43,33,24,0.25);">·</span>' +
          '<a href="/privacy" target="_blank" rel="noopener" style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.4px; color:rgba(43,33,24,0.5); text-decoration:none;">privacy</a>' +
          '<span style="color:rgba(43,33,24,0.25);">·</span>' +
          '<a href="/support" target="_blank" rel="noopener" style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.4px; color:rgba(43,33,24,0.5); text-decoration:none;">support page</a>' +
        '</div>' +
      '</div>'
    );
  }

  // ── export my history (client-side CSV) ──────────────────────────────────────
  // Builds a CSV from GET /api/activity and downloads it via a Blob link. Fields
  // are escaped per RFC-4180 (quotes doubled, commas/newlines quoted) AND guarded
  // against spreadsheet formula injection: any cell beginning with = + - @ (or a
  // control char) is prefixed with a single quote so Excel/Sheets treats it as
  // text, not a formula.
  function csvCell(v) {
    var s = (v == null) ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           // formula-injection guard
    if (/[",\n\r]/.test(s) || s.charAt(0) === "'") {   // RFC-4180 quoting
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function activityToCsv(events) {
    var rows = [["date", "type", "description", "amount", "group"]];
    if (Array.isArray(events)) {
      events.forEach(function (e) {
        if (!e) return;
        rows.push([e.at || "", e.type || "", e.text || "", e.amountFmt || "", e.tripName || ""]);
      });
    }
    return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
  }

  function exportHistoryCsv() {
    app.haptic && app.haptic();
    app.toast("preparing your history…");
    Promise.resolve().then(function () { return app.api.get("/api/activity"); })
      .then(function (events) {
        var csv = activityToCsv(events);
        var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "divvy-history-" + new Date().toISOString().slice(0, 10) + ".csv";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          try { a.remove(); } catch (_) {}
          try { URL.revokeObjectURL(url); } catch (_) {}
        }, 0);
        var n = Array.isArray(events) ? events.length : 0;
        app.toast(n ? ("exported " + n + " row" + (n === 1 ? "" : "s") + " ✨") : "no history yet — empty file saved");
      })
      .catch(function (e) { app.toast((e && e.message) || "couldn't export history"); });
  }

  function wireSettings() {
    var wal = document.getElementById("yWallet");
    if (wal) wal.onclick = function () {
      // Wallet backup/recovery lives in the embedded Privy app (it needs the
      // wallet context). Hand off with an absolute return path back to here.
      window.location.href = "/embedded/?manage=wallet&ret=" + encodeURIComponent("/#/you");
    };
    var lg = document.getElementById("yLogins");
    if (lg) lg.onclick = function () {
      // Linking sign-in methods (apple/google/email/phone → one account) lives
      // in the embedded Privy app too — it needs the Privy user context.
      window.location.href = "/embedded/?manage=logins&ret=" + encodeURIComponent("/#/you");
    };
    var f = document.getElementById("yFriends");
    if (f) f.onclick = function () { location.hash = "#/friends"; };
    var r = document.getElementById("yRecurring");
    if (r) r.onclick = function () { location.hash = "#/recurring"; };
    var jn = document.getElementById("yJournal");
    if (jn) jn.onclick = function () { location.hash = "#/journal"; };
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
    // export my history → client-side CSV download from /api/activity.
    var exp = document.getElementById("yExport");
    if (exp) exp.onclick = exportHistoryCsv;
    // make a mochi meme → opens the public meme generator (/memes) in a new tab.
    var meme = document.getElementById("yMeme");
    if (meme) meme.onclick = function () { window.open("/memes", "_blank", "noopener"); };
    // help & support → journal-styled FAQ sheet (+ mailto, /terms, /privacy).
    var help = document.getElementById("yHelp");
    if (help) help.onclick = openHelpSheet;
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
