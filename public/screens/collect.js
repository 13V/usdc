/* screens/collect.js — Collect / tab collect. Route #/collect/<billId>.
   Matches design/frames/Tab Collect Frames.dc.html (sent → collecting → square).
   Polls the bill so squared statuses + progress fill in live. */
(function () {
  "use strict";
  var app = window.app;

  var POLL_MS = 5000;
  var poll = null; // active interval id, cleared when we leave the screen

  function stopPoll() { if (poll) { clearInterval(poll); poll = null; } }

  // inject the kinetic-gradient keyframe once (not in the shared divvy.css)
  function ensureKeyframes() {
    if (document.getElementById("collectKf")) return;
    var s = document.createElement("style");
    s.id = "collectKf";
    s.textContent = "@keyframes cGrad{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}";
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
    return "🧾";
  }

  function shareUrl(bill) {
    // shareable link to this tab — the pay page handles per-person flows
    var base = location.origin;
    return base + (bill.shareUrl || ("/pay/" + encodeURIComponent(bill.id)));
  }

  function topbar(label) {
    return '<div class="topbar">' +
      '<a class="brand" href="#/home" style="text-decoration:none;color:inherit;">' +
        '<span class="mark"><span>/</span></span><span class="word">divvy</span></a>' +
      '<div class="eyebrow" style="letter-spacing:1.5px;">' + app.esc(label || "collecting") + '</div>' +
    '</div>';
  }

  // status pill — "you" squared = blue; others squared = blue; waiting = faint
  function pill(p, isYou) {
    if (p.paid) {
      return '<span class="pill" style="padding:3px 9px;background:rgba(39,117,202,0.16);' +
        'border-color:rgba(39,117,202,0.5);color:var(--blue-bright);">' +
        '<span style="font-size:11px;">✓</span>' +
        '<span class="mono" style="font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">squared</span></span>';
    }
    return '<span class="pill" style="padding:3px 9px;color:var(--faint);">' +
      '<span style="font-size:10px;">👀</span>' +
      '<span class="mono" style="font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">waiting</span></span>';
  }

  function personRow(p, isYou, nudgeable) {
    if (nudgeable) {
      // highlighted unpaid row with a nudge button (frame 2)
      return '<div class="row" data-nudge="' + app.esc(p.name) + '" style="border:none;' +
          'margin:4px -6px 0;padding:11px 10px;border-radius:14px;' +
          'background:rgba(255,198,92,0.08);box-shadow:inset 0 0 0 1px rgba(255,198,92,0.28);">' +
        app.avatar({ name: p.name }, "sm") +
        '<div class="meta" style="flex:1;min-width:0;">' +
          '<div class="name lower">' + app.esc(p.name) + (isYou ? " (you)" : "") + '</div>' +
          '<div class="sub mono" style="color:rgba(255,198,92,0.85);font-size:9px;">' +
            app.esc(p.amountFmt || "") + ' · still waiting</div>' +
        '</div>' +
        '<button class="btn nudgeBtn" style="width:auto;min-height:0;padding:8px 13px;font-size:13px;' +
          'background:#FFC65C;color:#0B1622;box-shadow:none;">nudge ' + app.esc(p.name) + ' 👀</button>' +
      '</div>';
    }
    return '<div class="row">' +
      app.avatar({ name: p.name }, "sm") +
      '<span class="lower" style="flex:1;font-weight:500;">' + app.esc(p.name) + (isYou ? " (you)" : "") + '</span>' +
      '<span style="' + (p.paid ? "" : "opacity:.6;") + 'font-size:14px;">' + app.money(p.amountCents, p.paid ? "pos" : "") + '</span>' +
      pill(p, isYou) +
    '</div>';
  }

  function progressBlock(squared, total, collectedFmt, totalFmt) {
    var pct = total > 0 ? Math.round((squared / total) * 100) : 0;
    return '<div style="width:100%;margin-top:16px;">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">' +
        '<span class="mono" style="font-size:10px;letter-spacing:1px;color:var(--muted);text-transform:uppercase;">' +
          squared + ' of ' + total + ' squared</span>' +
        '<span class="mono" style="font-size:10px;color:var(--blue-bright);">' +
          app.esc(collectedFmt) + ' / ' + app.esc(totalFmt) + '</span>' +
      '</div>' +
      '<div style="height:8px;border-radius:6px;background:var(--card);overflow:hidden;">' +
        '<div style="width:' + pct + '%;height:100%;border-radius:6px;' +
          'background:linear-gradient(90deg,#2775CA,#3a93e4);transition:width .5s ease;"></div></div>' +
    '</div>';
  }

  // ---- the in-progress screen (frames 1 & 2) ----
  function renderActive(view, bill) {
    var ps = bill.participants || [];
    var total = ps.length;
    var squared = ps.filter(function (p) { return p.paid; }).length;
    var some = squared > 0 && squared < total;
    var eachFmt = ps.length ? (ps[0].amountFmt || "") : "";

    // pick one person to nudge: first unpaid (the highlighted row in frame 2),
    // only once some have already paid
    var nudgeName = null;
    if (some) {
      var u = ps.find(function (p) { return !p.paid; });
      if (u) nudgeName = u.name;
    }

    var rows = ps.map(function (p, i) {
      var isYou = i === 0;
      return personRow(p, isYou, nudgeName !== null && p.name === nudgeName);
    }).join("");

    var receipt =
      '<div class="receipt" style="width:100%;margin:0;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;">' +
          '<div style="display:flex;align-items:center;gap:10px;">' +
            '<span style="font-size:24px;">' + titleEmoji(bill.title) + '</span>' +
            '<span class="lower" style="font-family:var(--mono);font-weight:700;font-size:19px;">' + app.esc(bill.title || "tab") + '</span>' +
          '</div>' +
          '<span style="font-size:24px;">' + app.money(bill.totalCents, "") + '</span>' +
        '</div>' +
        '<div class="mono" style="font-size:10.5px;letter-spacing:.5px;color:var(--faint);margin-top:5px;">' +
          'split ' + total + ' · ' + app.esc(eachFmt) + ' each</div>' +
        '<hr>' +
        '<div style="display:flex;flex-direction:column;">' + rows + '</div>' +
      '</div>';

    var primary, ghost, note;
    if (some) {
      // collecting: ghost re-share + dry "almost there" note
      primary = "";
      ghost = '<button class="btn ghost" id="cShare" style="min-height:52px;">re-share tab</button>';
      note = nudgeName ? "almost there — just " + app.esc(nudgeName) + " left 👀" : "almost there 👀";
    } else {
      primary = '<button class="btn" id="cShare" style="min-height:54px;">share tab</button>';
      ghost = '<button class="btn ghost" id="cCopy" style="min-height:48px;">copy link</button>';
      note = "they'll each get a link — no app needed. dollars, just faster.";
    }

    view.innerHTML = topbar(some ? "collecting" : "tab sent") +
      '<div class="appscroll" style="display:flex;flex-direction:column;align-items:center;padding-top:8px;">' +
        '<div style="margin:6px 0 14px;">' + app.mascot({ size: 96, mood: some ? "watching" : "happy", glow: true }) + '</div>' +
        receipt +
        progressBlock(squared, total, bill.collectedFmt || "$0.00", bill.totalFmt || "$0.00") +
        '<div style="display:flex;flex-direction:column;gap:10px;width:100%;margin-top:22px;">' +
          primary + ghost +
          '<div class="mono" style="font-size:10px;letter-spacing:.3px;color:var(--faint);text-align:center;margin-top:2px;">' +
            note + '</div>' +
        '</div>' +
      '</div>';

    wireShare(view, bill);
    var nb = view.querySelector(".nudgeBtn");
    if (nb) nb.onclick = function (e) {
      e.stopPropagation();
      app.toast("nudge sent 👀");
    };
  }

  // ---- the success screen (frame 3) ----
  function renderDone(view, bill) {
    var ps = bill.participants || [];
    var avatars = ps.map(function (p, i) {
      return '<span style="margin-left:' + (i ? "-9px" : "0") + ';">' + app.avatar({ name: p.name }, "sm") + '</span>';
    }).join("");

    view.innerHTML = topbar("everyone's square ✨") +
      '<div class="appscroll" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:70vh;text-align:center;">' +
        '<div style="margin-bottom:18px;">' + app.mascot({ size: 110, mood: "sparkle", glow: true }) + '</div>' +
        '<div class="receipt glow-blue kinetic" style="width:100%;color:#fff;border:none;text-align:left;' +
            'background:linear-gradient(125deg,#2775CA 0%,#2aa5cf 48%,#3DE8C7 100%);' +
            'background-size:200% 200%;animation:cGrad 6s ease-in-out infinite;">' +
          '<div class="mono" style="font-size:10.5px;letter-spacing:1.5px;color:rgba(255,255,255,0.8);text-transform:uppercase;">' +
            app.esc(bill.title || "tab") + ' ' + titleEmoji(bill.title) + ' · ' + ps.length + ' people</div>' +
          '<h2 class="lower" style="font-size:30px;line-height:1.08;margin:9px 0 0;font-weight:700;">everyone\'s<br>square ✨</h2>' +
          '<div style="display:flex;align-items:baseline;gap:9px;margin-top:18px;">' +
            '<span class="money" style="font-size:50px;color:#fff;">' +
              '<span class="cur" style="opacity:.6;">$</span>' + (bill.totalFmt || "").replace(/^\$/, "") + '</span>' +
            '<span class="mono" style="font-size:11px;color:rgba(255,255,255,0.82);">collected</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;margin-top:18px;">' + avatars +
            '<span class="mono" style="font-size:11px;color:rgba(255,255,255,0.9);margin-left:11px;">all squared · &lt;1 cent fees</span>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:11px;width:100%;margin-top:14px;">' +
          '<button class="btn" id="cShareDone" style="flex:1;min-height:52px;background:linear-gradient(120deg,#3DE8C7,#2aa5cf);color:#0B1622;">share ✨</button>' +
          '<button class="btn ghost" id="cDone" style="flex:1;min-height:52px;">done</button>' +
        '</div>' +
      '</div>';

    var sd = view.querySelector("#cShareDone");
    if (sd) sd.onclick = function () { doShare(bill); };
    var dn = view.querySelector("#cDone");
    if (dn) dn.onclick = function () { app.go("home"); };
  }

  function doShare(bill) {
    var url = shareUrl(bill);
    var txt = "chip in for " + (bill.title || "the tab") + " — " + (bill.totalFmt || "");
    if (navigator.share) {
      navigator.share({ title: "divvy", text: txt, url: url }).catch(function () {});
      return;
    }
    copyLink(url);
  }

  function copyLink(url) {
    var done = function () { app.toast("link copied 📋"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url); done(); });
    } else { fallbackCopy(url); done(); }
  }
  function fallbackCopy(url) {
    try {
      var ta = document.createElement("textarea");
      ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove();
    } catch (_) {}
  }

  function wireShare(view, bill) {
    var s = view.querySelector("#cShare");
    if (s) s.onclick = function () { doShare(bill); };
    var c = view.querySelector("#cCopy");
    if (c) c.onclick = function () { copyLink(shareUrl(bill)); };
  }

  function paint(view, bill) {
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
    for (var i = 0; i < 3; i++) rows += '<div class="skeleton" style="height:54px;margin:8px 0;"></div>';
    view.innerHTML = topbar("collecting") +
      '<div class="appscroll"><div class="skeleton" style="height:96px;width:96px;border-radius:50%;margin:8px auto 18px;"></div>' +
      '<div class="skeleton" style="height:160px;margin:8px 0 16px;"></div>' + rows + '</div>';
  }

  async function load(view, billId, isPoll) {
    var bill;
    try {
      bill = await app.api.get("/api/bills/" + encodeURIComponent(billId));
    } catch (e) {
      stopPoll();
      if (isPoll) return; // a poll hiccup shouldn't blow away the screen
      view.innerHTML = topbar("collecting") +
        '<div class="empty" style="padding-top:60px;">' + app.mascot({ size: 96, mood: "worried" }) +
        '<div class="title lower">couldn\'t find that tab</div>' +
        '<div class="hint">' + app.esc(e.status === 404 ? "it may have expired or never existed." : e.message) + '</div>' +
        '<button class="btn" style="max-width:240px;margin-top:8px;" onclick="location.hash=\'#/home\'">back home</button></div>';
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
        view.innerHTML = topbar("collecting") +
          '<div class="empty" style="padding-top:60px;">' + app.mascot({ size: 96, mood: "sleepy" }) +
          '<div class="title lower">no tab to collect</div>' +
          '<div class="hint">start a tab and we\'ll chase everyone down 👀</div>' +
          '<button class="btn" style="max-width:240px;margin-top:8px;" onclick="location.hash=\'#/new\'">new tab</button></div>';
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
