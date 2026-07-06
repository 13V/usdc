/* screens/chat.js — Group chat / receipt feed for a Trip (full-screen route).
   Route: #/chat/<id>  (params[0] = tripId). Registers window.Screens.chat.

   Built by LIFTING the EXACT inline-styled markup from
   design/handoff/Group Chat Frames.dc.html and wiring live data into the
   placeholders, so it pixel-matches the approved design (same lift-and-wire
   pattern as screens/home.js). Money is a first-class object in the feed:
   text bubbles, tappable receipt photos, expense "tab" cards, and the kinetic
   blue→mint settle card are interleaved chronologically.

   Wires (existing API — kept verbatim from the prior chat.js):
     GET  /api/trips/<id>                       -> members + shareToken + expenses + settle
     GET  /api/trips/<id>/messages?after=<iso>  -> { messages:[…] } ascending
     POST /api/trips/<id>/messages { text?, image? }  -> the new message
   The trip's shareToken is sent as X-Trip-Token on chat requests when known, so
   link-holders work signed-out. Polls every ~4s.

   This is a NEW module; it does NOT depend on window.Chat (the old overlay). */
(function () {
  "use strict";
  var app = window.app;

  var POLL_MS = 4000;
  var MAX_EDGE = 1000;        // longest-edge cap for the downscale
  var JPEG_QUALITY = 0.7;     // keeps a phone photo under the ~1.5MB server cap

  // ── per-render state (reset each render) ───────────────────────────────────
  var tripId = null;
  var shareToken = null;
  var trip = null;            // last fetched trip (members + expenses + settle)
  var memberById = {};        // memberId -> { name, ... } for avatars/lookups
  var feedEl = null;
  var inputEl = null;
  var fileEl = null;
  var screenEl = null;
  var pendingImage = null;    // a downscaled data: URL waiting to be sent
  var pollTimer = null;
  var lastSeenISO = null;     // newest message createdAt rendered
  var seenMsgIds = null;      // Set of message ids already rendered (dedupe)
  var sending = false;
  var reactionsMap = {};      // server-backed money-card reactions: target -> [{emoji,count,mine}]
  var token = 0;              // render token: stale polls/loads bail out

  // ── helpers ────────────────────────────────────────────────────────────────
  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  }

  function authUser() { return (window.Auth && window.Auth.user) || null; }
  function authFetchFn() {
    return (window.Auth && window.Auth.authFetch) ? window.Auth.authFetch : fetch;
  }

  // request(path, opts) — JSON helper that attaches the trip capability token
  // (X-Trip-Token) and the Bearer session (Auth.authFetch) when signed in.
  async function request(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    if (shareToken) headers["X-Trip-Token"] = shareToken;
    var res = await authFetchFn()(path, Object.assign({}, opts, { headers: headers }));
    var data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok) {
      var err = new Error((data && data.error) || ("request failed (" + res.status + ")"));
      err.status = res.status; err.data = data; throw err;
    }
    return data;
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    try { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase(); }
    catch (_) { return d.toISOString().slice(11, 16); }
  }

  function isMine(msg) {
    var u = authUser();
    return !!(u && msg && msg.userId && msg.userId === u.id);
  }

  // ── exact frame fonts (lifted, used inline so we never lose the brand type) ──
  var DISPLAY = "'Clash Display','General Sans',sans-serif";
  var SANS = "'General Sans',sans-serif";
  var MONO = "'Space Mono',monospace";

  // a deterministic blue→x gradient for an emoji avatar, matching the frame's
  // tinted circle avatars (maya 🌸 mint, marco 🐢 light-blue, etc.)
  var AV_GRADS = [
    "linear-gradient(150deg,#3DE8C7,#2775CA)",
    "linear-gradient(150deg,#2775CA,#2775CA)",
    "linear-gradient(150deg,#FF8A7E,#FF6B5E)",
    "linear-gradient(150deg,#FFC65C,#FF6B5E)",
    "linear-gradient(150deg,#a78bfa,#2775CA)",
    "linear-gradient(150deg,#5cf0d4,#2775CA)",
  ];
  function gradFor(seed) {
    var h = 0, s = String(seed || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AV_GRADS[h % AV_GRADS.length];
  }
  // the round emoji avatar that rides beside left bubbles / inside stacks.
  function avEmoji(name) {
    var nm = String(name || "?");
    var u = nm.trim();
    return (u && /\p{Emoji}/u.test(u[0])) ? u[0] : (u[0] || "?").toUpperCase();
  }

  // ── image downscale (canvas) — reused logic ─────────────────────────────────
  function downscaleImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("couldn't read that image.")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("couldn't load that image.")); };
        img.onload = function () {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) { reject(new Error("that image looks empty.")); return; }
          var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext("2d");
          if (!ctx) { reject(new Error("canvas unavailable.")); return; }
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          var dataUrl;
          try { dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY); }
          catch (e) { reject(new Error("couldn't process that image.")); return; }
          resolve(dataUrl);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ── scroll helpers ──────────────────────────────────────────────────────────
  function nearBottom() {
    if (!feedEl) return true;
    return feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 90;
  }
  function scrollToBottom(smooth) {
    if (!feedEl) return;
    try { feedEl.scrollTo({ top: feedEl.scrollHeight, behavior: smooth ? "smooth" : "auto" }); }
    catch (_) { feedEl.scrollTop = feedEl.scrollHeight; }
  }

  // the standard chip set (the design's 🫡 👀 💀 reaction pills). Persisted
  // reaction rows (messages + money cards) are built by reactionChipRow below.
  var REACTS = ["🫡", "👀", "💀"];

  // cap an emoji by CODEPOINTS (not UTF-16 code units) so we never split a
  // multi-codepoint emoji (e.g. flags / ZWJ sequences) mid-glyph.
  function capEmoji(s) {
    return Array.from(String(s == null ? "" : s)).slice(0, 8).join("");
  }

  // ── persisted reactions row (server-backed; the design's 🫡 👀 💀 chips) ─────
  // Shared chip-row builder. `initial` is [{emoji,count,mine}]; `submit(emoji)`
  // POSTs the toggle and resolves to the fresh array. Used by message bubbles
  // (the /messages/:id/react endpoint) AND money cards (the generic /reactions
  // target endpoint), so reactions persist everywhere the design shows chips.
  function reactionChipRow(initial, submit) {
    var row = el('<div style="display:flex; align-items:center; gap:6px; padding-left:2px;"></div>');
    var state = {}; // emoji -> { count, mine }
    function ingest(list) {
      state = {};
      (list || []).forEach(function (r) { state[r.emoji] = { count: r.count || 0, mine: !!r.mine }; });
    }
    ingest(initial);

    // chips: the standard set plus any extra emoji already present.
    var keys = REACTS.slice();
    Object.keys(state).forEach(function (e) { if (keys.indexOf(e) < 0) keys.push(e); });

    function repaintAll() {
      keys.forEach(function (k) { if (chips[k]) chips[k]._paint(); });
    }

    var chips = {};
    keys.forEach(function (emoji) {
      var capped = capEmoji(emoji);
      var chip = el('<button type="button" style="appearance:none; display:inline-flex; align-items:center; gap:4px; cursor:pointer; background:var(--card); border:2px solid var(--border-ink); border-radius:999px; box-shadow:3px 4px 0 rgba(var(--shadow-rgb),0.85); padding:3px 9px;"></button>');
      chips[emoji] = chip;
      function paint() {
        var st = state[emoji] || { count: 0, mine: false };
        chip.innerHTML = "";
        var e = document.createElement("span");
        e.style.cssText = "font-size:12px; line-height:1;";
        e.textContent = capped; // textContent + codepoint-capped: never split/inject
        chip.appendChild(e);
        if (st.count > 0) {
          var n = document.createElement("span");
          n.style.cssText = "font-family:" + MONO + "; font-size:10px; color:rgba(var(--ink-rgb),0.6);";
          n.textContent = String(st.count);
          chip.appendChild(n);
        }
        var on = st.count > 0;
        chip.style.borderColor = st.mine ? "rgba(39,117,202,0.8)" : (on ? "rgba(39,117,202,0.45)" : "rgba(var(--ink-rgb),0.1)");
        chip.style.background = st.mine ? "rgba(39,117,202,0.22)" : (on ? "rgba(39,117,202,0.12)" : "var(--card)");
      }
      chip.addEventListener("click", function () {
        // OPTIMISTIC: paint the toggled chip state immediately, then reconcile
        // with the server (or revert on failure).
        var prev = state[emoji] ? { count: state[emoji].count, mine: state[emoji].mine } : { count: 0, mine: false };
        var willAdd = !prev.mine;
        state[emoji] = { count: Math.max(0, prev.count + (willAdd ? 1 : -1)), mine: willAdd };
        paint();
        chip.disabled = true;
        Promise.resolve()
          .then(function () { return submit(emoji); })
          .then(function (fresh) {
            ingest(fresh || []); // reconcile with the authoritative server state
            repaintAll();
          })
          .catch(function (err) {
            state[emoji] = prev; // revert the optimistic paint
            paint();
            app.toast((err && err.status === 401) ? "sign in to react" : "couldn't react");
          })
          .then(function () { chip.disabled = false; });
      });
      chip._paint = paint;
      paint();
      row.appendChild(chip);
    });
    return row;
  }

  // message bubble reactions → /messages/:id/react
  function messageReactionRow(msg) {
    return reactionChipRow(msg.reactions, function (emoji) {
      return request("/api/trips/" + encodeURIComponent(tripId) + "/messages/" + encodeURIComponent(msg.id) + "/react", {
        method: "POST",
        body: JSON.stringify({ emoji: emoji }),
      }).then(function (fresh) {
        msg.reactions = (fresh && fresh.reactions) || [];
        return msg.reactions;
      });
    });
  }

  // money-card reactions (expense / payment) → generic /reactions target store.
  // `target` is a stable key ("exp:<id>" / "pay:<key>") shared with the server.
  function targetReactionRow(target) {
    return reactionChipRow(reactionsMap[target] || [], function (emoji) {
      return request("/api/trips/" + encodeURIComponent(tripId) + "/reactions", {
        method: "POST",
        body: JSON.stringify({ target: target, emoji: emoji }),
      }).then(function (fresh) {
        reactionsMap[target] = (fresh && fresh.reactions) || [];
        return reactionsMap[target];
      });
    });
  }

  // ── timeline item builders (markup LIFTED verbatim from the frame) ──────────

  // text + photo bubble. Left = other (emoji avatar + #FFFDF7 bubble, radius
  // 20 20 20 6). Right = you (blue tint, radius 20 20 6 20).
  function bubbleNode(msg) {
    var mine = isMine(msg);
    var who = mine ? "you" : String(msg.author || "someone").toLowerCase();
    var when = fmtTime(msg.createdAt);

    if (mine) {
      var wrap = el('<div style="display:flex; flex-direction:column; align-items:flex-end; gap:5px; align-self:flex-end; max-width:80%;"></div>');
      var head = el('<div style="display:flex; align-items:center; gap:7px; padding-right:4px;"></div>');
      var tEl = document.createElement("span");
      tEl.style.cssText = "font-family:" + MONO + "; font-size:9px; color:rgba(var(--ink-rgb),0.32);";
      tEl.textContent = when;
      var yEl = document.createElement("span");
      yEl.style.cssText = "font-family:" + MONO + "; font-size:10px; color:rgba(39,117,202,0.7);";
      yEl.textContent = "you";
      head.appendChild(tEl); head.appendChild(yEl);
      wrap.appendChild(head);

      var bubble = el('<div style="background:rgba(39,117,202,0.18); border:1px solid rgba(39,117,202,0.4); border-radius:20px 20px 6px 20px; padding:11px 15px; font-family:' + SANS + '; font-size:15px; line-height:1.35; color:var(--ink); word-break:break-word;"></div>');
      fillBubble(bubble, msg);
      wrap.appendChild(bubble);
      if (msg.id) wrap.appendChild(messageReactionRow(msg));
      return wrap;
    }

    var lwrap = el('<div style="display:flex; flex-direction:column; align-items:flex-start; gap:5px; max-width:80%;"></div>');
    var lhead = el('<div style="display:flex; align-items:center; gap:7px; padding-left:42px;"></div>');
    var nEl = document.createElement("span");
    nEl.style.cssText = "font-family:" + MONO + "; font-size:10px; color:rgba(var(--ink-rgb),0.55);";
    nEl.textContent = who;
    var wEl = document.createElement("span");
    wEl.style.cssText = "font-family:" + MONO + "; font-size:9px; color:rgba(var(--ink-rgb),0.32);";
    wEl.textContent = when;
    lhead.appendChild(nEl); lhead.appendChild(wEl);
    lwrap.appendChild(lhead);

    var line = el('<div style="display:flex; align-items:flex-end; gap:9px;"></div>');
    var av = el('<div style="width:33px; height:33px; border-radius:50%; background:' + gradFor(msg.author) + '; display:flex; align-items:center; justify-content:center; font-size:16px; flex:none;"></div>');
    av.textContent = avEmoji(msg.author);
    line.appendChild(av);
    var bub = el('<div style="background:var(--card); border:2px solid var(--border-ink); border-radius:20px; box-shadow:3px 4px 0 rgba(var(--shadow-rgb),0.85) 20px 20px 6px; padding:11px 15px; font-family:' + SANS + '; font-size:15px; line-height:1.35; color:var(--ink); word-break:break-word;"></div>');
    fillBubble(bub, msg);
    line.appendChild(bub);
    lwrap.appendChild(line);
    if (msg.id) {
      var rrow = messageReactionRow(msg);
      rrow.style.paddingLeft = "42px"; // align under the bubble, past the avatar
      lwrap.appendChild(rrow);
    }
    return lwrap;
  }

  // put text and/or a tappable receipt photo into a bubble shell.
  function fillBubble(bubble, msg) {
    if (msg.image) {
      var im = el('<img alt="receipt photo" style="display:block; width:200px; max-width:60vw; border-radius:14px; margin:1px 0; cursor:pointer; border:1px solid rgba(var(--ink-rgb),0.1);" />');
      im.src = msg.image; // data: URL from server — set via property, not raw HTML
      im.addEventListener("click", function () { enlarge(msg.image); });
      bubble.appendChild(im);
    }
    if (msg.text) {
      var txt = document.createElement("div");
      txt.style.cssText = "white-space:pre-wrap;";
      txt.textContent = msg.text; // textContent — never inject raw message HTML
      bubble.appendChild(txt);
    }
  }

  // expense "money card" (a tab) — lifted from the EXPENSE block of the frame:
  // raised card, left blue accent rail, guilloché overlay, 46px emoji tile,
  // Clash title, mono meta, big mono amount + coral "you owe", avatar stack,
  // blue "chip in ＋" pill, reaction chips below.
  function expenseNode(e) {
    var title = String(e.title || "an expense");
    var emoji = expenseEmoji(title);
    var names = Array.isArray(e.participantNames) ? e.participantNames : [];
    var splitN = names.length || (Array.isArray(e.participants) ? e.participants.length : 0) || 1;
    var paidBy = e.paidByName ? String(e.paidByName).toLowerCase() : "someone";
    var owe = yourShareCents(e);

    var wrap = el('<div style="display:flex; flex-direction:column; align-items:flex-start; gap:6px; width:100%;"></div>');

    var card = el('<div style="position:relative; width:100%; background:var(--card); border:1px solid rgba(39,117,202,0.28); border-radius:20px; overflow:hidden; box-shadow:0 12px 30px rgba(var(--shadow-rgb),0.13); cursor:pointer;"></div>');
    card.appendChild(el('<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 90% 6%, rgba(255,255,255,0.04) 0 1px, transparent 1px 8px); opacity:.7; pointer-events:none;"></div>'));
    card.appendChild(el('<div style="position:absolute; left:0; top:0; bottom:0; width:4px; background:linear-gradient(180deg,#2775CA,#3f97ee);"></div>'));

    var inner = el('<div style="position:relative; padding:15px 16px 13px;"></div>');

    var top = el('<div style="display:flex; align-items:center; gap:12px;"></div>');
    var ico = el('<div style="width:46px; height:46px; border-radius:14px; background:var(--paper); display:flex; align-items:center; justify-content:center; font-size:23px; flex:none;"></div>');
    ico.textContent = emoji;
    top.appendChild(ico);

    var mid = el('<div style="flex:1; min-width:0;"></div>');
    var titleRow = el('<div style="display:flex; align-items:center; gap:6px;"></div>');
    var tSpan = document.createElement("span");
    tSpan.style.cssText = "font-family:" + DISPLAY + "; font-weight:500; font-size:16.5px; letter-spacing:-0.2px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;";
    tSpan.textContent = title.toLowerCase();
    titleRow.appendChild(tSpan);
    var sub = document.createElement("div");
    sub.style.cssText = "font-family:" + MONO + "; font-size:10px; letter-spacing:.3px; color:rgba(var(--ink-rgb),0.48); margin-top:3px;";
    sub.textContent = "new tab · " + paidBy + " paid · split " + splitN;
    mid.appendChild(titleRow); mid.appendChild(sub);
    top.appendChild(mid);

    var amtBox = el('<div style="text-align:right; flex:none;"></div>');
    var amt = el('<div style="font-family:' + MONO + '; font-weight:700; font-size:21px; letter-spacing:-0.6px; color:var(--ink);"></div>');
    amt.innerHTML = bigMoney(e.amountCents || 0);
    amtBox.appendChild(amt);
    if (owe != null && owe > 0) {
      var ow = document.createElement("div");
      ow.style.cssText = "font-family:" + MONO + "; font-size:9px; color:#FF6B5E; margin-top:2px;";
      ow.textContent = "you owe $" + (owe / 100).toFixed(2);
      amtBox.appendChild(ow);
    }
    top.appendChild(amtBox);
    inner.appendChild(top);

    var foot = el('<div style="display:flex; align-items:center; justify-content:space-between; margin-top:13px; padding-top:12px; border-top:1px dashed rgba(var(--ink-rgb),0.12);"></div>');
    var stack = el('<div style="display:flex; align-items:center;"></div>');
    var stackNames = names.length ? names : [paidBy];
    stackNames.slice(0, 4).forEach(function (nm, i) {
      var a = el('<div style="width:22px; height:22px; border-radius:50%; background:' + gradFor(nm) + '; border:1.5px solid var(--card); display:flex; align-items:center; justify-content:center; font-size:11px;' + (i ? " margin-left:-7px;" : "") + '"></div>');
      a.textContent = avEmoji(nm);
      stack.appendChild(a);
    });
    foot.appendChild(stack);

    var chip = el('<button type="button" style="appearance:none; cursor:pointer; display:inline-flex; align-items:center; gap:6px; background:rgba(39,117,202,0.14); border:1px solid rgba(39,117,202,0.45); border-radius:999px; padding:5px 12px;">' +
      '<span style="font-family:' + MONO + '; font-weight:700; font-size:11px; color:#2775CA;">chip in</span>' +
      '<svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#2775CA" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>');
    chip.addEventListener("click", function () { location.hash = "#/settle/" + encodeURIComponent(tripId); });
    foot.appendChild(chip);
    inner.appendChild(foot);

    card.appendChild(inner);
    wrap.appendChild(card);
    wrap.appendChild(targetReactionRow("exp:" + (e.id || title)));
    return wrap;
  }

  // payment/settle event — LIFTED kinetic blue→mint gradient mini-receipt:
  // 1.5px animated gradient border, inner #0f1d29 with mint guilloché, the
  // mascot blob, "<name> chipped in <mint $>", "settled · ~$0.001" + pulse dot,
  // mint "view ↗" pill, reactions below (🫡 3, 💀 1).
  function paymentNode(p) {
    var who = p.fromName ? String(p.fromName).toLowerCase() : "someone";

    var wrap = el('<div style="display:flex; flex-direction:column; align-items:flex-start; gap:6px; width:100%;"></div>');
    var border = el('<div style="position:relative; width:100%; border-radius:20px; padding:1.5px; background:linear-gradient(90deg,#2775CA,#3DE8C7,#2775CA); background-size:200% 100%; animation:gcKinetic 4s linear infinite; box-shadow:3px 3px 0 rgba(var(--shadow-rgb),0.9);"></div>');
    var card = el('<div style="position:relative; border-radius:18.5px; background:var(--card); overflow:hidden;"></div>');
    card.appendChild(el('<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 8% 100%, rgba(61,232,199,0.05) 0 1px, transparent 1px 9px); opacity:.7; pointer-events:none;"></div>'));

    var rowInner = el('<div style="position:relative; display:flex; align-items:center; gap:13px; padding:14px 16px;"></div>');

    // mini mochi rides the money card, pulsing glow behind him.
    var blob = el('<div style="position:relative; width:42px; height:42px; flex:none; display:flex; align-items:center; justify-content:center;">' +
      '<div style="position:absolute; inset:0; border-radius:50%; background:radial-gradient(circle, rgba(61,232,199,0.4) 0%, rgba(61,232,199,0) 68%); animation:gcPulse 3s ease-in-out infinite;"></div>' +
      '<div style="position:relative; animation:gcSquish 4s ease-in-out infinite;">' + (window.Mascot ? window.Mascot.mini(30) : "") + '</div>' +
    '</div>');
    rowInner.appendChild(blob);

    var mid = el('<div style="flex:1; min-width:0;"></div>');
    var line = el('<div style="font-family:' + SANS + '; font-size:14px; line-height:1.3; color:var(--ink);"></div>');
    line.appendChild(document.createTextNode(who + " chipped in "));
    var amtSpan = document.createElement("span");
    amtSpan.style.cssText = "font-family:" + MONO + "; font-weight:700; color:#3DE8C7;";
    amtSpan.textContent = "$" + ((p.amountCents || 0) / 100).toFixed(2);
    line.appendChild(amtSpan);
    var meta = el('<div style="display:flex; align-items:center; gap:7px; margin-top:4px;">' +
      '<span style="display:inline-flex; align-items:center; gap:4px;"><span style="width:5px; height:5px; border-radius:50%; background:#3DE8C7; box-shadow:0 0 6px rgba(61,232,199,0.9);"></span>' +
      '<span style="font-family:' + MONO + '; font-size:9.5px; letter-spacing:.5px; color:rgba(61,232,199,0.85);">settled · ~$0.001</span></span></div>');
    mid.appendChild(line); mid.appendChild(meta);
    rowInner.appendChild(mid);

    var view = el('<button type="button" style="appearance:none; cursor:pointer; display:inline-flex; align-items:center; gap:5px; flex:none; background:rgba(61,232,199,0.12); border:1px solid rgba(61,232,199,0.4); border-radius:999px; padding:6px 13px;">' +
      '<span style="font-family:' + MONO + '; font-weight:700; font-size:11px; color:#3DE8C7;">view</span>' +
      '<svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3DE8C7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></button>');
    view.addEventListener("click", function () { location.hash = "#/settle/" + encodeURIComponent(tripId); });
    rowInner.appendChild(view);

    card.appendChild(rowInner);
    border.appendChild(card);
    wrap.appendChild(border);
    wrap.appendChild(targetReactionRow("pay:" + (p.from || "") + ":" + (p.to || "") + ":" + (p.amountCents || 0)));
    return wrap;
  }

  // day divider pill — lifted ("TODAY · JUN 24" mono pill).
  function dividerNode(label) {
    var d = el('<div style="display:flex; justify-content:center;"></div>');
    var s = document.createElement("span");
    s.style.cssText = "font-family:" + MONO + "; font-size:9.5px; letter-spacing:1.5px; color:rgba(var(--ink-rgb),0.4); background:rgba(var(--ink-rgb),0.05); border-radius:999px; padding:4px 12px;";
    s.textContent = label;
    d.appendChild(s);
    return d;
  }

  // big mono amount, $/decimals at half-size & half-opacity (frame style).
  function bigMoney(cents) {
    var n = Math.abs(cents) / 100;
    var whole = Math.floor(n).toLocaleString();
    var dec = (n % 1).toFixed(2).slice(1); // ".00"
    return '<span style="font-size:13px; opacity:.5;">$</span>' + whole +
      '<span style="font-size:13px; opacity:.5;">' + dec + '</span>';
  }

  // ── derived bits ────────────────────────────────────────────────────────────
  var EMOJI_MAP = [
    [/karaage|chick|fried|wing/, "🍢"], [/sushi|sashimi|maki|nigiri/, "🍣"],
    [/ramen|noodle|udon|soba/, "🍜"], [/pizza/, "🍕"], [/burger/, "🍔"],
    [/taco|burrito/, "🌮"], [/coffee|latte|espresso|cafe/, "☕"],
    [/beer|brew|pub/, "🍺"], [/wine/, "🍷"], [/cocktail|bar|drink/, "🍸"],
    [/hotel|airbnb|stay|room/, "🏨"], [/uber|taxi|cab|ride|car/, "🚕"],
    [/flight|plane|air/, "✈️"], [/train|metro|subway/, "🚆"],
    [/grocer|market|mart/, "🛒"], [/ticket|movie|show|concert/, "🎟️"]
  ];
  function expenseEmoji(title) {
    var t = String(title || "").toLowerCase();
    for (var i = 0; i < EMOJI_MAP.length; i++) { if (EMOJI_MAP[i][0].test(t)) return EMOJI_MAP[i][1]; }
    return "🧾";
  }

  // your-owe share for an expense (even split among participants), or null.
  function yourShareCents(e) {
    var u = authUser();
    if (!u || !trip) return null;
    var mine = (trip.members || []).filter(function (m) { return m.userId && m.userId === u.id; })
      .map(function (m) { return m.id; });
    if (!mine.length) return null;
    var parts = Array.isArray(e.participants) ? e.participants : [];
    if (!parts.length) return null;
    var iAmIn = parts.some(function (p) { return mine.indexOf(p) >= 0; });
    if (!iAmIn) return null;
    return Math.round((e.amountCents || 0) / parts.length);
  }

  function trackSeen(iso) {
    if (!iso) return;
    if (!lastSeenISO || (Date.parse(iso) || 0) > (Date.parse(lastSeenISO) || 0)) lastSeenISO = iso;
  }

  // ── timeline assembly ───────────────────────────────────────────────────────
  function buildTimeline(messages, expenses, settle) {
    var items = [];
    (messages || []).forEach(function (m) {
      items.push({ kind: "msg", ts: Date.parse(m.createdAt) || 0, data: m });
    });
    (expenses || []).forEach(function (e) {
      items.push({ kind: "exp", ts: Date.parse(e.createdAt) || 0, data: e });
    });
    if (settle && Array.isArray(settle.transfers)) {
      var base = Date.parse(settle.createdAt) || 0;
      settle.transfers.filter(function (t) { return t.paid; }).forEach(function (t, i) {
        items.push({ kind: "pay", ts: base + i, data: t });
      });
    }
    items.sort(function (a, b) { return a.ts - b.ts; });
    return items;
  }

  function nodeFor(it) {
    if (it.kind === "msg") return bubbleNode(it.data);
    if (it.kind === "exp") return expenseNode(it.data);
    return paymentNode(it.data);
  }

  // a readable "TODAY · JUN 24"-style label for a given date (default: now).
  function labelForDate(d) {
    if (!d || isNaN(d.getTime())) d = new Date();
    var today = new Date();
    var same = d.toDateString() === today.toDateString();
    var mon = d.toLocaleString([], { month: "short" }).toUpperCase();
    return (same ? "TODAY" : d.toLocaleString([], { weekday: "short" }).toUpperCase()) + " · " + mon + " " + d.getDate();
  }
  // a readable "TODAY · JUN 24"-style divider from the newest item, or today.
  function dayLabel(items) {
    var ts = 0;
    for (var i = items.length - 1; i >= 0; i--) { if (items[i].ts) { ts = items[i].ts; break; } }
    return labelForDate(ts ? new Date(ts) : new Date());
  }

  // ── empty state — LIFTED verbatim (mascot blob + dry copy) ──────────────────
  function renderEmpty() {
    if (!feedEl) return;
    feedEl.innerHTML = "";
    var box = el('<div style="position:relative; z-index:2; flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; padding:0 40px; text-align:center; margin:auto 0;">' +
      '<div style="position:relative; width:96px; height:86px; display:flex; align-items:center; justify-content:center;">' +
        '<div style="position:absolute; inset:0; border-radius:50%; background:radial-gradient(circle, rgba(61,232,199,0.35) 0%, rgba(61,232,199,0) 68%); animation:gcPulse 3s ease-in-out infinite;"></div>' +
        '<div style="position:relative; animation:gcSquish 4s ease-in-out infinite;">' + (window.Mascot ? window.Mascot.mini(72) : "") + '</div>' +
      '</div>' +
      '<div style="font-family:' + SANS + '; font-size:16px; line-height:1.45; color:rgba(var(--ink-rgb),0.65);">no messages yet — say hi<br>or drop a receipt 📷</div>' +
    '</div>');
    feedEl.appendChild(box);
  }

  function renderFeed(items) {
    if (!feedEl) return;
    feedEl.innerHTML = "";
    seenMsgIds = new Set();
    lastSeenISO = null;
    if (!items.length) { renderEmpty(); return; }
    var div = dividerNode(dayLabel(items));
    div.setAttribute("data-feed-divider", "1");
    feedEl.appendChild(div);
    items.forEach(function (it) {
      var node = nodeFor(it);
      if (it.kind === "msg") {
        // tag message bubbles with their timestamp so polled messages can be
        // inserted in time order (see insertBubbleSorted).
        node.setAttribute("data-msg-ts", String(it.ts || 0));
        if (it.data.id != null) seenMsgIds.add(String(it.data.id));
        trackSeen(it.data.createdAt);
      }
      feedEl.appendChild(node);
    });
  }

  // insert a message bubble keeping the feed time-sorted: place it before the
  // first existing bubble whose timestamp is strictly newer, else append.
  function insertBubbleSorted(node, ts) {
    node.setAttribute("data-msg-ts", String(ts || 0));
    var bubbles = feedEl.querySelectorAll("[data-msg-ts]");
    for (var i = 0; i < bubbles.length; i++) {
      var bts = Number(bubbles[i].getAttribute("data-msg-ts")) || 0;
      if (bts > (ts || 0)) { feedEl.insertBefore(node, bubbles[i]); return; }
    }
    feedEl.appendChild(node);
  }

  // append newly-polled messages (dedup by id), pinning scroll if at bottom.
  // Newly-arrived messages are inserted in timestamp order so an out-of-order
  // poll never leaves the timeline scrambled.
  function appendMessages(messages) {
    if (!feedEl || !messages || !messages.length) return;
    var wasNear = nearBottom();
    var added = false;
    messages.forEach(function (m) {
      var key = m.id != null ? String(m.id) : null;
      if (key && seenMsgIds && seenMsgIds.has(key)) return;
      if (!added) {
        // first new message clears any empty state and re-seeds the divider
        // using the real current date (not a hardcoded "today").
        if (!feedEl.querySelector("[data-feed-divider]")) {
          feedEl.innerHTML = "";
          var div = dividerNode(labelForDate(new Date()));
          div.setAttribute("data-feed-divider", "1");
          feedEl.appendChild(div);
        }
      }
      var node = bubbleNode(m);
      insertBubbleSorted(node, Date.parse(m.createdAt) || 0);
      if (key && seenMsgIds) seenMsgIds.add(key);
      trackSeen(m.createdAt);
      added = true;
    });
    if (added && wasNear) scrollToBottom(true);
  }

  // ── lightbox (tap a receipt photo) ──────────────────────────────────────────
  function enlarge(src) {
    var ov = el('<div role="dialog" aria-modal="true" aria-label="receipt photo" style="position:fixed; inset:0; z-index:60; background:rgba(0,0,0,0.92); display:flex; align-items:center; justify-content:center; padding:16px; cursor:zoom-out;"></div>');
    var im = el('<img alt="receipt photo" style="max-width:100%; max-height:100%; border-radius:14px;" />');
    im.src = src;
    ov.appendChild(im);
    ov.addEventListener("click", function () { if (ov.parentNode) ov.parentNode.removeChild(ov); });
    document.body.appendChild(ov);
  }

  // ── keyframes (lifted exactly from the frame's <style>) ─────────────────────
  function injectStyles() {
    if (document.getElementById("gcStyles")) return;
    var css =
      "@keyframes gcSquish{0%,100%{border-radius:47% 53% 52% 48% / 55% 48% 52% 45%;}50%{border-radius:53% 47% 48% 52% / 46% 54% 47% 53%;}}" +
      "@keyframes gcBlink{0%,91%,100%{transform:scaleY(1);}96%{transform:scaleY(0.12);}}" +
      "@keyframes gcKinetic{0%{background-position:0% 50%;}100%{background-position:200% 50%;}}" +
      "@keyframes gcPulse{0%,100%{opacity:.55;}50%{opacity:1;}}" +
      "@keyframes gcRise{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}" +
      "@keyframes gcShimmer{0%{background-position:-200% 0;}100%{background-position:200% 0;}}" +
      ".gc-scroll::-webkit-scrollbar{width:0;height:0;}" +
      ".gc-skel{height:46px;border-radius:20px;background:linear-gradient(100deg,var(--card) 30%,var(--paper-deep) 50%,var(--card) 70%);" +
        "background-size:200% 100%;animation:gcShimmer 1.3s linear infinite;}" +
      "@media (prefers-reduced-motion:reduce){.gc-scroll *{animation:none!important;}}";
    var style = document.createElement("style");
    style.id = "gcStyles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── composer status / preview ───────────────────────────────────────────────
  function setStatus(t) {
    var s = screenEl && screenEl.querySelector(".gc-status");
    if (!s) return;
    s.textContent = t || "";
    s.style.display = t ? "block" : "none";
  }
  function renderPreview() {
    var wrap = screenEl && screenEl.querySelector(".gc-preview");
    var btn = screenEl && screenEl.querySelector(".gc-attach");
    if (!wrap) return;
    if (!pendingImage) {
      wrap.style.display = "none"; wrap.innerHTML = "";
      if (btn) { btn.style.background = "rgba(255,198,92,0.55)"; btn.style.borderColor = "var(--border-ink)"; }
      return;
    }
    wrap.style.display = "flex"; wrap.innerHTML = "";
    var im = el('<img alt="selected receipt" style="width:40px; height:40px; object-fit:cover; border-radius:11px; border:1px solid rgba(var(--ink-rgb),0.1);" />');
    im.src = pendingImage;
    var lbl = el('<span style="font-family:' + MONO + '; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:rgba(var(--ink-rgb),0.6);">photo attached</span>');
    var x = el('<button type="button" style="margin-left:auto; appearance:none; background:none; border:0; color:rgba(var(--ink-rgb),0.6); font-family:' + MONO + '; font-size:11px; cursor:pointer; padding:4px 8px;">✕ remove</button>');
    x.addEventListener("click", function () { pendingImage = null; renderPreview(); });
    wrap.appendChild(im); wrap.appendChild(lbl); wrap.appendChild(x);
    if (btn) { btn.style.background = "#2775CA"; btn.style.borderColor = "var(--border-ink)"; }
  }
  async function onPhotoPicked(ev) {
    var file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    setStatus("processing photo…");
    try { pendingImage = await downscaleImage(file); setStatus(""); renderPreview(); }
    catch (err) { pendingImage = null; setStatus(err.message || "couldn't process that photo."); }
  }
  async function send() {
    if (sending) return;
    var text = (inputEl && inputEl.value || "").trim();
    var image = pendingImage;
    if (!text && !image) return;
    sending = true;
    var btn = screenEl && screenEl.querySelector(".gc-send");
    if (btn) { btn.style.opacity = ".5"; btn.disabled = true; }
    setStatus("sending…");
    try {
      var body = {};
      if (text) body.text = text;
      if (image) body.image = image;
      var msg = await request("/api/trips/" + encodeURIComponent(tripId) + "/messages",
        { method: "POST", body: JSON.stringify(body) });
      if (inputEl) inputEl.value = "";
      pendingImage = null; renderPreview(); setStatus("");
      if (msg && msg.id != null) appendMessages([msg]);
      scrollToBottom(true);
    } catch (err) {
      setStatus(err.status === 403 ? "you don't have access to this chat." : (err.message || "couldn't send — try again."));
    } finally {
      sending = false;
      if (btn) { btn.style.opacity = "1"; btn.disabled = false; }
    }
  }

  // ── polling ─────────────────────────────────────────────────────────────────
  async function poll(myToken) {
    if (myToken !== token || !tripId) return;
    var path = "/api/trips/" + encodeURIComponent(tripId) + "/messages";
    if (lastSeenISO) path += "?after=" + encodeURIComponent(lastSeenISO);
    try {
      var data = await request(path);
      if (myToken !== token) return; // a newer render took over
      appendMessages((data && data.messages) || []);
    } catch (_) { /* transient: next tick retries */ }
  }
  function startPolling(myToken) {
    stopPolling();
    pollTimer = setInterval(function () { poll(myToken); }, POLL_MS);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  // ── load ────────────────────────────────────────────────────────────────────
  function loadingFeed() {
    if (!feedEl) return;
    feedEl.innerHTML = "";
    feedEl.appendChild(el(
      '<div aria-hidden="true" style="display:flex; flex-direction:column; gap:12px;">' +
        '<div class="gc-skel" style="width:60%"></div>' +
        '<div class="gc-skel" style="width:52%; align-self:flex-end;"></div>' +
        '<div class="gc-skel" style="width:70%"></div>' +
      "</div>"));
  }

  function loadError(err) {
    if (!feedEl) return;
    feedEl.innerHTML = "";
    var box = el('<div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; padding:0 40px; text-align:center; margin:auto 0;"></div>');
    box.innerHTML = app.mascot({ size: 80, mood: "worried", glow: false });
    var p = document.createElement("div");
    p.style.cssText = "font-family:" + SANS + "; font-size:16px; line-height:1.45; color:rgba(var(--ink-rgb),0.65);";
    p.textContent = err && err.status === 403
      ? "no access to this chat — ask someone to share the link 🔒"
      : "couldn't load this chat — " + ((err && err.message) || "try again");
    box.appendChild(p);
    // A transient load failure shouldn't be a dead end — offer a retry. (403 is a
    // real access problem, not transient, so no retry there.)
    if (!(err && err.status === 403)) {
      var retry = document.createElement("button");
      retry.textContent = "tap to retry";
      retry.style.cssText = "font-family:" + SANS + "; font-size:15px; font-weight:600; color:#fff; " +
        "background:#2775CA; border:none; border-radius:999px; padding:11px 22px; cursor:pointer;";
      retry.onclick = function () { loadInitial(token); };
      box.appendChild(retry);
    }
    feedEl.appendChild(box);
  }

  async function loadInitial(myToken) {
    loadingFeed();
    var tName = screenEl && screenEl.querySelector(".gc-name");
    var tOn = screenEl && screenEl.querySelector(".gc-online");
    var tAv = screenEl && screenEl.querySelector(".gc-gavatar-emoji");
    try {
      var tripPath = "/api/trips/" + encodeURIComponent(tripId);
      trip = await request(tripPath);
      if (myToken !== token) return;
      shareToken = (trip && trip.shareToken) || shareToken;
      memberById = {};
      (trip && trip.members || []).forEach(function (m) { memberById[m.id] = m; });

      if (tName && trip && trip.name) tName.textContent = String(trip.name).toLowerCase();
      if (tAv) tAv.textContent = groupEmoji((trip && trip.name) || "");
      if (tOn) {
        var ms = (trip && trip.members) || [];
        var names = ms.slice(0, 2).map(function (m) { return String(m.name || "").toLowerCase(); });
        var extra = Math.max(0, ms.length - names.length);
        var who = names.join(", ") + (extra ? " +" + extra : "");
        var online = Math.max(1, ms.filter(function (m) { return m.claimed; }).length || 1);
        tOn.textContent = (who ? who + " · " : "") + online + " online";
      }

      var msgData = await request(tripPath + "/messages");
      if (myToken !== token) return;
      // money-card reactions (best-effort; cards still render if this fails)
      try {
        var rx = await request(tripPath + "/reactions");
        if (myToken !== token) return;
        reactionsMap = (rx && rx.reactions) || {};
      } catch (_) { reactionsMap = {}; }
      var messages = (msgData && msgData.messages) || [];
      var expenses = (trip && trip.expenses) || [];
      var settle = (trip && trip.settle) || null;

      renderFeed(buildTimeline(messages, expenses, settle));
      scrollToBottom(false);
      startPolling(myToken);
    } catch (err) {
      if (myToken !== token) return;
      loadError(err);
    }
  }

  function groupEmoji(name) {
    var n = (name || "").toLowerCase();
    if (/tokyo|japan|trip|travel|flight/.test(n)) return "🗼";
    if (/apart|rent|house|home|flat/.test(n)) return "🏠";
    if (/bali|beach|island|vacation/.test(n)) return "🏝️";
    if (/food|dinner|lunch|eat/.test(n)) return "🍜";
    return "👥";
  }

  // ── shell (top bar + composer, markup LIFTED verbatim from the frame) ───────
  function buildShell(view) {
    view.innerHTML = "";
    screenEl = el(
      '<div style="position:fixed; inset:0; z-index:40; background:var(--paper); color:var(--ink); font-family:' + SANS + '; -webkit-font-smoothing:antialiased; display:flex; flex-direction:column; overflow:hidden;">' +

        // faint money texture + soft blue glow (lifted)
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 84% 2%, rgba(var(--ink-rgb),0.028) 0 1px, transparent 1px 8px); opacity:.6; pointer-events:none;"></div>' +
        '<div style="position:absolute; left:-60px; top:380px; width:300px; height:300px; border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,0.13) 0%, rgba(39,117,202,0) 70%); pointer-events:none;"></div>' +

        // top bar
        '<div style="position:relative; z-index:6; display:flex; align-items:center; gap:11px; height:58px; padding:0 14px; flex:none; background:var(--paper); border-bottom:1.5px dashed rgba(var(--ink-rgb),0.22);">' +
          '<button class="gc-back" type="button" aria-label="back" style="appearance:none; width:38px; height:38px; border-radius:50%; background:var(--card); border:2px solid var(--border-ink); box-shadow:2px 3px 0 rgba(var(--shadow-rgb),0.85); display:flex; align-items:center; justify-content:center; cursor:pointer; flex:none; padding:0;">' +
            '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--border-ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>' +
          '<div style="position:relative; width:40px; height:40px; flex:none;">' +
            '<div class="gc-gavatar-emoji" style="width:40px; height:40px; border-radius:13px; background:linear-gradient(135deg,#3a93ec,#2775CA 60%,#1d5697); border:2px solid var(--border-ink); box-shadow:2px 3px 0 rgba(var(--shadow-rgb),0.85); display:flex; align-items:center; justify-content:center; font-size:19px; overflow:hidden;">👥</div>' +
            '<div style="position:absolute; right:-2px; bottom:-2px; width:14px; height:14px; border-radius:50%; background:#3DE8C7; border:2.5px solid var(--border-ink); box-shadow:0 0 8px rgba(61,232,199,0.7);"></div>' +
          '</div>' +
          '<div style="flex:1; min-width:0;">' +
            '<div class="gc-name" style="font-family:' + DISPLAY + '; font-weight:600; font-size:17px; letter-spacing:-0.2px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">group</div>' +
            '<div class="gc-online" style="font-family:' + MONO + '; font-size:9.5px; letter-spacing:.5px; color:#17a98c; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">loading…</div>' +
          '</div>' +
          '<div style="width:38px; height:38px; border-radius:50%; background:var(--card); border:2px solid var(--border-ink); box-shadow:2px 3px 0 rgba(var(--shadow-rgb),0.85); display:flex; align-items:center; justify-content:center; flex:none;"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--border-ink)" stroke-width="2.4" stroke-linecap="round"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></div>' +
        '</div>' +

        // feed (scroll)
        '<div class="gc-scroll gc-feed" style="position:relative; z-index:2; flex:1; overflow-y:auto; scrollbar-width:none; padding:16px 16px 14px; display:flex; flex-direction:column; gap:14px;"></div>' +

        // status line (sending / errors)
        '<div class="gc-status" style="position:relative; z-index:6; display:none; flex:none; font-family:' + MONO + '; font-size:10px; letter-spacing:.5px; color:rgba(var(--ink-rgb),0.6); padding:6px 16px 0; text-align:center; background:rgba(var(--paper-rgb),0.96);"></div>' +

        // photo preview strip
        '<div class="gc-preview" style="position:relative; z-index:6; display:none; flex:none; align-items:center; gap:8px; padding:8px 16px; background:rgba(var(--paper-rgb),0.96); border-top:1.5px dashed rgba(var(--ink-rgb),0.18);"></div>' +

        // composer (lifted: 📷 circle, input pill w/ "＋ tab", glowing send)
        '<div style="position:relative; z-index:6; flex:none; padding:10px 14px calc(14px + env(safe-area-inset-bottom)); background:var(--paper); border-top:1.5px dashed rgba(var(--ink-rgb),0.2); display:flex; align-items:center; gap:9px;">' +
          '<button class="gc-attach" type="button" aria-label="attach receipt" style="appearance:none; width:40px; height:40px; border-radius:50%; background:rgba(255,198,92,0.55); border:2px solid var(--border-ink); box-shadow:2px 3px 0 rgba(var(--shadow-rgb),0.85); display:flex; align-items:center; justify-content:center; font-size:17px; cursor:pointer; flex:none; padding:0;">📷</button>' +
          '<input class="gc-file" type="file" accept="image/*" capture="environment" style="display:none" />' +
          '<div style="flex:1; min-width:0; display:flex; align-items:center; gap:8px; background:var(--card); border:2px solid var(--border-ink); border-radius:999px; box-shadow:3px 4px 0 rgba(var(--shadow-rgb),0.85); padding:0 6px 0 16px; min-height:44px;">' +
            '<input class="gc-input" type="text" placeholder="message…" aria-label="message" style="flex:1; min-width:0; border:0; outline:none; background:transparent; color:var(--ink); font-family:' + SANS + '; font-size:15px; padding:11px 0;" />' +
            '<button class="gc-tabbtn" type="button" aria-label="new tab" style="appearance:none; display:inline-flex; align-items:center; gap:5px; background:rgba(39,117,202,0.16); border:1px solid rgba(39,117,202,0.4); border-radius:999px; padding:6px 11px; cursor:pointer; flex:none;">' +
              '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2775CA" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
              '<span style="font-family:' + MONO + '; font-weight:700; font-size:10.5px; color:#2775CA;">tab</span></button>' +
          '</div>' +
          '<button class="gc-send" type="button" aria-label="send" style="appearance:none; width:46px; height:46px; border-radius:50%; border:2px solid var(--border-ink); background:linear-gradient(135deg,#3286db,#2775CA); display:flex; align-items:center; justify-content:center; cursor:pointer; flex:none; box-shadow:3px 3px 0 rgba(var(--shadow-rgb),0.9);">' +
            '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg></button>' +
        '</div>' +
      '</div>');
    view.appendChild(screenEl);

    feedEl = screenEl.querySelector(".gc-feed");
    inputEl = screenEl.querySelector(".gc-input");
    fileEl = screenEl.querySelector(".gc-file");
    var attach = screenEl.querySelector(".gc-attach");
    var sendBtn = screenEl.querySelector(".gc-send");
    var back = screenEl.querySelector(".gc-back");
    var tabBtn = screenEl.querySelector(".gc-tabbtn");

    back.addEventListener("click", function () {
      if (history.length > 1) history.back(); else app.go("groups");
    });
    attach.addEventListener("click", function () { fileEl.click(); });
    fileEl.addEventListener("change", onPhotoPicked);
    sendBtn.addEventListener("click", send);
    tabBtn.addEventListener("click", function () { location.hash = "#/new/" + encodeURIComponent(tripId); });
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); send(); }
    });
  }

  // Stop the message poll the moment we leave the chat route — otherwise the
  // setInterval keeps firing network requests forever after navigating away.
  window.addEventListener("hashchange", function () {
    if (String(location.hash || "").indexOf("#/chat") !== 0) { token++; stopPolling(); }
  });

  window.Screens = window.Screens || {};
  window.Screens.chat = {
    title: "chat",
    render: function (view, params) {
      // reset state for this render; bump token so stale polls/loads bail.
      token++;
      var myToken = token;
      stopPolling();
      tripId = params && params[0] ? String(params[0]) : null;
      shareToken = null;
      trip = null;
      memberById = {};
      pendingImage = null;
      lastSeenISO = null;
      seenMsgIds = new Set();
      sending = false;
      reactionsMap = {};

      try { injectStyles(); } catch (_) {}
      buildShell(view);
      renderPreview();

      if (!tripId) {
        if (feedEl) {
          feedEl.innerHTML = "";
          var box = el('<div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; padding:0 40px; text-align:center; margin:auto 0;"></div>');
          box.innerHTML = app.mascot({ size: 80, mood: "worried", glow: false });
          var p = document.createElement("div");
          p.style.cssText = "font-family:" + SANS + "; font-size:16px; color:rgba(var(--ink-rgb),0.65);";
          p.textContent = "no group selected";
          box.appendChild(p);
          feedEl.appendChild(box);
        }
        return;
      }
      loadInitial(myToken);
    },
  };
})();
