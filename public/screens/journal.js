/* screens/journal.js — Spending journal: a warm monthly diary spread.
   Route #/journal (this month) or #/journal/2026-07. Fetches
   GET /api/journal/<yyyy-mm> and renders it like a diary entry: month title
   ("july, so far…"), a big warm headline stat, hand-drawn CSS category bars,
   a "mostly with" line, and a taped-in polaroid for the biggest splurge.
   Month picker ‹ › never goes past the current month. Zero guilt, no budgets.
   Journal aesthetic matching home.js / tabs.js. Never crashes. */
(function () {
  "use strict";
  var app = window.app;

  var INKC = "var(--ink)";
  var MONO = "'Space Mono',monospace";
  var SANS = "'General Sans',sans-serif";
  var DISPLAY = "'Clash Display','General Sans',sans-serif";

  var MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  var MONTHS = ["january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"];

  // hand-drawn bar palette per bucket (journal accents, ink-outlined).
  var BUCKET_FILL = {
    food: "rgba(255,198,92,0.75)",     // sunshine
    drinks: "rgba(61,232,199,0.65)",   // mint
    travel: "rgba(39,117,202,0.45)",   // usdc blue wash
    home: "rgba(139,92,246,0.4)",      // lavender
    fun: "rgba(255,107,94,0.55)",      // coral
    other: "rgba(var(--ink-rgb),0.18)",      // pencil
  };

  // ── month math (UTC, matching the server's bucketing) ────────────────────────
  function thisMonth() {
    var d = new Date();
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
  }
  function shiftMonth(m, delta) {
    var y = parseInt(m.slice(0, 4), 10), mo = parseInt(m.slice(5, 7), 10) - 1 + delta;
    var ny = y + Math.floor(mo / 12), nm = ((mo % 12) + 12) % 12;
    return ny + "-" + String(nm + 1).padStart(2, "0");
  }
  function monthName(m) { return MONTHS[parseInt(m.slice(5, 7), 10) - 1]; }
  function diaryTitle(m) {
    if (m === thisMonth()) return monthName(m) + ", so far…";
    var y = m.slice(0, 4), nowY = thisMonth().slice(0, 4);
    return monthName(m) + (y === nowY ? "" : " " + y);
  }

  function money3(cents) {
    var n = Math.abs(cents) / 100, whole = Math.floor(n).toLocaleString(), dec = (n % 1).toFixed(2).slice(1);
    return whole + '<span style="opacity:.5;">' + dec + '</span>';
  }
  function niceDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return monthName(iso.slice(0, 7) || thisMonth()).slice(0, 3) + " " + d.getUTCDate();
  }

  // ── chrome ───────────────────────────────────────────────────────────────────
  function topbar() {
    return '<div style="position:relative; z-index:6; display:flex; align-items:center; gap:12px; height:50px; padding:0 16px; flex:none;">' +
      '<div id="jnBack" role="button" aria-label="back" tabindex="0" style="width:38px; height:38px; border-radius:50%; background:var(--card); border:1px solid rgba(var(--ink-rgb),0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--border-ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></div>' +
      '<span style="font-family:' + MONO + '; font-size:11px; letter-spacing:1.5px; color:rgba(var(--ink-rgb),0.5);">spending journal</span>' +
    '</div>';
  }
  function wireBack() {
    var b = document.getElementById("jnBack");
    if (b) b.onclick = function () { if (history.length > 1) history.back(); else app.go("you"); };
  }

  // month picker: ‹ july, so far… › — next hidden at the current month.
  function pickerHtml(month) {
    var atNow = month >= thisMonth();
    var btn = 'appearance:none; cursor:pointer; width:34px; height:34px; border-radius:50%; background:var(--card); border:2px solid ' + INKC + '; box-shadow:2px 2px 0 rgba(var(--shadow-rgb),0.85); display:flex; align-items:center; justify-content:center; font-family:' + MONO + '; font-weight:700; font-size:15px; color:' + INKC + '; flex:none;';
    return '<div style="display:flex; align-items:center; gap:12px; padding:8px 2px 2px;">' +
      '<button id="jnPrev" aria-label="previous month" style="' + btn + '">‹</button>' +
      '<h1 class="jdoodle" style="flex:1; text-align:center; font-family:' + DISPLAY + '; font-weight:600; font-size:26px; letter-spacing:-0.7px; margin:0; color:' + INKC + '; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(diaryTitle(month)) + '</h1>' +
      (atNow
        ? '<span style="width:34px; flex:none;"></span>'
        : '<button id="jnNext" aria-label="next month" style="' + btn + '">›</button>') +
    '</div>';
  }

  function wirePicker(view, month) {
    var p = document.getElementById("jnPrev"), n = document.getElementById("jnNext");
    if (p) p.onclick = function () { location.hash = "#/journal/" + shiftMonth(month, -1); };
    if (n) n.onclick = function () { location.hash = "#/journal/" + shiftMonth(month, 1); };
  }

  // ── pieces ───────────────────────────────────────────────────────────────────

  // big warm headline: "you spent $214.31" + a friendly "mostly with" line.
  function headlineCard(d) {
    var mostly = "";
    if (d.topGroup && d.topGroup.name) {
      mostly = "mostly with " + d.topGroup.name + (d.topGroup.emoji ? " " + d.topGroup.emoji : "");
    } else if (d.topFriend && d.topFriend.name) {
      mostly = "mostly with " + d.topFriend.name;
    }
    var top = d.buckets && d.buckets.length ? d.buckets[0] : null;
    var doing = top && top.key !== "other" ? "mostly on " + top.label + " " + top.emoji : "";

    var deltaLine = "";
    if (d.prevSpentCents > 0 || d.spentCents > 0) {
      if (d.deltaCents < 0) deltaLine = "that's $" + money3(d.deltaCents) + " less than last month ✨";
      else if (d.deltaCents > 0 && d.prevSpentCents > 0) deltaLine = "$" + money3(d.deltaCents) + " more than last month — big month 💛";
    }

    var chips = "";
    // &nbsp; after money3(): chips are inline-flex, which drops the plain space
    // between the amount's trailing <span> and the text that follows it.
    if (d.frontedCents > 0) chips += chip("you fronted $" + money3(d.frontedCents) + "&nbsp;for friends 💛", "rgba(255,198,92,0.35)", -1);
    if (d.settledCount > 0) chips += chip(d.settledCount + " tab" + (d.settledCount === 1 ? "" : "s") + " settled ✓", "rgba(61,232,199,0.3)", 1);
    if (d.subscriptionsCents > 0) chips += chip("$" + money3(d.subscriptionsCents) + "&nbsp;of it was subscriptions 🔁", "rgba(39,117,202,0.14)", -0.6);

    return '<div style="position:relative; background:var(--card); border:2px solid ' + INKC + '; border-radius:20px; box-shadow:3px 4px 0 rgba(var(--shadow-rgb),0.85); margin-top:16px; padding:18px 18px 16px; transform:rotate(-0.35deg);">' +
      '<div class="jtape" style="top:-12px; left:14%; background:rgba(61,232,199,0.6);"></div>' +
      '<div style="font-family:' + MONO + '; font-size:10px; letter-spacing:1.5px; color:rgba(var(--ink-rgb),0.45);">YOU SPENT</div>' +
      '<div style="display:flex; align-items:baseline; gap:9px; margin-top:9px;">' +
        '<div style="font-family:' + MONO + '; font-weight:700; font-size:46px; line-height:.95; letter-spacing:-2px; color:#2775CA;"><span style="font-size:26px; opacity:.5;">$</span>' + money3(d.spentCents) + '</div>' +
        '<span style="font-family:' + MONO + '; font-size:11px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.5);">your share</span>' +
      '</div>' +
      (mostly || doing
        ? '<div style="font-family:' + SANS + '; font-weight:500; font-size:14.5px; line-height:1.45; color:rgba(var(--ink-rgb),0.75); margin-top:10px;">' + app.esc([doing, mostly].filter(Boolean).join(" · ")) + '</div>'
        : "") +
      (deltaLine ? '<div style="font-family:' + MONO + '; font-size:11px; letter-spacing:.3px; color:rgba(var(--ink-rgb),0.55); margin-top:8px;">' + deltaLine + '</div>' : "") +
      (chips ? '<div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:13px;">' + chips + '</div>' : "") +
    '</div>';
  }

  function chip(html, bg, rot) {
    return '<span style="display:inline-flex; align-items:center; padding:5px 11px; background:' + bg + '; border:1.5px solid ' + INKC + '; border-radius:999px; font-family:' + MONO + '; font-weight:700; font-size:10px; letter-spacing:.3px; color:' + INKC + '; transform:rotate(' + rot + 'deg);">' + html + '</span>';
  }

  // hand-drawn category bars: emoji + label, a wobbly ink-outlined bar, mono $.
  function bucketChart(d) {
    if (!d.buckets || !d.buckets.length) return "";
    var max = d.buckets[0].cents || 1;
    var rows = d.buckets.map(function (b, i) {
      var w = Math.max(8, Math.round((b.cents / max) * 100));
      var rot = (i % 2 === 0 ? -0.5 : 0.6);
      return '<div style="display:flex; align-items:center; gap:10px; padding:7px 0;">' +
        '<span style="width:22px; text-align:center; font-size:15px; flex:none;">' + b.emoji + '</span>' +
        '<span style="width:52px; flex:none; font-family:' + SANS + '; font-weight:500; font-size:13px; color:' + INKC + ';">' + app.esc(b.label) + '</span>' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="width:' + w + '%; height:15px; background:' + (BUCKET_FILL[b.key] || BUCKET_FILL.other) + '; border:2px solid ' + INKC + '; border-radius:5px 999px 999px 5px; box-shadow:2px 2px 0 rgba(var(--shadow-rgb),0.55); transform:rotate(' + rot + 'deg);"></div>' +
        '</div>' +
        '<span style="flex:none; font-family:' + MONO + '; font-weight:700; font-size:12px; color:' + INKC + ';"><span style="opacity:.5;">$</span>' + money3(b.cents) + '</span>' +
      '</div>';
    }).join("");
    return '<div style="background:var(--card); border:2px solid ' + INKC + '; border-radius:18px; box-shadow:3px 4px 0 rgba(var(--shadow-rgb),0.85); margin-top:18px; padding:15px 16px 10px; transform:rotate(0.3deg);">' +
      '<div style="font-family:' + MONO + '; font-size:10px; letter-spacing:1.5px; color:rgba(var(--ink-rgb),0.45); margin-bottom:5px;">WHERE IT WENT</div>' +
      rows +
    '</div>';
  }

  // biggest splurge — a taped-in polaroid, slightly tilted.
  function splurgeCard(d) {
    var b = d.biggest;
    if (!b || !(b.cents > 0)) return "";
    var emoji = "🏆";
    return '<div style="display:flex; justify-content:center; margin-top:24px;">' +
      '<div style="position:relative; width:min(78%, 280px); background:var(--card); border:2px solid ' + INKC + '; border-radius:6px; box-shadow:4px 5px 0 rgba(var(--shadow-rgb),0.85); padding:12px 12px 14px; transform:rotate(1.6deg);">' +
        '<div class="jtape" style="top:-13px; left:50%; transform:translateX(-50%) rotate(-3deg); background:rgba(255,198,92,0.7);"></div>' +
        '<div style="background:linear-gradient(150deg, rgba(39,117,202,0.14), rgba(61,232,199,0.18)); border:1.5px solid rgba(var(--ink-rgb),0.25); border-radius:4px; height:110px; display:flex; align-items:center; justify-content:center; font-size:44px;">' + emoji + '</div>' +
        '<div style="margin-top:11px; text-align:center;">' +
          '<div style="font-family:' + MONO + '; font-size:9px; letter-spacing:1.3px; color:rgba(var(--ink-rgb),0.45);">BIGGEST SPLURGE</div>' +
          '<div style="font-family:' + DISPLAY + '; font-weight:600; font-size:16px; letter-spacing:-0.2px; color:' + INKC + '; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(b.title || "expense") + '</div>' +
          '<div style="font-family:' + MONO + '; font-weight:700; font-size:19px; color:#FF6B5E; margin-top:3px;"><span style="opacity:.5;">$</span>' + money3(b.cents) + '</div>' +
          '<div style="font-family:' + MONO + '; font-size:10px; letter-spacing:.3px; color:rgba(var(--ink-rgb),0.5); margin-top:4px;">' + app.esc([b.where, niceDate(b.at)].filter(Boolean).join(" · ")) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function emptyMonth(month) {
    var now = month === thisMonth();
    return '<div class="empty" style="padding-top:44px;">' +
      app.mascot({ size: 116, mood: "happy" }) +
      '<div class="title lower">a quiet month 🐸</div>' +
      '<div class="hint">' + (now ? "nothing split yet this month — mochi approves of the peace." : "no spending journaled in " + app.esc(monthName(month)) + ".") + '</div>' +
    '</div>';
  }

  function footerNote() {
    return '<div style="text-align:center; font-family:' + MONO + '; font-size:9.5px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.35); margin-top:26px;">just a journal, not a judgment ✍️</div>';
  }

  // ── render ───────────────────────────────────────────────────────────────────
  function skeleton(view, month) {
    view.innerHTML = '<div class="vfill">' + topbar() +
      '<div class="appscroll" style="padding-top:2px;">' + pickerHtml(month) +
        '<div class="skeleton" style="height:150px; margin-top:16px; border-radius:20px;"></div>' +
        '<div class="skeleton" style="height:190px; margin-top:18px; border-radius:18px;"></div>' +
      '</div></div>';
    wireBack();
    wirePicker(view, month);
  }

  function signedOut(view) {
    view.innerHTML = '<div class="vfill">' + topbar() +
      '<div class="empty" style="padding-top:60px;">' +
        app.mascot({ size: 120, mood: "wave" }) +
        '<div class="title lower">sign in to read your journal</div>' +
        '<div class="hint">your monthly spending story lives behind your account.</div>' +
        '<button class="btn" id="jnSignIn" style="max-width:280px;margin-top:8px;">sign in</button>' +
      '</div></div>';
    wireBack();
    var b = document.getElementById("jnSignIn");
    if (b) b.onclick = function () { app.signIn(); };
  }

  async function signedIn(view, month) {
    skeleton(view, month);
    var d = null;
    try {
      d = await app.api.get("/api/journal/" + encodeURIComponent(month));
    } catch (_) { /* fall through to the quiet-month state */ }

    var hasStuff = d && ((d.spentCents > 0) || (d.frontedCents > 0) || (d.itemCount > 0));
    var body = hasStuff
      ? headlineCard(d) + bucketChart(d) + splurgeCard(d) + footerNote()
      : emptyMonth(month);

    view.innerHTML = '<div class="vfill">' + topbar() +
      '<div class="appscroll" style="padding-top:2px;">' + pickerHtml(month) + body + '</div></div>';
    wireBack();
    wirePicker(view, month);
    if (app.enter) app.enter(view.querySelector(".appscroll"));
  }

  window.Screens = window.Screens || {};
  window.Screens.journal = {
    title: "journal",
    render: function (view, params) {
      var m = params && params[0];
      var month = (typeof m === "string" && MONTH_RE.test(m) && m <= thisMonth()) ? m : thisMonth();
      var user = window.Auth && window.Auth.user;
      if (user) return signedIn(view, month);
      signedOut(view);
      if (window.Auth && window.Auth.onChange) window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("journal") >= 0) { if (u) signedIn(view, month); else signedOut(view); }
      });
    },
  };
})();
