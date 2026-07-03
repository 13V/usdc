/* screens/groups.js — Groups (#/groups).
   Built by lifting the EXACT inline-styled markup from
   design/handoff/Groups Playful.dc.html and wiring live data into it, so it
   pixel-matches the approved design. Same lift+wire approach as screens/home.js.
   Keeps the existing GET /api/trips?mine=1 + POST /api/trips (create-group) wiring. */
(function () {
  "use strict";
  var app = window.app;

  function meIdentity() {
    var u = (window.Auth && window.Auth.user) || {};
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem("divvy.profile") || "{}") || {}; } catch (_) {}
    return { emoji: u.emoji || saved.emoji || "🦊", color: u.color || saved.color || "#2775CA" };
  }

  // ---- brand mark + avatar row (lifted from frame top) ------------------
  function brandRow() {
    var me = meIdentity();
    return '<div style="display:flex; align-items:center; justify-content:space-between;">' +
      '<div style="width:36px; height:36px; border-radius:11px; background:linear-gradient(150deg,#3286db,#2775CA 60%,#1f5fa8); display:flex; align-items:center; justify-content:center; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">' +
        '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:700; font-size:24px; line-height:1; color:#fff; transform:translateY(-1px);">/</span>' +
      '</div>' +
      '<a href="#/you" style="text-decoration:none; width:36px; height:36px; border-radius:50%; background:' + me.color + '; display:flex; align-items:center; justify-content:center; font-size:18px; box-shadow:0 4px 12px rgba(43,33,24,0.13);">' + app.esc(me.emoji) + '</a>' +
    '</div>';
  }

  // ---- header ("your groups" + "N active") ------------------------------
  function header(count) {
    var sub = count === 1 ? "1 active" : count + " active";
    return '<div style="display:flex; align-items:baseline; gap:11px; margin-top:20px;">' +
      '<h1 class="jdoodle" style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:33px; line-height:1; letter-spacing:-0.5px; margin:0; color:#2B2118;">your groups</h1>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:11px; font-weight:700; color:#FF6B5E;">' + sub + '!!</span>' +
    '</div>';
  }

  // money split: whole + lighter ".dec" (frame style). Caller adds $ prefix.
  function money3(cents) {
    var n = Math.abs(cents) / 100;
    var whole = Math.floor(n).toLocaleString();
    var dec = (n % 1).toFixed(2).slice(1);
    return whole + '<span style="opacity:.55;">' + dec + '</span>';
  }

  // ---- HERO net-balance summary (lifted from frame) ---------------------
  function hero(totals, counterparties) {
    var net = totals.netCents || 0, owed = totals.owedCents || 0, owe = totals.owesCents || 0;
    var pos = net >= 0;
    var col = pos ? "#2775CA" : "#FF6B5E";
    var label = pos ? "you're up" : "you're down";
    var signPrefix = net < 0 ? "−$" : "+$";

    // sub line under the amount
    var subline;
    if (net === 0) {
      subline = "you're all square ✨";
    } else if (pos && owe > 0) {
      // surface the single biggest "you owe" counterparty, like "…but you owe maya $31 😬"
      var biggestOwe = null;
      counterparties.forEach(function (c) {
        if (c.direction === "owes" && (!biggestOwe || c.cents < biggestOwe.cents)) biggestOwe = c;
      });
      if (biggestOwe) {
        subline = "…but you owe " + app.esc((biggestOwe.name || "someone").toLowerCase()) +
          " $" + (Math.abs(biggestOwe.cents) / 100).toFixed(0) + " 😬";
      } else {
        subline = "everyone owes you 🤑";
      }
    } else if (pos) {
      subline = "everyone owes you 🤑";
    } else {
      subline = "time to settle up 💸";
    }

    // two-tone owed/owe bar with avatars riding it
    var owers = counterparties.filter(function (c) { return c.direction === "owed"; });
    var owees = counterparties.filter(function (c) { return c.direction === "owes"; });
    function ridingAv(list) {
      return list.slice(0, 3).map(function (c, i) {
        var face = c.emoji || (c.name ? c.name.trim()[0] : "?");
        return '<div style="width:23px; height:23px; border-radius:50%; background:rgba(11,22,34,0.55); border:2px solid rgba(255,255,255,0.85);' + (i ? " margin-left:-8px;" : "") + ' display:flex; align-items:center; justify-content:center; font-size:12px;">' + app.esc(face) + '</div>';
      }).join("");
    }
    var owedSeg = Math.max(owed, 1), oweSeg = Math.max(owe, 1);
    var bar = (owed > 0 || owe > 0)
      ? '<div style="display:flex; height:30px; border-radius:999px; overflow:hidden; gap:3px; margin-top:18px; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">' +
          (owed > 0 ? '<div style="flex:' + owedSeg + '; background:linear-gradient(90deg,#2775CA,#3f97ee); display:flex; align-items:center; padding-left:9px;">' + ridingAv(owers) + '</div>' : '') +
          (owe > 0 ? '<div style="flex:' + oweSeg + '; background:linear-gradient(90deg,#FF6B5E,#ff8073); display:flex; align-items:center; justify-content:flex-end; padding-right:7px;">' + ridingAv(owees) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex; justify-content:space-between; margin-top:9px;">' +
          (owed > 0 ? '<span style="font-family:\'Space Mono\',monospace; font-size:11px; color:#2775CA;"><span style="opacity:.55;">$</span>' + money3(owed) + ' owed</span>' : '<span></span>') +
          (owe > 0 ? '<span style="font-family:\'Space Mono\',monospace; font-size:11px; color:#FF6B5E;"><span style="opacity:.55;">$</span>' + money3(owe) + ' owe</span>' : '<span></span>') +
        '</div>'
      : "";

    return '<div style="margin-top:24px;">' +
      '<div style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:12.5px; letter-spacing:0.2px; color:rgba(43,33,24,0.5);">' + label + '</div>' +
      '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:62px; line-height:1; letter-spacing:-2.5px; color:' + col + '; text-shadow:0 0 34px ' + (pos ? "rgba(39,117,202,0.45)" : "rgba(255,107,94,0.4)") + '; margin-top:6px;"><span style="font-size:33px; opacity:.5;">' + signPrefix + '</span>' + money3(net).replace('opacity:.55;', 'font-size:33px; opacity:.5;') + '</div>' +
      '<div style="font-family:\'General Sans\',sans-serif; font-weight:400; font-size:14px; color:rgba(43,33,24,0.55); margin-top:11px;">' + subline + '</div>' +
      bar +
    '</div>';
  }

  // ---- card covers (gradient + deco), lifted from frame -----------------
  var COVERS = [
    { grad: "linear-gradient(125deg,#3a93ec 0%,#2775CA 58%,#1d5697 100%)", emoji: "🗼", dark: false },
    { grad: "linear-gradient(125deg,#ff8073,#FF6B5E 60%,#e0493c)", emoji: "🏠", dark: false },
    { grad: "linear-gradient(125deg,#5cf0d4,#3DE8C7 55%,#1fbfa3)", emoji: "🏝️", dark: true },
    { grad: "linear-gradient(155deg,#ffd47e,#FFC65C 58%,#f0a92f)", emoji: "🧻", dark: true },
    { grad: "linear-gradient(125deg,#a78bfa,#8B5CF6 60%,#6d3fd1)", emoji: "🍜", dark: false },
  ];
  function seed(s) {
    var h = 0, str = String(s || "");
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }
  function coverFor(t) { return COVERS[seed(t.id) % COVERS.length]; }
  function groupEmoji(t, cov) {
    var n = (t.name || "").toLowerCase();
    if (/tokyo|japan|trip|travel|flight/.test(n)) return "🗼";
    if (/apart|rent|house|home|flat/.test(n)) return "🏠";
    if (/bali|beach|island|vacation/.test(n)) return "🏝️";
    if (/room|mate/.test(n)) return "🧻";
    if (/food|dinner|lunch|eat|ramen|noodle/.test(n)) return "🍜";
    return cov.emoji;
  }

  // dotted "paper" texture + dashed perforation overlay (frame deco).
  function coverDeco(rightOffset, dark) {
    var dot = dark ? "rgba(8,40,34,0.14)" : "rgba(255,255,255,0.10)";
    var dash = dark ? "rgba(8,40,34,0.55)" : "rgba(255,255,255,0.7)";
    return '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 18% 120%, ' + dot + ' 0 1px, transparent 1px 7px); opacity:.55;"></div>' +
      '<div style="position:absolute; top:0; bottom:0; right:' + rightOffset + '; width:2.5px; background:repeating-linear-gradient(180deg, ' + dash + ' 0 4px, transparent 4px 9px); opacity:.45;"></div>';
  }

  // member avatar-stack (summaries don't ship members; synthesize deterministic
  // emoji faces from id + count, exactly the look the frame shows).
  var FACES = ["🐼", "🦊", "🐯", "🐻", "🐸", "🐰", "🐨", "🦁"];
  function memberStack(t, max, size, border) {
    var n = t.memberCount || 0;
    var shown = Math.min(n, max);
    var fs = size >= 30 ? 15 : 12;
    var html = "";
    for (var i = 0; i < shown; i++) {
      var face = FACES[seed(t.id + ":m" + i) % FACES.length];
      html += '<div style="width:' + size + 'px; height:' + size + 'px; border-radius:50%; background:rgba(11,22,34,0.55); border:2px solid ' + border + ';' + (i ? " margin-left:-10px;" : "") + ' display:flex; align-items:center; justify-content:center; font-size:' + fs + 'px;">' + face + '</div>';
    }
    if (n > max) {
      html += '<div style="width:' + size + 'px; height:' + size + 'px; border-radius:50%; background:rgba(11,22,34,0.7); border:2px solid ' + border + '; margin-left:-10px; display:flex; align-items:center; justify-content:center; font-family:\'Space Mono\',monospace; font-size:10px; font-weight:700; color:#2B2118;">+' + (n - max) + '</div>';
    }
    return '<div style="display:flex;">' + html + '</div>';
  }

  function metaLine(t) {
    if (!t.expenseCount) return "no tabs yet · tap to start";
    var noun = t.expenseCount === 1 ? "tab" : "tabs";
    var ppl = t.memberCount === 1 ? "1 person" : t.memberCount + " people";
    return t.expenseCount + " " + noun + " · " + ppl;
  }

  // right-side state: per-trip net (+blue / −coral) or "square ✨" chip.
  function netBlock(t, big) {
    if (t.settledUp || t.netCents === 0 || t.netCents == null) {
      return '<span style="display:inline-flex; align-items:center; gap:5px; background:rgba(61,232,199,0.14); border:1px solid rgba(61,232,199,0.4); border-radius:999px; padding:5px 11px;">' +
        '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:12px; letter-spacing:0.3px; color:#3DE8C7;">square</span>' +
        '<span style="font-size:12px;">✨</span>' +
      '</span>';
    }
    var pos = t.netCents > 0;
    var col = pos ? "#2775CA" : "#FF6B5E";
    var label = pos ? "you're owed" : "you owe";
    var labelCol = pos ? "rgba(43,33,24,0.45)" : "rgba(255,107,94,0.85)";
    var sign = pos ? "+$" : "−$";
    var amtFs = big ? "25px" : "21px";
    return '<div style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:' + (big ? "11px" : "10.5px") + '; color:' + labelCol + '; margin-bottom:2px;">' + label + '</div>' +
      '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:' + amtFs + '; letter-spacing:-0.5px; color:' + col + ';"><span style="opacity:.55;">' + sign + '</span>' + money3(t.netCents) + '</div>';
  }

  // full-width hero card (first / featured group). Lifted "tokyo trip" markup.
  function heroCard(t) {
    var cov = coverFor(t);
    var emoji = groupEmoji(t, cov);
    return '<a href="#/group/' + encodeURIComponent(t.id) + '" style="grid-column:1 / -1; text-decoration:none; color:inherit; background:#FFFDF7; border-radius:23px; overflow:hidden; border:1px solid rgba(43,33,24,0.06); box-shadow:0 10px 28px rgba(43,33,24,0.13); display:block;">' +
      '<div style="position:relative; height:84px; background:' + cov.grad + '; display:flex; align-items:center; padding:0 18px; overflow:hidden;">' +
        coverDeco("74px", cov.dark) +
        '<span style="position:relative; font-size:38px; filter:drop-shadow(0 3px 6px rgba(0,0,0,0.3));">' + emoji + '</span>' +
        '<div style="position:absolute; right:16px; bottom:13px;">' + memberStack(t, 3, 30, "#2775CA") + '</div>' +
      '</div>' +
      '<div style="padding:15px 18px 17px; display:flex; align-items:flex-end; justify-content:space-between; gap:12px;">' +
        '<div style="min-width:0;">' +
          '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:21px; letter-spacing:-0.3px; color:#2B2118;">' + app.esc((t.name || "").toLowerCase()) + '</div>' +
          '<div style="font-family:\'General Sans\',sans-serif; font-weight:400; font-size:13.5px; color:rgba(43,33,24,0.55); margin-top:4px;">' + app.esc(metaLine(t)) + '</div>' +
        '</div>' +
        '<div style="text-align:right; flex:none;">' + netBlock(t, true) + '</div>' +
      '</div>' +
    '</a>';
  }

  // compact bento card (half-width). Lifted "apartment 4b" / "bali crew" markup.
  function bentoCard(t) {
    var cov = coverFor(t);
    var emoji = groupEmoji(t, cov);
    return '<a href="#/group/' + encodeURIComponent(t.id) + '" style="text-decoration:none; color:inherit; background:#FFFDF7; border-radius:23px; overflow:hidden; border:1px solid rgba(43,33,24,0.06); box-shadow:0 8px 22px rgba(43,33,24,0.13); display:block;">' +
      '<div style="position:relative; height:62px; background:' + cov.grad + '; display:flex; align-items:center; padding:0 16px; overflow:hidden;">' +
        coverDeco("14px", cov.dark) +
        '<span style="position:relative; font-size:30px; filter:drop-shadow(0 2px 5px rgba(0,0,0,0.28));">' + emoji + '</span>' +
      '</div>' +
      '<div style="padding:13px 16px 15px;">' +
        '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; letter-spacing:-0.2px; color:#2B2118;">' + app.esc((t.name || "").toLowerCase()) + '</div>' +
        '<div style="font-family:\'General Sans\',sans-serif; font-weight:400; font-size:12px; color:rgba(43,33,24,0.55); margin-top:3px;">' + app.esc(metaLine(t)) + '</div>' +
        '<div style="margin-top:12px;">' + netBlock(t, false) + '</div>' +
      '</div>' +
    '</a>';
  }

  // horizontal full-width card (varied rhythm). Lifted "roommates" markup.
  function rowCard(t) {
    var cov = coverFor(t);
    var emoji = groupEmoji(t, cov);
    return '<a href="#/group/' + encodeURIComponent(t.id) + '" style="grid-column:1 / -1; text-decoration:none; color:inherit; display:flex; background:#FFFDF7; border-radius:23px; overflow:hidden; border:1px solid rgba(43,33,24,0.06); box-shadow:0 8px 22px rgba(43,33,24,0.13); min-height:92px;">' +
      '<div style="position:relative; width:98px; flex:none; background:' + cov.grad + '; display:flex; align-items:center; justify-content:center; overflow:hidden;">' +
        coverDeco("0", cov.dark) +
        '<span style="position:relative; font-size:34px; filter:drop-shadow(0 2px 5px rgba(0,0,0,0.18));">' + emoji + '</span>' +
      '</div>' +
      '<div style="flex:1; min-width:0; padding:15px 18px; display:flex; align-items:center; justify-content:space-between; gap:12px;">' +
        '<div style="min-width:0;">' +
          '<div style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:18px; letter-spacing:-0.2px; color:#2B2118;">' + app.esc((t.name || "").toLowerCase()) + '</div>' +
          '<div style="font-family:\'General Sans\',sans-serif; font-weight:400; font-size:12.5px; color:rgba(43,33,24,0.55); margin-top:4px;">' + app.esc(metaLine(t)) + '</div>' +
        '</div>' +
        '<div style="text-align:right; flex:none;">' + netBlock(t, false) + '</div>' +
      '</div>' +
    '</a>';
  }

  // bento rhythm: first = hero; every 3rd compact slot becomes a wide row.
  function bento(trips) {
    var html = '<div style="display:grid; grid-template-columns:1fr 1fr; gap:13px; margin-top:20px;">';
    for (var i = 0; i < trips.length; i++) {
      var t = trips[i];
      if (i === 0) html += heroCard(t);
      else if ((i - 1) % 3 === 2) html += rowCard(t);
      else html += bentoCard(t);
    }
    html += '</div>';
    return html;
  }

  // ---- "+ new group" button (lifted gradient pill from frame) -----------
  function newGroupBtn() {
    return '<button id="gNew" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:56px; margin-top:18px; border-radius:999px; background:#2775CA; border:2px solid #2B2118; display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">' +
      '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
      '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#fff;">new group</span>' +
    '</button>';
  }

  // ---- new group sheet (POST /api/trips) — kept from existing wiring -----
  function openNewGroup() {
    var rows = "";
    for (var i = 0; i < 3; i++) {
      rows += '<input class="input gMember" placeholder="' + (i === 0 ? "you" : "member name") + '" style="margin-top:9px;">';
    }
    var el = app.sheet(
      '<h2 class="lower" style="font-size:22px;margin:2px 0 4px;">new group</h2>' +
      '<p class="hint" style="margin:0 0 16px;">a trip, the rent, or last night\'s dinner.</p>' +
      '<label>group name</label>' +
      '<input class="input" id="gName" placeholder="tokyo trip" autocomplete="off">' +
      '<label style="margin-top:16px;">who\'s in</label>' +
      rows +
      '<button class="pill" id="gAddMember" style="margin-top:11px;">+ add another</button>' +
      '<button class="btn" id="gCreate" style="margin-top:20px;">start group 🎉</button>'
    );
    var add = el.querySelector("#gAddMember");
    if (add) add.onclick = function () {
      var inp = document.createElement("input");
      inp.className = "input gMember";
      inp.placeholder = "member name";
      inp.style.marginTop = "9px";
      add.parentNode.insertBefore(inp, add);
      inp.focus();
    };
    var create = el.querySelector("#gCreate");
    if (create) create.onclick = function () { submitNewGroup(el, create); };
    var nameEl = el.querySelector("#gName");
    if (nameEl) nameEl.focus();
  }

  async function submitNewGroup(el, btn) {
    var nameEl = el.querySelector("#gName");
    var name = nameEl ? nameEl.value.trim() : "";
    if (!name) { app.toast("give it a name"); if (nameEl) nameEl.focus(); return; }
    var members = [];
    Array.prototype.forEach.call(el.querySelectorAll(".gMember"), function (inp) {
      var v = inp.value.trim();
      if (v) members.push({ name: v });
    });
    if (!members.length) members.push({ name: "you" });
    btn.disabled = true;
    btn.textContent = "starting…";
    try {
      var trip = await app.api.post("/api/trips", { name: name, members: members });
      app.closeSheet();
      app.toast("group started ✨");
      location.hash = "#/group/" + encodeURIComponent(trip.id);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "start group 🎉";
      app.toast(e.message || "couldn't start group");
    }
  }

  function wireNew(view) {
    var b = view.querySelector("#gNew");
    if (b) b.onclick = openNewGroup;
  }

  // ---- signed-out -------------------------------------------------------
  function signedOut(view) {
    view.innerHTML = '<div class="appscroll" style="padding:14px 18px 112px;">' +
      brandRow() + header(0) +
      '<div style="display:flex; flex-direction:column; align-items:center; text-align:center; padding:50px 30px 0;">' +
        app.mascot({ size: 116, mood: "happy", glow: true }) +
        '<h2 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:23px; letter-spacing:-0.3px; margin:24px 0 0; color:#2B2118;">connect to see your groups</h2>' +
        '<p style="font-family:\'General Sans\',sans-serif; font-weight:400; font-size:14.5px; line-height:1.45; max-width:240px; margin:11px 0 0; color:rgba(43,33,24,0.55);">your tabs, trips and roommates live here — split now, settle later.</p>' +
        '<button class="btn" id="gConnect" style="max-width:300px; margin-top:24px;">connect a wallet</button>' +
      '</div></div>';
    var c = document.getElementById("gConnect");
    if (c) c.onclick = function () {
      if (window.Auth) Auth.createWallet().catch(function (e) { app.toast(e.message); });
    };
  }

  // ---- empty state (lifted from frame) ----------------------------------
  function emptyState(view) {
    view.innerHTML = '<div class="appscroll" style="padding:14px 18px 112px;">' +
      brandRow() + header(0) +
      '<div style="display:flex; flex-direction:column; align-items:center; text-align:center; padding:66px 30px 0;">' +
        app.mascot({ size: 108, mood: "happy", glow: true }) +
        '<h2 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:23px; letter-spacing:-0.3px; margin:30px 0 0; color:#2B2118;">no tabs yet — start one 🎉</h2>' +
        '<p style="font-family:\'General Sans\',sans-serif; font-weight:400; font-size:14.5px; line-height:1.45; max-width:240px; margin:11px 0 0; color:rgba(43,33,24,0.55);">split a trip, the rent, or last night\'s dinner. settle in dollars, just faster.</p>' +
        '<button id="gNew" style="appearance:none; border:none; cursor:pointer; min-height:54px; margin-top:26px; border-radius:999px; background:#2775CA; border:2px solid #2B2118; padding:0 26px; display:flex; align-items:center; gap:9px; box-shadow:3px 3px 0 rgba(43,33,24,0.9);">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
          '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16.5px; color:#fff;">start a tab</span>' +
        '</button>' +
      '</div></div>';
    wireNew(view);
  }

  // ---- loading ----------------------------------------------------------
  function skeleton(view) {
    view.innerHTML = '<div class="appscroll" style="padding:14px 18px 112px;">' +
      brandRow() + header(0) +
      '<div class="skeleton" style="height:150px; border-radius:18px; margin:24px 0 8px;"></div>' +
      '<div style="display:grid; grid-template-columns:1fr 1fr; gap:13px; margin-top:20px;">' +
        '<div class="skeleton" style="grid-column:1 / -1; height:160px; border-radius:23px;"></div>' +
        '<div class="skeleton" style="height:150px; border-radius:23px;"></div>' +
        '<div class="skeleton" style="height:150px; border-radius:23px;"></div>' +
      '</div>' +
    '</div>';
  }

  // ---- signed-in --------------------------------------------------------
  async function signedIn(view) {
    skeleton(view);

    // Primary source: the trips list (member/expense meta). Keep this wiring.
    var trips;
    try {
      trips = await app.api.get("/api/trips?mine=1");
    } catch (e) {
      view.innerHTML = '<div class="appscroll" style="padding:14px 18px 112px;">' +
        brandRow() + header(0) +
        '<div class="empty"><div class="title lower">couldn\'t load groups</div><div class="hint">' + app.esc(e.message) + '</div>' +
        newGroupBtn() + '</div></div>';
      wireNew(view);
      return;
    }
    trips = Array.isArray(trips) ? trips : [];
    if (!trips.length) { emptyState(view); return; }

    // newest first
    trips.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

    // Overlay cross-trip net balance for the hero + per-card +/− chips.
    // Best-effort: never crash the screen if this secondary call fails.
    var totals = null, counterparties = [];
    try {
      var d = await app.api.get("/api/me/balances");
      totals = d && d.totals;
      counterparties = (d && d.counterparties) || [];
      var byId = {};
      ((d && d.trips) || []).forEach(function (te) { byId[te.tripId] = te; });
      trips.forEach(function (t) {
        var te = byId[t.id];
        if (te) t.netCents = te.netCents;
      });
    } catch (_) { /* fall back to settledUp-only cards */ }

    view.innerHTML = '<div class="appscroll" style="padding:14px 18px 112px;">' +
      brandRow() +
      header(trips.length) +
      (totals ? hero(totals, counterparties) : "") +
      bento(trips) +
      newGroupBtn() +
    '</div>';
    wireNew(view);
    if (app.enter) app.enter(view.querySelector(".appscroll"));
    // pull down at the top to re-pull trips + balances and re-render.
    app.pullToRefresh(view.querySelector(".appscroll"), function () { return signedIn(view); });
  }

  // ---- entry ------------------------------------------------------------
  var authUnsub = null; // single auth listener; released each render so it can't leak
  window.Screens = window.Screens || {};
  window.Screens.groups = {
    title: "groups",
    render: function (view) {
      if (authUnsub) { authUnsub(); authUnsub = null; }
      var user = window.Auth && window.Auth.user;
      if (user) signedIn(view);
      else signedOut(view);
      if (window.Auth && window.Auth.onChange) authUnsub = window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("groups") >= 0) {
          if (u) signedIn(view); else signedOut(view);
        }
      });
    },
  };
})();
