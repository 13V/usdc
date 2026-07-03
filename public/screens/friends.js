/* screens/friends.js — Friends / your people.
   Built by lifting the EXACT inline-styled markup from
   design/handoff/Friends Frames.dc.html and wiring live data into it, so it
   pixel-matches the approved design. Keeps the existing data wiring:

   API:
     GET  /api/friends            -> { friends: [{ id, handle, displayName, primaryWallet, wallets[], emoji, color }] }
     POST /api/friends {handle?,wallet?} -> { friend: {...} } (404 if not on divvy)
     GET  /api/me/balances        -> { totals, trips[], counterparties[] } (per-person net, best-effort)
     GET  /api/trips?mine=1       -> [{ id, name, memberCount, ... }]  (saved tabs chips)
*/
(function () {
  "use strict";
  var app = window.app;

  // ---- header (lifted: "your people" Clash + mono subhead + search circle) --
  function header(sub) {
    return '<div style="display:flex; align-items:flex-end; justify-content:space-between; padding:6px 20px 12px; flex:none;">' +
      '<div>' +
        '<h1 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:30px; letter-spacing:-0.8px; margin:0; color:#2B2118;">your people</h1>' +
        '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(43,33,24,0.45); margin-top:3px;">' + app.esc(sub) + '</div>' +
      '</div>' +
      '<div id="frSearch" style="width:38px; height:38px; border-radius:50%; background:#FFFDF7; border:1px solid rgba(43,33,24,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.75)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>' +
      '</div>' +
    '</div>';
  }

  // ---- add well (lifted: recessed #0e1a25, mono input, QR tile, glowing + add)
  function addWell() {
    return '<div style="position:relative; z-index:5; flex:none; margin:0 16px 4px;">' +
      '<div style="position:relative; background:#0e1a25; border:1px solid rgba(39,117,202,0.28); border-radius:20px; padding:10px; display:flex; align-items:center; gap:9px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.03), 0 10px 26px rgba(0,0,0,0.3);">' +
        '<div style="flex:1; min-width:0; display:flex; align-items:center; gap:10px; padding-left:8px;">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.4)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><circle cx="11" cy="8" r="4"/><path d="M4 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5"/></svg>' +
          '<input id="frInput" placeholder="@handle or wallet…" autocomplete="off" autocapitalize="off" spellcheck="false" ' +
            'style="flex:1; min-width:0; background:transparent; border:none; outline:none; font-family:\'Space Mono\',monospace; font-size:13px; color:#2B2118; padding:2px 0;" />' +
        '</div>' +
        // QR scan tile
        '<div id="frQr" role="button" aria-label="scan a qr" style="width:40px; height:40px; border-radius:12px; background:#FFFDF7; border:1px solid rgba(43,33,24,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer; flex:none;">' +
          '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#2775CA" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3M21 14v.01M21 21v-4M17 21h-3"/></svg>' +
        '</div>' +
        // glowing blue + add
        '<div id="frAdd" role="button" aria-label="add" style="width:46px; height:40px; border-radius:12px; background:linear-gradient(135deg,#3286db,#2775CA); display:flex; align-items:center; justify-content:center; cursor:pointer; flex:none; box-shadow:0 6px 18px rgba(39,117,202,0.5), inset 0 1px 0 rgba(255,255,255,0.28);">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex; align-items:center; gap:6px; padding:8px 6px 2px;">' +
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(39,117,202,0.7)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z"/></svg>' +
        '<span style="font-family:\'Space Mono\',monospace; font-size:9.5px; letter-spacing:.3px; color:rgba(43,33,24,0.4);">scan their qr — never hand-type a wallet</span>' +
      '</div>' +
      '<div id="frStatus" style="font-family:\'Space Mono\',monospace; font-size:11.5px; color:rgba(43,33,24,0.6); min-height:0; padding:0 6px;"></div>' +
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

  // avatar tile (lifted: 46px rounded-square, emoji OR initial chip)
  var AV_GRADS = [
    "linear-gradient(150deg,#3DE8C7,#2775CA)",
    "linear-gradient(150deg,#2775CA,#2775CA)",
    "linear-gradient(150deg,#FFC65C,#FF6B5E)",
    "linear-gradient(150deg,#FF8A7E,#FF6B5E)",
    "linear-gradient(150deg,#a78bfa,#2775CA)",
    "linear-gradient(150deg,#5cf0d4,#3DE8C7 60%,#1fbfa3)",
  ];
  function gradFor(seed) {
    var h = 0, s = String(seed || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AV_GRADS[h % AV_GRADS.length];
  }
  function avatarTile(f, nm) {
    var bg = app.esc(f.color || gradFor(f.id || nm)); // esc: stored color never raw
    if (f.emoji) {
      return '<div style="width:46px; height:46px; border-radius:14px; background:' + bg + '; display:flex; align-items:center; justify-content:center; font-size:22px; flex:none;">' + app.esc(f.emoji) + '</div>';
    }
    var initial = (nm || "?").trim()[0] || "?";
    return '<div style="width:46px; height:46px; border-radius:14px; background:' + bg + '; display:flex; align-items:center; justify-content:center; font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:700; font-size:19px; color:#fff; flex:none;">' + app.esc(initial.toUpperCase()) + '</div>';
  }

  // right-side money (lifted: big mono, lighter $/decimals; grey $0.00 when even)
  function moneyCell(net) {
    var n = Math.abs(net) / 100;
    var whole = Math.floor(n).toLocaleString();
    var dec = (n % 1).toFixed(2).slice(1); // ".00"
    if (net === 0) {
      return '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:15px; letter-spacing:-0.4px; color:rgba(43,33,24,0.5);">' +
        '<span style="font-size:10px; opacity:.6;">$</span>0<span style="font-size:10px; opacity:.6;">.00</span></div>';
    }
    var col = net > 0 ? "#2775CA" : "#FF6B5E";
    var sign = net > 0 ? "+$" : "−$";
    return '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:17px; letter-spacing:-0.4px; color:' + col + ';">' +
      '<span style="font-size:11px; opacity:.5;">' + sign + '</span>' + whole + '<span style="font-size:11px; opacity:.5;">' + dec + '</span></div>';
  }

  // right-side pill (lifted: blue "tab" or mint "square ✨")
  function pillCell(net) {
    if (net === 0) {
      return '<span style="display:inline-flex; align-items:center; gap:5px; margin-top:6px; background:rgba(61,232,199,0.1); border:1px solid rgba(61,232,199,0.35); border-radius:999px; padding:3px 9px;">' +
        '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9px; color:#3DE8C7;">square ✨</span></span>';
    }
    return '<span style="display:inline-flex; align-items:center; gap:5px; margin-top:6px; background:rgba(39,117,202,0.14); border:1px solid rgba(39,117,202,0.45); border-radius:999px; padding:3px 10px; cursor:pointer;">' +
      '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:9.5px; color:#2775CA;">tab</span></span>';
  }

  // ---- saved tabs chip strip (lifted) -------------------------------------
  var TAB_EMOJI = ["🗼", "🏠", "🏝️", "🎟️", "🍜", "🛶"];
  var TAB_COVERS = [
    "linear-gradient(135deg,#3a93ec,#2775CA)",
    "linear-gradient(135deg,#ff8073,#FF6B5E)",
    "linear-gradient(135deg,#5cf0d4,#3DE8C7 60%,#1fbfa3)",
    "linear-gradient(135deg,#ffd98a,#FFC65C 60%,#e0a83c)",
    "linear-gradient(135deg,#a78bfa,#8B5CF6 60%,#6d28d9)",
    "linear-gradient(135deg,#2775CA,#2775CA)",
  ];
  var STACK_EMOJI = ["🦊", "🐢", "🌸", "🦜", "🐯", "🐼"];
  var STACK_GRADS = [
    "linear-gradient(150deg,#FFC65C,#FF6B5E)",
    "linear-gradient(150deg,#2775CA,#2775CA)",
    "linear-gradient(150deg,#3DE8C7,#2775CA)",
    "linear-gradient(150deg,#FF8A7E,#FF6B5E)",
    "linear-gradient(150deg,#FFC65C,#FF6B5E)",
    "linear-gradient(150deg,#a78bfa,#2775CA)",
  ];
  function tabChip(t, i) {
    var em = t.emoji || TAB_EMOJI[i % TAB_EMOJI.length];
    var cover = TAB_COVERS[i % TAB_COVERS.length];
    var total = t.memberCount || 0;
    var shown = Math.min(total, 3);
    var stack = "";
    for (var k = 0; k < shown; k++) {
      var isOverflow = (k === 2 && total > 3);
      if (isOverflow) {
        stack += '<div style="width:15px; height:15px; border-radius:50%; background:#F7F1E3; border:1.5px solid #FFFDF7; margin-left:-5px; display:flex; align-items:center; justify-content:center; font-family:\'Space Mono\',monospace; font-size:7px; font-weight:700; color:rgba(43,33,24,0.6);">+' + (total - 2) + '</div>';
      } else {
        stack += '<div style="width:15px; height:15px; border-radius:50%; background:' + STACK_GRADS[(i + k) % STACK_GRADS.length] + '; border:1.5px solid #FFFDF7;' + (k ? " margin-left:-5px;" : "") + ' display:flex; align-items:center; justify-content:center; font-size:8px;">' + STACK_EMOJI[(i + k) % STACK_EMOJI.length] + '</div>';
      }
    }
    return '<a href="#/group/' + encodeURIComponent(t.id) + '" style="text-decoration:none; flex:none; display:flex; align-items:center; gap:9px; background:#FFFDF7; border:1px solid rgba(43,33,24,0.08); border-radius:15px; padding:9px 13px 9px 11px; cursor:pointer;">' +
      '<div style="width:30px; height:30px; border-radius:10px; background:' + cover + '; display:flex; align-items:center; justify-content:center; font-size:15px;">' + app.esc(em) + '</div>' +
      '<div>' +
        '<div style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:13px; color:#2B2118;">' + app.esc((t.name || "tab").toLowerCase()) + '</div>' +
        '<div style="display:flex; align-items:center; margin-top:3px;">' + stack + '</div>' +
      '</div></a>';
  }
  function savedTabs(trips) {
    if (!trips || !trips.length) return "";
    return '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.42); padding:2px 2px 11px;">SAVED TABS</div>' +
      '<div class="fr-chips" style="display:flex; gap:9px; overflow-x:auto; scrollbar-width:none; margin:0 -16px 4px; padding:0 16px 4px;">' +
        trips.slice(0, 8).map(tabChip).join("") +
      '</div>';
  }

  // ---- friend row (lifted) ------------------------------------------------
  function friendRow(f) {
    var nm = nameOf(f);
    var net = (typeof f.netCents === "number") ? f.netCents : 0;
    var handle = f.handle ? '<span style="font-family:\'Space Mono\',monospace; font-size:10.5px; color:rgba(39,117,202,0.75);">@' + app.esc(f.handle) + '</span>' : "";
    var wallet = f.primaryWallet || "";
    var walletBit = wallet
      ? '<div style="display:flex; align-items:center; gap:6px; margin-top:5px;">' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:11px; color:rgba(43,33,24,0.45);">' + app.esc(shortWallet(wallet)) + '</span>' +
          '<span class="frCopy" data-w="' + app.esc(wallet) + '" style="cursor:pointer; line-height:0; display:inline-flex;">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.4)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>' +
          '</span>' +
        '</div>'
      : '<div style="font-family:\'Space Mono\',monospace; font-size:11px; color:rgba(43,33,24,0.45); margin-top:5px;">no wallet yet</div>';

    return '<a href="#/friend/' + encodeURIComponent(f.id) + '" style="text-decoration:none; color:inherit; display:flex; align-items:center; gap:13px; background:#FFFDF7; border:1px solid rgba(43,33,24,0.07); border-radius:18px; padding:13px 14px;">' +
      avatarTile(f, nm) +
      '<div style="flex:1; min-width:0;">' +
        '<div style="display:flex; align-items:center; gap:7px;">' +
          '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:16px; letter-spacing:-0.2px; color:#2B2118;">' + app.esc(nm.toLowerCase()) + '</span>' + handle +
        '</div>' +
        walletBit +
      '</div>' +
      '<div style="text-align:right; flex:none;">' + moneyCell(net) + pillCell(net) + '</div>' +
    '</a>';
  }

  // ---- empty variant (lifted mascot + copy) -------------------------------
  function emptyState() {
    return '<div style="position:relative; z-index:2; min-height:420px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px; padding:40px 44px 120px; text-align:center;">' +
      app.mascot({ size: 86, mood: "wave", glow: true }) +
      '<div style="font-family:\'General Sans\',sans-serif; font-size:16px; line-height:1.5; color:rgba(43,33,24,0.65);">add your first person to split<br>in one tap 🫡</div>' +
    '</div>';
  }
  function skeletonRows() {
    var r = "";
    for (var i = 0; i < 4; i++) r += '<div class="skeleton" style="height:74px; border-radius:18px; margin:0 0 9px;"></div>';
    return r;
  }

  // canvas wrapper: faint money texture + soft blue glow (lifted)
  function canvas(inner) {
    return '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 84% 2%, rgba(43,33,24,0.025) 0 1px, transparent 1px 8px); opacity:.55; pointer-events:none;"></div>' +
      '<div style="position:absolute; left:-40px; top:120px; width:340px; height:300px; border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,0.15) 0%, rgba(39,117,202,0) 70%); pointer-events:none;"></div>' +
      inner;
  }

  // ---- signed out ---------------------------------------------------------
  function signedOut(view) {
    view.innerHTML = canvas(
      header("your people, in one place") +
      '<div class="appscroll" style="display:flex; flex-direction:column; align-items:center; text-align:center; padding-top:34px;">' +
        '<div style="margin:8px 0 6px;">' + app.mascot({ size: 128, mood: "wave", glow: true }) + '</div>' +
        '<h1 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:24px; max-width:280px; margin:0;">your people, in one place.</h1>' +
        '<div class="eyebrow" style="margin:14px 0 22px; color:var(--muted);">connect a wallet to add friends and split</div>' +
        '<button class="btn" id="frConnect" style="max-width:320px;">connect a wallet</button>' +
        '<div class="eyebrow" style="margin-top:18px; color:var(--faint);">non-custodial · your keys</div>' +
      '</div>');
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

    function setStatus(msg, color) { if (status) { status.textContent = msg || ""; status.style.color = color || "rgba(43,33,24,0.6)"; } }

    async function submit() {
      var raw = (input && input.value || "").trim();
      if (!raw) { setStatus("drop a @handle or wallet.", "#FF6B5E"); if (input) input.focus(); return; }
      // looks-like-a-wallet heuristic: long base58-ish & no leading @
      var isHandle = raw[0] === "@" || !/^[1-9A-HJ-NP-Za-km-z]{30,}$/.test(raw);
      var body = isHandle ? { handle: raw.replace(/^@+/, "") } : { wallet: raw };
      setStatus("adding…");
      try {
        var d = await app.api.post("/api/friends", body);
        if (input) input.value = "";
        var nm = nameOf((d && d.friend) || {}).toLowerCase();
        if (d && d.status === "accepted") setStatus("you're friends with " + nm + " now ✨", "#3DE8C7");
        else setStatus("request sent to " + nm + " — they'll accept 👋", "#3DE8C7");
        await refresh();
      } catch (e) {
        if (e && e.status === 401) { signedOut(view); return; }
        if (e && e.status === 404) {
          var who = isHandle ? "@" + raw.replace(/^@+/, "") : shortWallet(raw);
          setStatus(who + " isn't on divvy yet — invite them, then add.", "rgba(43,33,24,0.6)");
          return;
        }
        setStatus((e && e.message) || "couldn't add that one.", "#FF6B5E");
      }
    }
    if (addBtn) addBtn.onclick = submit;
    if (input) input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } });
  }

  function skeleton(view) {
    view.innerHTML = canvas(
      header("counting your people…") +
      addWell() +
      '<div class="appscroll" style="padding-top:16px;">' + skeletonRows() + '</div>');
  }

  async function signedIn(view) {
    skeleton(view);

    var friends = [], balances = null, trips = [];
    try {
      var fd = await app.api.get("/api/friends");
      friends = (fd && Array.isArray(fd.friends)) ? fd.friends : [];
    } catch (e) {
      if (e && e.status === 401) { signedOut(view); return; }
      view.innerHTML = canvas(header("") + addWell() +
        '<div class="empty"><div class="title lower">couldn\'t load your people</div><div class="hint">' + app.esc(e.message) + '</div></div>');
      return;
    }
    // incoming friend requests (people who added you — you choose to accept)
    // + outgoing requests you've sent that are still pending acceptance.
    var requests = [], sent = [];
    try {
      var rq = await app.api.get("/api/friends/requests");
      requests = (rq && Array.isArray(rq.requests)) ? rq.requests : [];
      sent = (rq && Array.isArray(rq.sent)) ? rq.sent : [];
    } catch (_) {}
    // best-effort extras — never block the screen on these
    try { balances = await app.api.get("/api/me/balances"); } catch (_) {}
    try { var td = await app.api.get("/api/trips?mine=1"); trips = Array.isArray(td) ? td : []; } catch (_) {}

    attachNets(friends, balances && balances.counterparties);

    var sub = friends.length ? counts(friends) : "no one here yet";
    var body;
    if (friends.length || requests.length || sent.length) {
      body =
        '<div class="appscroll" style="padding:10px 16px 120px;">' +
          requestsBlock(requests) +
          sentBlock(sent) +
          savedTabs(trips) +
          (friends.length
            ? '<div style="display:flex; align-items:center; justify-content:space-between; margin:22px 2px 8px;">' +
                '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(43,33,24,0.42);">PEOPLE</span>' +
                '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.5px; color:rgba(43,33,24,0.38);">A–Z</span>' +
              '</div>' +
              '<div style="display:flex; flex-direction:column; gap:9px;">' + friends.map(friendRow).join("") + '</div>'
            : '') +
        '</div>';
    } else {
      body = emptyState();
    }

    view.innerHTML = canvas(header(sub) + addWell() + sendBar() + body);

    var refresh = function () { return signedIn(view); };
    wireAdd(view, refresh);
    wireRows(view);
    wireRequests(view, refresh);
    if (app.enter) app.enter(view.querySelector(".appscroll"));
    var sb = view.querySelector("#frSend");
    if (sb) sb.onclick = function () { sendSheet(); };
  }

  // ---- friend requests (incoming) -----------------------------------------
  function requestsBlock(requests) {
    if (!requests || !requests.length) return "";
    return '<div style="margin:12px 0 6px;">' +
      '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:#3DE8C7; margin:0 2px 9px;">FRIEND REQUESTS · ' + requests.length + '</div>' +
      '<div style="display:flex; flex-direction:column; gap:9px;">' + requests.map(requestRow).join("") + '</div>' +
    '</div>';
  }
  function requestRow(f) {
    var name = f.displayName || f.handle || (f.primaryWallet ? shortWallet(f.primaryWallet) : "someone");
    var emoji = f.emoji || "🙂";
    var color = app.esc(f.color || "linear-gradient(150deg,#2775CA,#3DE8C7)"); // esc: stored color never raw
    return '<div style="display:flex; align-items:center; gap:11px; background:#FFFDF7; border:1px solid rgba(61,232,199,0.18); border-radius:18px; padding:11px 12px;">' +
      '<div style="width:42px; height:42px; border-radius:50%; background:' + color + '; display:flex; align-items:center; justify-content:center; font-size:20px; flex:none;">' + app.esc(emoji) + '</div>' +
      '<div style="flex:1; min-width:0;"><div style="font-family:\'General Sans\',sans-serif; font-weight:600; font-size:15px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(name) + '</div><div style="font-family:\'Space Mono\',monospace; font-size:10px; color:rgba(43,33,24,0.4);">wants to be friends</div></div>' +
      '<button data-decline="' + app.esc(f.id) + '" title="dismiss" style="appearance:none; cursor:pointer; flex:none; width:36px; height:36px; border-radius:50%; background:transparent; border:1px solid rgba(43,33,24,0.14); color:rgba(43,33,24,0.55); font-size:15px;">✕</button>' +
      '<button data-accept="' + app.esc(f.id) + '" style="appearance:none; border:none; cursor:pointer; flex:none; min-height:36px; padding:0 16px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); color:#fff; font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:14px;">accept</button>' +
    '</div>';
  }
  // ---- outgoing requests you've sent (still pending acceptance) ------------
  function sentBlock(sent) {
    if (!sent || !sent.length) return "";
    return '<div style="margin:12px 0 6px;">' +
      '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(255,198,92,0.85); margin:0 2px 9px;">REQUESTED · ' + sent.length + '</div>' +
      '<div style="display:flex; flex-direction:column; gap:9px;">' + sent.map(sentRow).join("") + '</div>' +
    '</div>';
  }
  function sentRow(f) {
    var name = f.displayName || f.handle || (f.primaryWallet ? shortWallet(f.primaryWallet) : "someone");
    var emoji = f.emoji || "🙂";
    var color = app.esc(f.color || "linear-gradient(150deg,#2775CA,#3DE8C7)"); // esc: stored color never raw
    return '<div style="display:flex; align-items:center; gap:11px; background:#FFFDF7; border:1px solid rgba(43,33,24,0.07); border-radius:18px; padding:11px 12px;">' +
      '<div style="width:42px; height:42px; border-radius:50%; background:' + color + '; display:flex; align-items:center; justify-content:center; font-size:20px; flex:none; opacity:.9;">' + app.esc(emoji) + '</div>' +
      '<div style="flex:1; min-width:0;"><div style="font-family:\'General Sans\',sans-serif; font-weight:600; font-size:15px; color:#2B2118; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(name) + '</div><div style="font-family:\'Space Mono\',monospace; font-size:10px; color:rgba(43,33,24,0.4);">waiting for them to accept</div></div>' +
      '<span style="display:inline-flex; align-items:center; gap:5px; flex:none; background:rgba(255,198,92,0.1); border:1px solid rgba(255,198,92,0.35); border-radius:999px; padding:5px 11px; font-family:\'Space Mono\',monospace; font-size:10px; font-weight:700; letter-spacing:.5px; color:#FFC65C;"><span style="width:5px; height:5px; border-radius:50%; background:#FFC65C;"></span>pending</span>' +
      '<button data-cancel="' + app.esc(f.id) + '" title="cancel request" style="appearance:none; cursor:pointer; flex:none; width:34px; height:34px; border-radius:50%; background:transparent; border:1px solid rgba(43,33,24,0.12); color:rgba(43,33,24,0.5); font-size:14px;">✕</button>' +
    '</div>';
  }
  function wireRequests(view, refresh) {
    [].forEach.call(view.querySelectorAll("[data-cancel]"), function (b) {
      b.onclick = function () {
        b.disabled = true; b.style.opacity = ".5";
        app.api.del("/api/friends/" + encodeURIComponent(b.getAttribute("data-cancel")))
          .then(function () { app.toast("request canceled"); refresh(); })
          .catch(function (e) { b.disabled = false; b.style.opacity = "1"; app.toast(e.message || "couldn't cancel"); });
      };
    });
    [].forEach.call(view.querySelectorAll("[data-accept]"), function (b) {
      b.onclick = function () {
        b.disabled = true; b.style.opacity = ".6";
        app.api.post("/api/friends/accept", { userId: b.getAttribute("data-accept") })
          .then(function () { app.toast("you're friends now ✨"); refresh(); })
          .catch(function (e) { b.disabled = false; b.style.opacity = "1"; app.toast(e.message || "couldn't accept"); });
      };
    });
    [].forEach.call(view.querySelectorAll("[data-decline]"), function (b) {
      b.onclick = function () {
        b.disabled = true;
        app.api.del("/api/friends/" + encodeURIComponent(b.getAttribute("data-decline")))
          .then(function () { app.toast("request dismissed"); refresh(); })
          .catch(function (e) { b.disabled = false; app.toast(e.message || "couldn't dismiss"); });
      };
    });
  }

  // ---- send money ---------------------------------------------------------
  // A prominent button + a sheet to SEND USDC (the opposite of a tab, which
  // requests). Pick a friend with a wallet, or paste any wallet, set an amount,
  // and hand off to the embedded wallet to sign + send.
  function sendBar() {
    return '<div style="margin:2px 16px 0;">' +
      '<button id="frSend" style="appearance:none; cursor:pointer; width:100%; min-height:50px; border-radius:15px; background:linear-gradient(120deg,#3DE8C7,#2aa5cf); display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:0 8px 22px rgba(61,232,199,0.28);">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2B2118" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>' +
        '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:15.5px; color:#2B2118;">send money</span>' +
      '</button></div>';
  }
  var WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  function sendSheet(prefill) {
    prefill = prefill || {};
    var el = app.sheet('<div id="snBody" style="font-family:\'Space Mono\',monospace; font-size:12px; color:rgba(43,33,24,0.5); padding:12px 2px;">loading…</div>');
    var mint = null, balCents = null, friends = [];
    Promise.all([
      app.api.get("/api/me/wallet").catch(function () { return null; }),
      app.api.get("/api/friends").catch(function () { return { friends: [] }; })
    ]).then(function (r) {
      var w = r[0] || {};
      mint = w.mint; balCents = (typeof w.usdcCents === "number") ? w.usdcCents : null;
      friends = ((r[1] && r[1].friends) || []).filter(function (f) { return f.primaryWallet; });
      render();
    });
    function render() {
      var body = el.querySelector("#snBody"); if (!body) return;
      var bal = (balCents == null) ? "—" : "$" + (balCents / 100).toFixed(2);
      var chips = friends.length
        ? '<div style="display:flex; gap:8px; overflow-x:auto; padding:2px 0 4px; margin-top:8px;">' +
            friends.map(function (f) {
              var nm = (f.displayName || f.handle || "friend");
              return '<button class="snFriend" data-w="' + app.esc(f.primaryWallet) + '" data-n="' + app.esc(nm) + '" style="appearance:none; cursor:pointer; flex:none; display:flex; align-items:center; gap:7px; background:#0e1a24; border:1px solid rgba(43,33,24,0.1); border-radius:999px; padding:6px 12px 6px 7px;">' +
                '<span style="width:24px; height:24px; border-radius:50%; background:' + (f.color || "linear-gradient(150deg,#2775CA,#3DE8C7)") + '; display:flex; align-items:center; justify-content:center; font-size:13px;">' + app.esc(f.emoji || "🙂") + '</span>' +
                '<span style="font-family:\'General Sans\',sans-serif; font-weight:600; font-size:13px; color:#2B2118;">' + app.esc(nm.toLowerCase()) + '</span></button>';
            }).join("") +
          '</div>'
        : '';
      body.innerHTML =
        '<h2 class="lower" style="font-size:22px; margin:2px 0 2px;">send money</h2>' +
        '<p class="hint" style="margin:0 0 4px;">straight to their wallet · usdc, just faster. you have <b style="color:#3DE8C7;">' + bal + '</b>.</p>' +
        '<label style="margin-top:12px;">to</label>' +
        '<input class="input" id="snTo" placeholder="paste a wallet, or pick a friend" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + app.esc(prefill.wallet || "") + '">' +
        chips +
        '<label style="margin-top:14px;">amount</label>' +
        '<input class="input" id="snAmt" inputmode="decimal" placeholder="0.00">' +
        '<div id="snErr" style="font-family:\'Space Mono\',monospace; font-size:11px; color:#FF6B5E; min-height:14px; margin-top:8px;"></div>' +
        '<button class="btn" id="snGo" style="margin-top:6px;">send 💸</button>';
      var toEl = el.querySelector("#snTo");
      [].forEach.call(el.querySelectorAll(".snFriend"), function (b) {
        b.onclick = function () { toEl.value = b.getAttribute("data-w"); toEl.setAttribute("data-name", b.getAttribute("data-n")); };
      });
      var go = el.querySelector("#snGo");
      if (go) go.onclick = function () {
        var err = el.querySelector("#snErr"); err.textContent = "";
        var to = (toEl.value || "").trim();
        var nm = toEl.getAttribute("data-name") || "";
        // allow picking a friend by @handle typed in
        if (to[0] === "@") {
          var h = to.replace(/^@+/, "").toLowerCase();
          var f = friends.filter(function (x) { return (x.handle || "").toLowerCase() === h; })[0];
          if (f) { to = f.primaryWallet; nm = f.displayName || f.handle; }
        }
        if (!WALLET_RE.test(to)) { err.textContent = "paste a valid wallet, or pick a friend"; return; }
        var cents = Math.round(parseFloat((el.querySelector("#snAmt").value || "").replace(/[^0-9.]/g, "")) * 100);
        if (!cents || cents <= 0) { err.textContent = "enter an amount"; return; }
        if (!mint) { err.textContent = "couldn't load the token — try again"; return; }
        var qs = "pay=send&to=" + encodeURIComponent(to) + "&amount=" + cents +
          "&mint=" + encodeURIComponent(mint) + "&label=" + encodeURIComponent(nm || "") +
          "&ret=" + encodeURIComponent("/#/friends");
        window.location.href = "/embedded/?" + qs;
      };
    }
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
