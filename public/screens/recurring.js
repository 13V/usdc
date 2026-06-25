/* screens/recurring.js — Recurring / "on autopilot" (#/recurring).
   Matches design/frames/Recurring Frames.dc.html + Recurring Detail Frames.dc.html;
   follows the contract in design/BUILD.md and patterns in screens/home.js.

   GET /api/recurring -> { rules: [{ id, tripId, tripName, title, amountCents,
     amountFmt, paidBy, participants:[memberId], interval, nextDue, createdAt }] }
   POST /api/recurring { tripId, title, amountCents, paidBy, participants[], interval, startDate }
   DELETE /api/recurring/:id  */
(function () {
  "use strict";
  var app = window.app;

  // ---- topbar ---------------------------------------------------------------
  function topbar(sub) {
    return '<div class="topbar" style="height:auto;padding:8px 20px 0;align-items:flex-start;">' +
      '<div>' +
        '<h1 style="font-size:23px;" class="lower">on autopilot</h1>' +
        '<div class="mono" style="font-size:10px;letter-spacing:.3px;color:var(--faint);margin-top:1px;">' + app.esc(sub || "") + '</div>' +
      '</div>' +
      '<div style="transform:scale(.42);transform-origin:right center;width:74px;height:46px;overflow:visible;display:flex;justify-content:flex-end;">' +
        app.mascot({ size: 86, mood: "watching", glow: false }) +
      '</div></div>';
  }

  // ---- date / interval helpers ---------------------------------------------
  var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
  }
  function fmtDateY(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear();
  }
  // days until iso (can be negative if overdue)
  function daysUntil(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return Math.ceil((d.getTime() - Date.now()) / 86400000);
  }
  // human cadence label from interval form ("weekly"|"monthly"|"<n>d")
  function cadence(interval) {
    if (interval === "weekly") return "weekly";
    if (interval === "monthly") return "monthly";
    var m = /^(\d+)d$/.exec(String(interval || ""));
    if (m) {
      var n = Number(m[1]);
      if (n === 7) return "weekly";
      if (n === 14) return "biweekly";
      if (n === 1) return "daily";
      return "every " + n + "d";
    }
    return String(interval || "");
  }
  // interval length in days (for the countdown ring fraction)
  function intervalDays(interval) {
    if (interval === "weekly") return 7;
    if (interval === "monthly") return 30;
    var m = /^(\d+)d$/.exec(String(interval || ""));
    return m ? Number(m[1]) : 30;
  }
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
  function perShare(rule) {
    var n = (rule.participants && rule.participants.length) || 1;
    return Math.round(rule.amountCents / n);
  }

  // ---- signed-out -----------------------------------------------------------
  function signedOut(view) {
    view.innerHTML = topbar("set bills you split every month") +
      '<div class="appscroll" style="display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:40px;">' +
        '<div style="margin:6px 0 4px;">' + app.mascot({ size: 124, mood: "sleepy", glow: true }) + '</div>' +
        '<h1 style="font-size:22px;max-width:280px;margin-top:16px;" class="lower">put your bills on autopilot</h1>' +
        '<p class="hint" style="max-width:250px;margin:11px 0 0;">connect to set the bills you split every month and forget them 🫡</p>' +
        '<button class="btn" id="rConnect" style="max-width:300px;margin-top:24px;">connect a wallet</button>' +
      '</div>';
    var c = document.getElementById("rConnect");
    if (c) c.onclick = function () {
      if (window.Auth) Auth.createWallet().catch(function (e) { app.toast(e.message); });
    };
  }

  // ---- loading --------------------------------------------------------------
  function skeleton(view) {
    view.innerHTML = topbar("loading…") + '<div class="appscroll">' +
      '<div class="skeleton" style="height:220px;margin:8px 0 22px;border-radius:24px;"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:11px;">' +
        '<div class="skeleton" style="height:128px;border-radius:20px;"></div>' +
        '<div class="skeleton" style="height:128px;border-radius:20px;"></div>' +
        '<div class="skeleton" style="height:128px;border-radius:20px;"></div>' +
        '<div class="skeleton" style="height:128px;border-radius:20px;"></div>' +
      '</div></div>';
  }

  // ---- empty ----------------------------------------------------------------
  function emptyState(view) {
    view.innerHTML = topbar("nothing on autopilot yet") +
      '<div class="empty" style="padding-top:60px;">' +
        app.mascot({ size: 128, mood: "sleepy", glow: true }) +
        '<div class="title lower" style="margin-top:6px;">nothing on autopilot</div>' +
        '<div class="hint" style="max-width:260px;">set the bills you split every month<br>and forget them 🫡</div>' +
        '<button class="btn" id="rNew" style="max-width:260px;margin-top:10px;">+ new recurring</button>' +
      '</div>';
    var b = document.getElementById("rNew");
    if (b) b.onclick = function () { openNewSheet(); };
  }

  // ---- featured card (next-due) --------------------------------------------
  function featuredCard(rule) {
    var emoji = emojiFor(rule);
    var dleft = daysUntil(rule.nextDue);
    var total = intervalDays(rule.interval);
    var frac = dleft == null ? 0 : Math.max(0, Math.min(1, (total - dleft) / total));
    var R = 26, C = 2 * Math.PI * R; // 163.4
    var off = C * (1 - frac);
    var n = (rule.participants && rule.participants.length) || 1;
    var share = perShare(rule);
    var cadLabel = cadence(rule.interval);
    var cadShort = rule.interval === "monthly" ? "/mo" : rule.interval === "weekly" ? "/wk" : "";
    var ringTxt = dleft == null ? "—" : (dleft <= 0 ? "now" : dleft + "d");

    // owebar preview: blocks per participant, last one coral (your share)
    var bars = "";
    var blocks = Math.min(n, 5);
    for (var i = 0; i < blocks; i++) {
      var isYou = i === blocks - 1;
      bars += '<div style="flex:1;background:' + (isYou ? "#FF6B5E" : "#2775CA") + ';opacity:' + (isYou ? ".85" : (1 - i * 0.12).toFixed(2)) + ';"></div>';
    }

    return '<div class="paper" data-rid="' + app.esc(rule.id) + '" style="position:relative;background:var(--card);border-radius:24px;border:1px solid rgba(39,117,202,0.32);overflow:hidden;box-shadow:0 16px 40px rgba(0,0,0,0.36);cursor:pointer;">' +
      '<div style="position:absolute;right:-30px;top:-30px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(39,117,202,0.22) 0%,rgba(39,117,202,0) 70%);pointer-events:none;"></div>' +
      '<div style="position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,#2775CA,#3f97ee);"></div>' +
      '<div style="position:relative;padding:17px 18px 18px;">' +
        // top row
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">' +
          '<div style="display:flex;align-items:center;gap:12px;min-width:0;">' +
            '<div style="width:46px;height:46px;border-radius:14px;background:linear-gradient(135deg,#3a93ec,#2775CA 60%,#1d5697);display:flex;align-items:center;justify-content:center;font-size:23px;flex:none;">' + app.esc(emoji) + '</div>' +
            '<div style="min-width:0;">' +
              '<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(39,117,202,0.16);border:1px solid rgba(39,117,202,0.45);border-radius:999px;padding:2px 9px;margin-bottom:5px;"><span class="mono" style="font-weight:700;font-size:8.5px;letter-spacing:1px;color:#7fc0ff;">NEXT DUE</span></div>' +
              '<div class="display lower" style="font-size:17px;color:var(--text);">' + app.esc(rule.title) + '</div>' +
              '<div class="mono lower" style="font-size:10px;letter-spacing:.3px;color:var(--faint);margin-top:2px;">' + app.esc(rule.tripName || "auto-tab") + '</div>' +
            '</div>' +
          '</div>' +
          // countdown ring
          '<div style="position:relative;width:62px;height:62px;flex:none;">' +
            '<svg width="62" height="62" viewBox="0 0 62 62">' +
              '<circle cx="31" cy="31" r="26" fill="none" stroke="rgba(244,247,250,0.1)" stroke-width="5"/>' +
              '<circle cx="31" cy="31" r="26" fill="none" stroke="#2775CA" stroke-width="5" stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 31 31)" style="filter:drop-shadow(0 0 4px rgba(39,117,202,0.6));"/>' +
            '</svg>' +
            '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">' +
              '<span class="mono" style="font-weight:700;font-size:16px;letter-spacing:-0.5px;color:var(--text);line-height:1;">' + ringTxt + '</span>' +
              '<span class="mono" style="font-size:7px;letter-spacing:.5px;color:var(--faint);margin-top:2px;">to run</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        // big amount
        '<div style="display:flex;align-items:baseline;gap:9px;margin-top:16px;">' +
          app.money(rule.amountCents, "") +
          (cadShort ? '<span class="mono" style="font-size:12px;letter-spacing:.5px;color:var(--faint);">' + cadShort + '</span>' : "") +
        '</div>' +
        // pills
        '<div style="display:flex;align-items:center;gap:9px;margin-top:14px;">' +
          '<span class="pill mono" style="font-weight:700;font-size:11px;padding:5px 12px;">' + app.esc(cadLabel) + '</span>' +
          '<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(61,232,199,0.12);border:1px solid rgba(61,232,199,0.4);border-radius:999px;padding:5px 12px;"><span style="width:6px;height:6px;border-radius:50%;background:#3DE8C7;box-shadow:0 0 7px rgba(61,232,199,0.9);"></span><span class="mono" style="font-weight:700;font-size:11px;color:#3DE8C7;">active</span></span>' +
        '</div>' +
        // sub + owe bar
        '<div style="margin-top:16px;padding-top:15px;border-top:1px dashed rgba(244,247,250,0.12);">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
            '<span class="mono" style="font-size:11px;letter-spacing:.3px;color:var(--muted);">next: ' + fmtDate(rule.nextDue) + ' · split ' + n + '</span>' +
            '<span class="mono" style="font-size:11px;color:#FF6B5E;">your share ' + plainMoney(share) + '</span>' +
          '</div>' +
          '<div style="display:flex;gap:3px;height:7px;border-radius:4px;overflow:hidden;margin-top:11px;">' + bars + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // plain $ string (mono), for inline use where app.money's HTML is overkill
  function plainMoney(cents) {
    var n = Math.abs(cents) / 100;
    return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ---- bento card (the rest) -----------------------------------------------
  function bentoCard(rule) {
    var emoji = emojiFor(rule);
    var cadLabel = cadence(rule.interval);
    return '<div class="paper" data-rid="' + app.esc(rule.id) + '" style="position:relative;background:var(--card);border-radius:20px;border:1px solid var(--line);padding:14px;overflow:hidden;cursor:pointer;">' +
      '<div style="position:relative;display:flex;align-items:center;justify-content:space-between;">' +
        '<div style="width:38px;height:38px;border-radius:12px;background:rgba(39,117,202,0.18);display:flex;align-items:center;justify-content:center;font-size:18px;">' + app.esc(emoji) + '</div>' +
        '<span style="width:6px;height:6px;border-radius:50%;background:#3DE8C7;box-shadow:0 0 6px rgba(61,232,199,0.8);"></span>' +
      '</div>' +
      '<div class="display lower" style="font-weight:500;font-size:14.5px;color:var(--text);margin-top:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + app.esc(rule.title) + '</div>' +
      '<div style="margin-top:6px;">' + app.money(rule.amountCents, "") + '</div>' +
      '<div class="mono lower" style="font-size:9px;letter-spacing:.5px;color:var(--faint);margin-top:11px;">' + app.esc(cadLabel) + ' · ' + fmtDate(rule.nextDue) + '</div>' +
    '</div>';
  }

  // ---- signed-in (list) -----------------------------------------------------
  var _trips = null; // cache of mine trips for the new-sheet picker

  async function signedIn(view) {
    skeleton(view);
    var data;
    try { data = await app.api.get("/api/recurring"); }
    catch (e) {
      view.innerHTML = topbar("couldn't load") +
        '<div class="empty"><div class="title lower">couldn\'t load autopilot</div><div class="hint">' + app.esc(e.message) + '</div>' +
        '<button class="btn" id="rNew" style="max-width:260px;margin-top:10px;">+ new recurring</button></div>';
      var b = document.getElementById("rNew");
      if (b) b.onclick = function () { openNewSheet(); };
      return;
    }
    var rules = (data && data.rules) || [];
    if (!Array.isArray(rules)) rules = [];

    if (!rules.length) { emptyState(view); return; }

    // featured = soonest next-due
    var sorted = rules.slice().sort(function (a, b) {
      return new Date(a.nextDue).getTime() - new Date(b.nextDue).getTime();
    });
    var featured = sorted[0];
    var rest = sorted.slice(1);

    var total = rules.reduce(function (s, r) { return s + (r.amountCents || 0); }, 0);
    var sub = rules.length + (rules.length === 1 ? " bill" : " bills") + " · ~" + plainMoney(total) + "/mo split";

    var restHtml = "";
    if (rest.length) {
      restHtml = '<div class="mono" style="font-size:10px;letter-spacing:1.5px;color:var(--faint);padding:24px 2px 12px;">EVERYTHING ELSE</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:11px;">' +
          rest.map(bentoCard).join("") +
          '<div id="rAddTile" style="grid-column:1 / -1;display:flex;align-items:center;justify-content:center;gap:9px;min-height:58px;border-radius:20px;border:1.5px dashed rgba(39,117,202,0.4);background:rgba(39,117,202,0.05);cursor:pointer;">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7fc0ff" stroke-width="2.3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
            '<span class="display" style="font-weight:600;font-size:15px;color:#7fc0ff;">set up a new one</span>' +
          '</div>' +
        '</div>';
    } else {
      restHtml = '<div id="rAddTile" style="display:flex;align-items:center;justify-content:center;gap:9px;min-height:58px;margin-top:18px;border-radius:20px;border:1.5px dashed rgba(39,117,202,0.4);background:rgba(39,117,202,0.05);cursor:pointer;">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7fc0ff" stroke-width="2.3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
        '<span class="display" style="font-weight:600;font-size:15px;color:#7fc0ff;">set up a new one</span></div>';
    }

    view.innerHTML = topbar(sub) + '<div class="appscroll" style="padding-top:8px;">' +
      featuredCard(featured) + restHtml + '</div>';

    // wire taps -> detail
    var byId = {};
    rules.forEach(function (r) { byId[r.id] = r; });
    Array.prototype.forEach.call(view.querySelectorAll("[data-rid]"), function (el) {
      el.onclick = function () { var r = byId[el.getAttribute("data-rid")]; if (r) openDetailSheet(r); };
    });
    var add = document.getElementById("rAddTile");
    if (add) add.onclick = function () { openNewSheet(); };
  }

  // ---- "+ new" sheet --------------------------------------------------------
  async function openNewSheet() {
    var inputRow = function (label, id, ph, mono) {
      return '<label style="margin-top:14px;">' + label + '</label>' +
        '<input class="input' + (mono ? " mono" : "") + '" id="' + id + '" placeholder="' + app.esc(ph) + '" />';
    };

    var el = app.sheet(
      '<h2 class="lower" style="font-size:20px;margin:2px 0 2px;">set &amp; forget ✨</h2>' +
      '<div class="mono" style="font-size:11px;color:var(--faint);margin-bottom:6px;">a bill that splits itself every period</div>' +
      '<div id="rTripWrap"><label style="margin-top:14px;">group</label><div class="mono" style="font-size:12px;color:var(--muted);padding:10px 0;">loading groups…</div></div>' +
      inputRow("title", "rfTitle", "rent 🏠", false) +
      inputRow("amount (usd)", "rfAmount", "2400.00", true) +
      '<label style="margin-top:14px;">interval</label>' +
      '<div id="rfInterval" style="display:flex;gap:7px;">' +
        '<div class="chip mono" data-int="weekly" style="flex:1;justify-content:center;">weekly</div>' +
        '<div class="chip mono selected" data-int="monthly" style="flex:1;justify-content:center;">monthly</div>' +
        '<div class="chip mono" data-int="14d" style="flex:1;justify-content:center;">biweekly</div>' +
      '</div>' +
      inputRow("next due", "rfDate", "2026-07-01", true) +
      '<div id="rfMembers" style="margin-top:14px;"></div>' +
      '<button class="btn" id="rfSave" style="margin-top:20px;">set &amp; forget ✨</button>'
    );

    // interval segmented control
    var chosenInt = "monthly";
    var intWrap = el.querySelector("#rfInterval");
    Array.prototype.forEach.call(intWrap.querySelectorAll("[data-int]"), function (c) {
      c.onclick = function () {
        chosenInt = c.getAttribute("data-int");
        Array.prototype.forEach.call(intWrap.querySelectorAll("[data-int]"), function (x) { x.classList.remove("selected"); });
        c.classList.add("selected");
      };
    });

    // prefill next-due with a sensible default (today)
    var dEl = el.querySelector("#rfDate");
    if (dEl) dEl.value = new Date().toISOString().slice(0, 10);

    // load groups for the picker
    var trips = _trips;
    try {
      if (!trips) { trips = await app.api.get("/api/trips?mine=1"); _trips = trips; }
    } catch (_) { trips = []; }
    trips = Array.isArray(trips) ? trips : [];

    var tripWrap = el.querySelector("#rTripWrap");
    var chosenTrip = null;       // trip id
    var chosenMembers = null;    // full trip object (members live in detail fetch)
    var memWrap = el.querySelector("#rfMembers");

    if (!trips.length) {
      tripWrap.innerHTML = '<label style="margin-top:14px;">group</label>' +
        '<div class="mono" style="font-size:12px;color:var(--muted);padding:8px 0;">you need a group first — recurring bills attach to one.</div>' +
        '<button class="btn ghost" id="rfGoGroups" style="margin-top:6px;">make a group</button>';
      var g = el.querySelector("#rfGoGroups");
      if (g) g.onclick = function () { app.closeSheet(); app.go("groups"); };
      var sv0 = el.querySelector("#rfSave");
      if (sv0) sv0.disabled = true;
      return;
    }

    tripWrap.innerHTML = '<label style="margin-top:14px;">group</label>' +
      '<div id="rfTrips" style="display:flex;gap:8px;flex-wrap:wrap;">' +
        trips.map(function (t) {
          return '<div class="chip" data-trip="' + app.esc(t.id) + '">' + app.esc(t.name) + '</div>';
        }).join("") +
      '</div>';

    function renderMembers(trip) {
      if (!trip || !trip.members || !trip.members.length) { memWrap.innerHTML = ""; return; }
      memWrap.innerHTML = '<label>who splits it (paid by = first)</label>' +
        '<div class="mono" style="font-size:11px;color:var(--faint);margin:-2px 0 8px;">everyone splits evenly · tap the payer</div>' +
        '<div id="rfMemChips" style="display:flex;gap:8px;flex-wrap:wrap;">' +
        trip.members.map(function (m, i) {
          return '<div class="chip" data-mem="' + app.esc(m.id) + '"' + (i === 0 ? ' data-payer="1"' : '') + ' style="' + (i === 0 ? 'border-color:var(--blue);' : '') + '">' +
            app.avatar({ name: m.name, id: m.id }, "sm") + '<span class="lower">' + app.esc(m.name) + '</span></div>';
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
        // fetch full trip (members) if needed
        var t;
        try { t = await app.api.get("/api/trips/" + encodeURIComponent(id)); }
        catch (_) { t = trips.filter(function (x) { return x.id === id; })[0]; }
        pickTrip(t || { id: id, members: [] }, chip);
      };
    });

    // save
    var sv = el.querySelector("#rfSave");
    sv.onclick = async function () {
      if (!chosenTrip) { app.toast("pick a group first"); return; }
      var title = (el.querySelector("#rfTitle").value || "").trim();
      if (!title) { app.toast("give it a title"); return; }
      var amt = parseFloat(el.querySelector("#rfAmount").value);
      if (!(amt > 0)) { app.toast("enter an amount"); return; }
      var amountCents = Math.round(amt * 100);
      var dateStr = (el.querySelector("#rfDate").value || "").trim();

      // payer + participants from member chips
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

      sv.disabled = true; sv.textContent = "setting…";
      try {
        await app.api.post("/api/recurring", body);
        app.closeSheet();
        app.toast("set & forget ✨");
        var view = document.getElementById("view");
        if (view) signedIn(view);
      } catch (e) {
        sv.disabled = false; sv.innerHTML = "set &amp; forget ✨";
        app.toast(e.message || "couldn't save");
      }
    };

    // let tapping a member chip set the payer
    memWrap.onclick = function (ev) {
      var chip = ev.target.closest ? ev.target.closest("[data-mem]") : null;
      if (!chip) return;
      Array.prototype.forEach.call(memWrap.querySelectorAll("[data-mem]"), function (x) {
        x.removeAttribute("data-payer"); x.style.borderColor = "";
      });
      chip.setAttribute("data-payer", "1");
      chip.style.borderColor = "var(--blue)";
    };
  }

  // ---- detail sheet ---------------------------------------------------------
  async function openDetailSheet(rule) {
    var emoji = emojiFor(rule);
    var n = (rule.participants && rule.participants.length) || 1;
    var share = perShare(rule);
    var cadLabel = cadence(rule.interval);
    var cadShort = rule.interval === "monthly" ? "/mo" : rule.interval === "weekly" ? "/wk" : "";
    var dleft = daysUntil(rule.nextDue);
    var total = intervalDays(rule.interval);
    var frac = dleft == null ? 0 : Math.max(0, Math.min(1, (total - dleft) / total));
    var R = 31, C = 2 * Math.PI * R;
    var off = C * (1 - frac);
    var ringTxt = dleft == null ? "—" : (dleft <= 0 ? "now" : dleft + "d");

    // header identity card
    var headerCard =
      '<div style="position:relative;border-radius:24px;overflow:hidden;padding:18px;background:linear-gradient(150deg,#2f80d6 0%,#2775CA 55%,#1d5e9f 100%);box-shadow:0 16px 40px rgba(39,117,202,0.4);">' +
        '<div style="position:absolute;inset:0;background-image:repeating-radial-gradient(circle at 88% 8%,rgba(255,255,255,0.09) 0 1px,transparent 1px 9px);opacity:.55;pointer-events:none;"></div>' +
        '<div style="position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:14px;">' +
          '<div style="min-width:0;">' +
            '<div style="display:flex;align-items:center;gap:11px;">' +
              '<div style="width:46px;height:46px;border-radius:14px;background:rgba(11,22,34,0.28);border:1px solid rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-size:23px;flex:none;">' + app.esc(emoji) + '</div>' +
              '<div style="min-width:0;">' +
                '<div class="display lower" style="font-size:18px;color:#fff;">' + app.esc(rule.title) + '</div>' +
                '<div class="mono lower" style="font-size:10px;letter-spacing:.5px;color:rgba(255,255,255,0.72);margin-top:2px;">' + app.esc(rule.tripName || "auto-tab") + ' · auto-tab</div>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:baseline;gap:8px;margin-top:16px;">' +
              '<div class="mono" style="font-weight:700;font-size:40px;line-height:.9;letter-spacing:-2px;color:#fff;">' + plainMoney(rule.amountCents).replace(/^\$/, '<span style="font-size:22px;opacity:.6;">$</span>').replace(/(\.\d\d)$/, '<span style="font-size:22px;opacity:.6;">$1</span>') + '</div>' +
              (cadShort ? '<span class="mono" style="font-size:13px;color:rgba(255,255,255,0.6);">' + cadShort + '</span>' : "") +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;margin-top:14px;">' +
              '<span style="display:inline-flex;align-items:center;background:rgba(11,22,34,0.25);border:1px solid rgba(255,255,255,0.22);border-radius:999px;padding:5px 12px;"><span class="mono" style="font-weight:700;font-size:11px;color:#fff;">' + app.esc(cadLabel) + '</span></span>' +
              '<span style="display:inline-flex;align-items:center;gap:8px;background:rgba(11,22,34,0.25);border:1px solid rgba(255,255,255,0.22);border-radius:999px;padding:5px 12px;"><span style="width:6px;height:6px;border-radius:50%;background:#3DE8C7;"></span><span class="mono" style="font-weight:700;font-size:11px;color:#fff;">active</span></span>' +
            '</div>' +
          '</div>' +
          // countdown ring
          '<div style="display:flex;flex-direction:column;align-items:center;gap:7px;flex:none;">' +
            '<div style="position:relative;width:74px;height:74px;">' +
              '<svg width="74" height="74" viewBox="0 0 74 74">' +
                '<circle cx="37" cy="37" r="31" fill="none" stroke="rgba(11,22,34,0.28)" stroke-width="6"/>' +
                '<circle cx="37" cy="37" r="31" fill="none" stroke="#3DE8C7" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 37 37)" style="filter:drop-shadow(0 0 5px rgba(61,232,199,0.7));"/>' +
              '</svg>' +
              '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">' +
                '<span class="mono" style="font-weight:700;font-size:21px;letter-spacing:-0.5px;color:#fff;line-height:1;">' + ringTxt + '</span>' +
                '<span class="mono" style="font-size:8px;letter-spacing:.5px;color:rgba(255,255,255,0.65);margin-top:2px;">left</span>' +
              '</div>' +
            '</div>' +
            '<span class="mono" style="font-size:9.5px;letter-spacing:.3px;color:rgba(255,255,255,0.78);white-space:nowrap;">next: ' + fmtDate(rule.nextDue) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    // open sheet immediately with header + placeholders, then hydrate members
    var el = app.sheet(
      '<div style="max-height:78vh;overflow-y:auto;margin:-2px -6px 0;padding:0 6px;">' +
        headerCard +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin:22px 2px 12px;">' +
          '<span class="mono" style="font-size:10px;letter-spacing:1.5px;color:var(--faint);">WHO SPLITS IT</span>' +
          '<span class="mono" style="font-size:10px;letter-spacing:.5px;color:var(--faint);">SPLIT ' + n + ' · ' + plainMoney(share) + ' EACH</span>' +
        '</div>' +
        '<div class="card" id="rdMembers" style="padding:0;overflow:hidden;"><div class="mono" style="font-size:12px;color:var(--muted);padding:14px 15px;">loading members…</div></div>' +

        '<div style="margin:22px 2px 12px;"><span class="mono" style="font-size:10px;letter-spacing:1.5px;color:var(--faint);">THIS RUN · ' + fmtDate(rule.nextDue).toUpperCase() + '</span></div>' +
        '<div class="card">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;">' +
            '<span class="display lower" style="font-weight:500;font-size:16px;">0 of ' + n + ' squared</span>' +
            '<span class="mono" style="font-size:11px;color:#3DE8C7;">' + plainMoney(0) + ' in</span>' +
          '</div>' +
          '<div style="display:flex;gap:5px;height:8px;margin-top:13px;">' + thisRunBars(n) + '</div>' +
          '<div class="mono" style="font-size:11px;color:var(--faint);margin-top:13px;">due ' + fmtDateY(rule.nextDue) + ' · everyone chips in ' + plainMoney(share) + '</div>' +
        '</div>' +

        '<div style="margin:22px 2px 12px;"><span class="mono" style="font-size:10px;letter-spacing:1.5px;color:var(--faint);">PAST RUNS</span></div>' +
        '<div id="rdPast">' + pastRuns(rule) + '</div>' +

        // controls
        '<div style="display:flex;gap:9px;margin-top:22px;">' +
          ctrlBtn("rdPause", '<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>', "pause", false) +
          ctrlBtn("rdEdit", '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', "edit", false) +
          ctrlBtn("rdDelete", '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', "delete", true) +
        '</div>' +
      '</div>'
    );

    // controls wiring
    var pauseB = el.querySelector("#rdPause");
    if (pauseB) pauseB.onclick = function () { app.toast("paused — heads up: pause isn't wired server-side yet"); };
    var editB = el.querySelector("#rdEdit");
    if (editB) editB.onclick = function () { app.closeSheet(); openNewSheet(); };
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

    // hydrate "who splits it" from the trip members
    var memBox = el.querySelector("#rdMembers");
    var trip = null;
    try { trip = await app.api.get("/api/trips/" + encodeURIComponent(rule.tripId)); } catch (_) {}
    var byId = {};
    if (trip && trip.members) trip.members.forEach(function (m) { byId[m.id] = m; });
    var pids = (rule.participants && rule.participants.length) ? rule.participants : (trip && trip.members ? trip.members.map(function (m) { return m.id; }) : []);

    if (!pids.length) {
      memBox.innerHTML = '<div class="mono" style="font-size:12px;color:var(--muted);padding:14px 15px;">' + n + ' people · ' + plainMoney(share) + ' each</div>';
    } else {
      var rows = pids.map(function (pid, i) {
        var m = byId[pid] || { id: pid, name: "member" };
        var isPayer = pid === rule.paidBy;
        var nm = (m.userId && window.Auth && window.Auth.user && m.userId === window.Auth.user.id) ? "you" : m.name;
        return (i > 0 ? '<div style="height:1px;background:var(--line);margin:0 15px;"></div>' : '') +
          '<div style="display:flex;align-items:center;gap:12px;padding:13px 15px;">' +
            app.avatar({ name: m.name, id: m.id }) +
            '<span class="lower" style="flex:1;font-weight:500;font-size:15px;">' + app.esc(nm) + (isPayer ? ' <span class="mono" style="font-size:9px;color:var(--blue-bright);">· pays</span>' : '') + '</span>' +
            '<span class="mono" style="font-weight:700;font-size:15px;color:rgba(244,247,250,0.85);">' + plainMoney(share) + '</span>' +
          '</div>';
      }).join("");
      var payer = byId[rule.paidBy];
      rows += '<div style="display:flex;align-items:center;gap:8px;padding:11px 15px;background:rgba(255,198,92,0.07);border-top:1px solid var(--line);">' +
        '<span style="font-size:14px;">💳</span>' +
        '<span class="mono lower" style="font-size:11px;letter-spacing:.3px;color:var(--muted);">paid by: ' + app.esc(payer ? payer.name : "member") + ' · everyone chips in</span></div>';
      memBox.innerHTML = rows;
    }
  }

  function thisRunBars(n) {
    var s = "";
    for (var i = 0; i < n; i++) s += '<div style="flex:1;border-radius:4px;background:rgba(244,247,250,0.1);"></div>';
    return s;
  }

  function ctrlBtn(id, path, label, coral) {
    var stroke = coral ? "#FF6B5E" : "rgba(244,247,250,0.8)";
    var color = coral ? "#FF6B5E" : "rgba(244,247,250,0.85)";
    var bg = coral ? "rgba(255,107,94,0.08)" : "var(--card)";
    var bd = coral ? "rgba(255,107,94,0.28)" : "var(--line)";
    return '<button id="' + id + '" style="appearance:none;cursor:pointer;flex:1;display:flex;flex-direction:column;align-items:center;gap:7px;padding:14px 0;border-radius:16px;background:' + bg + ';border:1px solid ' + bd + ';">' +
      '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>' +
      '<span style="font-weight:500;font-size:13px;color:' + color + ';">' + label + '</span></button>';
  }

  // synthesize a friendly "past runs" history from createdAt -> nextDue.
  // The API doesn't persist run history, so we infer prior occurrences.
  function pastRuns(rule) {
    var runs = [];
    try {
      var step = intervalDays(rule.interval);
      var d = new Date(rule.nextDue);
      var created = new Date(rule.createdAt || rule.nextDue);
      // walk backwards up to 3 prior periods, not before created
      for (var i = 0; i < 4 && runs.length < 3; i++) {
        var prev = new Date(d.getTime());
        if (rule.interval === "monthly") prev.setUTCMonth(prev.getUTCMonth() - 1);
        else prev.setUTCDate(prev.getUTCDate() - step);
        d = prev;
        if (isNaN(d.getTime())) break;
        if (d.getTime() < created.getTime() - 86400000) break;
        runs.push(new Date(d.getTime()));
      }
    } catch (_) {}

    if (!runs.length) {
      return '<div class="card" style="padding:16px;"><div class="mono lower" style="font-size:12px;color:var(--muted);">no past runs yet — this one\'s fresh ✨</div></div>';
    }
    return '<div style="display:flex;flex-direction:column;gap:3px;">' + runs.map(function (date, i) {
      return (i > 0 ? '<div style="height:1px;background:rgba(244,247,250,0.05);margin:0 6px;"></div>' : '') +
        '<div style="display:flex;align-items:center;gap:13px;padding:12px 6px;">' +
          '<div style="width:34px;height:34px;border-radius:11px;background:rgba(61,232,199,0.12);display:flex;align-items:center;justify-content:center;font-size:15px;flex:none;">✨</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div class="lower" style="font-weight:500;font-size:14.5px;">' + fmtDate(date.toISOString()) + '</div>' +
            '<div style="display:flex;align-items:center;gap:7px;margin-top:3px;">' +
              '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(61,232,199,0.12);border:1px solid rgba(61,232,199,0.4);border-radius:999px;padding:1px 8px;"><span style="width:4px;height:4px;border-radius:50%;background:#3DE8C7;"></span><span class="mono" style="font-weight:700;font-size:8px;letter-spacing:.5px;color:#3DE8C7;">ALL SQUARED</span></span>' +
            '</div>' +
          '</div>' +
          '<span class="mono" style="font-weight:700;font-size:14px;color:rgba(244,247,250,0.75);">' + plainMoney(rule.amountCents) + '</span>' +
        '</div>';
    }).join("") + '</div>';
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
