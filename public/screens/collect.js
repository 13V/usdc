/* screens/collect.js — Collect / tab collect. Route #/collect/<billId>.
   Built by lifting the EXACT inline-styled markup from
   design/handoff/Tab Collect Frames.dc.html (frame 1 · tab sent → frame 2 ·
   collecting → frame 3 · everyone's square ✨) and wiring live bill data into it.
   Keeps the GET /api/bills/:id load + the POST .../verify poll that flips
   per-person statuses + progress live. lowercase, plain dollars, never crash. */
(function () {
  "use strict";
  var app = window.app;

  var POLL_MS = 5000;
  var poll = null; // active interval id, cleared when we leave the screen
  var celebratedId = null; // bill we've already fired the win-confetti for

  function stopPoll() { if (poll) { clearInterval(poll); poll = null; } }

  // inject the frame keyframes once (mascot + kinetic gradient + nudge wiggle)
  function ensureKeyframes() {
    if (document.getElementById("collectKf")) return;
    var s = document.createElement("style");
    s.id = "collectKf";
    s.textContent = [
      "@keyframes tcFloat{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-6px) rotate(3deg)}}",
      "@keyframes tcGrad{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}",
      "@keyframes tcNudge{0%,100%{transform:rotate(0deg)}20%{transform:rotate(-9deg)}40%{transform:rotate(9deg)}60%{transform:rotate(-5deg)}80%{transform:rotate(5deg)}}",
      "@keyframes tcSpark{0%,100%{transform:scale(.7);opacity:.3}50%{transform:scale(1.1);opacity:1}}",
      "@keyframes tcStamp{0%{transform:rotate(-11deg) scale(1.7);opacity:0}55%{opacity:1}100%{transform:rotate(-11deg) scale(1);opacity:1}}",
      "@keyframes tcConfetti{0%{transform:translateY(-12px) rotate(0deg);opacity:0}15%{opacity:1}100%{transform:translateY(80px) rotate(220deg);opacity:0}}",
    ].join("");
    document.head.appendChild(s);
  }

  // pick a title emoji from the bill title (dry heuristic; never blank)
  function titleEmoji(title) {
    var t = (title || "").toLowerCase();
    var map = [
      ["coffee", "☕"], ["brunch", "🥞"], ["breakfast", "🥞"], ["lunch", "🥗"],
      ["dinner", "🍜"], ["pizza", "🍕"], ["taco", "🌮"], ["sushi", "🍣"],
      ["bar", "🍻"], ["beer", "🍻"], ["drink", "🍸"], ["wine", "🍷"],
      ["grocer", "🛒"], ["uber", "🚕"], ["cab", "🚕"], ["ride", "🚕"],
      ["trip", "✈️"], ["flight", "✈️"], ["hotel", "🏨"], ["rent", "🏠"],
      ["movie", "🎬"], ["concert", "🎟️"], ["gift", "🎁"], ["birthday", "🎂"],
      ["game", "🎮"], ["gas", "⛽"],
    ];
    for (var i = 0; i < map.length; i++) if (t.indexOf(map[i][0]) >= 0) return map[i][1];
    return "🍜";
  }

  function shareUrl(bill) {
    // shareable link to this tab — the pay page handles per-person flows
    var base = location.origin;
    return base + (bill.shareUrl || ("/pay/" + encodeURIComponent(bill.id)));
  }

  // ---- shared chrome lifted verbatim from each frame ----
  // The app shell (index.html) already renders the device status bar, so the
  // per-screen one is dropped to avoid a duplicate 9:41.
  function statusbar() { return ""; }

  // Title strip with a close button (top-left) so this screen is never a
  // dead-end after a tab is sent.
  function titleStrip(label) {
    return '<div style="position:relative; z-index:3; display:flex; align-items:center; justify-content:center; height:48px; flex:none; padding:6px 16px 0;">' +
      '<div onclick="window.app.go(\'home\')" role="button" aria-label="close" tabindex="0" style="position:absolute; left:16px; top:6px; width:34px; height:34px; border-radius:50%; background:rgba(var(--ink-rgb),0.05); border:1px solid rgba(var(--ink-rgb),0.08); display:flex; align-items:center; justify-content:center; cursor:pointer;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--ink-rgb),0.6)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></div>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:1.5px; color:rgba(var(--ink-rgb),0.5);">' + app.esc(label) + '</span>' +
    '</div>';
  }

  // canvas texture + accent glow lifted from the frame backdrop
  function backdrop(glowOpacity) {
    return '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 50% 20%, rgba(var(--ink-rgb),0.024) 0 1px, transparent 1px 8px); opacity:.6; pointer-events:none;"></div>' +
      '<div style="position:absolute; left:50%; top:40px; width:440px; height:380px; transform:translateX(-50%); border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,' + glowOpacity + ') 0%, rgba(39,117,202,0) 60%); pointer-events:none;"></div>';
  }

  // status pill — squared (blue, ✓) vs waiting (faint, 👀) — lifted verbatim
  function statusPill(paid) {
    if (paid) {
      return '<span style="display:inline-flex; align-items:center; gap:4px; background:rgba(39,117,202,0.16); border:1px solid rgba(39,117,202,0.5); border-radius:999px; padding:3px 9px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#2775CA" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:#2775CA;">SQUARED</span></span>';
    }
    return '<span style="display:inline-flex; align-items:center; gap:4px; border:1px solid rgba(var(--ink-rgb),0.16); border-radius:999px; padding:3px 9px;"><span style="font-size:10px;">👀</span><span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.6);">WAITING</span></span>';
  }

  // a soft per-person avatar gradient (the frame uses warm/cool gradient tiles)
  var AV_GRADS = [
    "linear-gradient(150deg,#FFC65C,#FF6B5E)",
    "linear-gradient(150deg,#2775CA,#2775CA)",
    "linear-gradient(150deg,#FFC65C,#FFB23E)",
    "linear-gradient(150deg,#3DE8C7,#2775CA)",
    "linear-gradient(150deg,#8B5CF6,#2775CA)",
    "linear-gradient(150deg,#3a8fe0,#1f5da3)",
  ];
  function avGrad(i) { return AV_GRADS[i % AV_GRADS.length]; }
  function avFace(p, i) {
    return p.emoji || (p.name ? p.name.trim()[0].toLowerCase() : "🙂");
  }

  // a normal (non-highlighted) person row, lifted verbatim — squared rows are
  // full opacity, waiting rows dim to .5 in frame 1 (mirrors "tab sent")
  // Short "what they had" line from the itemized breakdown, e.g. "fries · wine".
  // Cheap: at most a handful of items, truncated. Empty when the bill wasn't
  // itemized or this person had nothing specifically assigned.
  function itemsLine(bill, name) {
    var items = bill && bill.items;
    if (!items || !items.length) return "";
    var mine = [];
    for (var k = 0; k < items.length && mine.length < 4; k++) {
      var it = items[k];
      if (it && it.names && it.names.indexOf(name) >= 0) mine.push(it.label);
    }
    if (!mine.length) return "";
    return '<div style="font-family:\'Space Mono\',monospace; font-size:9.5px; letter-spacing:.2px; color:rgba(var(--ink-rgb),0.42); margin-top:2px;">' + app.esc(mine.join(" · ")) + '</div>';
  }

  function personRow(p, i, isYou, dimWaiting, bill) {
    var amtCol = p.paid ? "#2775CA" : "rgba(var(--ink-rgb),0.6)";
    var dim = (dimWaiting && !p.paid) ? " opacity:.5;" : "";
    var sub = itemsLine(bill, p.name);
    return '<div style="display:flex; align-items:center; gap:11px; padding:9px 4px;' + dim + '">' +
      '<div style="width:34px; height:34px; border-radius:50%; background:' + avGrad(i) + '; display:flex; align-items:center; justify-content:center; font-size:17px; flex:none;">' + app.face(avFace(p, i)) + '</div>' +
      '<div style="flex:1; min-width:0;"><span style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:var(--ink);">' + app.esc(p.name) + (isYou ? " (you)" : "") + '</span>' + sub + '</div>' +
      '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:14px; color:' + amtCol + ';">' + app.esc(p.amountFmt || "") + '</span>' +
      statusPill(p.paid) +
    '</div>';
  }

  // the highlighted unpaid row with a nudge button (frame 2 · "ava") — verbatim.
  // The nudge targets this specific person by INDEX (data-nudge-idx), so two
  // people sharing a display name don't get conflated (dup-name bug).
  function nudgeRow(p, i) {
    return '<div style="display:flex; align-items:center; gap:11px; padding:11px 10px; margin:4px -6px 0; border-radius:14px; background:rgba(255,198,92,0.08); border:1px solid rgba(255,198,92,0.28);">' +
      '<div style="width:34px; height:34px; border-radius:50%; background:' + avGrad(i) + '; display:flex; align-items:center; justify-content:center; font-size:17px; flex:none;">' + app.face(avFace(p, i)) + '</div>' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:var(--ink);">' + app.esc(p.name) + '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:.3px; color:rgba(255,198,92,0.85); margin-top:1px;">' + app.esc(p.amountFmt || "") + ' · still waiting</div>' +
      '</div>' +
      '<button class="tcNudge" data-nudge-idx="' + i + '" style="appearance:none; cursor:pointer; display:inline-flex; align-items:center; gap:5px; background:#FFC65C; border:none; border-radius:999px; padding:8px 13px;">' +
        '<span style="font-size:11px; animation:tcNudge 2.2s ease-in-out infinite;">👀</span>' +
        '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:13px; color:var(--ink);">nudge ' + app.esc(p.name) + '</span>' +
      '</button>' +
    '</div>';
  }

  // the receipt card (header + perforation + member rows) — lifted verbatim
  function receiptCard(bill, ps, eachFmt, rowsHtml) {
    return '<div style="position:relative; width:100%; background:var(--card); border-radius:22px; border:2px solid var(--border-ink); box-shadow:3px 4px 0 rgba(var(--shadow-rgb),0.85); overflow:hidden;">' +
      '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 90% 5%, rgba(255,255,255,0.04) 0 1px, transparent 1px 8px); opacity:.7; pointer-events:none;"></div>' +
      '<div style="position:relative; padding:18px 18px 6px;">' +
        '<div style="display:flex; align-items:center; justify-content:space-between;">' +
          '<div style="display:flex; align-items:center; gap:10px;">' +
            '<span style="font-size:24px;">' + titleEmoji(bill.title) + '</span>' +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:19px; color:var(--ink);">' + app.esc((bill.title || "tab").toLowerCase()) + '</span>' +
          '</div>' +
          '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:24px; letter-spacing:-1px; color:var(--ink);">' + money(bill.totalCents, 15) + '</span>' +
        '</div>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10.5px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.45); margin-top:5px;">split ' + ps.length + ' · ' + app.esc(eachFmt) + ' each</div>' +
      '</div>' +
      '<div style="position:relative; height:1px; margin:12px 0; border-top:1.5px dashed rgba(var(--ink-rgb),0.14);">' +
        '<div style="position:absolute; left:-9px; top:-9px; width:18px; height:18px; border-radius:50%; background:var(--paper);"></div>' +
        '<div style="position:absolute; right:-9px; top:-9px; width:18px; height:18px; border-radius:50%; background:var(--paper);"></div>' +
      '</div>' +
      '<div style="position:relative; padding:2px 14px 14px; display:flex; flex-direction:column;">' + rowsHtml + '</div>' +
    '</div>';
  }

  // big mono money with smaller/lighter $ + decimals (lifted style; sizes given)
  function money(cents, smallPx) {
    var n = Math.abs(cents) / 100;
    var whole = Math.floor(n).toLocaleString();
    var dec = (n % 1).toFixed(2).slice(1); // ".00"
    return '<span style="font-size:' + smallPx + 'px; opacity:.6;">$</span>' + whole +
      '<span style="font-size:' + smallPx + 'px; opacity:.6;">' + dec + '</span>';
  }

  // progress block (label + mono $X / $Y + filled bar) — lifted verbatim
  function progressBlock(squared, total, collectedFmt, totalFmt) {
    var pct = total > 0 ? Math.round((squared / total) * 100) : 0;
    return '<div style="width:100%; margin-top:16px;">' +
      '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">' +
        '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1px; color:rgba(var(--ink-rgb),0.5);">' + squared + ' OF ' + total + ' SQUARED</span>' +
        '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:#2775CA;">' + app.esc(collectedFmt) + ' / ' + app.esc(totalFmt) + '</span>' +
      '</div>' +
      '<div style="height:8px; border-radius:6px; background:var(--card); overflow:hidden;"><div style="width:' + pct + '%; height:100%; background:linear-gradient(90deg,#2775CA,#3a93e4); border-radius:6px; transition:width .5s ease;"></div></div>' +
    '</div>';
  }

  // shared phone frame wrapper (390-wide column inside #view)
  function phone(inner, glowOpacity) {
    return '<div class="vfill" style="position:relative; display:flex; flex-direction:column; background:var(--paper); color:var(--ink); font-family:\'General Sans\',sans-serif; -webkit-font-smoothing:antialiased; overflow:hidden;">' +
      backdrop(glowOpacity) + inner + '</div>';
  }

  // ---- the in-progress screen (frames 1 & 2) ----
  function renderActive(view, bill) {
    var ps = bill.participants || [];
    var total = ps.length;
    var squared = ps.filter(function (p) { return p.paid; }).length;
    var some = squared > 0 && squared < total; // "collecting" (frame 2) vs "tab sent" (frame 1)
    var eachFmt = ps.length ? (ps[0].amountFmt || "") : (bill.totalFmt || "");

    // pick one person to nudge: first unpaid (the highlighted row in frame 2),
    // only once some have already paid. Track by INDEX so a duplicate display
    // name doesn't make us highlight (or nudge) the wrong person.
    var nudgeIdx = -1;
    var nudgeName = null;
    if (some) {
      for (var k = 0; k < ps.length; k++) {
        if (!ps[k].paid) { nudgeIdx = k; nudgeName = ps[k].name; break; }
      }
    }

    var rows = ps.map(function (p, i) {
      var isYou = i === 0;
      if (some && i === nudgeIdx) return nudgeRow(p, i);
      return personRow(p, i, isYou, !some, bill); // frame 1 dims waiting rows; frame 2 doesn't
    }).join("");

    // actions differ: tab sent → share + copy; collecting → re-share + dry note
    var actions;
    if (some) {
      actions =
        '<div style="width:100%; display:flex; flex-direction:column; gap:10px; margin-top:16px;">' +
          '<button class="tcShare" style="appearance:none; cursor:pointer; width:100%; min-height:52px; border-radius:999px; background:transparent; border:1px solid rgba(var(--ink-rgb),0.16); display:flex; align-items:center; justify-content:center; gap:8px; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:var(--ink);">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>' +
            're-share tab' +
          '</button>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(var(--ink-rgb),0.36); text-align:center;">' +
            (nudgeName ? 'almost there — just ' + app.esc(nudgeName) + ' left 👀' : 'almost there 👀') +
          '</div>' +
        '</div>';
    } else {
      actions =
        '<div style="width:100%; display:flex; flex-direction:column; gap:10px; margin-top:16px;">' +
          '<button class="tcShare" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:54px; border-radius:999px; background:#2775CA; border:2px solid var(--border-ink); display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:3px 3px 0 rgba(var(--shadow-rgb),0.9);">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>' +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#fff;">share tab</span>' +
          '</button>' +
          '<button class="tcCopy" style="appearance:none; cursor:pointer; width:100%; min-height:48px; border-radius:999px; background:transparent; border:1px solid rgba(var(--ink-rgb),0.16); display:flex; align-items:center; justify-content:center; gap:8px; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:var(--ink);">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>' +
            'copy link' +
          '</button>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(var(--ink-rgb),0.36); text-align:center; margin-top:2px;">they\'ll each get a link — no app needed. dollars, just faster.</div>' +
        '</div>';
    }

    var inner = statusbar() + titleStrip(some ? "collecting" : "tab sent") +
      '<div style="position:relative; z-index:2; flex:1; display:flex; flex-direction:column; align-items:center; padding:4px 22px 28px;">' +
        '<div style="margin-bottom:6px;">' + app.mascot({ size: 92, mood: some ? "watching" : "happy", glow: true }) + '</div>' +
        receiptCard(bill, ps, eachFmt, rows) +
        progressBlock(squared, total, bill.collectedFmt || "$0.00", bill.totalFmt || "$0.00") +
        '<div style="flex:1; min-height:18px;"></div>' +
        actions +
      '</div>';

    view.innerHTML = phone(inner, some ? "0.18" : "0.16");

    wireShare(view, bill);
    var nb = view.querySelector(".tcNudge");
    if (nb) nb.onclick = function (e) {
      e.stopPropagation();
      // target the specific unpaid person by index (dup-name safe), and copy
      // their pay link so the nudge is actually actionable.
      var idx = parseInt(nb.getAttribute("data-nudge-idx"), 10);
      var person = (!isNaN(idx) && ps[idx]) ? ps[idx] : null;
      var who = person ? person.name : "them";
      app.copy(shareUrl(bill)).then(function () {
        app.toast("link copied — nudge " + who + " 👀");
      }, function () {
        app.toast("nudge " + who + " 👀");
      });
    };
  }

  // ---- the success screen (frame 3 · everyone's square ✨) ----
  function renderDone(view, bill) {
    var ps = bill.participants || [];
    var n = ps.length;
    var avatars = ps.map(function (p, i) {
      return '<div style="width:32px; height:32px; border-radius:50%; background:' + avGrad(i) + '; border:2px solid #2aa0d0;' + (i ? " margin-left:-9px;" : "") + ' display:flex; align-items:center; justify-content:center; font-size:15px;">' + app.face(avFace(p, i)) + '</div>';
    }).join("");

    var confetti =
      '<div style="position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:1;">' +
        '<div style="position:absolute; left:14%; top:24%; width:8px; height:12px; border-radius:2px; background:#3DE8C7; animation:tcConfetti 2.6s ease-in .0s infinite;"></div>' +
        '<div style="position:absolute; left:30%; top:18%; width:7px; height:7px; border-radius:50%; background:#FFC65C; animation:tcConfetti 2.9s ease-in .5s infinite;"></div>' +
        '<div style="position:absolute; left:48%; top:22%; width:8px; height:12px; border-radius:2px; background:#2775CA; animation:tcConfetti 2.4s ease-in .9s infinite;"></div>' +
        '<div style="position:absolute; left:64%; top:17%; width:7px; height:7px; border-radius:50%; background:#FF6B5E; animation:tcConfetti 3.0s ease-in .3s infinite;"></div>' +
        '<div style="position:absolute; left:80%; top:25%; width:8px; height:12px; border-radius:2px; background:#3DE8C7; animation:tcConfetti 2.7s ease-in 1.2s infinite;"></div>' +
        '<div style="position:absolute; left:22%; top:30%; width:7px; height:7px; border-radius:50%; background:#2775CA; animation:tcConfetti 2.5s ease-in 1.5s infinite;"></div>' +
        '<div style="position:absolute; left:72%; top:30%; width:7px; height:7px; border-radius:50%; background:#FFC65C; animation:tcConfetti 2.8s ease-in .7s infinite;"></div>' +
      '</div>';

    var inner = confetti + statusbar() +
      '<div style="position:relative; z-index:2; flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:0 24px 40px;">' +
        '<div style="margin-bottom:6px;">' + app.mascot({ size: 104, mood: "sparkle", glow: true }) + '</div>' +
        // share card — the reserved kinetic blue→mint gradient (settle/success)
        '<div style="position:relative; width:100%; border-radius:24px; padding:28px 24px 24px; overflow:hidden; background:linear-gradient(125deg,#2775CA 0%,#2aa5cf 48%,#3DE8C7 100%); background-size:200% 200%; animation:tcGrad 6s ease-in-out infinite; box-shadow:3px 3px 0 rgba(var(--shadow-rgb),0.9);">' +
          '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 85% 6%, rgba(255,255,255,0.10) 0 1px, transparent 1px 9px); opacity:.55; pointer-events:none;"></div>' +
          '<div style="position:absolute; top:20px; right:18px; transform:rotate(-11deg); animation:tcStamp .6s ease-out .15s both;">' +
            '<span style="display:inline-flex; align-items:center; gap:5px; border:2px dashed rgba(255,255,255,0.85); border-radius:999px; padding:5px 11px;"><span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:12px; letter-spacing:1px; color:#fff;">ALL IN</span><span style="font-size:12px;">✨</span></span>' +
          '</div>' +
          '<div style="position:relative;">' +
            '<span style="font-family:\'Space Mono\',monospace; font-size:10.5px; letter-spacing:1.5px; color:rgba(255,255,255,0.8);">' + app.esc((bill.title || "tab").toUpperCase()) + ' ' + titleEmoji(bill.title) + ' · ' + n + ' PEOPLE</span>' +
            '<h2 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:30px; line-height:1.08; letter-spacing:-0.6px; margin:9px 0 0; color:#fff;">everyone\'s<br>square ✨</h2>' +
            '<div style="display:flex; align-items:baseline; gap:9px; margin-top:18px;">' +
              '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:50px; line-height:1; letter-spacing:-2px; color:#fff; text-shadow:none;">' + money(bill.totalCents, 27) + '</div>' +
              '<span style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.5px; color:rgba(255,255,255,0.82);">collected</span>' +
            '</div>' +
            '<div style="display:flex; align-items:center; gap:0; margin-top:18px;">' + avatars +
              '<span style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.3px; color:rgba(255,255,255,0.9); margin-left:11px;">all squared · &lt;1 cent fees</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex; gap:11px; width:100%; margin-top:14px;">' +
          '<button class="tcShareDone" style="appearance:none; border:none; cursor:pointer; flex:1; min-height:52px; border-radius:999px; background:linear-gradient(120deg,#3DE8C7,#2aa5cf); display:flex; align-items:center; justify-content:center; gap:7px; box-shadow:3px 3px 0 rgba(var(--shadow-rgb),0.9);">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--border-ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5"/></svg>' +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:var(--ink);">share ✨</span>' +
          '</button>' +
          '<button class="tcDone" style="appearance:none; cursor:pointer; flex:1; min-height:52px; border-radius:999px; background:var(--card); border:1px solid rgba(var(--ink-rgb),0.1); font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:var(--ink);">done</button>' +
        '</div>' +
      '</div>';

    // success glow is centered/larger; reuse phone() backdrop then add the warm halo
    view.innerHTML = '<div class="vfill" style="position:relative; display:flex; flex-direction:column; background:var(--paper); color:var(--ink); font-family:\'General Sans\',sans-serif; -webkit-font-smoothing:antialiased; overflow:hidden;">' +
      '<div style="position:absolute; left:50%; top:42%; width:480px; height:480px; transform:translate(-50%,-50%); border-radius:50%; background:radial-gradient(circle, rgba(61,232,199,0.20) 0%, rgba(39,117,202,0.13) 40%, rgba(39,117,202,0) 70%); pointer-events:none;"></div>' +
      inner + '</div>';

    var sd = view.querySelector(".tcShareDone");
    if (sd) sd.onclick = function () { doShare(bill); };
    var dn = view.querySelector(".tcDone");
    if (dn) dn.onclick = function () { app.go("home"); };
    if (app.celebrate && celebratedId !== bill.id) { // everyone's-square confetti (once per bill)
      celebratedId = bill.id;
      app.celebrate({ coins: true });
    }
  }

  function doShare(bill) {
    var url = shareUrl(bill);
    var txt = "chip in for " + ((bill.title || "the tab").toLowerCase()) + " — " + (bill.totalFmt || "");
    // Native share (Capacitor) → Web Share API → clipboard, via the app shim.
    if (app.share) { app.share({ title: "divvy", text: txt, url: url }); return; }
    if (navigator.share) { navigator.share({ title: "divvy", text: txt, url: url }).catch(function () {}); return; }
    copyLink(url);
  }

  function copyLink(url) {
    app.copy(url).then(function () { app.toast("link copied 📋"); },
      function () { app.toast("link copied 📋"); });
  }

  function wireShare(view, bill) {
    var s = view.querySelector(".tcShare");
    if (s) s.onclick = function () { doShare(bill); };
    var c = view.querySelector(".tcCopy");
    if (c) c.onclick = function () { copyLink(shareUrl(bill)); };
  }

  // Live collect drama: when the poll sees someone new flip to paid, thunk the
  // haptics, toast their name, and pop a mini coin burst. First paint of a bill
  // baselines silently so opening the screen never false-fires.
  var paidMap = {}; // billId -> "0,2,3" (indexes already seen as paid)
  function trackPays(bill) {
    var ps = bill.participants || [];
    var now = [];
    for (var i = 0; i < ps.length; i++) if (ps[i].paid) now.push(i);
    var key = now.join(",");
    var prev = paidMap[bill.id];
    paidMap[bill.id] = key;
    if (prev === undefined || prev === key) return;
    var seen = {};
    prev.split(",").forEach(function (x) { if (x !== "") seen[x] = 1; });
    var fresh = [];
    for (var j = 0; j < now.length; j++) if (!seen[now[j]]) fresh.push(ps[now[j]]);
    if (!fresh.length) return;
    app.haptic([18, 30, 44]);
    if (app.sound) app.sound("paid");
    app.toast(app.esc(fresh[0].name || "someone") + (fresh.length > 1 ? " +" + (fresh.length - 1) : "") + " squared up 🎉");
    if (app.celebrate && !bill.settled) app.celebrate({ count: 44, coins: true, y: window.innerHeight * 0.42 });
  }

  function paint(view, bill) {
    trackPays(bill);
    if (bill.settled || (bill.participants && bill.participants.length &&
        bill.participants.every(function (p) { return p.paid; }))) {
      stopPoll();
      renderDone(view, bill);
    } else {
      renderActive(view, bill);
    }
  }

  function onScreen(billId) {
    var h = location.hash || "";
    return h.indexOf("collect") >= 0 && h.indexOf(billId) >= 0;
  }

  function skeleton(view) {
    var rows = "";
    for (var i = 0; i < 3; i++) rows += '<div class="skeleton" style="height:54px;margin:8px 0;border-radius:14px;"></div>';
    var inner = statusbar() + titleStrip("collecting") +
      '<div style="position:relative; z-index:2; padding:4px 22px 28px;">' +
        '<div class="skeleton" style="height:92px;width:92px;border-radius:50%;margin:8px auto 18px;"></div>' +
        '<div class="skeleton" style="height:200px;margin:8px 0 16px;border-radius:22px;"></div>' + rows +
      '</div>';
    view.innerHTML = phone(inner, "0.16");
  }

  async function load(view, billId, isPoll) {
    var bill;
    try {
      bill = await app.api.get("/api/bills/" + encodeURIComponent(billId));
    } catch (e) {
      stopPoll();
      if (isPoll) return; // a poll hiccup shouldn't blow away the screen
      var inner = statusbar() + titleStrip("collecting") +
        '<div style="position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; text-align:center; padding:40px 30px;">' +
          app.mascot({ size: 92, mood: "worried", glow: true }) +
          '<div style="font-family:\'Clash Display\',sans-serif; font-weight:600; font-size:21px; margin-top:6px;">couldn\'t find that tab</div>' +
          '<div style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(var(--ink-rgb),0.6); margin-top:8px;">' + app.esc(e.status === 404 ? "it may have expired or never existed." : e.message) + '</div>' +
          '<button style="appearance:none; border:none; cursor:pointer; max-width:240px; width:100%; min-height:52px; border-radius:999px; margin-top:18px; background:#2775CA; border:2px solid var(--border-ink); color:#fff; font-family:\'Clash Display\',sans-serif; font-weight:600; font-size:16px;" onclick="location.hash=\'#/home\'">back home</button>' +
        '</div>';
      view.innerHTML = phone(inner, "0.16");
      return;
    }
    if (!onScreen(billId)) { stopPoll(); return; } // navigated away mid-fetch
    paint(view, bill);
  }

  function tick(view, billId) {
    // verify against the chain (best effort), then repaint from the result
    app.api.post("/api/bills/" + encodeURIComponent(billId) + "/verify")
      .then(function (bill) {
        if (!onScreen(billId)) { stopPoll(); return; }
        paint(view, bill);
      })
      .catch(function () { load(view, billId, true); });
  }

  window.Screens = window.Screens || {};
  window.Screens.collect = {
    title: "collect",
    render: function (view, params) {
      stopPoll();
      ensureKeyframes();
      var billId = params && params[0];
      if (!billId) {
        var inner = statusbar() + titleStrip("collecting") +
          '<div style="position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; text-align:center; padding:40px 30px;">' +
            app.mascot({ size: 92, mood: "sleepy", glow: true }) +
            '<div style="font-family:\'Clash Display\',sans-serif; font-weight:600; font-size:21px; margin-top:6px;">no tab to collect</div>' +
            '<div style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(var(--ink-rgb),0.6); margin-top:8px;">start a tab and we\'ll chase everyone down 👀</div>' +
            '<button style="appearance:none; border:none; cursor:pointer; max-width:240px; width:100%; min-height:52px; border-radius:999px; margin-top:18px; background:#2775CA; border:2px solid var(--border-ink); color:#fff; font-family:\'Clash Display\',sans-serif; font-weight:600; font-size:16px;" onclick="location.hash=\'#/new\'">new tab</button>' +
          '</div>';
        view.innerHTML = phone(inner, "0.16");
        return;
      }
      skeleton(view);
      load(view, billId, false);
      poll = setInterval(function () {
        if (!onScreen(billId)) { stopPoll(); return; }
        tick(view, billId);
      }, POLL_MS);
    },
  };
})();
