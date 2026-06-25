/* screens/friends.js — Friends / your people. Matches
   design/frames/Friends Frames.dc.html. Add by @handle or wallet, see the net
   tab with each person, jump into a friend. See design/BUILD.md for contract.

   API:
     GET  /api/friends            -> { friends: [{ id, handle, displayName, primaryWallet, wallets[] }] }
     POST /api/friends {handle?,wallet?} -> { friend: {...} } (404 if not on divvy)
     GET  /api/me/balances        -> { totals, trips[], counterparties[] } (per-person net, best-effort)
     GET  /api/trips?mine=1       -> [{ id, name, memberCount, ... }]  (saved tabs chips)
*/
(function () {
  "use strict";
  var app = window.app;

  // ---- chrome -------------------------------------------------------------
  function topbar() {
    return '<div class="topbar">' +
      '<div class="brand"><span class="mark"><span>/</span></span><span class="word">divvy</span></div>' +
      '<div style="transform:scale(.42);transform-origin:right center;width:74px;height:46px;overflow:visible;display:flex;justify-content:flex-end;">' +
        app.mascot({ size: 86, mood: "watching", glow: false }) +
      '</div></div>';
  }

  function header(sub) {
    return '<div style="display:flex;align-items:flex-end;justify-content:space-between;margin:2px 0 6px;">' +
      '<div><h1 style="font-size:30px;letter-spacing:-.8px;margin:0;" class="lower">your people</h1>' +
      '<div class="eyebrow" style="letter-spacing:.3px;margin-top:4px;color:var(--faint);">' + sub + '</div></div>' +
      '</div>';
  }

  // ---- small bits ---------------------------------------------------------
  function shortWallet(w) {
    if (!w) return "";
    return w.length > 12 ? w.slice(0, 4) + "…" + w.slice(-4) : w;
  }
  function nameOf(f) {
    return f.displayName || (f.handle ? f.handle : (f.primaryWallet ? shortWallet(f.primaryWallet) : "friend"));
  }
  // QR svg (matches the frame's scan glyph)
  function qrSvg() {
    return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--blue-bright)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3M21 14v.01M21 21v-4M17 21h-3"/></svg>';
  }
  function copySvg() {
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  }

  // ---- add well -----------------------------------------------------------
  function addWell() {
    return '<div class="card card-2" style="border-color:rgba(39,117,202,0.28);padding:10px;display:flex;align-items:center;gap:9px;">' +
      '<input id="frInput" class="input mono" placeholder="@handle or wallet…" autocomplete="off" autocapitalize="off" spellcheck="false" ' +
        'style="flex:1;min-width:0;min-height:40px;padding:10px 12px;background:transparent;border:none;font-size:13px;" />' +
      '<button id="frQr" type="button" aria-label="scan a qr" style="width:40px;height:40px;flex:none;border-radius:12px;background:var(--card);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;cursor:pointer;">' + qrSvg() + '</button>' +
      '<button id="frAdd" type="button" aria-label="add" style="width:46px;height:40px;flex:none;border-radius:12px;border:none;cursor:pointer;background:var(--blue-grad);box-shadow:0 6px 18px rgba(39,117,202,0.5),inset 0 1px 0 rgba(255,255,255,0.28);display:flex;align-items:center;justify-content:center;">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;padding:8px 6px 2px;">' +
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(127,192,255,0.7)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z"/></svg>' +
        '<span class="mono" style="font-size:9.5px;letter-spacing:.3px;color:var(--faint);">scan their qr — never hand-type a wallet</span>' +
      '</div>' +
      '<div id="frStatus" class="mono" style="font-size:12px;color:var(--muted);min-height:0;margin:2px 4px 0;"></div>';
  }

  // ---- saved tabs chip strip ---------------------------------------------
  var TAB_EMOJI = ["🗼", "🏠", "🏝️", "🎟️", "🍜", "🛶"];
  function tabChip(t, i) {
    var em = TAB_EMOJI[i % TAB_EMOJI.length];
    var faces = "", n = Math.min(t.memberCount || 0, 3);
    for (var k = 0; k < n; k++) {
      faces += '<span style="width:15px;height:15px;border-radius:50%;background:' + app.colorFor(t.id + ":" + k) +
        ';border:1.5px solid var(--card);' + (k ? "margin-left:-5px;" : "") + 'display:inline-flex;"></span>';
    }
    return '<a href="#/group/' + encodeURIComponent(t.id) + '" style="flex:none;text-decoration:none;color:inherit;display:flex;align-items:center;gap:9px;background:var(--card);border:1px solid var(--line);border-radius:15px;padding:9px 13px 9px 11px;">' +
      '<span style="width:30px;height:30px;border-radius:10px;background:var(--blue-grad);display:flex;align-items:center;justify-content:center;font-size:15px;">' + em + '</span>' +
      '<div><div class="lower" style="font-weight:500;font-size:13px;">' + app.esc((t.name || "tab").toLowerCase()) + '</div>' +
      '<div style="display:flex;align-items:center;margin-top:3px;">' + faces + '</div></div></a>';
  }
  function savedTabs(trips) {
    if (!trips || !trips.length) return "";
    return '<div class="eyebrow" style="margin:4px 2px 11px;">saved tabs</div>' +
      '<div style="display:flex;gap:9px;overflow-x:auto;scrollbar-width:none;margin:0 -20px 4px;padding:0 20px 4px;">' +
        trips.slice(0, 8).map(tabChip).join("") + '</div>';
  }

  // ---- friend row ---------------------------------------------------------
  function friendRow(f) {
    var nm = nameOf(f);
    var handle = f.handle ? '<span class="mono" style="font-size:10.5px;color:rgba(127,192,255,0.75);">@' + app.esc(f.handle) + '</span>' : "";
    var wallet = f.primaryWallet || "";
    var walletBit = wallet
      ? '<div style="display:flex;align-items:center;gap:6px;margin-top:5px;"><span class="mono" style="font-size:11px;color:var(--faint);">' + app.esc(shortWallet(wallet)) + '</span>' +
        '<button class="frCopy" type="button" data-w="' + app.esc(wallet) + '" aria-label="copy wallet" style="background:none;border:none;padding:2px;cursor:pointer;display:inline-flex;line-height:0;">' + copySvg() + '</button></div>'
      : '<div class="mono" style="font-size:11px;color:var(--faint);margin-top:5px;">no wallet yet</div>';

    var net = (typeof f.netCents === "number") ? f.netCents : 0;
    var kind = net > 0 ? "pos" : net < 0 ? "neg" : "settled";
    var moneyOrSquare = net === 0
      ? '<span class="state settled">square ✨</span>'
      : app.money(net, kind, true);
    var pill = net === 0 ? ""
      : '<div style="margin-top:6px;"><span class="pill" style="padding:3px 10px;background:rgba(39,117,202,0.14);border-color:rgba(39,117,202,0.45);"><span class="mono" style="font-weight:700;font-size:9.5px;color:var(--blue-bright);">tab</span></span></div>';

    return '<a class="row" href="#/friend/' + encodeURIComponent(f.id) + '" ' +
      'style="text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:13px 14px;margin-bottom:9px;">' +
      app.avatar({ name: nm, emoji: f.emoji, color: f.color, id: f.id }) +
      '<div class="meta">' +
        '<div style="display:flex;align-items:center;gap:7px;"><span class="name lower">' + app.esc(nm.toLowerCase()) + '</span>' + handle + '</div>' +
        walletBit +
      '</div>' +
      '<div style="text-align:right;flex:none;">' + moneyOrSquare + pill + '</div>' +
    '</a>';
  }

  // ---- empty + skeleton ---------------------------------------------------
  function emptyState() {
    return '<div class="empty" style="padding-top:48px;">' +
      app.mascot({ size: 120, mood: "happy", glow: true }) +
      '<div class="title lower" style="margin-top:14px;">no one here yet</div>' +
      '<div class="hint">add your first person to split in one tap 🫡</div>' +
      '<button class="btn" id="frEmptyAdd" type="button" style="max-width:240px;margin-top:14px;">add someone</button>' +
    '</div>';
  }
  function skeletonRows() {
    var r = "";
    for (var i = 0; i < 4; i++) r += '<div class="skeleton" style="height:74px;border-radius:18px;margin:0 0 9px;"></div>';
    return r;
  }

  // ---- signed out ---------------------------------------------------------
  function signedOut(view) {
    view.innerHTML = topbar() +
      '<div class="appscroll" style="display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:34px;">' +
        '<div style="margin:8px 0 6px;">' + app.mascot({ size: 128, mood: "wave", glow: true }) + '</div>' +
        '<h1 style="font-size:24px;max-width:280px;" class="lower">your people, in one place.</h1>' +
        '<div class="eyebrow" style="margin:14px 0 22px;color:var(--muted);">connect a wallet to add friends and split</div>' +
        '<button class="btn" id="frConnect" style="max-width:320px;">connect a wallet</button>' +
        '<div class="eyebrow" style="margin-top:18px;color:var(--faint);">non-custodial · your keys</div>' +
      '</div>';
    var b = document.getElementById("frConnect");
    if (b) b.onclick = function () {
      if (window.Auth) Auth.createWallet().catch(function (e) { app.toast(e.message); });
    };
  }

  // ---- signed in ----------------------------------------------------------
  // Best-effort: attach per-friend net from /api/me/balances counterparties,
  // matched by wallet then by name. Balances never expose userId, so this is
  // approximate — friends with no match render as square.
  function attachNets(friends, counterparties) {
    if (!Array.isArray(counterparties)) return;
    var byWallet = {}, byName = {};
    counterparties.forEach(function (c) {
      if (c.wallet) byWallet[c.wallet] = c.cents;
      if (c.name) byName[String(c.name).trim().toLowerCase()] = c.cents;
    });
    friends.forEach(function (f) {
      var hit;
      var wallets = Array.isArray(f.wallets) ? f.wallets : [];
      if (f.primaryWallet && f.primaryWallet in byWallet) hit = byWallet[f.primaryWallet];
      if (hit === undefined) for (var i = 0; i < wallets.length; i++) {
        if (wallets[i] in byWallet) { hit = byWallet[wallets[i]]; break; }
      }
      if (hit === undefined) {
        var nm = (f.displayName || f.handle || "").trim().toLowerCase();
        if (nm && nm in byName) hit = byName[nm];
      }
      if (typeof hit === "number") f.netCents = hit;
    });
  }

  function counts(friends) {
    var owe = 0, owed = 0;
    friends.forEach(function (f) {
      if (f.netCents > 0) owed++;
      else if (f.netCents < 0) owe++;
    });
    var n = friends.length;
    return n + (n === 1 ? " person" : " people") + " · " + owe + " you owe · " + owed + " owe you";
  }

  function wireRows(view) {
    Array.prototype.forEach.call(view.querySelectorAll(".frCopy"), function (btn) {
      btn.onclick = function (e) {
        e.preventDefault(); e.stopPropagation();
        var w = btn.getAttribute("data-w") || "";
        var done = function () { app.toast("wallet copied"); };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(w).then(done, done);
          else done();
        } catch (_) { done(); }
      };
    });
  }

  function wireAdd(view, refresh) {
    var input = view.querySelector("#frInput");
    var status = view.querySelector("#frStatus");
    var addBtn = view.querySelector("#frAdd");
    var qrBtn = view.querySelector("#frQr");
    if (qrBtn) qrBtn.onclick = function () { app.toast("qr scan coming soon — paste a handle for now"); if (input) input.focus(); };

    function setStatus(msg, color) { if (status) { status.textContent = msg || ""; status.style.color = color || "var(--muted)"; } }

    async function submit() {
      var raw = (input && input.value || "").trim();
      if (!raw) { setStatus("drop a @handle or wallet.", "var(--coral)"); if (input) input.focus(); return; }
      // looks-like-a-wallet heuristic: long base58-ish & no leading @
      var isHandle = raw[0] === "@" || !/^[1-9A-HJ-NP-Za-km-z]{30,}$/.test(raw);
      var body = isHandle ? { handle: raw.replace(/^@+/, "") } : { wallet: raw };
      setStatus("adding…");
      try {
        var d = await app.api.post("/api/friends", body);
        if (input) input.value = "";
        setStatus("added " + nameOf((d && d.friend) || {}).toLowerCase() + " ✓", "var(--mint)");
        await refresh();
      } catch (e) {
        if (e && e.status === 401) { signedOut(view); return; }
        if (e && e.status === 404) {
          var who = isHandle ? "@" + raw.replace(/^@+/, "") : shortWallet(raw);
          setStatus(who + " isn't on divvy yet — invite them, then add.", "var(--muted)");
          return;
        }
        setStatus((e && e.message) || "couldn't add that one.", "var(--coral)");
      }
    }
    if (addBtn) addBtn.onclick = submit;
    if (input) input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } });
  }

  function skeleton(view) {
    view.innerHTML = topbar() + '<div class="appscroll">' +
      header("counting your people…") +
      addWell() +
      '<div style="margin-top:16px;">' + skeletonRows() + '</div></div>';
  }

  async function signedIn(view) {
    skeleton(view);

    var friends = [], balances = null, trips = [];
    try {
      var fd = await app.api.get("/api/friends");
      friends = (fd && Array.isArray(fd.friends)) ? fd.friends : [];
    } catch (e) {
      if (e && e.status === 401) { signedOut(view); return; }
      view.innerHTML = topbar() + '<div class="appscroll">' + header("") +
        '<div class="empty"><div class="title lower">couldn\'t load your people</div><div class="hint">' + app.esc(e.message) + '</div></div></div>';
      return;
    }
    // best-effort extras — never block the screen on these
    try { balances = await app.api.get("/api/me/balances"); } catch (_) {}
    try { var td = await app.api.get("/api/trips?mine=1"); trips = Array.isArray(td) ? td : []; } catch (_) {}

    attachNets(friends, balances && balances.counterparties);

    var body = header(friends.length ? counts(friends) : "no one here yet") + addWell();
    if (friends.length) {
      body += savedTabs(trips) +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin:22px 2px 8px;">' +
          '<span class="eyebrow">people</span><span class="eyebrow" style="letter-spacing:.5px;color:var(--faint);">a–z</span>' +
        '</div>' + friends.map(friendRow).join("");
    } else {
      body += emptyState();
    }

    view.innerHTML = topbar() + '<div class="appscroll">' + body + '</div>';

    var refresh = function () { return signedIn(view); };
    wireAdd(view, refresh);
    wireRows(view);
    var ea = view.querySelector("#frEmptyAdd");
    if (ea) ea.onclick = function () { var i = view.querySelector("#frInput"); if (i) { i.focus(); i.scrollIntoView({ behavior: "smooth", block: "center" }); } };
  }

  // ---- register -----------------------------------------------------------
  window.Screens = window.Screens || {};
  window.Screens.friends = {
    title: "your people",
    render: function (view) {
      var user = window.Auth && window.Auth.user;
      if (user) signedIn(view);
      else signedOut(view);
      if (window.Auth && window.Auth.onChange) window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("friends") >= 0) { if (u) signedIn(view); else signedOut(view); }
      });
    },
  };
})();
