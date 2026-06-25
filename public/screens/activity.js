/* screens/activity.js — Activity feed. Matches design/frames/Activity Frames.dc.html.
   Reverse-chron timeline grouped by day. The real GET /api/activity returns an
   array of { type, tripId, tripName, text, amountFmt?, at } (see src/activity.ts),
   but we adapt gracefully to richer shapes (emoji/color/signature/reactions/people)
   if the API ever grows them. Dry lowercase voice; money via app.money. Never crash. */
(function () {
  "use strict";
  var app = window.app;

  // ---- header (matches the frame: big "activity" + search/menu chips) ----
  function header() {
    var chip = function (path) {
      return '<div style="width:38px;height:38px;border-radius:50%;background:var(--card);' +
        'border:1px solid var(--line);display:flex;align-items:center;justify-content:center;">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" ' +
        'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg></div>';
    };
    return '<div class="topbar" style="align-items:flex-end;height:auto;padding:6px 20px 14px;">' +
      '<h1 class="display" style="font-size:30px;letter-spacing:-0.8px;">activity</h1>' +
      '<div style="display:flex;gap:9px;">' +
        chip('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>') +
        chip('<path d="M4 6h16M7 12h10M10 18h4"/>') +
      '</div></div>';
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
    if (!isFinite(t)) return "earlier";
    var d = new Date(t), today = new Date(), yest = new Date();
    yest.setDate(today.getDate() - 1);
    if (dayKey(d) === dayKey(today)) return "today";
    if (dayKey(d) === dayKey(yest)) return "yesterday";
    try { return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toLowerCase(); }
    catch (_) { return "earlier"; }
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

  // ---- turn a raw event into a dry lowercase one-liner + visual hints ----
  // The real API ships English text like: Ava added "dinner" / Trip "x" created /
  // Settle-up created / Alex paid Sam. We rewrite to divvy's dry voice.
  function describe(ev) {
    var type = String(ev.type || "").toLowerCase();
    var trip = ev.tripName || "";
    var lc = function (s) { return String(s == null ? "" : s).toLowerCase(); };

    // pull a quoted "title" out of the server text when present
    var title = ev.title || ev.expenseTitle;
    if (!title && typeof ev.text === "string") {
      var m = ev.text.match(/"([^"]+)"/);
      if (m) title = m[1];
    }
    // pull a leading actor name out of the server text ("Ava added ...")
    var actor = ev.actor || ev.person || ev.from;
    if (!actor && typeof ev.text === "string") {
      var am = ev.text.match(/^([A-Za-z][\w' ]*?) (added|paid|created|joined|chipped)/);
      if (am) actor = am[1];
    }

    var settled = false, line, detail = "";
    var isYou = function (s) { return /^(you|me)$/.test(lc(s)); };
    var bold = function (s) { return '<span style="font-weight:600;">' + app.esc(lc(s)) + '</span>'; };

    if (/expense|bill|add|charge/.test(type)) {
      var who = actor ? lc(actor) : "someone";
      line = (isYou(who) ? "you" : app.esc(who)) + " started " + bold(title || "a tab") + " 🍜";
      detail = [trip, "split"].filter(Boolean).join(" · ");
    } else if (/settl|paid|payment|pay/.test(type)) {
      settled = true;
      var f = actor ? lc(actor) : null, t = ev.to ? lc(ev.to) : null;
      if (f && t) {
        line = (isYou(f) ? "you squared with " + bold(t) : app.esc(f) + " chipped in") + " 🫡";
        detail = trip;
      } else if (f) {
        line = (isYou(f) ? "you squared up ✨" : app.esc(f) + " chipped in 🫡");
        detail = trip;
      } else {
        line = bold(trip || "the crew") + " squared ✨"; // settle-up created at trip level
        detail = "";
      }
    } else if (/trip|create|new/.test(type)) {
      line = (actor && isYou(actor) ? "you" : "someone") + " started " + bold(trip || "a group") + " 🎉";
      detail = "new group";
    } else if (/join|member|invite/.test(type)) {
      line = (actor ? bold(actor) : "someone") + " hopped in 👋";
      detail = trip;
    } else if (/react/.test(type)) {
      line = (actor ? app.esc(lc(actor)) : "someone") + " reacted " +
        app.esc(ev.emoji || "💀") + (title ? " to " + bold(title) : "");
      detail = trip;
    } else {
      var raw = typeof ev.text === "string" && ev.text.trim() ? ev.text : "something happened";
      line = app.esc(lc(raw)) + " ✨";
      detail = trip;
    }
    return { line: line, detail: detail, settled: settled, title: title, isYou: isYou(actor) };
  }

  // ---- one feed row ----
  function row(ev) {
    var d = describe(ev);
    var cents = centsOf(ev);

    // avatar: emoji-on-color when we have identity; mascot for your own settle.
    var actorRaw = ev.actor || ev.person || ev.from || "";
    var ownSettle = d.settled && (d.isYou || /squared with|squared up/.test(d.line));
    var avatarHtml;
    if (ownSettle) {
      avatarHtml = '<div style="transform:scale(.5);transform-origin:center;width:42px;height:42px;' +
        'display:flex;align-items:center;justify-content:center;flex:none;overflow:visible;">' +
        app.mascot({ size: 80, mood: "sparkle", glow: true }) + '</div>';
    } else {
      avatarHtml = app.avatar({
        name: actorRaw || ev.tripName || "?",
        emoji: ev.emoji || ev.actorEmoji,
        color: ev.color || ev.actorColor,
        id: ev.actorId || ev.tripId,
      });
    }

    // amount on the right: pos blue / neg coral / zero settled-muted
    var amountHtml = "";
    if (cents != null) {
      var kind = cents > 0 ? "pos" : cents < 0 ? "neg" : "settled";
      amountHtml = app.money(cents, kind, cents !== 0);
    }

    // settled tag + view link (→ receipt when a signature exists)
    var tag = d.settled ? '<span class="state settled" style="font-size:9px;padding:3px 8px;">settled</span>' : "";
    var sig = ev.signature || ev.sig || (ev.receipt && ev.receipt.signature) || ev.reference;
    var viewLink = (d.settled && sig)
      ? '<a href="#/receipt/' + encodeURIComponent(sig) + '" ' +
        'style="font-family:var(--mono);font-size:10px;color:var(--blue-bright);text-decoration:none;">view ↗</a>'
      : "";

    // emoji reactions, if the API carries them
    var reacts = "";
    var rs = ev.reactions;
    if (rs && typeof rs === "object") {
      var chips = [];
      var pushChip = function (emoji, count) {
        chips.push('<span style="display:inline-flex;align-items:center;gap:4px;background:var(--card);' +
          'border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-size:11px;">' +
          app.esc(emoji) + '<span style="font-family:var(--mono);font-size:9px;color:var(--muted);">' +
          app.esc(String(count)) + '</span></span>');
      };
      if (Array.isArray(rs)) {
        rs.forEach(function (r) { if (r && r.emoji) pushChip(r.emoji, r.count != null ? r.count : 1); });
      } else {
        Object.keys(rs).forEach(function (k) { pushChip(k, rs[k]); });
      }
      if (chips.length) reacts = '<div style="display:flex;gap:6px;margin-top:8px;">' + chips.join("") + '</div>';
    }

    var bits = [];
    if (d.detail) bits.push('<span>' + app.esc(d.detail) + '</span>');
    bits.push('<span>' + app.esc(relTime(ev.at)) + '</span>');
    var subRow = '<div class="sub" style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">' +
      tag + bits.join('<span style="opacity:.4;">·</span>') +
      (viewLink ? '<span style="opacity:.4;">·</span>' + viewLink : "") + '</div>';

    return '<div class="row" style="align-items:flex-start;">' +
      avatarHtml +
      '<div class="meta"><div class="name lower" style="font-weight:500;font-size:15px;">' + d.line + '</div>' +
      subRow + reacts + '</div>' +
      (amountHtml ? '<div style="flex:none;align-self:center;">' + amountHtml + '</div>' : "") +
      '</div>';
  }

  // ---- loading skeleton ----
  function skeleton(view) {
    var rows = '<div class="skeleton" style="height:11px;width:54px;margin:14px 2px;"></div>';
    for (var i = 0; i < 4; i++) {
      rows += '<div class="row" style="border:none;">' +
        '<div class="skeleton" style="width:44px;height:44px;border-radius:14px;flex:none;"></div>' +
        '<div class="meta"><div class="skeleton" style="height:13px;width:60%;"></div>' +
        '<div class="skeleton" style="height:10px;width:38%;margin-top:8px;"></div></div>' +
        '<div class="skeleton" style="height:16px;width:48px;flex:none;"></div></div>';
    }
    view.innerHTML = header() + '<div class="appscroll">' + rows + '</div>';
  }

  // ---- empty / signed-out states ----
  function emptyState(view) {
    view.innerHTML = header() +
      '<div class="empty" style="padding-top:60px;">' +
      app.mascot({ size: 112, mood: "sleepy", glow: true }) +
      '<div class="title lower">nothing\'s happened yet 🫥</div>' +
      '<div class="hint">start a tab and the feed wakes up</div>' +
      '<button class="btn" style="max-width:240px;margin-top:10px;" onclick="location.hash=\'#/new\'">new tab</button>' +
      '</div>';
  }
  function signedOut(view) {
    view.innerHTML = header() +
      '<div class="empty" style="padding-top:54px;">' +
      app.mascot({ size: 120, mood: "happy", glow: true }) +
      '<div class="title lower">your feed lives here</div>' +
      '<div class="hint">connect a wallet to see who chipped in 💸</div>' +
      '<button class="btn" id="aConnect" style="max-width:260px;margin-top:10px;">connect a wallet</button>' +
      '</div>';
    var b = document.getElementById("aConnect");
    if (b) b.onclick = function () {
      if (window.Auth) Auth.createWallet().catch(function (e) { app.toast(e.message); });
    };
  }

  // ---- signed-in render ----
  async function signedIn(view) {
    skeleton(view);
    var items;
    try { items = await app.api.get("/api/activity"); }
    catch (e) {
      if (e && e.status === 401) { signedOut(view); return; }
      view.innerHTML = header() +
        '<div class="empty"><div class="title lower">couldn\'t load activity</div>' +
        '<div class="hint">' + app.esc(e.message || "try again") + '</div></div>';
      return;
    }
    if (!Array.isArray(items)) items = (items && Array.isArray(items.events)) ? items.events : [];
    if (!items.length) { emptyState(view); return; }

    // group by day (already reverse-chron from the server; preserve order)
    var html = "", lastDay = null;
    items.forEach(function (ev) {
      if (!ev || typeof ev !== "object") return;
      var k = dayKey(ev.at);
      if (k !== lastDay) {
        lastDay = k;
        html += '<div class="eyebrow" style="margin:18px 2px 6px;">' + app.esc(dayLabel(ev.at)) + '</div>';
      }
      try { html += row(ev); } catch (_) { /* one bad event never sinks the feed */ }
    });

    view.innerHTML = header() + '<div class="appscroll">' + html + '</div>';
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
