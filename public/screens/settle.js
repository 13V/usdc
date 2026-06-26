/* screens/settle.js — Settle up. A 5-state machine (ready · waiting · retry ·
   needs-funds · settled) lifted EXACTLY from design/handoff/Settle Up Frames.dc.html
   (primary) with the inline-styled markup wired to live data — see public/screens/home.js
   for the lift-and-wire pattern.

   Route: #/settle/<tripId> ; params[0] = tripId.
   Wiring kept intact: POST /api/trips/:id/settle (build) → transfers[].url + reference;
   POST /api/trips/:id/settle/verify (poll, debounced); Phantom universal-link deeplink;
   mascot mood per state. lowercase + dry; plain dollars, never "crypto". never crash. */
(function () {
  "use strict";
  var app = window.app;

  // ---- module state (per render) ----
  var S = null; // { view, tripId, state, transfer, toName, fromName, trip, pollTimer, polling, tries }

  function esc(s) { return app.esc(s); }
  function trunc(s) {
    s = String(s || "");
    if (s.length <= 11) return s;
    return s.slice(0, 4) + "…" + s.slice(-4);
  }
  function encURL(u) { return encodeURIComponent(String(u || "")); }
  function phantomLink(u) {
    // Phantom universal link wraps the solana: pay url in its browse deeplink.
    return "https://phantom.app/ul/browse/" + encURL(u) + "?ref=" + encURL("https://divvy.app");
  }
  function qrSrc(u) {
    return "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encURL(u);
  }
  function openUrl(u) {
    if (!u) return;
    try { window.location.href = u; } catch (_) { /* ignore */ }
  }

  // ---- inline icons (lifted from the frame SVGs) ----
  var PHANTOM_SVG =
    '<svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true" style="flex:none;">' +
    '<path fill="#fff" d="M12 3.2C7.7 3.2 4.2 6.6 4.2 10.9V19c0 .8.9 1.2 1.5.7l1.3-1.1c.3-.3.8-.3 1.1 0l1.2 1.1c.3.3.8.3 1.1 0l1.2-1.1c.3-.3.8-.3 1.1 0l1.2 1.1c.3.3.8.3 1.1 0l1.3-1.1c.3-.3.8-.3 1.1 0l1.3 1.1c.6.5 1.5.1 1.5-.7v-8.1c0-4.3-3.5-7.7-7.8-7.7z"/>' +
    '<circle cx="9.4" cy="11" r="1.35" fill="#2775CA"/><circle cx="14.6" cy="11" r="1.35" fill="#2775CA"/></svg>';
  var ARROW_SVG =
    '<svg width="24" height="13" viewBox="0 0 26 14" fill="none" stroke="rgba(244,247,250,0.4)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><path d="M1 7h22m-5-5 5 5-5 5"/></svg>';
  var SHARE_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0B1622" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5"/></svg>';

  // ---- chrome (lifted: settle-up status row + optional cancel) ----
  function header(showCancel) {
    return '<div style="position:relative; z-index:2; display:flex; align-items:center; justify-content:' +
      (showCancel ? 'space-between' : 'flex-start') + '; height:46px; padding:0 22px; flex:none;">' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:1.5px; color:rgba(244,247,250,0.5);">settle up</span>' +
      (showCancel
        ? '<span id="stCancel" style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(244,247,250,0.5); cursor:pointer;">cancel</span>'
        : '') +
      '</div>';
  }
  function wireCancel() {
    var c = document.getElementById("stCancel");
    if (c) c.onclick = function () { history.length > 1 ? history.back() : app.go("groups"); };
  }
  // centered stage; the radial glow tint shifts per state (lifted per frame)
  function stage(glowCss, inner) {
    return '<div style="position:relative; min-height:74vh;">' +
      (glowCss ? '<div style="position:absolute; left:50%; top:42%; width:460px; height:460px; transform:translate(-50%,-50%); border-radius:50%; background:' + glowCss + '; pointer-events:none;"></div>' : '') +
      '<div style="position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; min-height:74vh; padding:6px 2px 18px;">' +
      inner + '</div></div>';
  }

  // ---- mascot body builder (lifted from the frame: squishy USDC-blue blob) ----
  // mood: happy | watching | shrug | sparkle | broke
  function mascot(size, mood, floatAnim) {
    var feetY = Math.round(size * 0.30);
    var armY = Math.round(size * 0.32);
    var sparkles = mood === "sparkle"
      ? '<span style="position:absolute; top:-7px; left:-17px; font-size:15px; animation:stSpark 1.4s ease-in-out infinite;">✨</span>' +
        '<span style="position:absolute; top:1px; right:-17px; font-size:12px; animation:stSpark 1.4s ease-in-out .4s infinite;">✨</span>'
      : "";
    var brokeMark = mood === "broke"
      ? '<span style="position:absolute; top:-4px; right:-16px; font-size:15px;">💸</span>' : "";

    // arms — shrug throws them up; others wave
    var arms = mood === "shrug"
      ? '<div style="position:absolute; left:-8px; top:' + (armY - 12) + 'px; width:10px; height:18px; border-radius:999px; background:linear-gradient(160deg,#3f93e4,#2061a8); transform:rotate(48deg); z-index:-1;"></div>' +
        '<div style="position:absolute; right:-8px; top:' + (armY - 12) + 'px; width:10px; height:18px; border-radius:999px; background:linear-gradient(160deg,#3f93e4,#2061a8); transform:rotate(-48deg); z-index:-1;"></div>'
      : '<div style="position:absolute; left:-5px; top:' + armY + 'px; width:10px; height:18px; border-radius:999px; background:linear-gradient(160deg,#3f93e4,#2061a8); transform-origin:7px 2px; animation:stWaveL 4.2s ease-in-out infinite; z-index:-1;"></div>' +
        '<div style="position:absolute; right:-5px; top:' + armY + 'px; width:10px; height:18px; border-radius:999px; background:linear-gradient(160deg,#3f93e4,#2061a8); transform-origin:3px 2px; animation:stWaveR 4.2s ease-in-out infinite; z-index:-1;"></div>';

    // eyes
    var eyes;
    if (mood === "watching") {
      var e = '<div style="width:13px; height:14px; border-radius:50%; background:#eef6ff; display:flex; align-items:center; justify-content:center;"><div style="width:6px; height:6px; border-radius:50%; background:#0B1622; animation:stWatch 3s ease-in-out infinite;"></div></div>';
      eyes = '<div style="display:flex; gap:7px; margin-top:-2px;">' + e + e + '</div>';
    } else if (mood === "shrug") {
      var d = '<div style="width:9px; height:2.6px; border-radius:2px; background:#0B1622;"></div>';
      eyes = '<div style="display:flex; gap:8px; margin-top:-2px; align-items:center;">' + d + d + '</div>';
    } else {
      var blink = mood === "sparkle" ? "" : "animation:stBlink 5s infinite;";
      var dot = '<div style="width:7px; height:9px; border-radius:50%; background:#0B1622;' + blink + '"></div>';
      eyes = '<div style="display:flex; gap:8px; margin-top:-4px;">' + dot + dot + '</div>';
    }

    // mouth
    var mouth;
    if (mood === "shrug")
      mouth = '<div style="position:absolute; bottom:20px; width:9px; height:9px; border:2.4px solid #0B1622; border-radius:50%; border-bottom-color:transparent; border-left-color:transparent; transform:rotate(45deg);"></div>';
    else if (mood === "broke")
      mouth = '<div style="position:absolute; bottom:17px; width:12px; height:3px; border-radius:2px; background:#0B1622;"></div>';
    else if (mood === "watching")
      mouth = "";
    else
      mouth = '<div style="position:absolute; bottom:16px; width:16px; height:9px; border:2.6px solid #0B1622; border-top:none; border-radius:0 0 11px 11px;"></div>';

    return '<div style="position:relative; animation:' + (floatAnim || "stFloat 5s ease-in-out infinite") + ';">' +
      sparkles + brokeMark +
      '<div style="position:relative; width:' + size + 'px; height:' + size + 'px; background:linear-gradient(155deg,#4aa0f0,#2775CA 60%,#1c5697); animation:stSquish 4.5s ease-in-out infinite; box-shadow:0 12px 28px rgba(39,117,202,0.5), inset 0 2px 5px rgba(255,255,255,0.28); display:flex; align-items:center; justify-content:center;">' +
        '<div style="position:absolute; left:' + Math.round(size * 0.30) + 'px; bottom:-7px; width:9px; height:15px; border-radius:999px; background:linear-gradient(160deg,#3a8fe0,#1f5da3); z-index:-1;"></div>' +
        '<div style="position:absolute; right:' + Math.round(size * 0.30) + 'px; bottom:-7px; width:9px; height:15px; border-radius:999px; background:linear-gradient(160deg,#3a8fe0,#1f5da3); z-index:-1;"></div>' +
        arms + eyes + mouth +
      '</div>' +
    '</div>';
  }

  // ---- avatars for the you → name card ----
  function meEmoji() {
    var u = (window.Auth && window.Auth.user) || {};
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem("divvy.profile") || "{}") || {}; } catch (_) {}
    return { emoji: u.emoji || saved.emoji || "🦊", color: u.color || saved.color || "linear-gradient(150deg,#FFC65C,#FF6B5E)" };
  }
  // the recipient's real identity (emoji/color) from the trip members, not a
  // hardcoded avatar — falls back to a neutral blue→mint tile.
  function themIdentity() {
    var to = S && S.transfer && S.transfer.to;
    var m = ((S && S.trip && S.trip.members) || []).filter(function (x) { return x.id === to; })[0] || {};
    return { emoji: m.emoji || "🙂", color: m.color || "linear-gradient(150deg,#3DE8C7,#2775CA)" };
  }
  function avatarTile(emoji, bg, label, labelColor) {
    return '<div style="display:flex; flex-direction:column; align-items:center; gap:4px;">' +
      '<div style="width:38px; height:38px; border-radius:50%; background:' + bg + '; display:flex; align-items:center; justify-content:center; font-size:18px;">' + esc(emoji) + '</div>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:9px; color:' + labelColor + ';">' + esc(label) + '</span>' +
    '</div>';
  }

  // ---- amount, lifted: big mono digits, lighter −$ + decimals ----
  function bigNeg(cents, sizePx, decPx) {
    var n = Math.abs(cents) / 100;
    var whole = Math.floor(n).toLocaleString();
    var dec = (n % 1).toFixed(2).slice(1);
    return '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:' + sizePx + 'px; line-height:1; letter-spacing:-1.8px; color:#FF6B5E;">' +
      '<span style="font-size:' + decPx + 'px; opacity:.5;">−$</span>' + whole + '<span style="font-size:' + decPx + 'px; opacity:.5;">' + dec + '</span></div>';
  }

  // ---- STATE: ready / choose (lifted FRAME 1) ----------------------------------
  function renderReady() {
    var t = S.transfer;
    var solUrl = t.url;
    var me = meEmoji();
    var them = themIdentity();
    var themBg = them.color;
    var themLabel = S.toName + (t.toWallet ? " · " + trunc(t.toWallet) : "");

    var card =
      '<div style="position:relative; width:100%; max-width:340px; background:#13212E; border-radius:24px; border:1px solid rgba(244,247,250,0.07); box-shadow:0 16px 40px rgba(0,0,0,0.34); padding:20px 20px 18px; overflow:hidden;">' +
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 90% 4%, rgba(255,255,255,0.04) 0 1px, transparent 1px 8px); opacity:.7; pointer-events:none;"></div>' +
        '<div style="position:absolute; top:16px; bottom:16px; right:12px; width:3px; background:repeating-linear-gradient(180deg, rgba(39,117,202,0.6) 0 5px, transparent 5px 11px); opacity:.5; pointer-events:none;"></div>' +
        '<div style="position:relative;">' +
          // you → ava
          '<div style="display:flex; align-items:center; justify-content:center; gap:11px;">' +
            avatarTile(me.emoji, me.color, "you", "rgba(244,247,250,0.45)") +
            ARROW_SVG +
            avatarTile(them.emoji, themBg, themLabel, "rgba(244,247,250,0.55)") +
          '</div>' +
          // amount
          '<div style="text-align:center; margin-top:15px;">' +
            bigNeg(t.amountCents, 46, 25) +
            '<div style="display:flex; align-items:center; justify-content:center; gap:8px; margin-top:8px;">' +
              '<span style="font-family:\'General Sans\',sans-serif; font-size:13px; color:rgba(244,247,250,0.5);">you owe ' + esc(S.toName) + '</span>' +
              '<span style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:1px; color:rgba(244,247,250,0.4); border:1px solid rgba(244,247,250,0.16); border-radius:5px; padding:1px 5px;">IN USDC</span>' +
            '</div>' +
          '</div>' +
          // pay paths
          '<div style="display:flex; flex-direction:column; gap:9px; margin-top:18px;">' +
            '<button id="stPhantom" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:52px; border-radius:15px; background:linear-gradient(120deg,#3286db,#2775CA); display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:0 10px 26px rgba(39,117,202,0.45);">' +
              PHANTOM_SVG +
              '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff;">pay with phantom</span>' +
            '</button>' +
            '<button id="stWallet" style="appearance:none; cursor:pointer; width:100%; min-height:50px; border-radius:15px; background:transparent; border:1px solid rgba(244,247,250,0.16); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px;">' +
              '<span style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#F4F7FA;">open in another wallet</span>' +
              '<span style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.5px; color:rgba(244,247,250,0.42);">solflare · backpack · any solana pay</span>' +
            '</button>' +
            // QR (live image of the real solana: url)
            '<div style="display:flex; align-items:center; gap:13px; background:rgba(238,241,244,0.04); border:1px solid rgba(244,247,250,0.10); border-radius:15px; padding:11px 13px; text-align:left;">' +
              '<div style="width:62px; height:62px; background:#EEF1F4; border-radius:11px; padding:6px; flex:none;">' +
                '<img alt="solana pay qr" width="100%" height="100%" style="display:block; border-radius:6px;" src="' + esc(qrSrc(solUrl)) + '">' +
              '</div>' +
              '<div style="flex:1; min-width:0;">' +
                '<div style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:13px; color:rgba(244,247,250,0.82);">or scan with any solana wallet</div>' +
                '<div style="font-family:\'Space Mono\',monospace; font-size:9.5px; letter-spacing:.5px; color:rgba(244,247,250,0.4); margin-top:3px;">pay from your phone on desktop</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          // ref + reassurance
          '<div style="margin-top:16px; padding-top:13px; border-top:1px solid rgba(244,247,250,0.08); text-align:center;">' +
            '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:rgba(244,247,250,0.42);">ref ' + esc(trunc(t.reference)) + '</div>' +
            '<div style="font-family:\'Space Mono\',monospace; font-size:9.5px; letter-spacing:.3px; color:rgba(244,247,250,0.34); margin-top:5px;">irreversible · arrives in seconds · ~$0.0001 fee</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var amtStr = "$" + (Math.abs(t.amountCents || 0) / 100).toFixed(2);
    S.view.innerHTML = header(true) +
      '<div class="appscroll" style="padding-top:0;">' +
        stage("",
          '<div style="margin-bottom:14px;">' + mascot(58, "happy") + '</div>' +
          // primary: pay in-app with the user's own (Privy/created) wallet
          '<button id="stInApp" style="appearance:none; border:none; cursor:pointer; width:100%; max-width:340px; min-height:56px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 12px 30px rgba(39,117,202,0.5);">' +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff;">pay ' + amtStr + ' with my wallet</span><span style="font-size:14px;">✨</span>' +
          '</button>' +
          '<div style="display:flex; align-items:center; gap:12px; width:100%; max-width:340px; padding:14px 0 4px;"><span style="flex:1; height:1px; background:rgba(244,247,250,0.10);"></span><span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1px; color:rgba(244,247,250,0.4);">or pay from another wallet</span><span style="flex:1; height:1px; background:rgba(244,247,250,0.10);"></span></div>' +
          card +
          '<button id="stPaid" style="appearance:none; cursor:pointer; width:100%; max-width:340px; margin-top:14px; min-height:48px; border-radius:999px; background:transparent; border:1px solid rgba(244,247,250,0.16); font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#F4F7FA;">i\'ve paid — check now</button>'
        ) +
      '</div>';
    wireCancel();
    var inapp = document.getElementById("stInApp");
    if (inapp) inapp.onclick = function () {
      // hand off to the embedded Privy wallet to sign + send the USDC transfer.
      var mint = (/[?&]spl-token=([^&]+)/.exec(solUrl || "") || [])[1] || "";
      var qs = "pay=settle" +
        "&to=" + encodeURIComponent(t.toWallet || "") +
        "&amount=" + (Math.abs(t.amountCents || 0)) +
        "&ref=" + encodeURIComponent(t.reference || "") +
        "&mint=" + encodeURIComponent(mint) +
        "&trip=" + encodeURIComponent((S.trip && S.trip.id) || "") +
        // Absolute return path: the embedded app lives at /embedded/, so a bare
        // "#/settle/.." would just append a hash there and strand the user.
        // Prefix "/" so we return to the MAIN app (e.g. /#/settle/<tripId>).
        "&ret=" + encodeURIComponent("/" + (location.hash || "#/home"));
      window.location.href = "/embedded/?" + qs;
    };
    var ph = document.getElementById("stPhantom");
    if (ph) ph.onclick = function () { openUrl(phantomLink(solUrl)); go("waiting"); };
    var w = document.getElementById("stWallet");
    if (w) w.onclick = function () { openUrl(solUrl); go("waiting"); };
    var paid = document.getElementById("stPaid");
    if (paid) paid.onclick = function () { go("waiting"); poll(); };
  }

  // ---- STATE: waiting (lifted FRAME 3) ----------------------------------------
  function renderWaiting() {
    var t = S.transfer;
    S.view.innerHTML = header(false) +
      '<div class="appscroll" style="padding-top:0;">' +
        stage("radial-gradient(circle, rgba(39,117,202,0.18) 0%, rgba(39,117,202,0) 68%)",
          '<div style="margin-bottom:26px;">' + mascot(72, "watching") + '</div>' +
          // state pill
          '<div style="display:inline-flex; align-items:center; gap:7px; background:rgba(39,117,202,0.12); border:1px solid rgba(39,117,202,0.5); border-radius:999px; padding:5px 13px;">' +
            '<span style="width:7px; height:7px; border-radius:50%; background:#2775CA; animation:stPulse 1.4s ease-in-out infinite;"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:10px; letter-spacing:1.5px; color:#7fc0ff;">WAITING FOR PAYMENT</span>' +
          '</div>' +
          // waiting — confirmed progress
          '<div style="display:flex; align-items:center; gap:7px; margin-top:11px;">' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:9px; font-weight:700; letter-spacing:.5px; color:#7fc0ff;">waiting</span>' +
            '<span style="width:18px; height:2px; border-radius:2px; background:repeating-linear-gradient(90deg,rgba(127,192,255,0.7) 0 3px,transparent 3px 6px);"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.5px; color:rgba(244,247,250,0.4);">confirmed</span>' +
          '</div>' +
          '<h2 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:23px; line-height:1.18; letter-spacing:-0.3px; text-align:center; margin:22px 0 0; color:#F4F7FA; max-width:280px;">watching the chain<br>for your payment</h2>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.3px; color:rgba(244,247,250,0.5); margin-top:11px;">' +
            esc(t.amountFmt || "") + ' → ' + esc(S.toName) + (t.toWallet ? ' · ' + esc(trunc(t.toWallet)) : '') + '</div>' +
          '<div style="width:100%; max-width:340px; margin-top:30px; display:flex; flex-direction:column; gap:11px;">' +
            '<button id="stCheck" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:54px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff; box-shadow:0 10px 26px rgba(39,117,202,0.42);">i\'ve paid — check now</button>' +
            '<button id="stWalletAgain" style="appearance:none; background:transparent; border:none; cursor:pointer; width:100%; min-height:44px; font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(244,247,250,0.5);">open wallet again</button>' +
          '</div>'
        ) +
      '</div>';
    var c = document.getElementById("stCheck");
    if (c) c.onclick = function () { poll(true); };
    var wa = document.getElementById("stWalletAgain");
    if (wa) wa.onclick = function () { openUrl(t.url); };
    startAutoPoll();
  }

  // ---- STATE: retry / not-seen-yet (lifted FRAME 4) ---------------------------
  function renderRetry() {
    var t = S.transfer;
    S.view.innerHTML = header(false) +
      '<div class="appscroll" style="padding-top:0;">' +
        stage("radial-gradient(circle, rgba(255,198,92,0.10) 0%, rgba(39,117,202,0) 68%)",
          '<div style="margin-bottom:26px;">' + mascot(72, "shrug", "stShrug 3.4s ease-in-out infinite") + '</div>' +
          '<div style="display:inline-flex; align-items:center; gap:7px; background:rgba(255,198,92,0.10); border:1px solid rgba(255,198,92,0.4); border-radius:999px; padding:5px 13px;">' +
            '<span style="width:7px; height:7px; border-radius:50%; background:#FFC65C; animation:stPulse 1.6s ease-in-out infinite;"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:10px; letter-spacing:1.5px; color:#FFC65C;">NOT SEEN YET</span>' +
          '</div>' +
          '<h2 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:25px; line-height:1.16; letter-spacing:-0.3px; text-align:center; margin:22px 0 0; color:#F4F7FA;">still looking 👀</h2>' +
          '<p style="font-family:\'General Sans\',sans-serif; font-size:14px; line-height:1.45; text-align:center; color:rgba(244,247,250,0.55); margin:11px 0 0; max-width:264px;">paid already? give it a few seconds — solana\'s fast, but your wallet might still be broadcasting.</p>' +
          '<div style="width:100%; max-width:340px; margin-top:30px; display:flex; flex-direction:column; gap:11px;">' +
            '<button id="stAgain" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:54px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff; box-shadow:0 10px 26px rgba(39,117,202,0.42);">check again</button>' +
            '<button id="stOpenAgain" style="appearance:none; cursor:pointer; width:100%; min-height:50px; border-radius:999px; background:transparent; border:1px solid rgba(244,247,250,0.16); font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#F4F7FA;">open wallet again</button>' +
          '</div>'
        ) +
      '</div>';
    var a = document.getElementById("stAgain");
    if (a) a.onclick = function () { go("waiting"); poll(); };
    var o = document.getElementById("stOpenAgain");
    if (o) o.onclick = function () { openUrl(t.url); go("waiting"); };
  }

  // ---- STATE: needs-funds / balance too low (lifted FRAME 5) ------------------
  function renderNeedsFunds() {
    var t = S.transfer;
    // The API doesn't expose a wallet balance, so we render the breakdown only
    // when we actually know it (S.balanceCents) — never invent numbers.
    var amt = '<span style="font-family:\'Space Mono\',monospace; font-weight:700; color:#FF6B5E;">' + esc(t.amountFmt || "") + '</span>';
    var breakdown = "";
    if (typeof S.balanceCents === "number") {
      var have = "$" + (S.balanceCents / 100).toFixed(2);
      var shortBy = Math.max(0, Math.abs(t.amountCents) - S.balanceCents);
      breakdown =
        '<div style="display:flex; align-items:center; gap:8px; margin-top:14px;">' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:rgba(244,247,250,0.45);">balance</span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:13px; color:rgba(244,247,250,0.7);">' + esc(have) + '</span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; color:rgba(244,247,250,0.3);">/</span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:#FF6B5E;">short $' + (shortBy / 100).toFixed(2) + '</span>' +
        '</div>';
    }
    S.view.innerHTML = header(true) +
      '<div class="appscroll" style="padding-top:0;">' +
        stage("radial-gradient(circle, rgba(255,107,94,0.16) 0%, rgba(255,107,94,0) 68%)",
          '<div style="margin-bottom:24px;">' + mascot(70, "broke") + '</div>' +
          '<div style="display:inline-flex; align-items:center; gap:7px; background:rgba(255,107,94,0.1); border:1px solid rgba(255,107,94,0.45); border-radius:999px; padding:5px 13px;">' +
            '<span style="width:7px; height:7px; border-radius:50%; background:#FF6B5E; animation:stPulseC 1.6s ease-in-out infinite;"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:10px; letter-spacing:1.5px; color:#FF6B5E;">BALANCE TOO LOW</span>' +
          '</div>' +
          '<h2 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:24px; line-height:1.2; letter-spacing:-0.3px; text-align:center; margin:20px 0 0; color:#F4F7FA; max-width:280px;">you need ' + amt + ' USDC to settle this</h2>' +
          breakdown +
          '<div style="width:100%; max-width:340px; margin-top:30px; display:flex; flex-direction:column; gap:11px;">' +
            '<button id="stAdd" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:56px; border-radius:999px; background:linear-gradient(120deg,#FF8A7E,#FF6B5E); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px; box-shadow:0 10px 28px rgba(255,107,94,0.4);">' +
              '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#fff;">add money</span>' +
              '<span style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:1px; color:rgba(255,255,255,0.8);">DEBIT CARD · APPLE PAY · INSTANT</span>' +
            '</button>' +
            '<button id="stOther" style="appearance:none; cursor:pointer; width:100%; min-height:50px; border-radius:999px; background:transparent; border:1px solid rgba(244,247,250,0.16); font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#F4F7FA;">use another wallet</button>' +
            '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(244,247,250,0.34); text-align:center; margin-top:4px;">dollars, just faster.</div>' +
          '</div>'
        ) +
      '</div>';
    wireCancel();
    var add = document.getElementById("stAdd");
    if (add) add.onclick = function () { app.depositSheet(); watchDepositClose(); };
    var oth = document.getElementById("stOther");
    if (oth) oth.onclick = function () { go("ready"); };
  }

  // After "add money" opens the deposit sheet, watch for it to close, then
  // re-check the live wallet balance — if it now covers the amount, advance to
  // ready so the user isn't stranded on needs-funds after topping up.
  function watchDepositClose() {
    // tear down any prior watcher so repeated "add money" taps can't stack loops
    if (S && S.depositWatch) { clearTimeout(S.depositWatch.t); clearInterval(S.depositWatch.iv); }
    var w = { t: null, iv: null };
    if (S) S.depositWatch = w;
    // wait a tick so the just-opened sheet is registered before we poll for close
    w.t = setTimeout(function () {
      w.iv = setInterval(function () {
        if (!S || location.hash.indexOf("settle") < 0 || S.state !== "needs-funds") {
          clearInterval(w.iv); return;        // navigated away / state changed
        }
        if (app._sheet) return;               // sheet still open — keep waiting
        clearInterval(w.iv);
        recheckBalance();
      }, 400);
    }, 300);
  }

  function recheckBalance() {
    if (!S || !S.transfer || S.state !== "needs-funds") return;
    var need = Math.abs(S.transfer.amountCents || 0);
    app.api.get("/api/me/wallet").then(function (w) {
      if (!S || S.state !== "needs-funds") return;
      if (w && typeof w.usdcCents === "number") {
        S.balanceCents = w.usdcCents;
        if (w.usdcCents >= need) { go("ready"); return; }
        renderNeedsFunds();                   // refresh the shortfall breakdown
      }
    }).catch(function () { /* balance unknown — leave the user on needs-funds */ });
  }

  // ---- STATE: settled / squared (lifted FRAME 2) ------------------------------
  function renderSettled() {
    var card =
      '<div id="stShare" style="position:relative; width:100%; max-width:340px; border-radius:24px; padding:18px 24px 24px; overflow:hidden; color:#fff;' +
        'background:linear-gradient(125deg,#2775CA 0%,#2aa5cf 48%,#3DE8C7 100%); background-size:200% 200%; animation:stGrad 6s ease-in-out infinite; box-shadow:0 22px 52px rgba(39,117,202,0.45);">' +
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 85% 6%, rgba(255,255,255,0.10) 0 1px, transparent 1px 9px); opacity:.55; pointer-events:none;"></div>' +
        // squared stamp
        '<div style="position:absolute; top:18px; right:16px; transform:rotate(-11deg); animation:stStamp .6s ease-out .15s both;">' +
          '<span style="display:inline-flex; align-items:center; gap:5px; border:2px dashed rgba(255,255,255,0.85); border-radius:999px; padding:5px 11px;">' +
            '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:12px; letter-spacing:1px; color:#fff;">SQUARED</span><span style="font-size:12px;">✨</span>' +
          '</span>' +
        '</div>' +
        '<div style="position:relative; text-align:left;">' +
          // FINALIZED pill
          '<div style="display:inline-flex; align-items:center; gap:7px; background:rgba(11,22,34,0.22); border:1px solid rgba(255,255,255,0.45); border-radius:999px; padding:4px 11px;">' +
            '<span style="width:7px; height:7px; border-radius:50%; background:#eafff9; animation:stPulse 1.6s ease-in-out infinite;"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:10px; letter-spacing:1.5px; color:#fff;">FINALIZED</span>' +
          '</div>' +
          // waiting → confirmed → finalized
          '<div style="display:flex; align-items:center; gap:6px; margin-top:9px;">' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.5px; color:rgba(255,255,255,0.6);">waiting</span>' +
            '<span style="width:14px; height:1px; background:rgba(255,255,255,0.4);"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.5px; color:rgba(255,255,255,0.6);">confirmed</span>' +
            '<span style="width:14px; height:1px; background:rgba(255,255,255,0.7);"></span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:9px; font-weight:700; letter-spacing:.5px; color:#fff;">finalized</span>' +
          '</div>' +
          '<h2 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:28px; line-height:1.1; letter-spacing:-0.5px; margin:18px 0 0; color:#fff;">you\'re square with ' + esc(S.toName) + '</h2>' +
          '<div id="stTick" style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:52px; line-height:1; letter-spacing:-2px; color:#fff; margin-top:14px; text-shadow:0 2px 20px rgba(0,0,0,0.18);">' +
            '<span style="font-size:28px; opacity:.6;">$</span>0<span style="font-size:28px; opacity:.6;">.00</span></div>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:12px; letter-spacing:.3px; color:rgba(255,255,255,0.92); margin-top:15px;">settled. &lt;1 second. &lt;1 cent.</div>' +
          '<div id="stSolscan" style="display:inline-flex; align-items:center; gap:5px; margin-top:9px; cursor:pointer;">' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10.5px; letter-spacing:.5px; color:rgba(255,255,255,0.72);">view on solscan</span>' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:13px; color:rgba(255,255,255,0.72);">›</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    S.view.innerHTML = header(false) +
      '<div class="appscroll" style="padding-top:0;">' +
        stage("radial-gradient(circle, rgba(61,232,199,0.20) 0%, rgba(39,117,202,0.13) 40%, rgba(39,117,202,0) 70%)",
          '<div style="margin-bottom:16px;">' + mascot(62, "sparkle", "stBounce 2.4s ease-in-out infinite") + '</div>' +
          card +
          '<div style="display:flex; gap:11px; width:100%; max-width:340px; margin-top:14px;">' +
            '<button id="stShareBtn" style="appearance:none; border:none; cursor:pointer; flex:1; min-height:52px; border-radius:999px; background:linear-gradient(120deg,#3DE8C7,#2aa5cf); display:flex; align-items:center; justify-content:center; gap:7px; box-shadow:0 8px 22px rgba(61,232,199,0.3);">' +
              SHARE_SVG +
              '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#0B1622;">share ✨</span>' +
            '</button>' +
            '<button id="stDone" style="appearance:none; cursor:pointer; flex:1; min-height:52px; border-radius:999px; background:#13212E; border:1px solid rgba(244,247,250,0.1); font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#F4F7FA;">done</button>' +
          '</div>'
        ) +
      '</div>';
    ensureKeyframes();
    tickToZero();
    var sol = document.getElementById("stSolscan");
    if (sol) sol.onclick = function () {
      var t = S.transfer || {};
      var cluster = (S.trip && S.trip.cluster) || "devnet";
      var q = cluster === "mainnet-beta" ? "" : "?cluster=" + encodeURIComponent(cluster);
      if (t.reference) window.open("https://solscan.io/account/" + encodeURIComponent(t.reference) + q, "_blank");
    };
    var sh = document.getElementById("stShareBtn");
    if (sh) sh.onclick = function () {
      var text = "squared up with " + (S.toName || "a friend") + " ✨ — settled in usdc, <1 second, <1 cent.";
      if (navigator.share) navigator.share({ text: text }).catch(function () {});
      else { try { navigator.clipboard.writeText(text); } catch (_) {} app.toast("copied ✨"); }
    };
    var dn = document.getElementById("stDone");
    if (dn) dn.onclick = function () { history.length > 1 ? history.back() : app.go("groups"); };
  }

  // amount ticks to $0.00 (kinetic) — start from the owed amount, count down.
  function tickToZero() {
    var el = document.getElementById("stTick");
    if (!el || !S.transfer) return;
    var start = Math.abs(S.transfer.amountCents || 0);
    if (!start) return;
    var t0 = null, dur = 900;
    function frame(ts) {
      if (location.hash.indexOf("settle") < 0 || S.state !== "settled") return;
      if (t0 == null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var cents = Math.round(start * (1 - p));
      var n = cents / 100;
      var whole = Math.floor(n).toLocaleString();
      var dec = (n % 1).toFixed(2).slice(1);
      el.innerHTML = '<span style="font-size:28px; opacity:.6;">$</span>' + whole + '<span style="font-size:28px; opacity:.6;">' + dec + '</span>';
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  var _kf = false;
  function ensureKeyframes() {
    if (_kf) return; _kf = true;
    var s = document.createElement("style");
    s.textContent =
      "@keyframes stFloat{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-7px) rotate(3deg)}}" +
      "@keyframes stSquish{0%,100%{border-radius:47% 53% 52% 48% / 55% 48% 52% 45%}50%{border-radius:53% 47% 48% 52% / 46% 54% 47% 53%}}" +
      "@keyframes stBlink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}" +
      "@keyframes stWaveL{0%,100%{transform:rotate(15deg)}50%{transform:rotate(0)}}" +
      "@keyframes stWaveR{0%,100%{transform:rotate(-15deg)}50%{transform:rotate(0)}}" +
      "@keyframes stWatch{0%,100%{transform:translate(-2px,1px)}33%{transform:translate(2px,-1px)}66%{transform:translate(2px,2px)}}" +
      "@keyframes stShrug{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-3px) rotate(4deg)}}" +
      "@keyframes stBounce{0%,100%{transform:translateY(0) scale(1)}35%{transform:translateY(-9px) scale(1.04)}60%{transform:translateY(0) scale(.99)}}" +
      "@keyframes stSpark{0%,100%{transform:scale(.7);opacity:.3}50%{transform:scale(1.1);opacity:1}}" +
      "@keyframes stPulse{0%,100%{transform:scale(1);opacity:1;box-shadow:0 0 0 0 rgba(61,232,199,0.5)}50%{transform:scale(1.25);opacity:.85;box-shadow:0 0 0 5px rgba(61,232,199,0)}}" +
      "@keyframes stPulseC{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(255,107,94,0.5)}50%{transform:scale(1.25);box-shadow:0 0 0 5px rgba(255,107,94,0)}}" +
      "@keyframes stGrad{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}" +
      "@keyframes stStamp{0%{transform:rotate(-11deg) scale(1.7);opacity:0}55%{opacity:1}100%{transform:rotate(-11deg) scale(1);opacity:1}}" +
      "@media (prefers-reduced-motion: reduce){.appscroll *{animation:none!important}}";
    document.head.appendChild(s);
  }

  // ---- state transitions ------------------------------------------------------
  function go(state) {
    if (location.hash.indexOf("settle") < 0) return; // navigated away
    stopAutoPoll();
    ensureKeyframes();
    S.state = state;
    switch (state) {
      case "ready": renderReady(); break;
      case "waiting": renderWaiting(); break;
      case "retry": renderRetry(); break;
      case "needs-funds": renderNeedsFunds(); break;
      case "settled": renderSettled(); break;
      default: renderReady();
    }
  }

  // ---- polling (debounced) ----------------------------------------------------
  function startAutoPoll() {
    stopAutoPoll();
    S.pollTimer = setTimeout(function () { poll(); }, 4000);
  }
  function stopAutoPoll() {
    if (S && S.pollTimer) { clearTimeout(S.pollTimer); S.pollTimer = null; }
  }
  // poll the chain; manual=true comes from a button (shows feedback, resets tries window)
  function poll(manual) {
    if (!S || S.polling) return;          // debounce overlapping calls
    if (location.hash.indexOf("settle") < 0) return;
    S.polling = true;
    var btn = document.getElementById("stCheck") || document.getElementById("stAgain");
    if (btn) btn.textContent = "checking…";
    app.api.post("/api/trips/" + encodeURIComponent(S.tripId) + "/settle/verify")
      .then(function (trip) {
        S.polling = false;
        S.trip = trip;
        var mine = findMyTransfer(trip);
        if (mine) S.transfer = mine;
        if (mine && mine.paid) { go("settled"); return; }
        S.tries = (S.tries || 0) + 1;
        if (S.state === "waiting") {
          if (manual || S.tries >= 3) { go("retry"); }   // after a few silent tries, surface retry
          else { if (btn) btn.textContent = "i've paid — check now"; startAutoPoll(); }
        }
      })
      .catch(function () {
        S.polling = false;
        if (S.state === "waiting") go("retry");
      });
  }

  // ---- find the transfer where the signed-in user is the payer ----------------
  function findMyTransfer(trip) {
    var settle = trip && trip.settle;
    if (!settle || !settle.transfers || !settle.transfers.length) return null;
    var u = (window.Auth && window.Auth.user) || {};
    var wallets = (u.wallets || []).slice();
    if (u.primaryWallet) wallets.push(u.primaryWallet);
    var members = trip.members || [];
    // member id(s) that are "me": claimed by my userId, or holding one of my wallets.
    var myIds = members.filter(function (m) {
      return (u.id && m.userId === u.id) || (m.wallet && wallets.indexOf(m.wallet) >= 0);
    }).map(function (m) { return m.id; });

    var byPayer = settle.transfers.filter(function (t) { return myIds.indexOf(t.from) >= 0; });
    var pick = byPayer[0];
    if (!pick) {
      // Identified but not a payer here → you owe nothing in this settlement; do
      // NOT surface another member's transfer (it would prompt paying their debt).
      if (myIds.length) return null;
      // Unidentified (signed out / unclaimed): show the first payable so the
      // screen is still useful.
      pick = settle.transfers.filter(function (t) { return !t.needsWallet; })[0] || settle.transfers[0];
    }
    if (!pick) return null;
    // copy before decorating so we never mutate the shared trip.settle transfer
    pick = Object.assign({}, pick);
    var rec = members.filter(function (m) { return m.id === pick.to; })[0];
    pick.toWallet = rec && rec.wallet;
    return pick;
  }

  // ---- error / empty chrome ---------------------------------------------------
  function loading() {
    S.view.innerHTML = header(true) +
      '<div class="appscroll" style="padding-top:0;">' +
        stage("",
          mascot(72, "watching") +
          '<div class="skeleton" style="height:200px; width:100%; max-width:340px; margin-top:18px;"></div>'
        ) +
      '</div>';
    wireCancel();
  }
  function friendly(title, hint, btnLabel, btnGo) {
    S.view.innerHTML = header(true) +
      '<div class="appscroll" style="padding-top:0;">' +
        stage("",
          mascot(96, "shrug", "stShrug 3.4s ease-in-out infinite") +
          '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:20px; margin-top:14px; color:#F4F7FA;">' + esc(title) + '</div>' +
          '<div style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(244,247,250,0.55); margin-top:6px; max-width:280px;">' + esc(hint) + '</div>' +
          (btnLabel ? '<button id="stBack" style="appearance:none; border:none; cursor:pointer; width:100%; max-width:260px; min-height:54px; margin-top:18px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff; box-shadow:0 10px 26px rgba(39,117,202,0.42);">' + esc(btnLabel) + '</button>' : '')
        ) +
      '</div>';
    wireCancel();
    var b = document.getElementById("stBack");
    if (b) b.onclick = function () { btnGo ? btnGo() : app.go("groups"); };
  }

  // ---- entry ------------------------------------------------------------------
  async function start() {
    // Wait for auth to resolve before deciding signed-out — on a deep-link/refresh
    // Auth.user is briefly null until /api/me returns, and this screen wouldn't
    // otherwise re-render when it does.
    if (window.Auth && window.Auth.ready) { try { await window.Auth.ready; } catch (_) {} }
    if (!(window.Auth && window.Auth.user)) {
      friendly("sign in to settle", "connect a wallet to pay your share 👀", "connect a wallet", function () {
        if (window.Auth) window.Auth.createWallet().catch(function (e) { app.toast(e.message); });
      });
      return;
    }
    loading();
    var trip;
    try {
      trip = await app.api.post("/api/trips/" + encodeURIComponent(S.tripId) + "/settle");
    } catch (e) {
      friendly("couldn't load this settle", e.message || "try again in a sec", "back to groups");
      return;
    }
    S.trip = trip;
    var mine = findMyTransfer(trip);
    if (!mine) {
      // Either everything's already square, or no payable transfer for this user.
      var settle = trip.settle;
      if (settle && settle.allPaid) { go("settled"); return; }
      friendly("nothing to settle", "you're all square here ✨", "back to groups");
      return;
    }
    S.transfer = mine;
    if (mine.paid) { go("settled"); return; }
    if (mine.needsWallet || !mine.url) {
      friendly("can't build a payment yet", "the person you owe hasn't added a wallet — nudge them to claim their spot.", "back to groups");
      return;
    }
    // Returning from an in-app (embedded wallet) send: the wallet was just
    // debited, so skip the balance gate (it would wrongly show "balance too
    // low") and poll the chain until the transfer finalizes → "squared".
    try {
      if (sessionStorage.getItem("divvy.settle.sent") === S.tripId) {
        sessionStorage.removeItem("divvy.settle.sent");
        go("waiting"); poll(); return;
      }
    } catch (_) { /* sessionStorage unavailable — fall through to normal flow */ }
    // Check the live on-chain USDC balance — if you can't cover it, show needs-funds.
    try {
      var w = await app.api.get("/api/me/wallet");
      if (w && typeof w.usdcCents === "number") {
        S.balanceCents = w.usdcCents;
        if (S.balanceCents < Math.abs(mine.amountCents || 0)) { go("needs-funds"); return; }
      }
    } catch (_) { /* balance unknown — proceed to ready, don't block paying */ }
    go("ready");
  }

  window.Screens = window.Screens || {};
  window.Screens.settle = {
    title: "settle",
    render: function (view, params) {
      var tripId = (params && params[0]) || "";
      if (S) stopAutoPoll();
      S = {
        view: view, tripId: tripId, state: "loading",
        transfer: null, trip: null, balanceCents: null,
        pollTimer: null, polling: false, tries: 0,
      };
      // keep toName fresh from whatever transfer is current
      Object.defineProperty(S, "toName", {
        get: function () { return (S.transfer && S.transfer.toName) || "them"; },
        configurable: true,
      });
      ensureKeyframes();
      if (!tripId) { friendly("no trip", "missing a trip to settle", "back to groups"); return; }
      start();
    },
  };
})();
