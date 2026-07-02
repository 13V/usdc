/* screens/activity.js — Activity feed.
   Built by LIFTING the EXACT inline-styled markup from
   design/handoff/Activity Frames.dc.html and wiring live data into it, so it
   pixel-matches the approved design (same lift-and-wire pattern as home.js).

   The real GET /api/activity returns an array of
     { type: 'trip_created'|'expense'|'settlement'|'paid', tripId, tripName,
       text, amountFmt?, at }  (see src/activity.ts)
   but we adapt gracefully to richer shapes (emoji/color/signature/reactions/
   people/to) if the API ever grows them. Dry lowercase voice; plain dollars;
   mascot companion only on your own settle / empty state. Never crash.

   The shell (index.html) provides the status bar and the #tabbar (runtime sets
   Activity active), so this screen renders only the header + the state body
   into #view. Three states: feed (default) / loading (shimmer ~1.3s) / empty. */
(function () {
  "use strict";
  var app = window.app;

  // Inject the frame's keyframes once (shimmer sweep + the mascot blob squish/
  // blink/pulse used by the own-settle avatar).
  if (!document.getElementById("divvy-activity-css")) {
    var st = document.createElement("style");
    st.id = "divvy-activity-css";
    st.textContent = [
      "@keyframes acSquish{0%,100%{border-radius:47% 53% 52% 48% / 55% 48% 52% 45%}50%{border-radius:53% 47% 48% 52% / 46% 54% 47% 53%}}",
      "@keyframes acBlink{0%,91%,100%{transform:scaleY(1)}96%{transform:scaleY(0.12)}}",
      "@keyframes acPulse{0%,100%{opacity:.55}50%{opacity:1}}",
      "@keyframes acShimmer{0%{background-position:-260px 0}100%{background-position:260px 0}}",
      "@media (prefers-reduced-motion: reduce){.ac-anim{animation:none!important}}",
    ].join("");
    document.head.appendChild(st);
  }

  // ---- header (lifted: big "activity" 30px Clash + search/filter circles) ----
  function header() {
    var chip = function (path) {
      return '<div style="width:38px; height:38px; border-radius:50%; background:#13212E; ' +
        'border:1px solid rgba(244,247,250,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.75)" ' +
        'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg></div>';
    };
    return '<div style="position:relative; z-index:6; display:flex; align-items:flex-end; ' +
      'justify-content:space-between; padding:6px 20px 14px; flex:none;">' +
      '<h1 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; ' +
      'font-size:30px; letter-spacing:-0.8px; margin:0; color:#F4F7FA;">activity</h1>' +
      '<div style="display:flex; align-items:center; gap:9px;">' +
        chip('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>') +
        chip('<path d="M4 6h16M7 12h10M10 18h4"/>') +
      '</div></div>';
  }

  // faint money texture + the single soft blue glow from the frame.
  function ambient() {
    return '<div style="position:absolute; inset:0; z-index:0; pointer-events:none; ' +
      'background-image:repeating-radial-gradient(circle at 84% 2%, rgba(244,247,250,0.028) 0 1px, transparent 1px 8px); opacity:.6;"></div>' +
      '<div style="position:absolute; left:-40px; top:90px; width:340px; height:300px; border-radius:50%; z-index:0; pointer-events:none; ' +
      'background:radial-gradient(circle, rgba(39,117,202,0.16) 0%, rgba(39,117,202,0) 70%);"></div>';
  }

  // ---- time / day helpers ----
  function ms(at) { var t = new Date(at).getTime(); return isFinite(t) ? t : NaN; }
  function relTime(at) {
    var t = ms(at);
    if (!isFinite(t)) return "";
    var diff = Date.now() - t;
    if (diff < 0) return "now";
    var sec = Math.floor(diff / 1000);
    if (sec < 60) return "now";
    var min = Math.floor(sec / 60);
    if (min < 60) return min + "m";
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h";
    var day = Math.floor(hr / 24);
    if (day < 7) return day + "d";
    try { return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toLowerCase(); }
    catch (_) { return day + "d"; }
  }
  function dayKey(at) {
    var t = ms(at);
    if (!isFinite(t)) return "earlier";
    var d = new Date(t);
    return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
  }
  function dayLabel(at) {
    var t = ms(at);
    if (!isFinite(t)) return "EARLIER";
    var d = new Date(t), today = new Date(), yest = new Date();
    yest.setDate(today.getDate() - 1);
    if (dayKey(d) === dayKey(today)) return "TODAY";
    if (dayKey(d) === dayKey(yest)) return "YESTERDAY";
    try { return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase(); }
    catch (_) { return "EARLIER"; }
  }

  // ---- amount: prefer structured cents; fall back to parsing amountFmt ----
  function centsOf(ev) {
    if (typeof ev.amountCents === "number") return ev.amountCents;
    var f = ev.amountFmt;
    if (typeof f === "string") {
      var neg = /[-−]/.test(f);
      var num = parseFloat(f.replace(/[^0-9.]/g, ""));
      if (isFinite(num)) return Math.round(num * 100) * (neg ? -1 : 1);
    }
    return null;
  }

  // ---- emoji avatars: deterministic per identity (frame uses 🍜🦊🏝️🐢🐯…) --
  var AV_GRADS = [
    "linear-gradient(150deg,#3DE8C7,#2775CA)",
    "linear-gradient(150deg,#7fc0ff,#2775CA)",
    "linear-gradient(150deg,#FFC65C,#FF6B5E)",
    "linear-gradient(150deg,#8B5CF6,#2775CA)",
    "linear-gradient(150deg,#5cf0d4,#3DE8C7 55%,#1fbfa3)",
  ];
  function pickGrad(seed) {
    var h = 0, s = String(seed || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AV_GRADS[h % AV_GRADS.length];
  }
  function tripEmoji(name) {
    var n = (name || "").toLowerCase();
    if (/tokyo|japan|trip|travel|flight/.test(n)) return "🗼";
    if (/apart|rent|house|home|flat/.test(n)) return "🏠";
    if (/bali|beach|island|vacation/.test(n)) return "🏝️";
    if (/groc|market|food|dinner|lunch|eat/.test(n)) return "🍜";
    if (/hotel|stay/.test(n)) return "🏨";
    return "🧾";
  }

  // round emoji-on-gradient avatar (people), matching the frame's 42px circles.
  function personAvatar(seed, emoji, color) {
    var bg = app.esc(color || pickGrad(seed)); // esc: never inject a stored color raw
    return '<div style="width:42px; height:42px; border-radius:50%; background:' + bg + '; ' +
      'display:flex; align-items:center; justify-content:center; font-size:20px; flex:none;">' +
      app.esc(emoji || "🦊") + '</div>';
  }
  // rounded-square emoji tile (a tab/trip), 42px / radius 14, frame-style.
  function tripTile(seed, emoji, tint) {
    var bg = tint || "rgba(255,198,92,0.16)";
    return '<div style="width:42px; height:42px; border-radius:14px; background:' + bg + '; ' +
      'display:flex; align-items:center; justify-content:center; font-size:21px; flex:none;">' +
      app.esc(emoji || tripEmoji(seed)) + '</div>';
  }
  // the canonical mascot, shrunk for your-own-settle rows — same creature as
  // every other screen (was a one-off mini blob before).
  function mascotMini() {
    return '<div style="flex:none; display:flex; align-items:center; justify-content:center;">' +
      (window.Mascot ? window.Mascot.html({ size: 30, mood: "happy", glow: false }) : "") +
    '</div>';
  }

  // ---- right-aligned mono amount: lighter $/decimals, +blue / −coral / grey-settled ----
  function amountHtml(cents, settled) {
    if (cents == null) return "";
    var pos = cents > 0, zero = cents === 0;
    var col = zero ? "rgba(244,247,250,0.5)" : pos ? "#3B92E8" : "#FF6B5E";
    var sign = zero ? "$" : pos ? "+$" : "−$";
    var size = zero ? "15px" : "17px";
    var n = Math.abs(cents) / 100;
    var whole = Math.floor(n).toLocaleString();
    var dec = (n % 1).toFixed(2).slice(1);
    var sopac = zero ? ".6" : ".5";
    return '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:' + size + '; ' +
      'letter-spacing:-0.4px; color:' + col + '; flex:none;">' +
      '<span style="font-size:11px; opacity:' + sopac + ';">' + sign + '</span>' + whole +
      '<span style="font-size:11px; opacity:' + sopac + ';">' + dec + '</span></div>';
  }

  // ---- the mint settled / all-settled tag (pulsing dot), lifted ----
  function settledTag(label) {
    return '<span style="display:inline-flex; align-items:center; gap:4px; background:rgba(61,232,199,0.12); ' +
      'border:1px solid rgba(61,232,199,0.4); border-radius:999px; padding:2px 8px;">' +
      '<span class="ac-anim" style="width:4px; height:4px; border-radius:50%; background:#3DE8C7; box-shadow:0 0 5px rgba(61,232,199,0.9);"></span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:8.5px; letter-spacing:.5px; color:#3DE8C7;">' +
      app.esc(label) + '</span></span>';
  }
  // mono meta line (sep with grey dots) used under one-liners.
  function metaMono(text) {
    return '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; ' +
      'color:rgba(244,247,250,0.42); margin-top:3px;">' + text + '</div>';
  }
  // "view ↗" link → the receipt route when the backend gives us a real
  // signature/reference; otherwise fall back to the relevant settle/group
  // screen rather than pointing at a dead #/receipt/ route.
  function viewLink(sig, fallbackHref) {
    var style = 'font-family:\'Space Mono\',monospace; font-size:10px; color:#7fc0ff; cursor:pointer;';
    var href = sig ? ("#/receipt/" + encodeURIComponent(sig)) : (fallbackHref || "");
    if (href) return '<a href="' + href + '" style="' + style + ' text-decoration:none;">view ↗</a>';
    return '<span style="' + style + '">view ↗</span>';
  }
  // blue "chip in" pill (open requests show this instead of an amount).
  function chipInPill(href) {
    var inner = '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:11px; color:#7fc0ff;">chip in</span>';
    var css = 'display:inline-flex; align-items:center; gap:6px; background:rgba(39,117,202,0.14); ' +
      'border:1px solid rgba(39,117,202,0.45); border-radius:999px; padding:6px 13px; cursor:pointer; flex:none;';
    if (href) return '<a href="' + href + '" style="' + css + ' text-decoration:none;">' + inner + '</a>';
    return '<span style="' + css + '">' + inner + '</span>';
  }
  // reaction chips strip (frame-style), from ev.reactions if present.
  function reactionStrip(rs) {
    if (!rs || typeof rs !== "object") return "";
    var chips = [];
    var push = function (emoji, count) {
      chips.push('<div style="display:inline-flex; align-items:center; gap:4px; background:#13212E; ' +
        'border:1px solid rgba(244,247,250,0.1); border-radius:999px; padding:2px 8px;">' +
        '<span style="font-size:11px;">' + app.esc(emoji) + '</span>' +
        '<span style="font-family:\'Space Mono\',monospace; font-size:9px; color:rgba(244,247,250,0.6);">' +
        app.esc(String(count)) + '</span></div>');
    };
    if (Array.isArray(rs)) rs.forEach(function (r) { if (r && r.emoji) push(r.emoji, r.count != null ? r.count : 1); });
    else Object.keys(rs).forEach(function (k) { push(k, rs[k]); });
    if (!chips.length) return "";
    return '<div style="display:flex; align-items:center; gap:6px; margin-top:8px;">' + chips.join("") + '</div>';
  }

  // ---- turn a raw event into a dry lowercase one-liner + visual hints ----
  // Real API ships English text: Ava added "dinner" / Trip "x" created /
  // Settle-up created / Alex paid Sam. We rewrite to divvy's dry voice.
  function describe(ev) {
    var type = String(ev.type || "").toLowerCase();
    var trip = ev.tripName || "";
    var lc = function (s) { return String(s == null ? "" : s).toLowerCase(); };
    var bold = function (s) { return '<span style="font-weight:600;">' + app.esc(lc(s)) + '</span>'; };
    var isYou = function (s) { return /^(you|me)$/.test(lc(s)); };

    // pull a quoted "title" out of the server text when present.
    var title = ev.title || ev.expenseTitle;
    if (!title && typeof ev.text === "string") {
      var qm = ev.text.match(/"([^"]+)"/);
      if (qm) title = qm[1];
    }
    // pull a leading actor name out of the server text ("Ava added ...").
    var actor = ev.actor || ev.person || ev.from;
    if (!actor && typeof ev.text === "string") {
      var am = ev.text.match(/^([A-Za-z][\w' ]*?) (added|paid|created|joined|chipped|reacted|requested)/);
      if (am) actor = am[1];
    }
    // pull a "paid <to>" target when present.
    var to = ev.to;
    if (!to && typeof ev.text === "string") {
      var tm = ev.text.match(/ paid ([A-Za-z][\w' ]*)$/);
      if (tm) to = tm[1];
    }

    var settled = false, settleLabel = "SETTLED", line, detail, request = false, ownSettle = false;

    if (/expense|bill|add|charge/.test(type)) {
      var who = actor ? lc(actor) : "someone";
      line = (isYou(who) ? "you" : app.esc(who)) + " started " + bold(title || "a tab") + " 🍜";
      detail = trip ? app.esc(lc(trip)) + " · split" : "split";
    } else if (/settl|paid|payment|pay/.test(type)) {
      settled = true;
      var f = actor ? lc(actor) : null, t = to ? lc(to) : null;
      if (f && t && isYou(f)) {
        line = "you squared with " + bold(t) + " ✨";
        ownSettle = true;
        detail = "";
      } else if (f && t && isYou(t)) {
        line = app.esc(lc(f)) + " chipped in 🫡";
        detail = trip ? app.esc(lc(trip)) : "";
      } else if (f) {
        if (isYou(f)) { line = "you squared up ✨"; ownSettle = true; }
        else line = app.esc(lc(f)) + " chipped in 🫡";
        detail = trip ? app.esc(lc(trip)) : "";
      } else {
        // settle-up created at the trip level → the whole crew squared.
        line = bold(trip || "the crew") + " squared ✨";
        settleLabel = "ALL SETTLED";
        detail = ev.memberCount ? ev.memberCount + " people" : "";
      }
    } else if (/request|waiting|owe/.test(type)) {
      request = true;
      line = (actor ? app.esc(lc(actor)) : "someone") + " is waiting on you 👀";
      detail = trip ? app.esc(lc(trip)) : "";
    } else if (/trip|create|new|group/.test(type)) {
      var c = actor && isYou(actor) ? "you" : "someone";
      line = c + " started " + bold(trip || "a group") + " 🎉";
      detail = "new group";
    } else if (/join|member|invite/.test(type)) {
      line = (actor ? bold(actor) : "someone") + " hopped in 👋";
      detail = trip ? app.esc(lc(trip)) : "";
    } else if (/react/.test(type)) {
      line = (actor ? app.esc(lc(actor)) : "someone") + " reacted " +
        app.esc(ev.emoji || "💀") + (title ? " to " + bold(title) : "");
      detail = trip ? app.esc(lc(trip)) : "";
    } else {
      var raw = typeof ev.text === "string" && ev.text.trim() ? ev.text : "something happened";
      line = app.esc(lc(raw)) + " ✨";
      detail = trip ? app.esc(lc(trip)) : "";
    }
    return {
      line: line, detail: detail, settled: settled, settleLabel: settleLabel,
      title: title, actor: actor, to: to, request: request, ownSettle: ownSettle,
    };
  }

  // ---- one feed row (the exact frame row, wired) ----
  function row(ev) {
    var d = describe(ev);
    var cents = centsOf(ev);
    var sig = ev.signature || ev.sig || (ev.receipt && ev.receipt.signature) || ev.reference;

    // avatar: mascot for your own settle, emoji-tile for tab/trip events,
    // emoji-on-gradient circle for a person.
    var avatarHtml;
    if (d.ownSettle) {
      avatarHtml = mascotMini();
    } else if (d.request) {
      avatarHtml = personAvatar(d.actor || ev.tripId, ev.emoji || ev.actorEmoji, ev.color || ev.actorColor);
    } else if (/expense|bill|add|charge|trip|create|new|group|settl|paid/.test(String(ev.type || "").toLowerCase()) && !d.actor) {
      // trip-flavored event with no person → rounded emoji tile.
      var crew = /settl|paid/.test(String(ev.type || "").toLowerCase());
      avatarHtml = tripTile(ev.tripName, ev.emoji || tripEmoji(ev.tripName),
        crew ? "linear-gradient(135deg,#5cf0d4,#3DE8C7 55%,#1fbfa3)" : "rgba(255,198,92,0.16)");
    } else if (d.actor && !d.ownSettle && /expense|bill|add|charge/.test(String(ev.type || "").toLowerCase())) {
      // "you started dinner" → the tab tile, like the frame.
      avatarHtml = tripTile(ev.tripName, ev.emoji || tripEmoji(ev.tripName), "rgba(255,198,92,0.16)");
    } else {
      avatarHtml = personAvatar(d.actor || ev.tripId, ev.emoji || ev.actorEmoji, ev.color || ev.actorColor);
    }

    // sub-row: settled tag + meta + view link (settle) OR plain mono meta.
    var subRow;
    if (d.settled) {
      var bits = [];
      if (d.detail) bits.push(app.esc(d.detail));
      bits.push(app.esc(relTime(ev.at)));
      subRow = '<div style="display:flex; align-items:center; gap:7px; margin-top:3px; flex-wrap:wrap;">' +
        settledTag(d.settleLabel) +
        '<span style="font-family:\'Space Mono\',monospace; font-size:10px; color:rgba(244,247,250,0.42);">' +
        bits.join(" · ") + '</span>' +
        (d.settleLabel === "ALL SETTLED" ? "" : viewLink(sig, ev.tripId ? "#/settle/" + encodeURIComponent(ev.tripId) : "")) +
        '</div>';
    } else {
      var detail = d.detail ? d.detail + " · " : "";
      subRow = metaMono(detail + app.esc(relTime(ev.at)));
    }

    // right side: chip-in pill for requests, reaction emoji for reactions,
    // otherwise the mono amount.
    var right = "";
    if (d.request) {
      right = chipInPill("#/group/" + encodeURIComponent(ev.tripId || ""));
    } else if (/react/.test(String(ev.type || "").toLowerCase())) {
      right = '<div style="font-size:18px; flex:none;">' + app.esc(ev.emoji || "💀") + '</div>';
    } else {
      right = amountHtml(cents, d.settled);
    }

    var reacts = reactionStrip(ev.reactions);
    // settle rows align center; rows with reactions align top (like the frame).
    var align = reacts ? "flex-start" : "center";

    return '<div style="display:flex; align-items:' + align + '; gap:13px; padding:11px 4px;">' +
      avatarHtml +
      '<div style="flex:1; min-width:0;">' +
        '<div style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; color:#F4F7FA;">' + d.line + '</div>' +
        subRow + reacts +
      '</div>' +
      right +
    '</div>';
  }

  // ---- FEED render ----
  function feed(view, items) {
    var html = "", lastDay = null;
    items.forEach(function (ev) {
      if (!ev || typeof ev !== "object") return;
      var k = dayKey(ev.at);
      if (k !== lastDay) {
        if (lastDay !== null) html += '</div>';
        lastDay = k;
        html += '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; ' +
          'color:rgba(244,247,250,0.4); padding:' + (html ? "20px" : "8px") + ' 2px 10px;">' +
          app.esc(dayLabel(ev.at)) + '</div>' +
          '<div style="display:flex; flex-direction:column; gap:3px;">';
      }
      try { html += row(ev); } catch (_) { /* one bad event never sinks the feed */ }
    });
    if (lastDay !== null) html += '</div>';

    view.innerHTML =
      '<div class="vfill" style="position:relative; flex:1; display:flex; flex-direction:column;">' +
        ambient() +
        '<div style="position:relative; z-index:2;">' + header() + '</div>' +
        '<div class="ac-scroll" style="position:relative; z-index:2; padding:2px 18px 104px;">' + html + '</div>' +
      '</div>';
  }

  // ---- LOADING (shimmer skeleton rows, ~1.3s sweep) — lifted from the frame ----
  function skeletonBlock(extra) {
    return 'background:#13212E; background-image:linear-gradient(90deg, transparent 0, rgba(244,247,250,0.10) 50%, transparent 100%); ' +
      'background-size:260px 100%; background-repeat:no-repeat; animation:acShimmer 1.3s ease-in-out infinite; ' + (extra || "");
  }
  function skeletonRow(round, w1, w2) {
    var avStyle = round
      ? 'width:42px; height:42px; border-radius:50%; flex:none; ' + skeletonBlock()
      : 'width:42px; height:42px; border-radius:14px; flex:none; ' + skeletonBlock();
    return '<div style="display:flex; align-items:center; gap:13px;">' +
      '<div class="ac-anim" style="' + avStyle + '"></div>' +
      '<div style="flex:1;">' +
        '<div class="ac-anim" style="height:13px; width:' + w1 + '; border-radius:5px; ' + skeletonBlock() + '"></div>' +
        '<div class="ac-anim" style="height:10px; width:' + w2 + '; border-radius:5px; margin-top:8px; ' + skeletonBlock('') + '"></div>' +
      '</div>' +
      '<div class="ac-anim" style="width:48px; height:16px; border-radius:5px; flex:none; ' + skeletonBlock() + '"></div>' +
    '</div>';
  }
  function loading(view) {
    var body =
      '<div class="ac-anim" style="height:11px; width:54px; border-radius:4px; margin:8px 2px 16px; ' + skeletonBlock() + '"></div>' +
      '<div style="display:flex; flex-direction:column; gap:18px;">' +
        skeletonRow(false, "62%", "40%") +
        skeletonRow(true, "54%", "46%") +
        skeletonRow(false, "58%", "38%") +
        skeletonRow(true, "50%", "44%") +
      '</div>';
    view.innerHTML =
      '<div class="vfill" style="position:relative; flex:1; display:flex; flex-direction:column;">' +
        ambient() +
        '<div style="position:relative; z-index:2;">' + header() + '</div>' +
        '<div style="position:relative; z-index:2; padding:2px 18px 104px;">' + body + '</div>' +
      '</div>';
  }

  // ---- EMPTY (mascot + frame copy) ----
  function emptyState(view) {
    view.innerHTML =
      '<div class="vfill" style="position:relative; flex:1; display:flex; flex-direction:column;">' +
        ambient() +
        '<div style="position:relative; z-index:2;">' + header() + '</div>' +
        '<div style="position:relative; z-index:2; flex:1; display:flex; flex-direction:column; align-items:center; ' +
          'justify-content:center; gap:18px; padding:40px 44px; text-align:center;">' +
          app.mascot({ size: 96, mood: "sleepy", glow: true }) +
          '<div style="font-family:\'General Sans\',sans-serif; font-size:16px; line-height:1.45; color:rgba(244,247,250,0.65);">' +
            'nothing\'s happened yet 🫥<br>start a tab and the feed wakes up</div>' +
          '<button id="acNew" style="appearance:none; border:none; cursor:pointer; min-height:50px; padding:0 26px; ' +
            'border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); ' +
            'font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:15px; color:#fff; ' +
            'box-shadow:0 8px 24px rgba(39,117,202,0.42);">start a tab</button>' +
        '</div>' +
      '</div>';
    var b = document.getElementById("acNew");
    if (b) b.onclick = function () { location.hash = "#/new"; };
  }

  // ---- signed-out (connect wallet) ----
  function signedOut(view) {
    view.innerHTML =
      '<div class="vfill" style="position:relative; flex:1; display:flex; flex-direction:column;">' +
        ambient() +
        '<div style="position:relative; z-index:2;">' + header() + '</div>' +
        '<div style="position:relative; z-index:2; flex:1; display:flex; flex-direction:column; align-items:center; ' +
          'justify-content:center; gap:16px; padding:40px 44px; text-align:center;">' +
          app.mascot({ size: 104, mood: "happy", glow: true }) +
          '<div style="font-family:\'General Sans\',sans-serif; font-size:16px; line-height:1.45; color:rgba(244,247,250,0.65);">' +
            'your feed lives here<br>connect a wallet to see who chipped in 💸</div>' +
          '<button id="acConnect" style="appearance:none; border:none; cursor:pointer; min-height:50px; padding:0 26px; ' +
            'border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); ' +
            'font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:15px; color:#fff; ' +
            'box-shadow:0 8px 24px rgba(39,117,202,0.42);">connect a wallet</button>' +
        '</div>' +
      '</div>';
    var b = document.getElementById("acConnect");
    if (b) b.onclick = function () {
      if (window.Auth) Auth.createWallet().catch(function (e) { app.toast(e.message); });
    };
  }

  function errorState(view, msg) {
    view.innerHTML =
      '<div class="vfill" style="position:relative; flex:1; display:flex; flex-direction:column;">' +
        ambient() +
        '<div style="position:relative; z-index:2;">' + header() + '</div>' +
        '<div style="position:relative; z-index:2; flex:1; display:flex; flex-direction:column; align-items:center; ' +
          'justify-content:center; gap:10px; padding:40px 44px; text-align:center;">' +
          '<div style="font-family:\'General Sans\',sans-serif; font-size:16px; color:rgba(244,247,250,0.65);">couldn\'t load activity</div>' +
          '<div style="font-family:\'Space Mono\',monospace; font-size:11px; color:rgba(244,247,250,0.42);">' +
            app.esc(msg || "try again") + '</div>' +
        '</div>' +
      '</div>';
  }

  // ---- signed-in render ----
  async function signedIn(view) {
    loading(view); // shimmer skeleton while we fetch
    var items;
    try { items = await app.api.get("/api/activity"); }
    catch (e) {
      if (e && e.status === 401) { signedOut(view); return; }
      errorState(view, e && e.message);
      return;
    }
    if (!Array.isArray(items)) items = (items && Array.isArray(items.events)) ? items.events : [];
    if (!items.length) { emptyState(view); return; }
    feed(view, items);
    if (app.enter) app.enter(view.querySelector(".ac-scroll"));
    // pull down at the top to re-pull the feed and re-render.
    app.pullToRefresh(view, function () { return signedIn(view); });
  }

  window.Screens = window.Screens || {};
  window.Screens.activity = {
    title: "activity",
    render: function (view) {
      var user = window.Auth && window.Auth.user;
      if (user) signedIn(view); else signedOut(view);
      if (window.Auth && window.Auth.onChange) window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("activity") >= 0) {
          if (u) signedIn(view); else signedOut(view);
        }
      });
    },
  };
})();
