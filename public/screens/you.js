/* screens/you.js — You / profile. Identity, USDC balance, and settings.
   Matches design/frames/You Profile Frames.dc.html (see design/BUILD.md). */
(function () {
  "use strict";
  var app = window.app;

  var PROFILE_KEY = "divvy.profile"; // local emoji/color until the API carries them

  function localProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}") || {}; }
    catch (_) { return {}; }
  }

  // header: title "you" + settings gear, full-body mascot waving top-right.
  function header() {
    var gear =
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="var(--muted)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="3.2"/>' +
        '<path d="M19.4 13.5a1.8 1.8 0 0 0 .36 1.98l.07.07a2.2 2.2 0 1 1-3.11 3.11l-.07-.07a1.8 1.8 0 0 0-3.04 1.28V21a2.2 2.2 0 0 1-4.4 0v-.1A1.8 1.8 0 0 0 5.5 19.4l-.07.07a2.2 2.2 0 1 1-3.11-3.11l.07-.07a1.8 1.8 0 0 0-1.28-3.04H1a2.2 2.2 0 0 1 0-4.4h.1A1.8 1.8 0 0 0 2.6 5.5l-.07-.07a2.2 2.2 0 1 1 3.11-3.11l.07.07a1.8 1.8 0 0 0 1.98.36H8a1.8 1.8 0 0 0 1.1-1.65V1a2.2 2.2 0 0 1 4.4 0v.1a1.8 1.8 0 0 0 3.04 1.28l.07-.07a2.2 2.2 0 1 1 3.11 3.11l-.07.07A1.8 1.8 0 0 0 21.9 8H22a2.2 2.2 0 0 1 0 4.4h-.1a1.8 1.8 0 0 0-1.5 1.1z"/></svg>';
    return '<div class="topbar" style="height:72px;">' +
      '<div style="display:flex;align-items:center;gap:12px;">' +
        '<h1 class="lower" style="font-size:28px;">you</h1>' +
        '<button id="yGear" aria-label="settings" style="appearance:none;cursor:pointer;width:36px;height:36px;border-radius:50%;background:var(--card);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;">' + gear + '</button>' +
      '</div>' +
      '<div style="transform:scale(.6);transform-origin:right center;width:80px;height:62px;overflow:visible;display:flex;justify-content:flex-end;align-items:center;">' +
        app.mascot({ size: 94, mood: "wave", glow: true }) +
      '</div></div>';
  }

  function truncWallet(w) {
    if (!w) return "no wallet linked";
    if (w.length <= 10) return w;
    return w.slice(0, 4) + "…" + w.slice(-4);
  }

  function copyIcon() {
    return '<svg id="yCopy" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--faint)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="cursor:pointer;flex:none;">' +
      '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  }

  // ── profile row ─────────────────────────────────────────────────────────────
  function profileRow(user) {
    var p = localProfile();
    var name = (user && (user.displayName || user.handle)) || "you";
    var handle = (user && user.handle) ? "@" + user.handle : "@you";
    var wallet = user && user.primaryWallet;
    var person = { name: name, emoji: p.emoji, color: p.color, id: user && user.id };

    return '<div style="display:flex;align-items:center;gap:15px;padding:6px 2px 2px;">' +
      '<span id="yAvatar" style="cursor:pointer;border-radius:22px;display:inline-flex;width:72px;height:72px;box-shadow:0 12px 28px rgba(0,0,0,0.3);flex:none;">' +
        avatarBig(person) +
      '</span>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
          '<span class="display" style="font-size:21px;">' + app.esc((name || "").toLowerCase()) + '</span>' +
          '<span class="mono" style="font-size:12px;color:var(--blue-bright);opacity:.85;">' + app.esc(handle.toLowerCase()) + '</span>' +
          '<a id="yEdit" class="mono" style="font-size:11px;color:var(--faint);cursor:pointer;text-decoration:none;">edit</a>' +
        '</div>' +
        '<div id="yWalletChip" style="display:inline-flex;align-items:center;gap:8px;margin-top:9px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:5px 11px;cursor:pointer;">' +
          '<span class="mono" style="font-size:11px;letter-spacing:.5px;color:var(--muted);">' + app.esc(truncWallet(wallet)) + '</span>' +
          (wallet ? copyIcon() : '') +
        '</div>' +
      '</div></div>';
  }

  // big rounded avatar (72px) reusing app.avatar emoji/color logic
  function avatarBig(person) {
    person = person || {};
    var emoji = person.emoji || (person.name ? person.name.trim()[0].toUpperCase() : "🙂");
    var bg = person.color || app.colorFor(person.id || person.name);
    return '<span style="width:72px;height:72px;border-radius:22px;display:inline-flex;align-items:center;justify-content:center;font-size:36px;background:' + bg + ';">' + app.esc(emoji) + '</span>';
  }

  // ── balance card (receipt style with money texture) ─────────────────────────
  function balanceCard(balanceCents) {
    var has = typeof balanceCents === "number" && isFinite(balanceCents);
    var bigMoney = has
      ? app.money(balanceCents, "pos", false)
      : '<span class="money" style="color:var(--muted);">—</span>';

    return '<div class="receipt paper glow-blue" style="margin-top:22px;padding:0;overflow:hidden;">' +
      '<div style="height:4px;background:linear-gradient(90deg,var(--blue),var(--mint));"></div>' +
      '<div style="padding:20px 20px 8px;">' +
        '<div class="mono" style="font-size:10px;letter-spacing:1.5px;color:var(--faint);">your balance</div>' +
        '<div style="display:flex;align-items:baseline;gap:10px;margin-top:11px;">' +
          '<span class="mono" style="font-size:48px;font-weight:700;line-height:.9;letter-spacing:-1.5px;color:var(--blue-bright);text-shadow:0 0 30px rgba(59,146,232,0.4);">' + bigMoney + '</span>' +
          '<span class="mono" style="font-size:12px;letter-spacing:1px;color:var(--faint);">usdc</span>' +
        '</div>' +
        '<div class="mono" style="display:inline-flex;align-items:center;gap:7px;margin-top:14px;border:1px solid rgba(39,117,202,0.4);background:rgba(39,117,202,0.1);border-radius:999px;padding:4px 11px;font-size:10px;color:var(--muted);">' +
          '<span style="width:6px;height:6px;border-radius:50%;background:var(--blue-bright);box-shadow:0 0 7px rgba(59,146,232,0.8);"></span>' +
          'settles instantly · ~$0.001 fee' +
        '</div>' +
      '</div>' +
      '<hr style="margin:18px 0 0;border:none;border-top:1.5px dashed var(--line-2);">' +
      '<div style="padding:18px 20px 20px;">' +
        '<div style="display:flex;gap:11px;">' +
          '<button class="btn" id="yAdd" style="flex:1;min-height:52px;font-size:15px;">＋ add money</button>' +
          '<button class="btn ghost" id="yCash" style="flex:1;min-height:52px;font-size:15px;">cash out</button>' +
        '</div>' +
        '<div class="mono" style="display:flex;align-items:center;gap:7px;justify-content:center;margin-top:14px;font-size:10px;color:var(--faint);">' +
          '<span>💳</span> spend it with any card. dollars, just faster.' +
        '</div>' +
      '</div></div>';
  }

  // ── settings list ───────────────────────────────────────────────────────────
  function settingRow(icon, tint, label, opts) {
    opts = opts || {};
    var chev = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="rgba(244,247,250,0.3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
    var tag = opts.tag
      ? '<span class="mono" style="font-size:10px;color:var(--faint);margin-right:2px;">' + app.esc(opts.tag) + '</span>'
      : "";
    var attrs = (opts.id ? ' id="' + opts.id + '"' : "") + (opts.href ? ' data-href="' + opts.href + '"' : "");
    return '<div class="yrow"' + attrs + ' style="display:flex;align-items:center;gap:13px;padding:14px 15px;cursor:pointer;">' +
      '<div style="width:34px;height:34px;border-radius:11px;background:' + tint + ';display:flex;align-items:center;justify-content:center;font-size:16px;flex:none;">' + icon + '</div>' +
      '<span class="lower" style="flex:1;font-weight:500;font-size:15px;">' + app.esc(label) + '</span>' +
      tag + chev + '</div>';
  }

  function divider() { return '<div style="height:1px;background:rgba(244,247,250,0.05);margin:0 15px;"></div>'; }

  function networkTag() {
    return '<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(61,232,199,0.1);border:1px solid rgba(61,232,199,0.35);border-radius:999px;padding:3px 9px;margin-right:2px;">' +
      '<span style="width:5px;height:5px;border-radius:50%;background:var(--mint);box-shadow:0 0 6px rgba(61,232,199,0.8);"></span>' +
      '<span class="mono" style="font-weight:700;font-size:9px;letter-spacing:.5px;color:var(--mint);">devnet</span></span>';
  }

  function settingsList() {
    var list =
      settingRow("🫂", "rgba(39,117,202,0.16)", "friends", { href: "#/friends" }) + divider() +
      settingRow("🔁", "rgba(61,232,199,0.14)", "recurring", { href: "#/recurring" }) + divider() +
      settingRow("🧾", "rgba(255,198,92,0.16)", "saved tabs", { id: "ySaved" }) + divider() +
      settingRow("🔔", "rgba(255,107,94,0.14)", "notifications", { id: "yNotif", tag: "on" }) + divider() +
      // network tag rendered inline below
      '<div class="yrow" id="yNet" style="display:flex;align-items:center;gap:13px;padding:14px 15px;cursor:pointer;">' +
        '<div style="width:34px;height:34px;border-radius:11px;background:rgba(39,117,202,0.16);display:flex;align-items:center;justify-content:center;font-size:16px;flex:none;">🌐</div>' +
        '<span class="lower" style="flex:1;font-weight:500;font-size:15px;">network</span>' + networkTag() +
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="rgba(244,247,250,0.3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>' +
      '</div>' + divider() +
      settingRow("💁", "rgba(244,247,250,0.07)", "help", { id: "yHelp" });

    return '<div class="mono" style="font-size:10px;letter-spacing:1.5px;color:var(--faint);padding:24px 2px 11px;">settings</div>' +
      '<div style="background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden;">' + list + '</div>';
  }

  function signOutCard() {
    return '<div style="margin-top:11px;background:rgba(255,107,94,0.06);border:1px solid rgba(255,107,94,0.2);border-radius:18px;overflow:hidden;">' +
      '<div id="ySignOut" style="display:flex;align-items:center;gap:13px;padding:14px 15px;cursor:pointer;">' +
        '<div style="width:34px;height:34px;border-radius:11px;background:rgba(255,107,94,0.14);display:flex;align-items:center;justify-content:center;flex:none;">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--coral)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>' +
        '</div>' +
        '<span class="lower" style="flex:1;font-weight:500;font-size:15px;color:var(--coral);">sign out</span>' +
      '</div></div>' +
      '<div class="mono" style="text-align:center;font-size:9.5px;letter-spacing:.5px;color:rgba(244,247,250,0.28);margin:18px 0 8px;">divvy v1.4.0 · made for splitting, not stressing</div>';
  }

  // ── signed-out ──────────────────────────────────────────────────────────────
  function signedOut(view) {
    view.innerHTML = header() +
      '<div class="appscroll" style="display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:30px;">' +
        '<div style="margin:10px 0 4px;">' + app.mascot({ size: 128, mood: "happy", glow: true }) + '</div>' +
        '<h1 class="lower" style="font-size:24px;max-width:300px;margin-top:10px;">your wallet, your tabs, your money.</h1>' +
        '<div class="eyebrow" style="margin:16px 0 22px;">connect to see your balance</div>' +
        '<button class="btn" id="yConnect" style="max-width:320px;">connect a wallet</button>' +
        '<button class="btn ghost" id="yCreate" style="max-width:320px;margin-top:11px;">create a wallet</button>' +
        '<div class="eyebrow" style="margin-top:22px;color:var(--faint);">non-custodial · your keys · usdc on solana</div>' +
      '</div>';
    wireGear();
    var c = document.getElementById("yConnect"), n = document.getElementById("yCreate");
    if (c) c.onclick = function () { if (window.Auth) Auth.signInWithWallet().catch(function (e) { app.toast(e.message); }); };
    if (n) n.onclick = function () { if (window.Auth) Auth.createWallet().catch(function (e) { app.toast(e.message); }); };
  }

  // ── signed-in ───────────────────────────────────────────────────────────────
  async function signedIn(view, user) {
    // best-effort balance; spec says fall back to "—" if unavailable.
    var balance = null;
    try {
      var b = await app.api.get("/api/me/balances");
      var t = (b && b.totals) || {};
      if (typeof t.walletCents === "number") balance = t.walletCents;
      else if (typeof t.balanceCents === "number") balance = t.balanceCents;
    } catch (_) { /* show — */ }

    view.innerHTML = header() +
      '<div class="appscroll">' +
        profileRow(user) +
        balanceCard(balance) +
        settingsList() +
        signOutCard() +
      '</div>';

    wireGear();
    wireProfile(user);
    wireBalance();
    wireSettings();
  }

  // ── wiring ──────────────────────────────────────────────────────────────────
  function wireGear() {
    var g = document.getElementById("yGear");
    if (g) g.onclick = function () { app.go("customize"); };
  }

  function wireProfile(user) {
    var av = document.getElementById("yAvatar"), ed = document.getElementById("yEdit");
    if (av) av.onclick = function () { app.go("customize"); };
    if (ed) ed.onclick = function () { app.go("customize"); };
    var chip = document.getElementById("yWalletChip");
    var wallet = user && user.primaryWallet;
    if (chip && wallet) chip.onclick = function () {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(wallet).then(function () { app.toast("wallet copied ✨"); },
            function () { app.toast(wallet); });
        } else { app.toast(wallet); }
      } catch (_) { app.toast(wallet); }
    };
  }

  function wireBalance() {
    var add = document.getElementById("yAdd"), cash = document.getElementById("yCash");
    if (add) add.onclick = function () { app.toast("add money — coming soon 💳"); };
    if (cash) cash.onclick = function () { app.toast("cash out — coming soon"); };
  }

  function wireSettings() {
    Array.prototype.forEach.call(document.querySelectorAll(".yrow[data-href]"), function (r) {
      r.onclick = function () { location.hash = r.getAttribute("data-href"); };
    });
    var saved = document.getElementById("ySaved");
    if (saved) saved.onclick = function () { app.go("groups"); };
    var notif = document.getElementById("yNotif");
    if (notif) notif.onclick = function () { app.toast("notifications — coming soon 🔔"); };
    var net = document.getElementById("yNet");
    if (net) net.onclick = function () { app.toast("on devnet · mainnet coming soon 🌐"); };
    var help = document.getElementById("yHelp");
    if (help) help.onclick = function () { app.toast("need a hand? we got you 💁"); };
    var so = document.getElementById("ySignOut");
    if (so) so.onclick = function () {
      if (window.Auth && Auth.signOut) Auth.signOut();
      app.toast("signed out");
      app.go("home");
    };
  }

  window.Screens = window.Screens || {};
  window.Screens.you = {
    title: "you",
    render: function (view) {
      var user = window.Auth && window.Auth.user;
      if (user) signedIn(view, user);
      else signedOut(view);
      // re-render when auth resolves / changes
      if (window.Auth && window.Auth.onChange) window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("you") >= 0) {
          if (u) signedIn(view, u); else signedOut(view);
        }
      });
    },
  };
})();
