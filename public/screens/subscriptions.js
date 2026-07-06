/* screens/subscriptions.js — Shared subscriptions (#/subscriptions).
   The group netflix/spotify/etc: each subscription auto-splits into its
   group's tab on renewal day (src/subscriptions.ts) and nudges everyone.
   Journal aesthetic — cards styled as taped-in clippings, following the
   lift+wire patterns in screens/home.js + screens/recurring.js.

   API:
   GET /api/subscriptions -> { subscriptions: [{ id, tripId, tripName, name,
     icon, service, amountCents, amountFmt, monthlyCents, interval, renewalDay,
     payerMemberId, members:[{id,name,emoji,color,userId,shareCents,shareFmt,
     weight,isPayer}], yourShareCents, yourShareFmt, nextRenewal, canEdit }],
     totals: { monthlyCents, monthlyFmt, yourMonthlyCents, yourMonthlyFmt } }
   GET /api/subscriptions/:id -> same + renewals:[{period, amountFmt}]
   POST /api/subscriptions { tripId, name, icon, service, amountCents,
     interval, renewalDay, payerMemberId, members[] }
   PATCH /api/subscriptions/:id (same fields) ; DELETE /api/subscriptions/:id */
(function () {
  "use strict";
  var app = window.app;

  // fonts, lifted verbatim from the frames so nothing falls back to Inter
  var DISPLAY = "'Clash Display','General Sans',sans-serif";
  var MONO = "'Space Mono',monospace";
  var SANS = "'General Sans',sans-serif";

  // curated quick-pick services (key stored server-side as `service`)
  var QUICKPICK = [
    { key: "netflix", label: "netflix", icon: "🍿" },
    { key: "spotify", label: "spotify", icon: "🎧" },
    { key: "youtube premium", label: "youtube", icon: "▶️" },
    { key: "icloud", label: "icloud", icon: "☁️" },
    { key: "crunchyroll", label: "crunchyroll", icon: "🍥" },
    { key: "chatgpt", label: "chatgpt", icon: "🤖" },
    { key: "prime", label: "prime", icon: "📦" },
    { key: "custom", label: "custom", icon: "✨" },
  ];
  // washi tape colors cycle so the wall of clippings feels hand-assembled
  var TAPES = ["rgba(61,232,199,0.55)", "rgba(255,198,92,0.5)", "rgba(39,117,202,0.35)", "rgba(255,107,94,0.4)"];

  // ---- tiny helpers ---------------------------------------------------------
  var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
  }
  function daysUntil(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return Math.ceil((d.getTime() - Date.now()) / 86400000);
  }
  function renewsIn(iso) {
    var dl = daysUntil(iso);
    if (dl == null) return "";
    if (dl <= 0) return "today!!";
    if (dl === 1) return "tomorrow";
    return "in " + dl + "d";
  }
  function cadShort(interval) { return interval === "yearly" ? "/yr" : "/mo"; }
  function moneyParts(cents) {
    var n = Math.abs(cents) / 100;
    return { whole: Math.floor(n).toLocaleString(), dec: (n % 1).toFixed(2).slice(1) };
  }
  function plain$(cents) { var p = moneyParts(cents); return "$" + p.whole + p.dec; }
  function iconOf(sub) { return sub.icon || "💳"; }
  function meUserId() { return (window.Auth && window.Auth.user && window.Auth.user.id) || null; }

  // faint money texture + glow (frame canvas)
  function canvasTexture() {
    return '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 84% 2%, rgba(var(--ink-rgb),0.025) 0 1px, transparent 1px 8px); opacity:.6; pointer-events:none; z-index:0;"></div>' +
      '<div style="position:absolute; left:-40px; top:120px; width:340px; height:300px; border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,0.15) 0%, rgba(39,117,202,0) 70%); pointer-events:none; z-index:0;"></div>';
  }

  function topbar(subhead) {
    return '<div style="position:relative; z-index:6; display:flex; align-items:center; gap:12px; height:54px; padding:0 16px; flex:none;">' +
      '<div id="sBack" role="button" aria-label="back" tabindex="0" style="width:38px; height:38px; border-radius:50%; background:var(--card); border:1px solid rgba(var(--ink-rgb),0.1); display:flex; align-items:center; justify-content:center; cursor:pointer; flex:none;"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--border-ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></div>' +
      '<div style="flex:1;">' +
        '<h1 style="font-family:' + DISPLAY + '; font-weight:600; font-size:23px; letter-spacing:-0.5px; margin:0; color:var(--ink);">subscriptions</h1>' +
        '<div style="font-family:' + MONO + '; font-size:10px; letter-spacing:.3px; color:rgba(var(--ink-rgb),0.45); margin-top:1px;">' + app.esc(subhead || "") + '</div>' +
      '</div>' +
    '</div>';
  }
  function wireBack() {
    var b = document.getElementById("sBack");
    if (b) b.onclick = function () { if (history.length > 1) history.back(); else app.go("home"); };
  }

  // ---- signed-out -----------------------------------------------------------
  function signedOut(view) {
    view.innerHTML = canvasTexture() + topbar("split the group netflix & co") +
      '<div class="appscroll" style="position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; text-align:center; padding-top:40px;">' +
        '<div style="margin:6px 0 4px;">' + app.mascot({ size: 124, mood: "happy", glow: true }) + '</div>' +
        '<h1 style="font-family:' + DISPLAY + '; font-weight:600; font-size:22px; max-width:280px; margin-top:16px;" class="lower">the squad\'s subscriptions, sorted</h1>' +
        '<p style="font-family:' + SANS + '; font-size:14px; color:rgba(var(--ink-rgb),0.6); max-width:260px; margin:11px 0 0;">sign in to split netflix, spotify & co automatically every renewal 🍿</p>' +
        '<button class="btn" id="sConnect" style="max-width:300px; margin-top:24px;">sign in</button>' +
      '</div>';
    wireBack();
    var c = document.getElementById("sConnect");
    if (c) c.onclick = function () { app.signIn(); };
  }

  // ---- loading --------------------------------------------------------------
  function skeleton(view) {
    view.innerHTML = canvasTexture() + topbar("loading…") +
      '<div class="appscroll" style="position:relative; z-index:2; padding-top:8px;">' +
        '<div class="skeleton" style="height:56px; margin:4px 0 20px; border-radius:16px;"></div>' +
        '<div class="skeleton" style="height:118px; margin:14px 0; border-radius:18px;"></div>' +
        '<div class="skeleton" style="height:118px; margin:14px 0; border-radius:18px;"></div>' +
        '<div class="skeleton" style="height:118px; margin:14px 0; border-radius:18px;"></div>' +
      '</div>';
    wireBack();
  }

  // ---- empty (Mochi) --------------------------------------------------------
  function emptyState(view) {
    view.innerHTML = canvasTexture() + topbar("nothing shared yet") +
      '<div style="position:relative; z-index:2; min-height:60vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px; padding:40px 44px 120px; text-align:center;">' +
        app.mascot({ size: 120, mood: "happy", glow: true }) +
        '<div style="font-family:' + SANS + '; font-size:16px; line-height:1.5; color:rgba(var(--ink-rgb),0.65);">split the group netflix once —<br>never chase $4.25 again 🍿</div>' +
        '<button id="sNew" style="appearance:none; border:none; cursor:pointer; display:inline-flex; align-items:center; gap:8px; min-height:50px; padding:0 24px; border-radius:999px; background:#2775CA; border:2px solid var(--border-ink); box-shadow:3px 3px 0 rgba(var(--shadow-rgb),0.9);">' +
          '<svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
          '<span style="font-family:' + DISPLAY + '; font-weight:600; font-size:16px; color:#fff;">add a subscription</span>' +
        '</button>' +
      '</div>';
    wireBack();
    var b = document.getElementById("sNew");
    if (b) b.onclick = function () { openEditSheet(); };
  }

  // ---- "costs you $X/mo" strip ----------------------------------------------
  function costStrip(totals, count) {
    var mine = totals && totals.yourMonthlyCents > 0;
    var cents = mine ? totals.yourMonthlyCents : (totals ? totals.monthlyCents : 0);
    var label = mine ? "your subscriptions cost you" : "the squad's subs run";
    return '<div style="position:relative; display:flex; align-items:center; gap:11px; background:var(--card); border:2px solid var(--border-ink); border-radius:16px; box-shadow:3px 4px 0 rgba(var(--shadow-rgb),0.85); padding:13px 16px; margin:6px 0 20px; transform:rotate(0.4deg);">' +
      '<div style="position:absolute; top:-11px; right:22%; width:64px; height:20px; background:rgba(255,198,92,0.5); transform:rotate(4deg); border-left:1.5px dashed rgba(var(--ink-rgb),0.25); border-right:1.5px dashed rgba(var(--ink-rgb),0.25); pointer-events:none;"></div>' +
      '<span style="font-size:19px; flex:none;">🧾</span>' +
      '<span style="flex:1; font-family:' + MONO + '; font-size:11px; letter-spacing:.4px; color:rgba(var(--ink-rgb),0.6);">' + label + '</span>' +
      '<span style="font-family:' + MONO + '; font-weight:700; font-size:19px; letter-spacing:-0.5px; color:#FF6B5E;"><span style="opacity:.5;">$</span>' + moneyParts(cents).whole + '<span style="opacity:.5;">' + moneyParts(cents).dec + '</span></span>' +
      '<span style="font-family:' + MONO + '; font-size:10px; color:rgba(var(--ink-rgb),0.45);">/mo · ' + count + '</span>' +
    '</div>';
  }

  // overlapping member avatar stack (home-hero style, ink-ringed)
  function avatarStack(members) {
    var shown = (members || []).slice(0, 4);
    var extra = (members || []).length - shown.length;
    var html = shown.map(function (m, i) {
      return '<div style="width:24px;height:24px;border-radius:50%;background:' + (m.color || "rgba(39,117,202,0.18)") + ';border:2px solid var(--card);' + (i ? "margin-left:-8px;" : "") + 'display:flex;align-items:center;justify-content:center;font-size:12px;">' + app.face(m.emoji || (m.name || "?")[0]) + '</div>';
    }).join("");
    if (extra > 0) html += '<div style="width:24px;height:24px;border-radius:50%;background:rgba(var(--ink-rgb),0.08);border:2px solid var(--card);margin-left:-8px;display:flex;align-items:center;justify-content:center;font-family:' + MONO + ';font-size:9px;color:rgba(var(--ink-rgb),0.6);">+' + extra + '</div>';
    return '<div style="display:flex; align-items:center;">' + html + '</div>';
  }

  // ---- subscription card — a taped-in clipping --------------------------------
  function subCard(sub, i) {
    var rot = (i % 2 === 0 ? -0.7 : 0.6);
    var tape = TAPES[i % TAPES.length];
    var due = daysUntil(sub.nextRenewal);
    var dueSoon = due != null && due <= 2;
    var mp = moneyParts(sub.amountCents);
    var share = sub.yourShareCents != null
      ? 'your share <span style="color:#FF6B5E; font-weight:700;">' + plain$(sub.yourShareCents) + '</span>'
      : 'split ' + ((sub.members && sub.members.length) || 1) + ' ways';
    return '<div data-sid="' + app.esc(sub.id) + '" role="button" tabindex="0" style="position:relative; background:var(--card); border:2px solid var(--border-ink); border-radius:18px; box-shadow:3px 4px 0 rgba(var(--shadow-rgb),0.85); padding:15px 16px 13px; margin:16px 0; transform:rotate(' + rot + 'deg); cursor:pointer;">' +
      // washi tape holding the clipping down
      '<div style="position:absolute; top:-12px; ' + (i % 2 === 0 ? "left:12%" : "right:14%") + '; width:78px; height:22px; background:' + tape + '; transform:rotate(' + (i % 2 === 0 ? -5 : 4) + 'deg); border-left:1.5px dashed rgba(var(--ink-rgb),0.25); border-right:1.5px dashed rgba(var(--ink-rgb),0.25); pointer-events:none;"></div>' +
      '<div style="display:flex; align-items:center; gap:13px;">' +
        '<div style="width:46px; height:46px; border-radius:13px; background:rgba(39,117,202,0.14); border:1.5px solid rgba(var(--ink-rgb),0.14); display:flex; align-items:center; justify-content:center; font-size:23px; flex:none;">' + app.face(iconOf(sub)) + '</div>' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="font-family:' + DISPLAY + '; font-weight:600; font-size:16.5px; letter-spacing:-0.2px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" class="lower">' + app.esc(sub.name) + '</div>' +
          '<div style="font-family:' + MONO + '; font-size:10px; letter-spacing:.4px; color:rgba(var(--ink-rgb),0.5); margin-top:3px;" class="lower">' + app.esc(sub.tripName || "group") + ' · ' + share + '</div>' +
        '</div>' +
        '<div style="text-align:right; flex:none;">' +
          '<div style="font-family:' + MONO + '; font-weight:700; font-size:19px; letter-spacing:-0.5px; color:var(--ink);"><span style="opacity:.5;">$</span>' + mp.whole + '<span style="opacity:.5;">' + mp.dec + '</span><span style="font-size:10px; opacity:.45;">' + cadShort(sub.interval) + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex; align-items:center; justify-content:space-between; margin-top:12px; padding-top:11px; border-top:1.5px dashed rgba(var(--ink-rgb),0.14);">' +
        avatarStack(sub.members) +
        '<span style="display:inline-flex; align-items:center; gap:6px; background:' + (dueSoon ? "rgba(255,107,94,0.1)" : "rgba(61,232,199,0.12)") + '; border:1px solid ' + (dueSoon ? "rgba(255,107,94,0.35)" : "rgba(61,232,199,0.4)") + '; border-radius:999px; padding:4px 11px;">' +
          '<span style="width:5px; height:5px; border-radius:50%; background:' + (dueSoon ? "#FF6B5E" : "#3DE8C7") + ';"></span>' +
          '<span style="font-family:' + MONO + '; font-weight:700; font-size:10px; color:' + (dueSoon ? "#FF6B5E" : "#1fbfa3") + ';">renews ' + fmtDate(sub.nextRenewal) + ' · ' + renewsIn(sub.nextRenewal) + '</span>' +
        '</span>' +
      '</div>' +
    '</div>';
  }

  function addCard() {
    return '<div id="sAddTile" role="button" tabindex="0" style="display:flex; align-items:center; justify-content:center; gap:9px; min-height:56px; margin:18px 0 10px; border-radius:18px; border:1.5px dashed rgba(39,117,202,0.4); background:rgba(39,117,202,0.05); cursor:pointer;">' +
      '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2775CA" stroke-width="2.3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
      '<span style="font-family:' + DISPLAY + '; font-weight:600; font-size:15px; color:#2775CA;">add a subscription</span>' +
    '</div>';
  }

  // ---- signed-in (list) -----------------------------------------------------
  var _trips = null; // cache of my trips for the create-sheet group picker

  async function signedIn(view) {
    skeleton(view);
    var data;
    try { data = await app.api.get("/api/subscriptions"); }
    catch (e) {
      view.innerHTML = canvasTexture() + topbar("couldn't load") +
        '<div class="empty" style="position:relative; z-index:2;"><div class="title lower">couldn\'t load subscriptions</div><div class="hint">' + app.esc(e.message) + '</div></div>';
      wireBack();
      return;
    }
    var subs = (data && data.subscriptions) || [];
    if (!Array.isArray(subs)) subs = [];
    if (!subs.length) { emptyState(view); return; }

    // soonest renewal first — the one about to bill you leads the wall
    subs = subs.slice().sort(function (a, b) {
      return new Date(a.nextRenewal).getTime() - new Date(b.nextRenewal).getTime();
    });

    var totals = (data && data.totals) || { monthlyCents: 0, yourMonthlyCents: 0 };
    var sub = subs.length + (subs.length === 1 ? " sub" : " subs") + " · ~" + plain$(totals.monthlyCents).replace(/\.00$/, "") + "/mo total";

    view.innerHTML = canvasTexture() + topbar(sub) +
      '<div class="appscroll" style="position:relative; z-index:2; padding:10px 16px 120px;">' +
        costStrip(totals, subs.length) +
        subs.map(subCard).join("") +
        addCard() +
      '</div>';

    wireBack();
    var byId = {};
    subs.forEach(function (s) { byId[s.id] = s; });
    Array.prototype.forEach.call(view.querySelectorAll("[data-sid]"), function (el) {
      var open = function () { var s = byId[el.getAttribute("data-sid")]; if (s) openDetailSheet(s); };
      el.onclick = open;
      el.onkeydown = function (e) { if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); open(); } };
    });
    var add = document.getElementById("sAddTile");
    if (add) {
      add.onclick = function () { openEditSheet(); };
      add.onkeydown = function (e) { if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); openEditSheet(); } };
    }
    if (app.enter) app.enter(view.querySelector(".appscroll"));
  }

  // ---- create / edit sheet ----------------------------------------------------
  function quickChip(q, selected) {
    var sel = selected ? "background:rgba(39,117,202,0.14); border:2px solid #2775CA;" : "background:var(--card); border:2px solid rgba(var(--ink-rgb),0.14);";
    return '<div data-qp="' + app.esc(q.key) + '" role="button" tabindex="0" style="display:flex; flex-direction:column; align-items:center; gap:5px; padding:11px 2px 9px; border-radius:14px; cursor:pointer; ' + sel + '">' +
      '<span style="font-size:22px;">' + q.icon + '</span>' +
      '<span style="font-family:' + MONO + '; font-size:9.5px; letter-spacing:.3px; color:rgba(var(--ink-rgb),0.65); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;">' + q.label + '</span>' +
    '</div>';
  }
  function segChip(value, label, selected) {
    var sel = 'background:rgba(39,117,202,0.16); border:1px solid rgba(39,117,202,0.5); font-weight:700; color:#2775CA;';
    var unsel = 'background:rgba(var(--ink-rgb),0.05); border:1px solid rgba(var(--ink-rgb),0.08); color:rgba(var(--ink-rgb),0.55);';
    return '<div data-int="' + value + '" style="flex:1; text-align:center; padding:9px 0; border-radius:11px; font-family:' + MONO + '; font-size:11px; cursor:pointer; ' + (selected ? sel : unsel) + '">' + label + '</div>';
  }
  function applySeg(el, selected) {
    if (selected) {
      el.style.background = "rgba(39,117,202,0.16)"; el.style.border = "1px solid rgba(39,117,202,0.5)";
      el.style.fontWeight = "700"; el.style.color = "#2775CA";
    } else {
      el.style.background = "rgba(var(--ink-rgb),0.05)"; el.style.border = "1px solid rgba(var(--ink-rgb),0.08)";
      el.style.fontWeight = "400"; el.style.color = "rgba(var(--ink-rgb),0.55)";
    }
  }
  function rowShell(inner) {
    return '<div style="background:var(--card); border:2px solid var(--border-ink); border-radius:16px; box-shadow:3px 4px 0 rgba(var(--shadow-rgb),0.85); padding:13px 16px;">' + inner + '</div>';
  }

  async function openEditSheet(prefill) {
    var editing = !!(prefill && prefill.id);
    var el = app.sheet(
      '<div style="max-height:82vh; overflow-y:auto; margin:-2px -6px 0; padding:0 6px 4px;">' +
      '<div style="font-family:' + MONO + '; font-size:11px; letter-spacing:1px; color:rgba(var(--ink-rgb),0.5); margin:2px 2px 14px;">' + (editing ? "edit subscription" : "new subscription · what's the squad on?") + '</div>' +

      // quick-pick grid
      '<div id="sfPick" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:8px;">' +
        QUICKPICK.map(function (q) { return quickChip(q, false); }).join("") +
      '</div>' +

      '<div style="display:flex; flex-direction:column; gap:11px; margin-top:14px;">' +

        // name row
        rowShell('<div style="display:flex; align-items:center; gap:12px;">' +
          '<span style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.45); flex:none;">name</span>' +
          '<input id="sfName" placeholder="netflix" maxlength="80" style="appearance:none; border:none; outline:none; background:transparent; flex:1; min-width:0; text-align:right; font-family:' + MONO + '; font-size:13px; color:var(--ink);" /></div>') +

        // amount hero
        '<div style="background:var(--card); border:1px solid rgba(39,117,202,0.3); border-radius:22px; padding:18px; text-align:center; box-shadow:0 12px 30px rgba(var(--shadow-rgb),0.13);">' +
          '<div style="font-family:' + MONO + '; font-size:9px; letter-spacing:2px; color:rgba(var(--ink-rgb),0.4);">AMOUNT</div>' +
          '<div style="display:flex; align-items:center; justify-content:center; margin-top:10px;">' +
            '<span style="font-family:' + MONO + '; font-weight:700; font-size:24px; opacity:.5; color:var(--ink);">$</span>' +
            '<input id="sfAmount" inputmode="decimal" placeholder="0" style="appearance:none; border:none; outline:none; background:transparent; width:auto; max-width:210px; text-align:center; font-family:' + MONO + '; font-weight:700; font-size:44px; line-height:1; letter-spacing:-2px; color:var(--ink); caret-color:#2775CA;" />' +
          '</div>' +
        '</div>' +

        // interval + renewal day
        rowShell('<div style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.45); margin-bottom:11px;">billed</div>' +
          '<div id="sfInterval" style="display:flex; gap:7px;">' + segChip("monthly", "monthly", true) + segChip("yearly", "yearly", false) + '</div>') +
        rowShell('<div style="display:flex; align-items:center; gap:12px;">' +
          '<span style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.45); flex:1;">renews on the</span>' +
          '<input id="sfDay" inputmode="numeric" maxlength="2" style="appearance:none; border:none; outline:none; background:rgba(39,117,202,0.08); border-radius:10px; width:52px; padding:7px 0; text-align:center; font-family:' + MONO + '; font-weight:700; font-size:16px; color:#2775CA;" />' +
          '<span style="font-family:' + MONO + '; font-size:11px; color:rgba(var(--ink-rgb),0.45);">of the month</span></div>') +

        // group picker
        '<div id="sfTripWrap" style="background:var(--card); border:2px solid var(--border-ink); border-radius:16px; box-shadow:3px 4px 0 rgba(var(--shadow-rgb),0.85); padding:13px 16px;">' +
          '<div style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.45); margin-bottom:11px;">group</div>' +
          '<div style="font-family:' + MONO + '; font-size:12px; color:rgba(var(--ink-rgb),0.6);">loading groups…</div>' +
        '</div>' +

        // members (toggle) + payer
        '<div id="sfMembers" style="background:var(--card); border:2px solid var(--border-ink); border-radius:16px; box-shadow:3px 4px 0 rgba(var(--shadow-rgb),0.85); padding:13px 16px;">' +
          '<div style="display:flex; align-items:center; justify-content:space-between;">' +
            '<span style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.45);">who splits it</span>' +
            '<span style="font-family:' + MONO + '; font-size:11px; color:rgba(var(--ink-rgb),0.4);">pick a group first</span>' +
          '</div>' +
        '</div>' +

      '</div>' +

      '<button id="sfSave" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:56px; border-radius:999px; background:#2775CA; border:2px solid var(--border-ink); display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:3px 3px 0 rgba(var(--shadow-rgb),0.9); margin-top:18px;">' +
        '<span style="font-family:' + DISPLAY + '; font-weight:600; font-size:17px; color:#fff;">' + (editing ? "save changes" : "start splitting") + '</span><span style="font-size:15px;">🍿</span>' +
      '</button>' +
      '</div>'
    );

    // quick-pick wiring: tapping a service seeds name + icon; custom clears them
    var chosenService = (prefill && prefill.service) || null;
    var chosenIcon = (prefill && prefill.icon) || null;
    var nameEl = el.querySelector("#sfName");
    function markPick() {
      Array.prototype.forEach.call(el.querySelectorAll("[data-qp]"), function (c) {
        var on = c.getAttribute("data-qp") === chosenService;
        c.style.background = on ? "rgba(39,117,202,0.14)" : "var(--card)";
        c.style.border = on ? "2px solid #2775CA" : "2px solid rgba(var(--ink-rgb),0.14)";
      });
    }
    Array.prototype.forEach.call(el.querySelectorAll("[data-qp]"), function (c) {
      c.onclick = function () {
        var key = c.getAttribute("data-qp");
        var q = QUICKPICK.filter(function (x) { return x.key === key; })[0];
        chosenService = key;
        chosenIcon = q.icon;
        if (key === "custom") { nameEl.value = ""; nameEl.focus(); }
        else nameEl.value = q.key;
        markPick();
      };
    });
    if (chosenService) markPick();

    // interval segmented
    var chosenInt = (prefill && prefill.interval) || "monthly";
    var intWrap = el.querySelector("#sfInterval");
    Array.prototype.forEach.call(intWrap.querySelectorAll("[data-int]"), function (c) {
      applySeg(c, c.getAttribute("data-int") === chosenInt);
      c.onclick = function () {
        chosenInt = c.getAttribute("data-int");
        Array.prototype.forEach.call(intWrap.querySelectorAll("[data-int]"), function (x) { applySeg(x, false); });
        applySeg(c, true);
      };
    });

    // prefills
    if (prefill) {
      if (typeof prefill.amountCents === "number") el.querySelector("#sfAmount").value = (prefill.amountCents / 100).toFixed(2);
      if (prefill.name) nameEl.value = prefill.name;
    }
    el.querySelector("#sfDay").value = String((prefill && prefill.renewalDay) || new Date().getUTCDate());

    // group picker (same trips source as recurring.js)
    var trips = _trips;
    try {
      if (!trips) { trips = await app.api.get("/api/trips?mine=1"); _trips = trips; }
    } catch (_) { trips = []; }
    trips = Array.isArray(trips) ? trips : [];

    var tripWrap = el.querySelector("#sfTripWrap");
    var memWrap = el.querySelector("#sfMembers");
    var chosenTrip = null;      // trip id
    var tripMembers = [];       // [{id,name,...}]
    var included = {};          // memberId -> true
    var payerId = null;

    if (!trips.length) {
      tripWrap.innerHTML = '<div style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.45); margin-bottom:8px;">group</div>' +
        '<div style="font-family:' + MONO + '; font-size:12px; color:rgba(var(--ink-rgb),0.6);">you need a group first — the split lands on its tab.</div>' +
        '<button class="btn ghost" id="sfGoGroups" style="margin-top:10px;">make a group</button>';
      var g = el.querySelector("#sfGoGroups");
      if (g) g.onclick = function () { app.closeSheet(); app.go("groups"); };
      var sv0 = el.querySelector("#sfSave");
      if (sv0) sv0.disabled = true;
      return;
    }

    tripWrap.innerHTML = '<div style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.45); margin-bottom:11px;">group</div>' +
      '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
        trips.map(function (t) { return '<div class="chip lower" data-trip="' + app.esc(t.id) + '">' + app.esc(t.name) + '</div>'; }).join("") +
      '</div>';

    function renderMembers() {
      if (!tripMembers.length) {
        memWrap.innerHTML = '<div style="display:flex; align-items:center; justify-content:space-between;">' +
          '<span style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.45);">who splits it</span>' +
          '<span style="font-family:' + MONO + '; font-size:11px; color:rgba(var(--ink-rgb),0.4);">no members</span></div>';
        return;
      }
      var chips = tripMembers.map(function (m) {
        return '<div class="chip lower' + (included[m.id] ? " selected" : "") + '" data-mem="' + app.esc(m.id) + '">' +
          app.avatar({ name: m.name, id: m.id }, "sm") + '<span>' + app.esc(m.name) + '</span></div>';
      }).join("");
      var inIds = tripMembers.filter(function (m) { return included[m.id]; });
      var payerChips = inIds.map(function (m) {
        var on = m.id === payerId;
        return '<div class="chip lower" data-payer-chip="' + app.esc(m.id) + '" style="' + (on ? "border-color:var(--blue);" : "") + '">' +
          '<span>💳 ' + app.esc(m.name) + '</span></div>';
      }).join("");
      memWrap.innerHTML =
        '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:11px;">' +
          '<span style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.45);">who splits it</span>' +
          '<span style="font-family:' + MONO + '; font-size:10px; color:rgba(var(--ink-rgb),0.4);">even split · tap to toggle</span>' +
        '</div>' +
        '<div style="display:flex; gap:8px; flex-wrap:wrap;">' + chips + '</div>' +
        '<div style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.45); margin:14px 0 10px;">who pays the provider</div>' +
        '<div style="display:flex; gap:8px; flex-wrap:wrap;">' + (payerChips || '<span style="font-family:' + MONO + '; font-size:11px; color:rgba(var(--ink-rgb),0.4);">pick members first</span>') + '</div>';
    }

    memWrap.onclick = function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-mem],[data-payer-chip]") : null;
      if (!t) return;
      var mid = t.getAttribute("data-mem");
      if (mid) {
        included[mid] = !included[mid];
        if (!included[mid] && payerId === mid) payerId = null;
      } else {
        payerId = t.getAttribute("data-payer-chip");
      }
      if (!payerId) {
        var firstIn = tripMembers.filter(function (m) { return included[m.id]; })[0];
        payerId = firstIn ? firstIn.id : null;
      }
      renderMembers();
    };

    async function pickTrip(id, chipEl) {
      var t;
      try { t = await app.api.get("/api/trips/" + encodeURIComponent(id)); }
      catch (_) { t = trips.filter(function (x) { return x.id === id; })[0]; }
      chosenTrip = id;
      tripMembers = (t && t.members) || [];
      included = {};
      tripMembers.forEach(function (m) { included[m.id] = true; });
      payerId = tripMembers.length ? tripMembers[0].id : null;
      // editing: seed membership + payer from the subscription
      if (editing && prefill.tripId === id) {
        var keep = {};
        (prefill.members || []).forEach(function (m) { keep[m.id || m] = true; });
        if (Object.keys(keep).length) {
          tripMembers.forEach(function (m) { included[m.id] = !!keep[m.id]; });
        }
        if (prefill.payerMemberId && included[prefill.payerMemberId]) payerId = prefill.payerMemberId;
      }
      Array.prototype.forEach.call(el.querySelectorAll("[data-trip]"), function (x) { x.classList.remove("selected"); });
      if (chipEl) chipEl.classList.add("selected");
      renderMembers();
    }

    Array.prototype.forEach.call(el.querySelectorAll("[data-trip]"), function (chip) {
      chip.onclick = function () { pickTrip(chip.getAttribute("data-trip"), chip); };
    });

    // editing: auto-open the subscription's group
    if (editing && prefill.tripId) {
      var editChip = el.querySelector('[data-trip="' + (window.CSS && CSS.escape ? CSS.escape(prefill.tripId) : prefill.tripId) + '"]');
      if (editChip) await pickTrip(prefill.tripId, editChip);
    }

    // save
    var sv = el.querySelector("#sfSave");
    sv.onclick = async function () {
      if (!chosenTrip) { app.toast("pick a group first"); return; }
      var name = (nameEl.value || "").trim();
      if (!name) { app.toast("what's it called?"); return; }
      var raw = (el.querySelector("#sfAmount").value || "").trim();
      if (!/^\d*(\.\d{1,2})?$/.test(raw)) { app.toast("enter a plain dollar amount"); return; }
      var amt = parseFloat(raw);
      if (!isFinite(amt) || !(amt > 0)) { app.toast("enter an amount"); return; }
      var amountCents = Math.round(amt * 100);
      var day = parseInt((el.querySelector("#sfDay").value || "").trim(), 10);
      if (!(day >= 1 && day <= 31)) { app.toast("renewal day is 1–31"); return; }
      var members = tripMembers.filter(function (m) { return included[m.id]; }).map(function (m) { return m.id; });
      if (!members.length) { app.toast("pick who splits it"); return; }
      if (!payerId || members.indexOf(payerId) < 0) payerId = members[0];

      var body = {
        tripId: chosenTrip,
        name: name,
        icon: chosenIcon || undefined,
        service: chosenService || undefined,
        amountCents: amountCents,
        interval: chosenInt,
        renewalDay: day,
        payerMemberId: payerId,
        members: members,
      };

      sv.disabled = true;
      sv.innerHTML = '<span style="font-family:' + DISPLAY + '; font-weight:600; font-size:17px; color:#fff;">' + (editing ? "saving…" : "setting up…") + '</span>';
      try {
        if (editing) await app.api.patch("/api/subscriptions/" + encodeURIComponent(prefill.id), body);
        else await app.api.post("/api/subscriptions", body);
        app.closeSheet();
        app.toast(editing ? "updated ✨" : "on autopilot 🍿");
        var view = document.getElementById("view");
        if (view) signedIn(view);
      } catch (e) {
        sv.disabled = false;
        sv.innerHTML = '<span style="font-family:' + DISPLAY + '; font-weight:600; font-size:17px; color:#fff;">' + (editing ? "save changes" : "start splitting") + '</span><span style="font-size:15px;">🍿</span>';
        app.toast(e.message || "couldn't save");
      }
    };
  }

  // ---- detail sheet -----------------------------------------------------------
  async function openDetailSheet(sub) {
    var mp = moneyParts(sub.amountCents);
    var meId = meUserId();
    var members = sub.members || [];
    var payer = members.filter(function (m) { return m.isPayer; })[0];
    var iAmPayer = !!(payer && payer.userId && meId && payer.userId === meId);
    function nameFor(m) { return (m.userId && meId && m.userId === meId) ? "you" : (m.name || "member"); }

    var memberRows = members.map(function (m, i) {
      return (i > 0 ? '<div style="height:1px; background:rgba(var(--ink-rgb),0.06); margin:0 15px;"></div>' : '') +
        '<div style="display:flex; align-items:center; gap:12px; padding:12px 15px;">' +
          '<div style="width:32px;height:32px;border-radius:50%;background:' + (m.color || "rgba(39,117,202,0.18)") + ';display:flex;align-items:center;justify-content:center;font-size:15px;flex:none;">' + app.face(m.emoji || (m.name || "?")[0]) + '</div>' +
          '<span style="flex:1; font-family:' + SANS + '; font-weight:500; font-size:15px; color:var(--ink);" class="lower">' + app.esc(nameFor(m)) + (m.weight > 1 ? ' <span style="font-family:' + MONO + '; font-size:10px; color:rgba(var(--ink-rgb),0.4);">×' + m.weight + '</span>' : '') + '</span>' +
          (m.isPayer ? '<span style="font-family:' + MONO + '; font-size:9px; letter-spacing:.5px; background:rgba(255,198,92,0.15); border:1px solid rgba(255,198,92,0.4); border-radius:999px; padding:2px 8px; color:#b8862e;">PAYS 💳</span>' : '') +
          '<span style="font-family:' + MONO + '; font-weight:700; font-size:15px; color:rgba(var(--ink-rgb),0.85);">' + app.esc(m.shareFmt || plain$(m.shareCents || 0)) + '</span>' +
        '</div>';
    }).join("");

    var el = app.sheet(
      '<div style="max-height:80vh; overflow-y:auto; margin:-2px -6px 0; padding:0 6px;">' +
        // header — taped-in identity card
        '<div style="position:relative; border-radius:22px; overflow:hidden; padding:19px; background:linear-gradient(150deg,#2f80d6 0%,#2775CA 55%,#1d5e9f 100%); box-shadow:3px 3px 0 rgba(var(--shadow-rgb),0.9);">' +
          '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 88% 8%, rgba(255,255,255,0.09) 0 1px, transparent 1px 9px); opacity:.55; pointer-events:none;"></div>' +
          '<div style="position:relative; display:flex; align-items:center; gap:12px;">' +
            '<div style="width:48px; height:48px; border-radius:14px; background:rgba(11,22,34,0.28); border:1px solid rgba(255,255,255,0.25); display:flex; align-items:center; justify-content:center; font-size:24px; flex:none;">' + app.face(iconOf(sub)) + '</div>' +
            '<div style="min-width:0; flex:1;">' +
              '<div style="font-family:' + DISPLAY + '; font-weight:600; font-size:19px; letter-spacing:-0.2px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" class="lower">' + app.esc(sub.name) + '</div>' +
              '<div style="font-family:' + MONO + '; font-size:10px; letter-spacing:.5px; color:rgba(255,255,255,0.72); margin-top:2px;" class="lower">' + app.esc(sub.tripName || "group") + ' · renews ' + fmtDate(sub.nextRenewal) + ' · ' + renewsIn(sub.nextRenewal) + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="position:relative; display:flex; align-items:baseline; gap:8px; margin-top:16px;">' +
            '<div style="font-family:' + MONO + '; font-weight:700; font-size:42px; line-height:.9; letter-spacing:-2px; color:#fff;"><span style="font-size:22px; opacity:.6;">$</span>' + mp.whole + '<span style="font-size:22px; opacity:.6;">' + mp.dec + '</span></div>' +
            '<span style="font-family:' + MONO + '; font-size:13px; color:rgba(255,255,255,0.6);">' + cadShort(sub.interval) + '</span>' +
            (sub.yourShareCents != null ? '<span style="margin-left:auto; font-family:' + MONO + '; font-size:11px; color:rgba(255,255,255,0.85); background:rgba(11,22,34,0.25); border:1px solid rgba(255,255,255,0.22); border-radius:999px; padding:4px 11px;">your share ' + plain$(sub.yourShareCents) + '</span>' : '') +
          '</div>' +
        '</div>' +

        // members + shares
        '<div style="display:flex; align-items:center; justify-content:space-between; margin:22px 2px 12px;">' +
          '<span style="font-family:' + MONO + '; font-size:10px; letter-spacing:1.5px; color:rgba(var(--ink-rgb),0.45);">WHO SPLITS IT</span>' +
          '<span style="font-family:' + MONO + '; font-size:10px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.4);">SPLIT ' + members.length + '</span>' +
        '</div>' +
        '<div style="background:var(--card); border:2px solid var(--border-ink); border-radius:18px; box-shadow:3px 4px 0 rgba(var(--shadow-rgb),0.85); overflow:hidden;">' +
          (memberRows || '<div style="font-family:' + MONO + '; font-size:12px; color:rgba(var(--ink-rgb),0.6); padding:14px 15px;">no members</div>') +
        '</div>' +

        // renewal history
        '<div style="margin:22px 2px 12px;"><span style="font-family:' + MONO + '; font-size:10px; letter-spacing:1.5px; color:rgba(var(--ink-rgb),0.45);">RENEWALS</span></div>' +
        '<div id="sdHistory" style="background:var(--card); border:2px solid var(--border-ink); border-radius:18px; box-shadow:3px 4px 0 rgba(var(--shadow-rgb),0.85); overflow:hidden;">' +
          '<div style="font-family:' + MONO + '; font-size:12px; color:rgba(var(--ink-rgb),0.6); padding:14px 15px;">loading…</div>' +
        '</div>' +

        // actions
        '<button id="sdPay" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:52px; border-radius:999px; background:#2775CA; border:2px solid var(--border-ink); box-shadow:3px 3px 0 rgba(var(--shadow-rgb),0.9); margin-top:22px; font-family:' + DISPLAY + '; font-weight:600; font-size:16px; color:#fff;">' +
          (iAmPayer ? "open the group tab →" : "pay your share →") + '</button>' +
        (sub.canEdit
          ? '<div style="display:flex; gap:9px; margin-top:11px;">' +
              '<button id="sdEdit" style="appearance:none; cursor:pointer; flex:1; min-height:46px; border-radius:999px; background:var(--card); border:1px solid rgba(var(--ink-rgb),0.14); font-family:' + SANS + '; font-weight:500; font-size:14px; color:rgba(var(--ink-rgb),0.85);">edit</button>' +
              '<button id="sdDelete" style="appearance:none; cursor:pointer; flex:1; min-height:46px; border-radius:999px; background:rgba(255,107,94,0.08); border:1px solid rgba(255,107,94,0.28); font-family:' + SANS + '; font-weight:500; font-size:14px; color:#FF6B5E;">delete</button>' +
            '</div>'
          : '') +
      '</div>'
    );

    // actions
    var payB = el.querySelector("#sdPay");
    if (payB) payB.onclick = function () {
      app.closeSheet();
      location.hash = (iAmPayer ? "#/group/" : "#/settle/") + encodeURIComponent(sub.tripId);
    };
    var editB = el.querySelector("#sdEdit");
    if (editB) editB.onclick = function () { app.closeSheet(); openEditSheet(sub); };
    var delB = el.querySelector("#sdDelete");
    if (delB) delB.onclick = async function () {
      delB.disabled = true;
      try {
        await app.api.del("/api/subscriptions/" + encodeURIComponent(sub.id));
        app.closeSheet();
        app.toast("cancelled — no more auto-splits");
        var view = document.getElementById("view");
        if (view) signedIn(view);
      } catch (e) {
        delB.disabled = false;
        app.toast(e.message || "couldn't delete");
      }
    };

    // hydrate renewal history
    var hist = el.querySelector("#sdHistory");
    var detail = null;
    try { detail = await app.api.get("/api/subscriptions/" + encodeURIComponent(sub.id)); } catch (_) {}
    var renewals = (detail && detail.renewals) || [];
    if (!renewals.length) {
      hist.innerHTML = '<div style="font-family:' + MONO + '; font-size:12px; color:rgba(var(--ink-rgb),0.6); padding:14px 15px;" class="lower">no renewals yet — first one lands ' + fmtDate(sub.nextRenewal) + ' ✨</div>';
    } else {
      hist.innerHTML = renewals.map(function (r, i) {
        return (i > 0 ? '<div style="height:1px; background:rgba(var(--ink-rgb),0.06); margin:0 15px;"></div>' : '') +
          '<div style="display:flex; align-items:center; gap:12px; padding:12px 15px;">' +
            '<div style="width:32px; height:32px; border-radius:10px; background:rgba(61,232,199,0.12); display:flex; align-items:center; justify-content:center; font-size:14px; flex:none;">🔁</div>' +
            '<span style="flex:1; font-family:' + SANS + '; font-weight:500; font-size:14.5px; color:var(--ink);" class="lower">' + fmtDate(r.period) + '</span>' +
            '<span style="display:inline-flex; align-items:center; gap:4px; background:rgba(61,232,199,0.12); border:1px solid rgba(61,232,199,0.4); border-radius:999px; padding:1px 8px;"><span style="font-family:' + MONO + '; font-weight:700; font-size:8px; letter-spacing:.5px; color:#1fbfa3;">SPLIT ✨</span></span>' +
            '<span style="font-family:' + MONO + '; font-weight:700; font-size:14px; color:rgba(var(--ink-rgb),0.75);">' + app.esc(r.amountFmt || "") + '</span>' +
          '</div>';
      }).join("");
    }
  }

  // ---- register -------------------------------------------------------------
  window.Screens = window.Screens || {};
  window.Screens.subscriptions = {
    title: "subscriptions",
    render: function (view) {
      var user = window.Auth && window.Auth.user;
      if (user) return signedIn(view);
      signedOut(view);
      if (window.Auth && window.Auth.onChange) window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("subscriptions") >= 0) { if (u) signedIn(view); else signedOut(view); }
      });
    },
  };
})();
