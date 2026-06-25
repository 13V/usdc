/* screens/recurring.js — Recurring / "on autopilot" (#/recurring).
   Built by lifting the EXACT inline-styled markup from
   design/handoff/Recurring Frames.dc.html + Recurring Detail Frames.dc.html and
   wiring live data into it, so it pixel-matches the approved design.
   Follows the lift+wire pattern in screens/home.js.

   API (kept from the prior version, adapted to the real shape):
   GET /api/recurring -> { rules: [{ id, tripId, tripName, title, amountCents,
     amountFmt, paidBy, participants:[memberId], interval, nextDue, createdAt, paused? }] }
   POST /api/recurring { tripId, title, amountCents, paidBy, participants[], interval, startDate }
   DELETE /api/recurring/:id  */
(function () {
  "use strict";
  var app = window.app;

  // fonts, lifted verbatim from the frames so nothing falls back to Inter
  var DISPLAY = "'Clash Display','General Sans',sans-serif";
  var MONO = "'Space Mono',monospace";
  var SANS = "'General Sans',sans-serif";

  // ---- date / interval helpers ---------------------------------------------
  var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
  }
  function fmtDateLong(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear();
  }
  function daysUntil(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return Math.ceil((d.getTime() - Date.now()) / 86400000);
  }
  function cadence(interval) {
    if (interval === "weekly") return "weekly";
    if (interval === "monthly") return "monthly";
    if (interval === "yearly") return "yearly";
    var m = /^(\d+)d$/.exec(String(interval || ""));
    if (m) {
      var n = Number(m[1]);
      if (n === 7) return "weekly";
      if (n === 14) return "biweekly";
      if (n === 1) return "daily";
      if (n === 365) return "yearly";
      return "every " + n + "d";
    }
    return String(interval || "monthly");
  }
  function cadShort(interval) {
    if (interval === "monthly") return "/mo";
    if (interval === "weekly") return "/wk";
    if (interval === "yearly") return "/yr";
    return "";
  }
  function intervalDays(interval) {
    if (interval === "weekly") return 7;
    if (interval === "monthly") return 30;
    if (interval === "yearly") return 365;
    var m = /^(\d+)d$/.exec(String(interval || ""));
    return m ? Number(m[1]) : 30;
  }
  function isPaused(rule) { return !!(rule.paused || rule.active === false || rule.status === "paused"); }

  // deterministic emoji from a title, so cards feel alive without server data
  var EMOJI = ["🏠", "🎧", "📶", "🧹", "🏋️", "💡", "🚿", "📺", "☕", "🍿", "🔑", "🪴"];
  function emojiFor(rule) {
    var t = (rule.title || "").toLowerCase();
    if (/rent|apartment|apt|home|house|room/.test(t)) return "🏠";
    if (/spotify|music|audio|headphone|podcast/.test(t)) return "🎧";
    if (/internet|wifi|wi-fi|net|fiber|comcast/.test(t)) return "📶";
    if (/clean|maid|chore/.test(t)) return "🧹";
    if (/gym|fit|yoga|class/.test(t)) return "🏋️";
    if (/power|electric|util|energy/.test(t)) return "💡";
    if (/water/.test(t)) return "🚿";
    if (/netflix|tv|hulu|stream|disney/.test(t)) return "📺";
    if (/coffee|cafe/.test(t)) return "☕";
    var h = 0, s = String(rule.id || rule.title || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return EMOJI[h % EMOJI.length];
  }
  // soft tile tint per emoji, matching the bento cards in the frame
  function tileTint(emoji) {
    if (emoji === "🎧") return "rgba(61,232,199,0.16)";
    if (emoji === "🧹") return "rgba(255,107,94,0.15)";
    if (emoji === "🏋️") return "rgba(255,198,92,0.12)";
    return "rgba(39,117,202,0.18)";
  }
  function perShare(rule) {
    var n = (rule.participants && rule.participants.length) || 1;
    return Math.round(rule.amountCents / n);
  }
  // plain mono $ string, $ and decimals lighter (frame style)
  function moneyParts(cents) {
    var n = Math.abs(cents) / 100;
    var whole = Math.floor(n).toLocaleString();
    var dec = (n % 1).toFixed(2).slice(1);
    return { whole: whole, dec: dec };
  }
  function plain$(cents) {
    var p = moneyParts(cents);
    return "$" + p.whole + p.dec;
  }

  // ---- shared chrome --------------------------------------------------------
  // faint money texture + glow, lifted from the frame canvas
  function canvasTexture() {
    return '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 84% 2%, rgba(244,247,250,0.025) 0 1px, transparent 1px 8px); opacity:.6; pointer-events:none; z-index:0;"></div>' +
      '<div style="position:absolute; left:-40px; top:120px; width:340px; height:300px; border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,0.15) 0%, rgba(39,117,202,0) 70%); pointer-events:none; z-index:0;"></div>';
  }

  // top bar — back chevron + "on autopilot" + mono subhead (frame-exact)
  function topbar(subhead) {
    return '<div style="position:relative; z-index:6; display:flex; align-items:center; gap:12px; height:54px; padding:0 16px; flex:none;">' +
      '<div id="rBack" style="width:38px; height:38px; border-radius:50%; background:#13212E; border:1px solid rgba(244,247,250,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer; flex:none;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F4F7FA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></div>' +
      '<div style="flex:1;">' +
        '<h1 style="font-family:' + DISPLAY + '; font-weight:600; font-size:23px; letter-spacing:-0.5px; margin:0; color:#F4F7FA;">on autopilot</h1>' +
        '<div style="font-family:' + MONO + '; font-size:10px; letter-spacing:.3px; color:rgba(244,247,250,0.45); margin-top:1px;">' + app.esc(subhead || "") + '</div>' +
      '</div>' +
    '</div>';
  }
  function wireBack() {
    var b = document.getElementById("rBack");
    if (b) b.onclick = function () { if (history.length > 1) history.back(); else app.go("home"); };
  }

  // ---- signed-out -----------------------------------------------------------
  function signedOut(view) {
    view.innerHTML = canvasTexture() + topbar("set bills you split every month") +
      '<div class="appscroll" style="position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; text-align:center; padding-top:40px;">' +
        '<div style="margin:6px 0 4px;">' + app.mascot({ size: 124, mood: "sleepy", glow: true }) + '</div>' +
        '<h1 style="font-family:' + DISPLAY + '; font-weight:600; font-size:22px; max-width:280px; margin-top:16px;" class="lower">put your bills on autopilot</h1>' +
        '<p style="font-family:' + SANS + '; font-size:14px; color:rgba(244,247,250,0.6); max-width:250px; margin:11px 0 0;">connect to set the bills you split every month and forget them 🫡</p>' +
        '<button class="btn" id="rConnect" style="max-width:300px; margin-top:24px;">connect a wallet</button>' +
      '</div>';
    wireBack();
    var c = document.getElementById("rConnect");
    if (c) c.onclick = function () {
      if (window.Auth) Auth.createWallet().catch(function (e) { app.toast(e.message); });
    };
  }

  // ---- loading --------------------------------------------------------------
  function skeleton(view) {
    view.innerHTML = canvasTexture() + topbar("loading…") +
      '<div class="appscroll" style="position:relative; z-index:2; padding-top:8px;">' +
        '<div class="skeleton" style="height:226px; margin:0 0 22px; border-radius:24px;"></div>' +
        '<div class="skeleton" style="height:14px; width:120px; margin:6px 2px 14px; border-radius:6px;"></div>' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:11px;">' +
          '<div class="skeleton" style="height:128px; border-radius:20px;"></div>' +
          '<div class="skeleton" style="height:128px; border-radius:20px;"></div>' +
          '<div class="skeleton" style="height:128px; border-radius:20px;"></div>' +
          '<div class="skeleton" style="height:128px; border-radius:20px;"></div>' +
        '</div></div>';
    wireBack();
  }

  // ---- empty (full-body mascot, lifted copy) --------------------------------
  function emptyState(view) {
    view.innerHTML = canvasTexture() + topbar("nothing on autopilot yet") +
      '<div style="position:relative; z-index:2; min-height:60vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px; padding:40px 44px 120px; text-align:center;">' +
        app.mascot({ size: 120, mood: "sleepy", glow: true }) +
        '<div style="font-family:' + SANS + '; font-size:16px; line-height:1.5; color:rgba(244,247,250,0.65);">set the bills you split every month<br>and forget them 🫡</div>' +
        '<button id="rNew" style="appearance:none; border:none; cursor:pointer; display:inline-flex; align-items:center; gap:8px; min-height:50px; padding:0 24px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); box-shadow:0 10px 26px rgba(39,117,202,0.45);">' +
          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
          '<span style="font-family:' + DISPLAY + '; font-weight:600; font-size:16px; color:#fff;">new recurring</span>' +
        '</button>' +
      '</div>';
    wireBack();
    var b = document.getElementById("rNew");
    if (b) b.onclick = function () { openNewSheet(); };
  }

  // ---- featured next-due card (lifted from the frame) -----------------------
  function featuredCard(rule) {
    var emoji = emojiFor(rule);
    var dleft = daysUntil(rule.nextDue);
    var total = intervalDays(rule.interval);
    var frac = dleft == null ? 0 : Math.max(0, Math.min(1, (total - dleft) / total));
    var C = 163.4; // 2πr for r=26 (frame value)
    var off = (C * (1 - frac)).toFixed(1);
    var n = (rule.participants && rule.participants.length) || 1;
    var share = perShare(rule);
    var ringTxt = dleft == null ? "—" : (dleft <= 0 ? "now" : dleft + "d");
    var paused = isPaused(rule);
    var mp = moneyParts(rule.amountCents);

    // owe-bar preview: a block per participant, last = your share (coral)
    var bars = "";
    var blocks = Math.min(n, 5);
    for (var i = 0; i < blocks; i++) {
      var isYou = i === blocks - 1;
      var op = isYou ? ".85" : (1 - i * 0.12 * (1 / Math.max(1, blocks - 1))).toFixed(2);
      bars += '<div style="flex:1; background:' + (isYou ? "#FF6B5E" : "#2775CA") + '; opacity:' + op + ';"></div>';
    }

    var statusPill = paused
      ? '<span style="display:inline-flex; align-items:center; gap:5px; background:rgba(255,198,92,0.1); border:1px solid rgba(255,198,92,0.3); border-radius:999px; padding:5px 12px;"><svg width="8" height="8" viewBox="0 0 24 24" fill="#FFC65C"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg><span style="font-family:' + MONO + '; font-weight:700; font-size:11px; color:#FFC65C;">paused</span></span>'
      : '<span style="display:inline-flex; align-items:center; gap:6px; background:rgba(61,232,199,0.12); border:1px solid rgba(61,232,199,0.4); border-radius:999px; padding:5px 12px;"><span style="width:6px; height:6px; border-radius:50%; background:#3DE8C7; box-shadow:0 0 7px rgba(61,232,199,0.9); animation:recPulse 2.4s ease-in-out infinite;"></span><span style="font-family:' + MONO + '; font-weight:700; font-size:11px; color:#3DE8C7;">active</span></span>';

    return '<div data-rid="' + app.esc(rule.id) + '" style="position:relative; background:#13212E; border-radius:24px; border:1px solid rgba(39,117,202,0.32); overflow:hidden; box-shadow:0 16px 40px rgba(0,0,0,0.36); cursor:pointer;">' +
      '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 90% 4%, rgba(255,255,255,0.04) 0 1px, transparent 1px 8px); opacity:.7; pointer-events:none;"></div>' +
      '<div style="position:absolute; right:-30px; top:-30px; width:180px; height:180px; border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,0.22) 0%, rgba(39,117,202,0) 70%); pointer-events:none;"></div>' +
      '<div style="position:absolute; left:0; top:0; bottom:0; width:4px; background:linear-gradient(180deg,#2775CA,#3f97ee);"></div>' +

      '<div style="position:relative; padding:17px 18px 18px;">' +
        // top row
        '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">' +
          '<div style="display:flex; align-items:center; gap:12px; min-width:0;">' +
            '<div style="width:46px; height:46px; border-radius:14px; background:linear-gradient(135deg,#3a93ec,#2775CA 60%,#1d5697); display:flex; align-items:center; justify-content:center; font-size:23px; flex:none;">' + app.esc(emoji) + '</div>' +
            '<div style="min-width:0;">' +
              '<div style="display:inline-flex; align-items:center; gap:6px; background:rgba(39,117,202,0.16); border:1px solid rgba(39,117,202,0.45); border-radius:999px; padding:2px 9px; margin-bottom:5px;"><span style="font-family:' + MONO + '; font-weight:700; font-size:8.5px; letter-spacing:1px; color:#7fc0ff;">NEXT DUE</span></div>' +
              '<div style="font-family:' + DISPLAY + '; font-weight:600; font-size:17px; letter-spacing:-0.2px; color:#F4F7FA;" class="lower">' + app.esc(rule.title) + '</div>' +
              '<div style="font-family:' + MONO + '; font-size:10px; letter-spacing:.3px; color:rgba(244,247,250,0.45); margin-top:2px;" class="lower">' + app.esc(rule.tripName || "auto-tab") + '</div>' +
            '</div>' +
          '</div>' +
          // progress ring
          '<div style="position:relative; width:62px; height:62px; flex:none;">' +
            '<svg width="62" height="62" viewBox="0 0 62 62">' +
              '<circle cx="31" cy="31" r="26" fill="none" stroke="rgba(244,247,250,0.1)" stroke-width="5"/>' +
              '<circle cx="31" cy="31" r="26" fill="none" stroke="#2775CA" stroke-width="5" stroke-linecap="round" stroke-dasharray="163.4" stroke-dashoffset="' + off + '" transform="rotate(-90 31 31)" style="filter:drop-shadow(0 0 4px rgba(39,117,202,0.6));"/>' +
            '</svg>' +
            '<div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center;">' +
              '<span style="font-family:' + MONO + '; font-weight:700; font-size:16px; letter-spacing:-0.5px; color:#F4F7FA; line-height:1;">' + ringTxt + '</span>' +
              '<span style="font-family:' + MONO + '; font-size:7px; letter-spacing:.5px; color:rgba(244,247,250,0.4); margin-top:2px;">to run</span>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // big amount
        '<div style="display:flex; align-items:baseline; gap:9px; margin-top:16px;">' +
          '<div style="font-family:' + MONO + '; font-weight:700; font-size:42px; line-height:.9; letter-spacing:-1.8px; color:#F4F7FA;"><span style="font-size:22px; opacity:.5;">$</span>' + mp.whole + '<span style="font-size:22px; opacity:.5;">' + mp.dec + '</span></div>' +
          (cadShort(rule.interval) ? '<span style="font-family:' + MONO + '; font-size:12px; letter-spacing:.5px; color:rgba(244,247,250,0.4);">' + cadShort(rule.interval) + '</span>' : "") +
        '</div>' +

        // pills
        '<div style="display:flex; align-items:center; gap:9px; margin-top:14px;">' +
          '<span style="display:inline-flex; align-items:center; gap:6px; background:rgba(244,247,250,0.06); border:1px solid rgba(244,247,250,0.12); border-radius:999px; padding:5px 12px;"><span style="font-family:' + MONO + '; font-weight:700; font-size:11px; color:rgba(244,247,250,0.8);">' + app.esc(cadence(rule.interval)) + '</span></span>' +
          statusPill +
        '</div>' +

        // sub + owe bar
        '<div style="margin-top:16px; padding-top:15px; border-top:1px dashed rgba(244,247,250,0.12);">' +
          '<div style="display:flex; align-items:center; justify-content:space-between;">' +
            '<span style="font-family:' + MONO + '; font-size:11px; letter-spacing:.3px; color:rgba(244,247,250,0.55);">next: ' + fmtDate(rule.nextDue) + ' · split ' + n + '</span>' +
            '<span style="font-family:' + MONO + '; font-size:11px; color:#FF6B5E;">your share ' + plain$(share) + '</span>' +
          '</div>' +
          '<div style="display:flex; gap:3px; height:7px; border-radius:4px; overflow:hidden; margin-top:11px;">' + bars + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ---- bento card (the rest) — lifted, with paused variant ------------------
  function bentoCard(rule) {
    var emoji = emojiFor(rule);
    var paused = isPaused(rule);
    var mp = moneyParts(rule.amountCents);
    var cad = cadence(rule.interval);

    if (paused) {
      return '<div data-rid="' + app.esc(rule.id) + '" style="position:relative; background:#0f1a24; border-radius:20px; border:1px solid rgba(244,247,250,0.05); padding:14px; overflow:hidden; opacity:.72; cursor:pointer;">' +
        '<div style="position:relative; display:flex; align-items:center; justify-content:space-between;">' +
          '<div style="width:38px; height:38px; border-radius:12px; background:rgba(255,198,92,0.12); display:flex; align-items:center; justify-content:center; font-size:18px; filter:grayscale(.3);">' + app.esc(emoji) + '</div>' +
          '<span style="display:inline-flex; align-items:center; gap:5px; background:rgba(255,198,92,0.1); border:1px solid rgba(255,198,92,0.3); border-radius:999px; padding:2px 8px;"><svg width="8" height="8" viewBox="0 0 24 24" fill="#FFC65C"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg><span style="font-family:' + MONO + '; font-weight:700; font-size:8px; letter-spacing:.5px; color:#FFC65C;">PAUSED</span></span>' +
        '</div>' +
        '<div style="position:relative; font-family:' + DISPLAY + '; font-weight:500; font-size:14.5px; color:rgba(244,247,250,0.75); margin-top:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" class="lower">' + app.esc(rule.title) + '</div>' +
        '<div style="position:relative; font-family:' + MONO + '; font-weight:700; font-size:22px; letter-spacing:-0.6px; color:rgba(244,247,250,0.6); margin-top:6px;"><span style="font-size:13px; opacity:.5;">$</span>' + mp.whole + '<span style="font-size:13px; opacity:.5;">' + mp.dec + '</span></div>' +
        '<div style="position:relative; font-family:' + MONO + '; font-size:9px; letter-spacing:.5px; color:rgba(244,247,250,0.35); margin-top:11px;">' + app.esc(cad) + ' · paused</div>' +
      '</div>';
    }

    return '<div data-rid="' + app.esc(rule.id) + '" style="position:relative; background:#13212E; border-radius:20px; border:1px solid rgba(244,247,250,0.07); padding:14px; overflow:hidden; cursor:pointer;">' +
      '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 88% 6%, rgba(255,255,255,0.03) 0 1px, transparent 1px 8px); opacity:.6; pointer-events:none;"></div>' +
      '<div style="position:relative; display:flex; align-items:center; justify-content:space-between;">' +
        '<div style="width:38px; height:38px; border-radius:12px; background:' + tileTint(emoji) + '; display:flex; align-items:center; justify-content:center; font-size:18px;">' + app.esc(emoji) + '</div>' +
        '<span style="width:6px; height:6px; border-radius:50%; background:#3DE8C7; box-shadow:0 0 6px rgba(61,232,199,0.8);"></span>' +
      '</div>' +
      '<div style="position:relative; font-family:' + DISPLAY + '; font-weight:500; font-size:14.5px; color:#F4F7FA; margin-top:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" class="lower">' + app.esc(rule.title) + '</div>' +
      '<div style="position:relative; font-family:' + MONO + '; font-weight:700; font-size:22px; letter-spacing:-0.6px; color:#F4F7FA; margin-top:6px;"><span style="font-size:13px; opacity:.5;">$</span>' + mp.whole + '<span style="font-size:13px; opacity:.5;">' + mp.dec + '</span></div>' +
      '<div style="position:relative; font-family:' + MONO + '; font-size:9px; letter-spacing:.5px; color:rgba(244,247,250,0.42); margin-top:11px;">' + app.esc(cad) + ' · ' + fmtDate(rule.nextDue) + '</div>' +
    '</div>';
  }

  // the dashed "set up a new one ＋" card (lifted)
  function addCard() {
    return '<div id="rAddTile" style="grid-column:1 / -1; display:flex; align-items:center; justify-content:center; gap:9px; min-height:58px; border-radius:20px; border:1.5px dashed rgba(39,117,202,0.4); background:rgba(39,117,202,0.05); cursor:pointer;">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7fc0ff" stroke-width="2.3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
      '<span style="font-family:' + DISPLAY + '; font-weight:600; font-size:15px; color:#7fc0ff;">set up a new one</span>' +
    '</div>';
  }

  // ---- signed-in (list) -----------------------------------------------------
  var _trips = null; // cache of mine trips for the new-sheet picker

  async function signedIn(view) {
    skeleton(view);
    var data;
    try { data = await app.api.get("/api/recurring"); }
    catch (e) {
      view.innerHTML = canvasTexture() + topbar("couldn't load") +
        '<div class="empty" style="position:relative; z-index:2;"><div class="title lower">couldn\'t load autopilot</div><div class="hint">' + app.esc(e.message) + '</div>' +
        '<button class="btn" id="rNew" style="max-width:260px; margin-top:10px;">+ new recurring</button></div>';
      wireBack();
      var b = document.getElementById("rNew");
      if (b) b.onclick = function () { openNewSheet(); };
      return;
    }
    var rules = (data && data.rules) || [];
    if (!Array.isArray(rules)) rules = [];

    if (!rules.length) { emptyState(view); return; }

    // featured = soonest next-due among active rules (fall back to any)
    var active = rules.filter(function (r) { return !isPaused(r); });
    var pool = active.length ? active : rules;
    var sorted = pool.slice().sort(function (a, b) {
      return new Date(a.nextDue).getTime() - new Date(b.nextDue).getTime();
    });
    var featured = sorted[0];
    var rest = rules.filter(function (r) { return r.id !== featured.id; })
      .sort(function (a, b) { return new Date(a.nextDue).getTime() - new Date(b.nextDue).getTime(); });

    var total = rules.reduce(function (s, r) { return s + (isPaused(r) ? 0 : (r.amountCents || 0)); }, 0);
    var sub = rules.length + (rules.length === 1 ? " bill · ~" : " bills · ~") + plain$(total).replace(/\.00$/, "") + "/mo split";

    var bentoHtml = "";
    if (rest.length) {
      bentoHtml = '<div style="font-family:' + MONO + '; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.4); padding:24px 2px 12px;">EVERYTHING ELSE</div>' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:11px;">' +
          rest.map(bentoCard).join("") + addCard() +
        '</div>';
    } else {
      bentoHtml = '<div style="margin-top:18px; display:grid; grid-template-columns:1fr 1fr; gap:11px;">' + addCard() + '</div>';
    }

    view.innerHTML = canvasTexture() + topbar(sub) +
      '<div class="rec-scroll" style="position:relative; z-index:2; padding:8px 16px 120px;">' +
        featuredCard(featured) + bentoHtml +
      '</div>';

    wireBack();
    // wire taps -> detail
    var byId = {};
    rules.forEach(function (r) { byId[r.id] = r; });
    Array.prototype.forEach.call(view.querySelectorAll("[data-rid]"), function (el) {
      el.onclick = function () { var r = byId[el.getAttribute("data-rid")]; if (r) openDetailSheet(r); };
    });
    var add = document.getElementById("rAddTile");
    if (add) add.onclick = function () { openNewSheet(); };
  }

  // ---- "+ new" sheet (the "well") — lifted hero amount + segmented + rows ----
  // `prefill` (optional) = an existing rule to EDIT: we seed every field from it
  // and, on save, replace the old rule (the recurring API has no field-level
  // PATCH, so an edit = delete-old + create-new with the edited values).
  async function openNewSheet(prefill) {
    var editing = !!(prefill && prefill.id);
    var el = app.sheet(
      '<div style="font-family:' + MONO + '; font-size:11px; letter-spacing:1px; color:rgba(244,247,250,0.5); margin:2px 2px 16px;">' + (editing ? "edit recurring · tweak the well" : "new recurring · fill the well") + '</div>' +

      // amount hero input
      '<div style="background:#13212E; border:1px solid rgba(39,117,202,0.3); border-radius:22px; padding:20px; text-align:center; box-shadow:0 12px 30px rgba(0,0,0,0.3);">' +
        '<div style="font-family:' + MONO + '; font-size:9px; letter-spacing:2px; color:rgba(244,247,250,0.4);">AMOUNT</div>' +
        '<div style="display:flex; align-items:center; justify-content:center; margin-top:12px;">' +
          '<span style="font-family:' + MONO + '; font-weight:700; font-size:26px; opacity:.5; color:#F4F7FA;">$</span>' +
          '<input id="rfAmount" inputmode="decimal" placeholder="0" style="appearance:none; border:none; outline:none; background:transparent; width:auto; max-width:230px; text-align:center; font-family:' + MONO + '; font-weight:700; font-size:48px; line-height:1; letter-spacing:-2px; color:#F4F7FA; caret-color:#2775CA;" />' +
        '</div>' +
      '</div>' +

      // mono input rows
      '<div style="display:flex; flex-direction:column; gap:11px; margin-top:14px;">' +

        // title row
        '<div style="display:flex; align-items:center; gap:12px; background:#13212E; border:1px solid rgba(244,247,250,0.08); border-radius:16px; padding:13px 16px;">' +
          '<span style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(244,247,250,0.45); flex:none;">title</span>' +
          '<input id="rfTitle" placeholder="rent 🏠" style="appearance:none; border:none; outline:none; background:transparent; flex:1; min-width:0; text-align:right; font-family:' + MONO + '; font-size:13px; color:#F4F7FA;" />' +
        '</div>' +

        // group picker
        '<div id="rTripWrap" style="background:#13212E; border:1px solid rgba(244,247,250,0.08); border-radius:16px; padding:13px 16px;">' +
          '<div style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(244,247,250,0.45); margin-bottom:11px;">group</div>' +
          '<div style="font-family:' + MONO + '; font-size:12px; color:rgba(244,247,250,0.6);">loading groups…</div>' +
        '</div>' +

        // interval segmented
        '<div style="background:#13212E; border:1px solid rgba(244,247,250,0.08); border-radius:16px; padding:13px 16px;">' +
          '<div style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(244,247,250,0.45); margin-bottom:11px;">interval</div>' +
          '<div id="rfInterval" style="display:flex; gap:7px;">' +
            segChip("weekly", "weekly", false) +
            segChip("monthly", "monthly", true) +
            segChip("yearly", "yearly", false) +
          '</div>' +
        '</div>' +

        // next due
        '<div style="display:flex; align-items:center; justify-content:space-between; background:#13212E; border:1px solid rgba(244,247,250,0.08); border-radius:16px; padding:13px 16px;">' +
          '<span style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(244,247,250,0.45);">next due</span>' +
          '<span style="display:inline-flex; align-items:center; gap:8px;">' +
            '<input id="rfDate" type="date" style="appearance:none; border:none; outline:none; background:transparent; font-family:' + MONO + '; font-size:13px; color:#F4F7FA; color-scheme:dark;" />' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.5)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>' +
          '</span>' +
        '</div>' +

        // members
        '<div id="rfMembers" style="background:#13212E; border:1px solid rgba(244,247,250,0.08); border-radius:16px; padding:13px 16px;">' +
          '<div style="display:flex; align-items:center; justify-content:space-between;">' +
            '<span style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(244,247,250,0.45);">members</span>' +
            '<span style="font-family:' + MONO + '; font-size:11px; color:rgba(244,247,250,0.4);">pick a group first</span>' +
          '</div>' +
        '</div>' +

      '</div>' +

      // set & forget
      '<button id="rfSave" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:56px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:0 12px 30px rgba(39,117,202,0.5), inset 0 1px 0 rgba(255,255,255,0.25); margin-top:18px;">' +
        '<span style="font-family:' + DISPLAY + '; font-weight:600; font-size:17px; color:#fff;">' + (editing ? "save changes" : "set &amp; forget") + '</span><span style="font-size:15px;">✨</span>' +
      '</button>'
    );

    // interval segmented control
    var chosenInt = (prefill && prefill.interval) || "monthly";
    var intWrap = el.querySelector("#rfInterval");
    Array.prototype.forEach.call(intWrap.querySelectorAll("[data-int]"), function (c) {
      // reflect the editing rule's interval as the pre-selected chip
      applySeg(c, c.getAttribute("data-int") === chosenInt);
      c.onclick = function () {
        chosenInt = c.getAttribute("data-int");
        Array.prototype.forEach.call(intWrap.querySelectorAll("[data-int]"), function (x) { applySeg(x, false); });
        applySeg(c, true);
      };
    });

    // prefill amount + title from the rule being edited
    if (prefill) {
      var amtEl = el.querySelector("#rfAmount");
      if (amtEl && typeof prefill.amountCents === "number") amtEl.value = (prefill.amountCents / 100).toFixed(2);
      var titEl = el.querySelector("#rfTitle");
      if (titEl && prefill.title) titEl.value = prefill.title;
    }

    // prefill next-due — the rule's nextDue when editing, else today
    var dEl = el.querySelector("#rfDate");
    if (dEl) {
      var seedDate = (prefill && prefill.nextDue) ? new Date(prefill.nextDue) : new Date();
      dEl.value = isNaN(seedDate.getTime()) ? new Date().toISOString().slice(0, 10) : seedDate.toISOString().slice(0, 10);
    }

    // load groups for the picker
    var trips = _trips;
    try {
      if (!trips) { trips = await app.api.get("/api/trips?mine=1"); _trips = trips; }
    } catch (_) { trips = []; }
    trips = Array.isArray(trips) ? trips : [];

    var tripWrap = el.querySelector("#rTripWrap");
    var chosenTrip = null;       // trip id
    var chosenMembers = null;    // full trip object
    var memWrap = el.querySelector("#rfMembers");

    if (!trips.length) {
      tripWrap.innerHTML = '<div style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(244,247,250,0.45); margin-bottom:8px;">group</div>' +
        '<div style="font-family:' + MONO + '; font-size:12px; color:rgba(244,247,250,0.6);">you need a group first — recurring bills attach to one.</div>' +
        '<button class="btn ghost" id="rfGoGroups" style="margin-top:10px;">make a group</button>';
      var g = el.querySelector("#rfGoGroups");
      if (g) g.onclick = function () { app.closeSheet(); app.go("groups"); };
      var sv0 = el.querySelector("#rfSave");
      if (sv0) sv0.disabled = true;
      return;
    }

    tripWrap.innerHTML = '<div style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(244,247,250,0.45); margin-bottom:11px;">group</div>' +
      '<div id="rfTrips" style="display:flex; gap:8px; flex-wrap:wrap;">' +
        trips.map(function (t) {
          return '<div class="chip lower" data-trip="' + app.esc(t.id) + '">' + app.esc(t.name) + '</div>';
        }).join("") +
      '</div>';

    function renderMembers(trip) {
      if (!trip || !trip.members || !trip.members.length) {
        memWrap.innerHTML = '<div style="display:flex; align-items:center; justify-content:space-between;">' +
          '<span style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(244,247,250,0.45);">members</span>' +
          '<span style="font-family:' + MONO + '; font-size:11px; color:rgba(244,247,250,0.4);">no members</span></div>';
        return;
      }
      memWrap.innerHTML = '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:11px;">' +
          '<span style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(244,247,250,0.45);">members</span>' +
          '<span style="font-family:' + MONO + '; font-size:10px; color:rgba(244,247,250,0.4);">tap the payer</span>' +
        '</div>' +
        '<div id="rfMemChips" style="display:flex; gap:8px; flex-wrap:wrap;">' +
        trip.members.map(function (m, i) {
          return '<div class="chip lower" data-mem="' + app.esc(m.id) + '"' + (i === 0 ? ' data-payer="1"' : '') + ' style="' + (i === 0 ? 'border-color:var(--blue);' : '') + '">' +
            app.avatar({ name: m.name, id: m.id }, "sm") + '<span>' + app.esc(m.name) + '</span></div>';
        }).join("") + '</div>';
    }

    function pickTrip(t, chipEl) {
      chosenTrip = t.id;
      chosenMembers = t;
      Array.prototype.forEach.call(el.querySelectorAll("[data-trip]"), function (x) { x.classList.remove("selected"); });
      chipEl.classList.add("selected");
      renderMembers(t);
    }

    Array.prototype.forEach.call(el.querySelectorAll("[data-trip]"), function (chip) {
      chip.onclick = async function () {
        var id = chip.getAttribute("data-trip");
        var t;
        try { t = await app.api.get("/api/trips/" + encodeURIComponent(id)); }
        catch (_) { t = trips.filter(function (x) { return x.id === id; })[0]; }
        pickTrip(t || { id: id, members: [] }, chip);
        markEditPrefs(t);
      };
    });

    // when editing, pre-select the rule's payer + participants on the member chips
    function markEditPrefs(t) {
      if (!editing || !t) return;
      var memChips = memWrap.querySelectorAll("#rfMemChips [data-mem]");
      var parts = prefill.participants || [];
      Array.prototype.forEach.call(memChips, function (c) {
        var mid = c.getAttribute("data-mem");
        var isPayer = mid === prefill.paidBy;
        c.removeAttribute("data-payer"); c.style.borderColor = "";
        if (isPayer) { c.setAttribute("data-payer", "1"); c.style.borderColor = "var(--blue)"; }
      });
      // participants that aren't in the trip's member chips are ignored (membership
      // changed); the create call below dedupes + validates like a fresh create.
      void parts;
    }

    // auto-open the rule's group when editing so members/payer are pre-filled
    if (editing && prefill.tripId) {
      var editChip = el.querySelector('[data-trip="' + (window.CSS && CSS.escape ? CSS.escape(prefill.tripId) : prefill.tripId) + '"]');
      if (editChip) {
        var t0;
        try { t0 = await app.api.get("/api/trips/" + encodeURIComponent(prefill.tripId)); }
        catch (_) { t0 = trips.filter(function (x) { return x.id === prefill.tripId; })[0]; }
        pickTrip(t0 || { id: prefill.tripId, members: [] }, editChip);
        markEditPrefs(t0);
      }
    }

    // tapping a member chip sets the payer
    memWrap.onclick = function (ev) {
      var chip = ev.target.closest ? ev.target.closest("[data-mem]") : null;
      if (!chip) return;
      Array.prototype.forEach.call(memWrap.querySelectorAll("[data-mem]"), function (x) {
        x.removeAttribute("data-payer"); x.style.borderColor = "";
      });
      chip.setAttribute("data-payer", "1");
      chip.style.borderColor = "var(--blue)";
    };

    // save
    var sv = el.querySelector("#rfSave");
    sv.onclick = async function () {
      if (!chosenTrip) { app.toast("pick a group first"); return; }
      var title = (el.querySelector("#rfTitle").value || "").trim();
      if (!title) { app.toast("give it a title"); return; }
      // Validate the dollar amount: reject NaN/empty/non-positive and anything
      // finer than whole cents (e.g. "12.345" would round to fractional cents).
      var raw = (el.querySelector("#rfAmount").value || "").trim();
      if (!/^\d*(\.\d{1,2})?$/.test(raw)) { app.toast("enter a plain dollar amount"); return; }
      var amt = parseFloat(raw);
      if (!isFinite(amt) || !(amt > 0)) { app.toast("enter an amount"); return; }
      var amountCents = Math.round(amt * 100);
      if (!(amountCents > 0)) { app.toast("enter an amount"); return; }
      var dateStr = (el.querySelector("#rfDate").value || "").trim();

      var memChips = el.querySelectorAll("#rfMemChips [data-mem]");
      var participants = [], paidBy = null;
      Array.prototype.forEach.call(memChips, function (c) {
        var mid = c.getAttribute("data-mem");
        participants.push(mid);
        if (c.getAttribute("data-payer")) paidBy = mid;
      });
      if (!participants.length && chosenMembers && chosenMembers.members) {
        participants = chosenMembers.members.map(function (m) { return m.id; });
        paidBy = participants[0];
      }
      if (!paidBy) paidBy = participants[0];
      if (!paidBy) { app.toast("this group has no members"); return; }

      var body = {
        tripId: chosenTrip,
        title: title,
        amountCents: amountCents,
        paidBy: paidBy,
        participants: participants,
        interval: chosenInt,
      };
      if (dateStr) body.startDate = dateStr;

      sv.disabled = true; sv.innerHTML = '<span style="font-family:' + DISPLAY + '; font-weight:600; font-size:17px; color:#fff;">' + (editing ? "saving…" : "setting…") + '</span>';
      try {
        if (editing) {
          // Atomic in-place edit (single PATCH) — no duplicate-on-failure window.
          await app.api.patch("/api/recurring/" + encodeURIComponent(prefill.id), {
            title: title, amountCents: amountCents, paidBy: paidBy,
            participants: participants, interval: chosenInt,
            startDate: dateStr || undefined,
          });
        } else {
          await app.api.post("/api/recurring", body);
        }
        app.closeSheet();
        app.toast(editing ? "updated ✨" : "set & forget ✨");
        var view = document.getElementById("view");
        if (view) signedIn(view);
      } catch (e) {
        sv.disabled = false; sv.innerHTML = '<span style="font-family:' + DISPLAY + '; font-weight:600; font-size:17px; color:#fff;">' + (editing ? "save changes" : "set &amp; forget") + '</span><span style="font-size:15px;">✨</span>';
        app.toast(e.message || "couldn't save");
      }
    };
  }

  // a segmented-interval chip, lifted from the frame (selected = blue tint)
  function segChip(value, label, selected) {
    var sel = 'background:rgba(39,117,202,0.16); border:1px solid rgba(39,117,202,0.5); font-weight:700; color:#7fc0ff;';
    var unsel = 'background:rgba(244,247,250,0.05); border:1px solid rgba(244,247,250,0.08); color:rgba(244,247,250,0.55);';
    return '<div data-int="' + value + '" style="flex:1; text-align:center; padding:9px 0; border-radius:11px; font-family:' + MONO + '; font-size:11px; cursor:pointer; ' + (selected ? sel : unsel) + '">' + label + '</div>';
  }
  function applySeg(el, selected) {
    if (selected) {
      el.style.background = "rgba(39,117,202,0.16)";
      el.style.border = "1px solid rgba(39,117,202,0.5)";
      el.style.fontWeight = "700";
      el.style.color = "#7fc0ff";
    } else {
      el.style.background = "rgba(244,247,250,0.05)";
      el.style.border = "1px solid rgba(244,247,250,0.08)";
      el.style.fontWeight = "400";
      el.style.color = "rgba(244,247,250,0.55)";
    }
  }

  // ---- detail sheet — lifted from Recurring Detail Frames ------------------
  async function openDetailSheet(rule) {
    var emoji = emojiFor(rule);
    var n = (rule.participants && rule.participants.length) || 1;
    var share = perShare(rule);
    var dleft = daysUntil(rule.nextDue);
    var total = intervalDays(rule.interval);
    var frac = dleft == null ? 0 : Math.max(0, Math.min(1, (total - dleft) / total));
    var C = 194.8; // 2πr for r=31 (frame value)
    var off = (C * (1 - frac)).toFixed(1);
    var ringTxt = dleft == null ? "—" : (dleft <= 0 ? "now" : dleft + "d");
    var paused = isPaused(rule);
    var mp = moneyParts(rule.amountCents);

    var toggle = paused
      ? '<span style="width:34px; height:20px; border-radius:999px; background:rgba(11,22,34,0.4); position:relative; box-shadow:inset 0 0 0 1px rgba(255,255,255,0.18);"><span style="position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff;"></span></span>'
      : '<span style="width:34px; height:20px; border-radius:999px; background:#3DE8C7; position:relative; box-shadow:inset 0 0 0 1px rgba(0,0,0,0.06);"><span style="position:absolute; top:2px; right:2px; width:16px; height:16px; border-radius:50%; background:#0B1622;"></span></span>';

    // ===== HEADER identity card (blue gradient) =====
    var headerCard =
      '<div style="position:relative; border-radius:24px; overflow:hidden; padding:20px; background:linear-gradient(150deg,#2f80d6 0%,#2775CA 55%,#1d5e9f 100%); box-shadow:0 16px 40px rgba(39,117,202,0.4);">' +
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 88% 8%, rgba(255,255,255,0.09) 0 1px, transparent 1px 9px); opacity:.55; pointer-events:none;"></div>' +
        '<div style="position:relative; display:flex; align-items:flex-start; justify-content:space-between; gap:14px;">' +
          '<div style="min-width:0;">' +
            '<div style="display:flex; align-items:center; gap:11px;">' +
              '<div style="width:46px; height:46px; border-radius:14px; background:rgba(11,22,34,0.28); border:1px solid rgba(255,255,255,0.25); display:flex; align-items:center; justify-content:center; font-size:23px; flex:none;">' + app.esc(emoji) + '</div>' +
              '<div style="min-width:0;">' +
                '<div style="font-family:' + DISPLAY + '; font-weight:600; font-size:18px; letter-spacing:-0.2px; color:#fff;" class="lower">' + app.esc(rule.title) + '</div>' +
                '<div style="font-family:' + MONO + '; font-size:10px; letter-spacing:.5px; color:rgba(255,255,255,0.72); margin-top:2px;" class="lower">' + app.esc(rule.tripName || "auto-tab") + ' · auto-tab</div>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex; align-items:baseline; gap:8px; margin-top:18px;">' +
              '<div style="font-family:' + MONO + '; font-weight:700; font-size:44px; line-height:.9; letter-spacing:-2px; color:#fff;"><span style="font-size:23px; opacity:.6;">$</span>' + mp.whole + '<span style="font-size:23px; opacity:.6;">' + mp.dec + '</span></div>' +
              (cadShort(rule.interval) ? '<span style="font-family:' + MONO + '; font-size:13px; color:rgba(255,255,255,0.6);">' + cadShort(rule.interval) + '</span>' : "") +
            '</div>' +
            '<div style="display:flex; align-items:center; gap:8px; margin-top:16px;">' +
              '<span style="display:inline-flex; align-items:center; background:rgba(11,22,34,0.25); border:1px solid rgba(255,255,255,0.22); border-radius:999px; padding:5px 12px;"><span style="font-family:' + MONO + '; font-weight:700; font-size:11px; color:#fff;">' + app.esc(cadence(rule.interval)) + '</span></span>' +
              '<span style="display:inline-flex; align-items:center; gap:8px; background:rgba(11,22,34,0.25); border:1px solid rgba(255,255,255,0.22); border-radius:999px; padding:4px 6px 4px 12px;">' +
                '<span style="font-family:' + MONO + '; font-weight:700; font-size:11px; color:#fff;">' + (paused ? "paused" : "active") + '</span>' + toggle +
              '</span>' +
            '</div>' +
          '</div>' +
          // countdown ring + caption BELOW
          '<div style="display:flex; flex-direction:column; align-items:center; gap:7px; flex:none;">' +
            '<div style="position:relative; width:74px; height:74px;">' +
              '<svg width="74" height="74" viewBox="0 0 74 74">' +
                '<circle cx="37" cy="37" r="31" fill="none" stroke="rgba(11,22,34,0.28)" stroke-width="6"/>' +
                '<circle cx="37" cy="37" r="31" fill="none" stroke="#3DE8C7" stroke-width="6" stroke-linecap="round" stroke-dasharray="194.8" stroke-dashoffset="' + off + '" transform="rotate(-90 37 37)" style="filter:drop-shadow(0 0 5px rgba(61,232,199,0.7));"/>' +
              '</svg>' +
              '<div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center;">' +
                '<span style="font-family:' + MONO + '; font-weight:700; font-size:21px; letter-spacing:-0.5px; color:#fff; line-height:1;">' + ringTxt + '</span>' +
                '<span style="font-family:' + MONO + '; font-size:8px; letter-spacing:.5px; color:rgba(255,255,255,0.65); margin-top:2px;">left</span>' +
              '</div>' +
            '</div>' +
            '<span style="font-family:' + MONO + '; font-size:9.5px; letter-spacing:.3px; color:rgba(255,255,255,0.78); white-space:nowrap;">next: ' + fmtDate(rule.nextDue) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    var el = app.sheet(
      '<div style="max-height:80vh; overflow-y:auto; margin:-2px -6px 0; padding:0 6px;">' +
        headerCard +

        // ===== WHO SPLITS IT =====
        '<div style="display:flex; align-items:center; justify-content:space-between; margin:24px 2px 12px;">' +
          '<span style="font-family:' + MONO + '; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.45);">WHO SPLITS IT</span>' +
          '<span style="font-family:' + MONO + '; font-size:10px; letter-spacing:.5px; color:rgba(244,247,250,0.4);">SPLIT ' + n + ' · ' + plain$(share) + ' EACH</span>' +
        '</div>' +
        '<div id="rdMembers" style="background:#13212E; border:1px solid rgba(244,247,250,0.07); border-radius:18px; overflow:hidden;"><div style="font-family:' + MONO + '; font-size:12px; color:rgba(244,247,250,0.6); padding:14px 15px;">loading members…</div></div>' +

        // ===== THIS RUN (preview — no live run state is persisted yet) =====
        '<div style="margin:24px 2px 12px; display:flex; align-items:center; gap:7px;"><span style="font-family:' + MONO + '; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.45);">THIS RUN · ' + fmtDate(rule.nextDue).toUpperCase() + '</span><span style="font-family:' + MONO + '; font-weight:700; font-size:8px; letter-spacing:.5px; color:rgba(244,247,250,0.4); background:rgba(244,247,250,0.06); border:1px solid rgba(244,247,250,0.12); border-radius:999px; padding:2px 7px;">PREVIEW</span></div>' +
        '<div style="background:#13212E; border:1px solid rgba(244,247,250,0.07); border-radius:18px; padding:16px;">' +
          '<div style="display:flex; align-items:center; justify-content:space-between;">' +
            '<span style="font-family:' + DISPLAY + '; font-weight:500; font-size:16px; color:#F4F7FA;" class="lower">0 of ' + n + ' squared</span>' +
            '<span style="font-family:' + MONO + '; font-size:11px; color:#3DE8C7;">$0 in</span>' +
          '</div>' +
          '<div style="display:flex; gap:5px; height:8px; margin-top:13px;">' + thisRunBars(n) + '</div>' +
          '<div id="rdTicks" style="display:flex; align-items:center; gap:14px; margin-top:15px; flex-wrap:wrap;"></div>' +
          '<div style="display:flex; align-items:center; justify-content:center; gap:7px; margin-top:16px; padding-top:14px; border-top:1px solid rgba(244,247,250,0.06); cursor:pointer;">' +
            '<span style="font-family:' + MONO + '; font-size:12px; color:#7fc0ff;">remind the group</span><span style="font-size:13px;">👀</span>' +
          '</div>' +
        '</div>' +

        // ===== PAST RUNS (preview — inferred from the cadence, not stored runs) =====
        '<div style="margin:24px 2px 12px; display:flex; align-items:center; gap:7px;"><span style="font-family:' + MONO + '; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.45);">PAST RUNS</span><span style="font-family:' + MONO + '; font-weight:700; font-size:8px; letter-spacing:.5px; color:rgba(244,247,250,0.4); background:rgba(244,247,250,0.06); border:1px solid rgba(244,247,250,0.12); border-radius:999px; padding:2px 7px;">PREVIEW</span></div>' +
        '<div>' + pastRuns(rule) + '</div>' +

        // ===== CONTROLS =====
        '<div style="display:flex; gap:9px; margin-top:24px;">' +
          ctrlBtn("rdPause", '<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>', paused ? "resume" : "pause", false) +
          ctrlBtn("rdEdit", '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', "edit", false) +
          ctrlBtn("rdDelete", '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', "delete", true) +
        '</div>' +
      '</div>'
    );

    // controls wiring
    var pauseB = el.querySelector("#rdPause");
    if (pauseB) pauseB.onclick = async function () {
      pauseB.disabled = true;
      try {
        var updated = await app.api.patch("/api/recurring/" + encodeURIComponent(rule.id), { paused: !paused });
        app.closeSheet();
        app.toast((updated && updated.paused) ? "paused — off autopilot for now" : "resumed — back on autopilot");
        var view = document.getElementById("view");
        if (view) signedIn(view);
      } catch (e) {
        pauseB.disabled = false;
        app.toast((e && e.message) || "couldn't update");
      }
    };
    var editB = el.querySelector("#rdEdit");
    if (editB) editB.onclick = function () { app.closeSheet(); openNewSheet(rule); };
    var delB = el.querySelector("#rdDelete");
    if (delB) delB.onclick = async function () {
      delB.disabled = true;
      try {
        await app.api.del("/api/recurring/" + encodeURIComponent(rule.id));
        app.closeSheet();
        app.toast("deleted — off autopilot");
        var view = document.getElementById("view");
        if (view) signedIn(view);
      } catch (e) {
        delB.disabled = false;
        app.toast(e.message || "couldn't delete");
      }
    };

    // hydrate "who splits it" + member ticks from the trip members
    var memBox = el.querySelector("#rdMembers");
    var ticksBox = el.querySelector("#rdTicks");
    var trip = null;
    try { trip = await app.api.get("/api/trips/" + encodeURIComponent(rule.tripId)); } catch (_) {}
    var byId = {};
    if (trip && trip.members) trip.members.forEach(function (m) { byId[m.id] = m; });
    var pids = (rule.participants && rule.participants.length) ? rule.participants
      : (trip && trip.members ? trip.members.map(function (m) { return m.id; }) : []);

    var meId = window.Auth && window.Auth.user && window.Auth.user.id;
    function nameFor(m) {
      return (m.userId && meId && m.userId === meId) ? "you" : (m.name || "member");
    }

    if (!pids.length) {
      memBox.innerHTML = '<div style="font-family:' + MONO + '; font-size:12px; color:rgba(244,247,250,0.6); padding:14px 15px;">' + n + ' people · ' + plain$(share) + ' each</div>';
    } else {
      var rows = pids.map(function (pid, i) {
        var m = byId[pid] || { id: pid, name: "member" };
        var nm = nameFor(m);
        return (i > 0 ? '<div style="height:1px; background:rgba(244,247,250,0.06); margin:0 15px;"></div>' : '') +
          '<div style="display:flex; align-items:center; gap:12px; padding:13px 15px;">' +
            app.avatar({ name: m.name, id: m.id }, "sm") +
            '<span style="flex:1; font-family:' + SANS + '; font-weight:500; font-size:15px; color:#F4F7FA;" class="lower">' + app.esc(nm) + '</span>' +
            '<span style="font-family:' + MONO + '; font-weight:700; font-size:15px; color:rgba(244,247,250,0.85);">' + plain$(share) + '</span>' +
          '</div>';
      }).join("");
      var payer = byId[rule.paidBy];
      var payerNm = payer ? nameFor(payer) : "member";
      rows += '<div style="display:flex; align-items:center; gap:8px; padding:11px 15px; background:rgba(255,198,92,0.07); border-top:1px solid rgba(244,247,250,0.06);">' +
        '<span style="font-size:14px;">💳</span>' +
        '<span style="font-family:' + MONO + '; font-size:11px; letter-spacing:.3px; color:rgba(244,247,250,0.6);" class="lower">paid by: ' + app.esc(payerNm) + ' · everyone chips in to ' + app.esc(payerNm) + '</span></div>';
      memBox.innerHTML = rows;

      // member ticks for "this run" — everyone pending (👀) until a run lands
      ticksBox.innerHTML = pids.map(function (pid) {
        var m = byId[pid] || { id: pid, name: "member" };
        var nm = nameFor(m);
        return '<div style="display:flex; align-items:center; gap:7px;">' +
          '<div style="position:relative; width:30px; height:30px; border-radius:50%; background:rgba(244,247,250,0.08); border:1.5px dashed rgba(244,247,250,0.25); display:flex; align-items:center; justify-content:center; font-size:13px; opacity:.7;">👀</div>' +
          '<span style="font-family:' + MONO + '; font-size:11px; color:rgba(244,247,250,0.45);">' + app.esc(nm) + '</span></div>';
      }).join("");
    }
  }

  function thisRunBars(n) {
    var s = "";
    for (var i = 0; i < n; i++) s += '<div style="flex:1; border-radius:4px; background:rgba(244,247,250,0.1);"></div>';
    return s;
  }

  function ctrlBtn(id, path, label, coral) {
    var stroke = coral ? "#FF6B5E" : "rgba(244,247,250,0.8)";
    var color = coral ? "#FF6B5E" : "rgba(244,247,250,0.85)";
    var bg = coral ? "rgba(255,107,94,0.08)" : "#13212E";
    var bd = coral ? "rgba(255,107,94,0.28)" : "rgba(244,247,250,0.09)";
    return '<button id="' + id + '" style="appearance:none; cursor:pointer; flex:1; display:flex; flex-direction:column; align-items:center; gap:7px; padding:14px 0; border-radius:16px; background:' + bg + '; border:1px solid ' + bd + ';">' +
      '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>' +
      '<span style="font-family:' + SANS + '; font-weight:500; font-size:13px; color:' + color + ';">' + label + '</span></button>';
  }

  // synthesize a friendly "past runs" history from createdAt -> nextDue.
  // The API doesn't persist run history, so we infer prior occurrences,
  // rendering each with the lifted "ALL SQUARED ✨" history row markup.
  function pastRuns(rule) {
    var runs = [];
    try {
      var step = intervalDays(rule.interval);
      var d = new Date(rule.nextDue);
      var created = new Date(rule.createdAt || rule.nextDue);
      for (var i = 0; i < 4 && runs.length < 3; i++) {
        var prev = new Date(d.getTime());
        if (rule.interval === "monthly") prev.setUTCMonth(prev.getUTCMonth() - 1);
        else if (rule.interval === "yearly") prev.setUTCFullYear(prev.getUTCFullYear() - 1);
        else prev.setUTCDate(prev.getUTCDate() - step);
        d = prev;
        if (isNaN(d.getTime())) break;
        if (d.getTime() < created.getTime() - 86400000) break;
        runs.push(new Date(d.getTime()));
      }
    } catch (_) {}

    if (!runs.length) {
      return '<div style="background:#13212E; border:1px solid rgba(244,247,250,0.07); border-radius:18px; padding:16px;"><div style="font-family:' + MONO + '; font-size:12px; color:rgba(244,247,250,0.6);" class="lower">no past runs yet — this one\'s fresh ✨</div></div>';
    }
    return '<div style="display:flex; flex-direction:column; gap:3px;">' + runs.map(function (date, i) {
      return (i > 0 ? '<div style="height:1px; background:rgba(244,247,250,0.05); margin:0 6px;"></div>' : '') +
        '<div style="display:flex; align-items:center; gap:13px; padding:12px 6px; cursor:pointer;">' +
          '<div style="width:34px; height:34px; border-radius:11px; background:rgba(61,232,199,0.12); display:flex; align-items:center; justify-content:center; font-size:15px; flex:none;">✨</div>' +
          '<div style="flex:1; min-width:0;">' +
            '<div style="font-family:' + SANS + '; font-weight:500; font-size:14.5px; color:#F4F7FA;" class="lower">' + fmtDate(date.toISOString()) + '</div>' +
            '<div style="display:flex; align-items:center; gap:7px; margin-top:3px;">' +
              '<span style="display:inline-flex; align-items:center; gap:4px; background:rgba(61,232,199,0.12); border:1px solid rgba(61,232,199,0.4); border-radius:999px; padding:1px 8px;"><span style="width:4px; height:4px; border-radius:50%; background:#3DE8C7;"></span><span style="font-family:' + MONO + '; font-weight:700; font-size:8px; letter-spacing:.5px; color:#3DE8C7;">ALL SQUARED</span></span>' +
            '</div>' +
          '</div>' +
          '<span style="font-family:' + MONO + '; font-weight:700; font-size:14px; color:rgba(244,247,250,0.75);">' + plain$(rule.amountCents) + '</span>' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.35)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>' +
        '</div>';
    }).join("") + '</div>';
  }

  // ---- inject the frame keyframes once (recPulse for the active dot) --------
  if (!document.getElementById("divvy-recurring-css")) {
    var s = document.createElement("style");
    s.id = "divvy-recurring-css";
    s.textContent = "@keyframes recPulse{0%,100%{opacity:.5}50%{opacity:1}}";
    document.head.appendChild(s);
  }

  // ---- register -------------------------------------------------------------
  window.Screens = window.Screens || {};
  window.Screens.recurring = {
    title: "recurring",
    render: function (view) {
      var user = window.Auth && window.Auth.user;
      if (user) return signedIn(view);
      signedOut(view);
      if (window.Auth && window.Auth.onChange) window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("recurring") >= 0) { if (u) signedIn(view); else signedOut(view); }
      });
    },
  };
})();
