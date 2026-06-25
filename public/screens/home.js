/* screens/home.js — Home / balances. Reference implementation of the screen
   contract (see design/BUILD.md), matching design/frames/Home Playful.dc.html. */
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

  function signedOut(view) {
    view.innerHTML = topbar() +
      '<div class="appscroll" style="display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:30px;">' +
        '<div style="margin:10px 0 4px;">' + app.mascot({ size: 132, mood: "happy", glow: true }) + '</div>' +
        '<h1 style="font-size:26px;max-width:300px;margin-top:10px;" class="lower">split the bill. get your money back — before you leave the table.</h1>' +
        '<div class="eyebrow" style="margin:16px 0 22px;">split bills · settle in usdc</div>' +
        '<button class="btn" id="hCreate" style="max-width:320px;">create a wallet</button>' +
        '<button class="btn ghost" id="hConnect" style="max-width:320px;margin-top:11px;">connect a wallet</button>' +
        '<div class="eyebrow" style="margin-top:22px;color:var(--faint);">non-custodial · your keys · usdc on solana</div>' +
      '</div>';
    var c = document.getElementById("hCreate"), n = document.getElementById("hConnect");
    if (c) c.onclick = function () { if (window.Auth) Auth.createWallet().catch(function (e) { app.toast(e.message); }); };
    if (n) n.onclick = function () { if (window.Auth) Auth.signInWithWallet().catch(function (e) { app.toast(e.message); }); };
  }

  function skeleton(view) {
    var rows = "";
    for (var i = 0; i < 3; i++) rows += '<div class="skeleton" style="height:58px;margin:10px 0;"></div>';
    view.innerHTML = topbar() + '<div class="appscroll"><div class="skeleton" style="height:150px;margin:8px 0 20px;"></div>' + rows + "</div>";
  }

  function personRow(c) {
    var kind = c.direction === "owed" ? "pos" : c.direction === "owes" ? "neg" : "settled";
    var label = c.direction === "owed" ? "owes you" : c.direction === "owes" ? "you owe" : "square";
    return '<div class="row">' + app.avatar({ name: c.name, emoji: c.emoji, color: c.color }, "sm") +
      '<div class="meta"><div class="name lower">' + app.esc(c.name) + '</div>' +
      '<div class="sub">' + label + '</div></div>' +
      (c.direction === "settled" ? '<span class="state settled">square ✨</span>' : app.money(c.cents, kind, true)) + '</div>';
  }
  function groupRow(t) {
    var kind = t.netCents > 0 ? "pos" : t.netCents < 0 ? "neg" : "settled";
    return '<a class="row" style="text-decoration:none;color:inherit;cursor:pointer;" href="#/group/' + encodeURIComponent(t.tripId) + '">' +
      app.avatar({ name: t.name, emoji: t.emoji, color: t.color }) +
      '<div class="meta"><div class="name lower">' + app.esc(t.name) + '</div>' +
      '<div class="sub">' + (t.subtitle || (t.memberCount ? t.memberCount + " people" : "tap to open")) + '</div></div>' +
      (t.netCents === 0 ? '<span class="state settled">square ✨</span>' : app.money(t.netCents, kind, true)) + '</a>';
  }

  async function signedIn(view) {
    skeleton(view);
    var d;
    try { d = await app.api.get("/api/me/balances"); }
    catch (e) { view.innerHTML = topbar() + '<div class="empty"><div class="title lower">couldn\'t load balances</div><div class="hint">' + app.esc(e.message) + "</div></div>"; return; }
    var t = d.totals || {}, net = t.netCents || 0;
    var owed = t.owedCents || 0, owe = t.owesCents || 0, tot = owed + owe || 1;
    var ppl = (d.counterparties || []), grp = (d.trips || []);

    var heroKind = net > 0 ? "pos" : net < 0 ? "neg" : "settled";
    var sub = owe > 0 ? '…but you owe ' + app.money(owe, "neg").replace(/<span class="cur">[−]?\$/, '<span class="cur">$') + ' elsewhere'
                      : (net > 0 ? "everyone owes you 🤑" : "you're all square ✨");

    var hero = '<div class="receipt glow-blue" style="margin:6px 0 18px;">' +
      '<div class="eyebrow">' + (net >= 0 ? "you're up" : "you're down") + ' · across ' + grp.length + ' groups</div>' +
      '<div class="hero-amount ' + heroKind + '" style="margin:8px 0 6px;color:' + (net > 0 ? "var(--blue-bright)" : net < 0 ? "var(--coral)" : "var(--mint)") + ';">' +
        (net >= 0 ? "+" : "−") + "$" + Math.abs(net / 100).toLocaleString(undefined, { minimumFractionDigits: 2 }) + '</div>' +
      '<div class="sub mono" style="color:var(--muted);font-size:13px;">' + sub + '</div>' +
      '<div class="owebar" style="margin:14px 0 4px;"><div class="pos" style="width:' + (owed / tot * 100) + '%"></div><div class="neg" style="width:' + (owe / tot * 100) + '%"></div></div>' +
      '<div style="display:flex;gap:10px;margin-top:16px;">' +
        '<button class="btn" id="hSettle" style="flex:1;min-height:50px;font-size:15px;">settle up 💸</button>' +
        '<button class="btn ghost" id="hRequest" style="flex:1;min-height:50px;font-size:15px;">request</button>' +
      '</div></div>';

    var people = ppl.length ? '<div class="eyebrow" style="margin:18px 0 4px;">people</div><div class="card">' + ppl.map(personRow).join("") + "</div>" : "";
    var groups = grp.length ? '<div class="eyebrow" style="margin:18px 0 4px;">your groups</div><div class="card">' + grp.map(groupRow).join("") + "</div>" :
      '<div class="empty" style="padding-top:24px;">' + app.mascot({ size: 96, mood: "happy" }) + '<div class="title lower">no tabs yet</div><div class="hint">start a group and split something 🎉</div><button class="btn" style="max-width:240px;margin-top:8px;" onclick="location.hash=\'#/new\'">new tab</button></div>';

    view.innerHTML = topbar() + '<div class="appscroll">' + hero + people + groups + "</div>";
    var s = document.getElementById("hSettle"), rq = document.getElementById("hRequest");
    if (s) s.onclick = function () { app.go("groups"); };
    if (rq) rq.onclick = function () { app.go("new"); };
  }

  window.Screens = window.Screens || {};
  window.Screens.home = {
    title: "home",
    render: function (view) {
      var user = window.Auth && window.Auth.user;
      if (user) return signedIn(view);
      signedOut(view);
      // re-render when auth resolves
      if (window.Auth && window.Auth.onChange) window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("home") >= 0) { if (u) signedIn(view); else signedOut(view); }
      });
    },
  };
})();
