/* screens/groups.js — Groups (#/groups). Your groups, bento-style.
   Matches design/frames/Groups Playful.dc.html; follows the contract in
   design/BUILD.md and the patterns in screens/home.js. */
(function () {
  "use strict";
  var app = window.app;

  function topbar() {
    return '<div class="topbar">' +
      '<div class="brand"><span class="mark"><span>/</span></span><span class="word">divvy</span></div>' +
      '<div style="transform:scale(.42);transform-origin:right center;width:74px;height:46px;overflow:visible;display:flex;justify-content:flex-end;">' +
        app.mascot({ size: 86, mood: "wave", glow: false }) +
      '</div></div>';
  }

  // ---- signed-out -------------------------------------------------------
  function signedOut(view) {
    view.innerHTML = topbar() +
      '<div class="appscroll" style="display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:46px;">' +
        '<div style="margin:6px 0 4px;">' + app.mascot({ size: 124, mood: "happy", glow: true }) + '</div>' +
        '<h1 style="font-size:23px;max-width:280px;margin-top:18px;" class="lower">connect to see your groups</h1>' +
        '<p class="hint" style="max-width:240px;margin:11px 0 0;">your tabs, trips and roommates live here — split now, settle later.</p>' +
        '<button class="btn" id="gConnect" style="max-width:300px;margin-top:24px;">connect a wallet</button>' +
      '</div>';
    var c = document.getElementById("gConnect");
    if (c) c.onclick = function () {
      if (window.Auth) Auth.createWallet().catch(function (e) { app.toast(e.message); });
    };
  }

  // ---- loading ----------------------------------------------------------
  function skeleton(view) {
    view.innerHTML = topbar() + '<div class="appscroll">' +
      '<div class="skeleton" style="height:38px;width:60%;margin:8px 0 22px;"></div>' +
      '<div class="skeleton" style="height:128px;margin:0 0 13px;"></div>' +
      '<div style="display:flex;gap:13px;">' +
        '<div class="skeleton" style="height:140px;flex:1;"></div>' +
        '<div class="skeleton" style="height:140px;flex:1;"></div>' +
      '</div>' +
      '<div class="skeleton" style="height:92px;margin:13px 0 0;"></div>' +
    '</div>';
  }

  // ---- helpers ----------------------------------------------------------
  // covers cycle through the brand palette so cards feel varied, not identical.
  var COVERS = [
    { grad: "linear-gradient(125deg,#3a93ec 0%,#2775CA 58%,#1d5697 100%)", emoji: "🗼" },
    { grad: "linear-gradient(125deg,#ff8073,#FF6B5E 60%,#e0493c)", emoji: "🏠" },
    { grad: "linear-gradient(125deg,#5cf0d4,#3DE8C7 55%,#1fbfa3)", emoji: "🏝️" },
    { grad: "linear-gradient(155deg,#ffd47e,#FFC65C 58%,#f0a92f)", emoji: "🧻" },
    { grad: "linear-gradient(125deg,#a78bfa,#8B5CF6 60%,#6d3fd1)", emoji: "🍜" },
  ];
  function seed(s) {
    var h = 0, str = String(s || "");
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }
  function coverFor(t) { return COVERS[seed(t.id) % COVERS.length]; }

  // a small dotted "paper" texture + dashed perforation overlay for a cover.
  function coverDeco(light) {
    var dot = light ? "rgba(255,255,255,0.10)" : "rgba(11,22,34,0.14)";
    var dash = light ? "rgba(255,255,255,0.7)" : "rgba(11,22,34,0.5)";
    return '<div style="position:absolute;inset:0;background-image:repeating-radial-gradient(circle at 18% 120%,' + dot + ' 0 1px,transparent 1px 7px);opacity:.55;"></div>' +
      '<div style="position:absolute;top:0;bottom:0;right:14px;width:2.5px;background:repeating-linear-gradient(180deg,' + dash + ' 0 4px,transparent 4px 8px);opacity:.45;"></div>';
  }

  // member avatar-stack (list summaries don't ship members, so synthesize
  // deterministic emoji-on-color faces from the trip id + count).
  var FACES = ["🐼", "🦊", "🐯", "🐻", "🐸", "🐰", "🐨", "🦁"];
  function memberStack(t, max) {
    var n = t.memberCount || 0;
    var shown = Math.min(n, max);
    var html = "";
    for (var i = 0; i < shown; i++) {
      var sd = seed(t.id + ":m" + i);
      var bg = app.colorFor(t.id + ":m" + i);
      var face = FACES[sd % FACES.length];
      html += '<span style="width:30px;height:30px;border-radius:50%;background:' + bg +
        ';border:2px solid var(--ink);margin-left:' + (i ? "-10px" : "0") +
        ';display:inline-flex;align-items:center;justify-content:center;font-size:13px;">' +
        face + '</span>';
    }
    if (n > max) {
      html += '<span style="width:30px;height:30px;border-radius:50%;background:rgba(11,22,34,0.7);border:2px solid var(--ink);margin-left:-10px;display:inline-flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:10px;font-weight:700;color:var(--text);">+' + (n - max) + '</span>';
    }
    return '<div style="display:inline-flex;align-items:center;">' + html + '</div>';
  }

  function lastActivity(t) {
    if (!t.expenseCount) return "no tabs yet · tap to start";
    var noun = t.expenseCount === 1 ? "tab" : "tabs";
    return t.expenseCount + " " + noun + " · " + t.memberCount + " in";
  }

  // a full-width hero card (first / featured group).
  function heroCard(t) {
    var cov = coverFor(t);
    var settled = t.settledUp;
    return '<a href="#/group/' + encodeURIComponent(t.id) + '" style="grid-column:1 / -1;text-decoration:none;color:inherit;background:var(--card);border-radius:23px;overflow:hidden;border:1px solid var(--line);box-shadow:0 10px 28px rgba(0,0,0,0.28);display:block;">' +
      '<div style="position:relative;height:84px;background:' + cov.grad + ';display:flex;align-items:center;padding:0 18px;overflow:hidden;">' +
        coverDeco(true) +
        '<span style="position:relative;font-size:38px;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.3));">' + cov.emoji + '</span>' +
        '<div style="position:absolute;right:16px;bottom:13px;">' + memberStack(t, 3) + '</div>' +
      '</div>' +
      '<div style="padding:15px 18px 17px;display:flex;align-items:flex-end;justify-content:space-between;gap:12px;">' +
        '<div style="min-width:0;">' +
          '<div class="display" style="font-size:21px;color:var(--text);">' + app.esc(t.name.toLowerCase()) + '</div>' +
          '<div class="sub mono" style="font-size:12.5px;color:var(--muted);margin-top:4px;">' + app.esc(lastActivity(t)) + '</div>' +
        '</div>' +
        '<div style="text-align:right;flex:none;">' +
          (settled
            ? '<span class="state settled">square ✨</span>'
            : '<div class="eyebrow" style="margin-bottom:3px;">tab total</div>' + app.money(t.totalCents, "pos")) +
        '</div>' +
      '</div>' +
    '</a>';
  }

  // a compact bento card (half-width).
  function bentoCard(t) {
    var cov = coverFor(t);
    return '<a href="#/group/' + encodeURIComponent(t.id) + '" style="text-decoration:none;color:inherit;background:var(--card);border-radius:23px;overflow:hidden;border:1px solid var(--line);box-shadow:0 8px 22px rgba(0,0,0,0.24);display:block;">' +
      '<div style="position:relative;height:62px;background:' + cov.grad + ';display:flex;align-items:center;padding:0 16px;overflow:hidden;">' +
        coverDeco(true) +
        '<span style="position:relative;font-size:30px;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.28));">' + cov.emoji + '</span>' +
      '</div>' +
      '<div style="padding:13px 16px 15px;">' +
        '<div class="display" style="font-size:17px;color:var(--text);">' + app.esc(t.name.toLowerCase()) + '</div>' +
        '<div class="sub mono" style="font-size:11.5px;color:var(--muted);margin-top:3px;">' + app.esc(lastActivity(t)) + '</div>' +
        '<div style="margin-top:12px;">' +
          (t.settledUp
            ? '<span class="state settled">square ✨</span>'
            : app.money(t.totalCents, "pos")) +
        '</div>' +
      '</div>' +
    '</a>';
  }

  // horizontal full-width card (varied rhythm).
  function rowCard(t) {
    var cov = coverFor(t);
    return '<a href="#/group/' + encodeURIComponent(t.id) + '" style="grid-column:1 / -1;text-decoration:none;color:inherit;display:flex;background:var(--card);border-radius:23px;overflow:hidden;border:1px solid var(--line);box-shadow:0 8px 22px rgba(0,0,0,0.24);min-height:92px;">' +
      '<div style="position:relative;width:98px;flex:none;background:' + cov.grad + ';display:flex;align-items:center;justify-content:center;overflow:hidden;">' +
        coverDeco(true) +
        '<span style="position:relative;font-size:34px;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.18));">' + cov.emoji + '</span>' +
      '</div>' +
      '<div style="flex:1;min-width:0;padding:15px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
        '<div style="min-width:0;">' +
          '<div class="display" style="font-size:18px;color:var(--text);">' + app.esc(t.name.toLowerCase()) + '</div>' +
          '<div class="sub mono" style="font-size:12px;color:var(--muted);margin-top:4px;">' + app.esc(lastActivity(t)) + '</div>' +
        '</div>' +
        '<div style="text-align:right;flex:none;">' +
          (t.settledUp ? '<span class="state settled">square ✨</span>' : app.money(t.totalCents, "pos")) +
        '</div>' +
      '</div>' +
    '</a>';
  }

  // pick a card variant by position for the bento rhythm.
  function bento(trips) {
    var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-top:20px;">';
    for (var i = 0; i < trips.length; i++) {
      var t = trips[i];
      if (i === 0) html += heroCard(t);
      else if ((i - 1) % 3 === 2) html += rowCard(t);  // every 3rd compact slot becomes a wide row
      else html += bentoCard(t);
    }
    html += '</div>';
    return html;
  }

  // ---- new group sheet --------------------------------------------------
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
    var membersWrap = el;
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
      var trip = await app.api.post("/api/trips", { name: name, cluster: "devnet", members: members });
      app.closeSheet();
      app.toast("group started ✨");
      location.hash = "#/group/" + encodeURIComponent(trip.id);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "start group 🎉";
      app.toast(e.message || "couldn't start group");
    }
  }

  function newGroupBtn(wide) {
    return '<button class="btn" id="gNew" style="' + (wide ? "margin-top:18px;" : "max-width:260px;margin-top:8px;") + '">+ new group</button>';
  }

  // ---- empty ------------------------------------------------------------
  function emptyState(view) {
    view.innerHTML = topbar() + '<div class="appscroll">' + header(0) +
      '<div class="empty" style="padding-top:48px;">' +
        app.mascot({ size: 116, mood: "happy", glow: true }) +
        '<div class="title lower" style="margin-top:18px;">no tabs yet — start one 🎉</div>' +
        '<div class="hint" style="max-width:240px;">split a trip, the rent, or last night\'s dinner. settle in dollars, just faster.</div>' +
        newGroupBtn(false) +
      '</div></div>';
    wireNew(view);
  }

  function header(count) {
    var sub = count === 1 ? "1 active" : count + " active";
    return '<div style="display:flex;align-items:baseline;gap:11px;margin:18px 0 2px;">' +
      '<h1 style="font-size:33px;line-height:1;" class="lower">your groups</h1>' +
      '<span class="mono" style="font-size:12px;color:var(--faint);">' + sub + '</span>' +
    '</div>';
  }

  function wireNew(view) {
    var b = view.querySelector("#gNew");
    if (b) b.onclick = openNewGroup;
  }

  // ---- signed-in --------------------------------------------------------
  async function signedIn(view) {
    skeleton(view);
    var trips;
    try {
      trips = await app.api.get("/api/trips?mine=1");
    } catch (e) {
      view.innerHTML = topbar() + '<div class="appscroll">' + header(0) +
        '<div class="empty"><div class="title lower">couldn\'t load groups</div><div class="hint">' + app.esc(e.message) + '</div>' + newGroupBtn(false) + '</div></div>';
      wireNew(view);
      return;
    }
    trips = Array.isArray(trips) ? trips : [];
    if (!trips.length) { emptyState(view); return; }

    // newest first
    trips.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

    view.innerHTML = topbar() + '<div class="appscroll">' +
      header(trips.length) +
      bento(trips) +
      newGroupBtn(true) +
    '</div>';
    wireNew(view);
  }

  // ---- entry ------------------------------------------------------------
  window.Screens = window.Screens || {};
  window.Screens.groups = {
    title: "groups",
    render: function (view) {
      var user = window.Auth && window.Auth.user;
      if (user) signedIn(view);
      else signedOut(view);
      if (window.Auth && window.Auth.onChange) window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("groups") >= 0) {
          if (u) signedIn(view); else signedOut(view);
        }
      });
    },
  };
})();
