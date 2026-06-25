/* screens/chat.js — Group chat / receipt feed for a Trip (full-screen route).
   Route: #/chat/<id>  (params[0] = tripId). Registers window.Screens.chat.

   Money is a first-class object in the feed: text bubbles, tappable receipt
   photos, and "money cards" (expenses = tabs, settlement transfers = payment
   events) are interleaved chronologically, each with emoji reactions.

   Wires:
     GET  /api/trips/<id>                       -> members + shareToken + expenses + settle
     GET  /api/trips/<id>/messages?after=<iso>  -> { messages:[…] } ascending
     POST /api/trips/<id>/messages { text?, image? }  -> the new message
   The trip's shareToken is sent as X-Trip-Token on chat requests when known, so
   link-holders work signed-out. Polls every ~4s. Matches
   design/frames/Group Chat Frames.dc.html. (Reuses chat.js helper logic.)

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
  var reactions = {};         // local-only reaction counts keyed by item id
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

  // members carry no emoji/color from the server → deterministic avatar fallback
  function personFor(name) { return { name: name || "someone" }; }

  // ── image downscale (canvas) — reused from chat.js logic ───────────────────
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

  // ── reactions row (local-only, the design's 🫡 👀 💀 chips) ─────────────────
  var REACTS = ["🫡", "👀", "💀"];
  function reactionRow(itemId) {
    var row = el('<div class="gc-reacts"></div>');
    REACTS.forEach(function (emoji) {
      var key = itemId + ":" + emoji;
      var chip = el('<button type="button" class="gc-react"></button>');
      var count = reactions[key] || 0;
      function paint() {
        chip.innerHTML = "";
        var e = document.createElement("span"); e.className = "gc-react-e"; e.textContent = emoji;
        chip.appendChild(e);
        if (count > 0) {
          var n = document.createElement("span"); n.className = "gc-react-n mono"; n.textContent = String(count);
          chip.appendChild(n);
        }
        chip.classList.toggle("on", count > 0);
      }
      chip.addEventListener("click", function () {
        count = count > 0 ? 0 : 1; // toggle
        reactions[key] = count; paint();
      });
      paint();
      row.appendChild(chip);
    });
    return row;
  }

  // ── timeline item builders ──────────────────────────────────────────────────
  // text + photo bubble
  function bubbleNode(msg) {
    var mine = isMine(msg);
    var wrap = el('<div class="gc-msg' + (mine ? " mine" : "") + '"></div>');

    var head = el('<div class="gc-head"></div>');
    var who = document.createElement("span"); who.className = "gc-who mono";
    who.textContent = mine ? "you" : String(msg.author || "someone").toLowerCase();
    var when = document.createElement("span"); when.className = "gc-when mono";
    when.textContent = fmtTime(msg.createdAt);
    if (mine) { head.appendChild(when); head.appendChild(who); }
    else { head.appendChild(who); head.appendChild(when); }

    var line = el('<div class="gc-line"></div>');
    if (!mine) {
      var av = el('<div class="gc-avwrap"></div>');
      av.innerHTML = app.avatar(personFor(msg.author), "sm");
      line.appendChild(av);
    }
    var bubble = el('<div class="gc-bubble' + (mine ? " mine" : "") + '"></div>');
    if (msg.image) {
      var im = el('<img class="gc-img" alt="receipt photo" />');
      im.src = msg.image; // data: URL from the server; set via property, not raw HTML
      im.addEventListener("click", function () { enlarge(msg.image); });
      bubble.appendChild(im);
    }
    if (msg.text) {
      var txt = document.createElement("div");
      txt.className = "gc-text";
      txt.textContent = msg.text; // textContent — never inject raw message HTML
      bubble.appendChild(txt);
    }
    line.appendChild(bubble);

    wrap.appendChild(head);
    wrap.appendChild(line);
    return wrap;
  }

  // expense "money card" (a tab)
  function expenseNode(e) {
    var title = String(e.title || "an expense");
    var emoji = expenseEmoji(title);
    var names = Array.isArray(e.participantNames) ? e.participantNames : [];
    var splitN = names.length || (Array.isArray(e.participants) ? e.participants.length : 0);
    var paidBy = e.paidByName ? String(e.paidByName).toLowerCase() : "someone";

    // your share (you owe) — only meaningful when signed in & a participant.
    var owe = yourShareCents(e);

    var card = el('<div class="gc-card gc-tab"></div>');
    card.appendChild(el('<div class="gc-rail"></div>'));
    var inner = el('<div class="gc-card-in"></div>');

    var top = el('<div class="gc-card-top"></div>');
    var ico = document.createElement("div"); ico.className = "gc-card-ico"; ico.textContent = emoji;
    top.appendChild(ico);

    var mid = el('<div class="gc-card-mid"></div>');
    var t = document.createElement("div"); t.className = "gc-card-title display"; t.textContent = title.toLowerCase();
    var sub = document.createElement("div"); sub.className = "gc-card-sub mono";
    sub.textContent = "tab · " + paidBy + " paid · split " + (splitN || 1);
    mid.appendChild(t); mid.appendChild(sub);
    top.appendChild(mid);

    var amt = el('<div class="gc-card-amt"></div>');
    amt.innerHTML = app.money(e.amountCents || 0, "");
    if (owe != null && owe > 0) {
      var ow = el('<div class="gc-card-owe mono">you owe </div>');
      ow.appendChild(el('<span>' + app.money(owe, "neg") + '</span>'));
      amt.appendChild(ow);
    }
    top.appendChild(amt);
    inner.appendChild(top);

    var foot = el('<div class="gc-card-foot"></div>');
    var stack = el('<div class="avatar-stack"></div>');
    names.slice(0, 4).forEach(function (nm) { stack.innerHTML += app.avatar(personFor(nm), "sm"); });
    foot.appendChild(stack);
    var chip = el('<button type="button" class="gc-chipin"><span class="mono">chip in</span>' +
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>');
    chip.addEventListener("click", function () { location.hash = "#/settle/" + encodeURIComponent(tripId); });
    foot.appendChild(chip);
    inner.appendChild(foot);
    card.appendChild(inner);

    var wrap = el('<div class="gc-cardwrap"></div>');
    wrap.appendChild(card);
    wrap.appendChild(reactionRow("exp:" + (e.id || title)));
    return wrap;
  }

  // payment event "money card" — "<name> chipped in <mono> · settled"
  function paymentNode(p) {
    var who = p.fromName ? String(p.fromName).toLowerCase() : "someone";
    var card = el('<div class="gc-card gc-pay"></div>');
    var inner = el('<div class="gc-card-in gc-pay-in"></div>');

    var blob = el('<div class="gc-blob"><span class="gc-blob-glow"></span>' +
      app.mascot({ size: 30, mood: "happy", glow: false }) + '</div>');
    inner.appendChild(blob);

    var mid = el('<div class="gc-pay-mid"></div>');
    var line = el('<div class="gc-pay-line"></div>');
    line.appendChild(document.createTextNode(who + " chipped in "));
    line.appendChild(el('<span>' + app.money(p.amountCents || 0, "settled") + '</span>'));
    var meta = el('<div class="gc-pay-meta"><span class="gc-dot"></span>' +
      '<span class="mono">settled · ~$0.001</span></div>');
    mid.appendChild(line); mid.appendChild(meta);
    inner.appendChild(mid);

    var view = el('<button type="button" class="gc-view"><span class="mono">view</span>' +
      '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></button>');
    view.addEventListener("click", function () { location.hash = "#/settle/" + encodeURIComponent(tripId); });
    inner.appendChild(view);

    card.appendChild(inner);
    var wrap = el('<div class="gc-cardwrap"></div>');
    wrap.appendChild(card);
    wrap.appendChild(reactionRow("pay:" + (p.from || "") + ":" + (p.to || "") + ":" + (p.amountCents || 0)));
    return wrap;
  }

  // small mono day divider
  function dividerNode(label) {
    var d = el('<div class="gc-divider"></div>');
    var s = document.createElement("span"); s.className = "mono"; s.textContent = label;
    d.appendChild(s);
    return d;
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

  function renderEmpty() {
    if (!feedEl) return;
    feedEl.innerHTML = "";
    var box = el('<div class="gc-empty"></div>');
    box.innerHTML = app.mascot({ size: 80, mood: "happy", glow: true });
    var p = document.createElement("div"); p.className = "gc-empty-txt lower";
    p.textContent = "no messages yet — say hi or drop a receipt 📷";
    box.appendChild(p);
    feedEl.appendChild(box);
  }

  function renderFeed(items) {
    if (!feedEl) return;
    feedEl.innerHTML = "";
    seenMsgIds = new Set();
    lastSeenISO = null;
    if (!items.length) { renderEmpty(); return; }
    feedEl.appendChild(dividerNode("today"));
    items.forEach(function (it) {
      feedEl.appendChild(nodeFor(it));
      if (it.kind === "msg") {
        if (it.data.id != null) seenMsgIds.add(String(it.data.id));
        trackSeen(it.data.createdAt);
      }
    });
  }

  // append newly-polled messages (dedup by id), pinning scroll if at bottom.
  function appendMessages(messages) {
    if (!feedEl || !messages || !messages.length) return;
    var wasNear = nearBottom();
    var added = false;
    messages.forEach(function (m) {
      var key = m.id != null ? String(m.id) : null;
      if (key && seenMsgIds && seenMsgIds.has(key)) return;
      if (!added) {
        var empty = feedEl.querySelector(".gc-empty");
        if (empty) { feedEl.innerHTML = ""; feedEl.appendChild(dividerNode("today")); }
      }
      feedEl.appendChild(bubbleNode(m));
      if (key && seenMsgIds) seenMsgIds.add(key);
      trackSeen(m.createdAt);
      added = true;
    });
    if (added && wasNear) scrollToBottom(true);
  }

  // ── lightbox (tap a receipt photo) ──────────────────────────────────────────
  function enlarge(src) {
    var ov = el('<div class="gc-lightbox" role="dialog" aria-modal="true" aria-label="receipt photo"></div>');
    var im = el('<img alt="receipt photo" />'); im.src = src;
    ov.appendChild(im);
    ov.addEventListener("click", function () { if (ov.parentNode) ov.parentNode.removeChild(ov); });
    document.body.appendChild(ov);
  }

  // ── styles (scoped to .gc-*, injected once) ─────────────────────────────────
  function injectStyles() {
    if (document.getElementById("gcStyles")) return;
    var css =
      ".gc-screen{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;background:var(--ink);}" +
      ".gc-topbar{flex:none;display:flex;align-items:center;gap:11px;height:58px;padding:0 14px;" +
        "background:rgba(11,22,34,0.82);border-bottom:1px solid var(--line);backdrop-filter:blur(8px);}" +
      ".gc-back{width:38px;height:38px;flex:none;border-radius:50%;background:var(--card);" +
        "border:1px solid var(--line);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text);}" +
      ".gc-back svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;}" +
      ".gc-gavatar{position:relative;width:40px;height:40px;flex:none;}" +
      ".gc-gavatar .avatar{width:40px;height:40px;border-radius:13px;font-size:20px;}" +
      ".gc-gdot{position:absolute;right:-2px;bottom:-2px;width:14px;height:14px;border-radius:50%;" +
        "background:var(--mint);border:2.5px solid var(--ink);box-shadow:0 0 8px rgba(61,232,199,0.7);}" +
      ".gc-tt{flex:1;min-width:0;}" +
      ".gc-tt .nm{font-family:var(--display);font-weight:600;font-size:17px;letter-spacing:-0.2px;color:var(--text);" +
        "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".gc-tt .on{font-family:var(--mono);font-size:9.5px;letter-spacing:.5px;color:rgba(61,232,199,0.85);margin-top:1px;" +
        "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +

      ".gc-feed{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;" +
        "padding:16px 16px 14px;display:flex;flex-direction:column;gap:14px;}" +
      ".gc-feed::-webkit-scrollbar{width:0;height:0;}" +

      ".gc-divider{display:flex;justify-content:center;}" +
      ".gc-divider span{font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--faint);" +
        "background:rgba(244,247,250,0.05);border-radius:999px;padding:4px 12px;}" +

      ".gc-msg{display:flex;flex-direction:column;gap:5px;max-width:82%;animation:gcRise 150ms ease both;}" +
      ".gc-msg.mine{align-self:flex-end;align-items:flex-end;}" +
      "@keyframes gcRise{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}" +
      "@media (prefers-reduced-motion:reduce){.gc-msg,.gc-cardwrap,.gc-pay{animation:none;}}" +
      ".gc-head{display:flex;align-items:center;gap:7px;padding:0 4px 0 44px;}" +
      ".gc-msg.mine .gc-head{padding:0 4px 0 0;}" +
      ".gc-who{font-size:10px;color:var(--muted);}" +
      ".gc-msg.mine .gc-who{color:rgba(127,192,255,0.75);}" +
      ".gc-when{font-size:9px;color:rgba(244,247,250,0.32);}" +
      ".gc-line{display:flex;align-items:flex-end;gap:9px;}" +
      ".gc-msg.mine .gc-line{justify-content:flex-end;}" +
      ".gc-avwrap{flex:none;}" +
      ".gc-avwrap .avatar{width:33px;height:33px;border-radius:50%;font-size:16px;}" +
      ".gc-bubble{background:var(--card);border:1px solid rgba(244,247,250,0.07);" +
        "border-radius:20px 20px 20px 6px;padding:11px 15px;font-size:15px;line-height:1.35;color:var(--text);" +
        "word-break:break-word;}" +
      ".gc-bubble.mine{background:rgba(39,117,202,0.18);border:1px solid rgba(39,117,202,0.4);" +
        "border-radius:20px 20px 6px 20px;}" +
      ".gc-text{white-space:pre-wrap;}" +
      ".gc-img{display:block;width:200px;max-width:60vw;border-radius:14px;margin:1px 0;cursor:pointer;" +
        "border:1px solid var(--line);}" +

      ".gc-cardwrap{display:flex;flex-direction:column;gap:6px;width:100%;animation:gcRise 150ms ease both;}" +
      ".gc-card{position:relative;width:100%;background:var(--card);border:1px solid rgba(39,117,202,0.28);" +
        "border-radius:20px;overflow:hidden;box-shadow:0 12px 30px rgba(0,0,0,0.32);}" +
      ".gc-rail{position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,#2775CA,#3f97ee);}" +
      ".gc-card-in{position:relative;padding:15px 16px 13px;}" +
      ".gc-card-top{display:flex;align-items:center;gap:12px;}" +
      ".gc-card-ico{width:46px;height:46px;border-radius:14px;background:var(--ink);display:flex;align-items:center;" +
        "justify-content:center;font-size:23px;flex:none;}" +
      ".gc-card-mid{flex:1;min-width:0;}" +
      ".gc-card-title{font-weight:500;font-size:16.5px;letter-spacing:-0.2px;color:var(--text);" +
        "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".gc-card-sub{font-size:10px;letter-spacing:.3px;color:var(--faint);margin-top:3px;}" +
      ".gc-card-amt{text-align:right;flex:none;}" +
      ".gc-card-amt .money{font-size:21px;}" +
      ".gc-card-owe{font-size:9px;margin-top:2px;display:flex;align-items:baseline;justify-content:flex-end;color:var(--coral);}" +
      ".gc-card-owe .money{font-size:9px;}" +
      ".gc-card-foot{display:flex;align-items:center;justify-content:space-between;margin-top:13px;padding-top:12px;" +
        "border-top:1px dashed rgba(244,247,250,0.12);}" +
      ".gc-card-foot .avatar-stack > *{margin-left:-7px;border:1.5px solid var(--card);width:22px;height:22px;" +
        "border-radius:50%;font-size:11px;}" +
      ".gc-card-foot .avatar-stack > *:first-child{margin-left:0;}" +
      ".gc-chipin{appearance:none;display:inline-flex;align-items:center;gap:6px;cursor:pointer;" +
        "background:rgba(39,117,202,0.14);border:1px solid rgba(39,117,202,0.45);border-radius:999px;padding:5px 12px;" +
        "color:var(--blue-bright);}" +
      ".gc-chipin .mono{font-weight:700;font-size:11px;}" +
      ".gc-chipin svg{display:block;}" +

      ".gc-pay{border:0;padding:1.5px;background:linear-gradient(90deg,#2775CA,#3DE8C7,#2775CA);" +
        "background-size:200% 100%;animation:gcKin 4s linear infinite;box-shadow:0 12px 32px rgba(39,117,202,0.3);}" +
      "@keyframes gcKin{0%{background-position:0% 50%;}100%{background-position:200% 50%;}}" +
      ".gc-pay-in{border-radius:18.5px;background:#0f1d29;display:flex;align-items:center;gap:13px;padding:14px 16px;}" +
      ".gc-blob{position:relative;width:42px;height:42px;flex:none;display:flex;align-items:center;justify-content:center;}" +
      ".gc-blob-glow{position:absolute;inset:0;border-radius:50%;" +
        "background:radial-gradient(circle,rgba(61,232,199,0.4) 0%,rgba(61,232,199,0) 68%);}" +
      ".gc-pay-mid{flex:1;min-width:0;}" +
      ".gc-pay-line{font-size:14px;line-height:1.3;color:var(--text);}" +
      ".gc-pay-line .money{font-size:14px;}" +
      ".gc-pay-meta{display:flex;align-items:center;gap:6px;margin-top:4px;}" +
      ".gc-pay-meta .mono{font-size:9.5px;letter-spacing:.5px;color:rgba(61,232,199,0.85);}" +
      ".gc-dot{width:5px;height:5px;border-radius:50%;background:var(--mint);box-shadow:0 0 6px rgba(61,232,199,0.9);}" +
      ".gc-view{appearance:none;flex:none;display:inline-flex;align-items:center;gap:5px;cursor:pointer;" +
        "background:rgba(61,232,199,0.12);border:1px solid rgba(61,232,199,0.4);border-radius:999px;padding:6px 13px;color:var(--mint);}" +
      ".gc-view .mono{font-weight:700;font-size:11px;}" +
      ".gc-view svg{display:block;}" +

      ".gc-reacts{display:flex;align-items:center;gap:6px;padding-left:2px;}" +
      ".gc-react{appearance:none;display:inline-flex;align-items:center;gap:4px;cursor:pointer;" +
        "background:var(--card);border:1px solid var(--line);border-radius:999px;padding:3px 9px;color:var(--muted);}" +
      ".gc-react.on{border-color:rgba(39,117,202,0.45);background:rgba(39,117,202,0.12);}" +
      ".gc-react-e{font-size:12px;line-height:1;}" +
      ".gc-react-n{font-size:10px;color:var(--muted);}" +

      ".gc-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;" +
        "padding:0 40px;text-align:center;margin:auto 0;}" +
      ".gc-empty-txt{font-size:16px;line-height:1.45;color:var(--muted);}" +

      ".gc-loading{display:flex;flex-direction:column;gap:12px;}" +
      ".gc-loading .skeleton{height:46px;max-width:78%;border-radius:20px;}" +
      ".gc-loading .skeleton.mine{align-self:flex-end;}" +

      ".gc-composer{flex:none;display:flex;align-items:center;gap:9px;padding:10px 14px;" +
        "padding-bottom:calc(14px + env(safe-area-inset-bottom));background:rgba(8,17,26,0.96);" +
        "border-top:1px solid var(--line);}" +
      ".gc-attach{width:40px;height:40px;flex:none;border-radius:50%;background:var(--card);border:1px solid var(--line);" +
        "display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer;color:var(--text);}" +
      ".gc-attach.has{background:var(--blue);border-color:var(--blue);}" +
      ".gc-inwrap{flex:1;min-width:0;display:flex;align-items:center;gap:8px;background:var(--card);" +
        "border:1px solid var(--line);border-radius:999px;padding:0 6px 0 16px;min-height:44px;}" +
      ".gc-input{flex:1;min-width:0;border:0;outline:none;background:transparent;color:var(--text);" +
        "font-family:var(--sans);font-size:15px;padding:11px 0;}" +
      ".gc-input::placeholder{color:var(--faint);}" +
      ".gc-tabbtn{flex:none;display:inline-flex;align-items:center;gap:5px;cursor:pointer;" +
        "background:rgba(39,117,202,0.16);border:1px solid rgba(39,117,202,0.4);border-radius:999px;padding:6px 11px;color:var(--blue-bright);}" +
      ".gc-tabbtn svg{display:block;}" +
      ".gc-tabbtn .mono{font-weight:700;font-size:10.5px;}" +
      ".gc-send{width:46px;height:46px;flex:none;border-radius:50%;border:0;cursor:pointer;" +
        "background:linear-gradient(135deg,#3286db,#2775CA);display:flex;align-items:center;justify-content:center;" +
        "box-shadow:0 6px 20px rgba(39,117,202,0.55),inset 0 1px 0 rgba(255,255,255,0.28);}" +
      ".gc-send:active{transform:scale(.97);}" +
      ".gc-send:disabled{opacity:.5;}" +
      ".gc-send svg{display:block;}" +

      ".gc-preview{flex:none;display:flex;align-items:center;gap:8px;padding:8px 16px;" +
        "background:rgba(8,17,26,0.96);border-top:1px solid var(--line);}" +
      ".gc-preview img{width:40px;height:40px;object-fit:cover;border-radius:11px;border:1px solid var(--line);}" +
      ".gc-preview .lbl{font-family:var(--mono);font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);}" +
      ".gc-preview .x{margin-left:auto;appearance:none;background:none;border:0;color:var(--muted);" +
        "font-family:var(--mono);font-size:11px;cursor:pointer;padding:4px 8px;}" +
      ".gc-status{flex:none;font-family:var(--mono);font-size:10px;letter-spacing:.5px;color:var(--muted);" +
        "padding:0 16px;text-align:center;}" +
      ".gc-status:empty{display:none;padding:0;}" +

      ".gc-lightbox{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,0.92);display:flex;align-items:center;" +
        "justify-content:center;padding:16px;cursor:zoom-out;}" +
      ".gc-lightbox img{max-width:100%;max-height:100%;border-radius:14px;}";
    var style = document.createElement("style");
    style.id = "gcStyles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── composer ────────────────────────────────────────────────────────────────
  function setStatus(t) {
    var s = screenEl && screenEl.querySelector(".gc-status");
    if (s) s.textContent = t || "";
  }
  function renderPreview() {
    var wrap = screenEl && screenEl.querySelector(".gc-preview");
    var btn = screenEl && screenEl.querySelector(".gc-attach");
    if (!wrap) return;
    if (!pendingImage) {
      wrap.style.display = "none"; wrap.innerHTML = "";
      if (btn) btn.classList.remove("has");
      return;
    }
    wrap.style.display = "flex"; wrap.innerHTML = "";
    var im = el('<img alt="selected receipt" />'); im.src = pendingImage;
    var lbl = el('<span class="lbl">photo attached</span>');
    var x = el('<button type="button" class="x">✕ remove</button>');
    x.addEventListener("click", function () { pendingImage = null; renderPreview(); });
    wrap.appendChild(im); wrap.appendChild(lbl); wrap.appendChild(x);
    if (btn) btn.classList.add("has");
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
    if (btn) btn.disabled = true;
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
      if (btn) btn.disabled = false;
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
      '<div class="gc-loading" aria-hidden="true">' +
        '<div class="skeleton" style="width:60%"></div>' +
        '<div class="skeleton mine" style="width:52%"></div>' +
        '<div class="skeleton" style="width:70%"></div>' +
      "</div>"));
  }

  function loadError(err) {
    if (!feedEl) return;
    feedEl.innerHTML = "";
    var box = el('<div class="gc-empty"></div>');
    box.innerHTML = app.mascot({ size: 80, mood: "worried", glow: false });
    var p = document.createElement("div"); p.className = "gc-empty-txt lower";
    p.textContent = err && err.status === 403
      ? "no access to this chat — ask someone to share the link 🔒"
      : "couldn't load this chat — " + ((err && err.message) || "try again");
    box.appendChild(p);
    feedEl.appendChild(box);
  }

  async function loadInitial(myToken) {
    loadingFeed();
    var tName = screenEl && screenEl.querySelector(".gc-tt .nm");
    var tOn = screenEl && screenEl.querySelector(".gc-tt .on");
    var tAv = screenEl && screenEl.querySelector(".gc-gavatar .avatar");
    try {
      var tripPath = "/api/trips/" + encodeURIComponent(tripId);
      // 1) fetch trip first to learn members + shareToken.
      trip = await request(tripPath);
      if (myToken !== token) return;
      shareToken = (trip && trip.shareToken) || shareToken;
      memberById = {};
      (trip && trip.members || []).forEach(function (m) { memberById[m.id] = m; });

      if (tName && trip && trip.name) tName.textContent = String(trip.name).toLowerCase();
      if (tAv) {
        var av = el(app.avatar({ name: (trip && trip.name) || "group", id: tripId }));
        if (av) { av.className = "avatar"; tAv.replaceWith(av); }
      }
      if (tOn) {
        var ms = (trip && trip.members) || [];
        var names = ms.slice(0, 2).map(function (m) { return String(m.name || "").toLowerCase(); });
        var extra = Math.max(0, ms.length - names.length);
        var who = names.join(", ") + (extra ? " +" + extra : "");
        var online = Math.max(1, ms.filter(function (m) { return m.claimed; }).length || 1);
        tOn.textContent = (who ? who + " · " : "") + online + " online";
      }

      // 2) now fetch messages (with the token we just learned).
      var msgData = await request(tripPath + "/messages");
      if (myToken !== token) return;
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

  // ── render (screen contract) ────────────────────────────────────────────────
  function buildShell(view) {
    view.innerHTML = "";
    screenEl = el(
      '<div class="gc-screen">' +
        '<div class="gc-topbar">' +
          '<button class="gc-back" type="button" aria-label="back">' +
            '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>' +
          '<div class="gc-gavatar"><span class="avatar">👥</span><span class="gc-gdot"></span></div>' +
          '<div class="gc-tt"><div class="nm lower">group</div><div class="on mono">loading…</div></div>' +
        "</div>" +
        '<div class="gc-feed"></div>' +
        '<div class="gc-status"></div>' +
        '<div class="gc-preview" style="display:none"></div>' +
        '<div class="gc-composer">' +
          '<button class="gc-attach" type="button" aria-label="attach receipt">📷</button>' +
          '<input class="gc-file" type="file" accept="image/*" capture="environment" style="display:none" />' +
          '<div class="gc-inwrap">' +
            '<input class="gc-input" type="text" placeholder="message…" aria-label="message" />' +
            '<button class="gc-tabbtn" type="button" aria-label="new tab">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
              '<span class="mono">tab</span></button>' +
          "</div>" +
          '<button class="gc-send" type="button" aria-label="send">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>' +
          "</button>" +
        "</div>" +
      "</div>");
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
      reactions = {};

      try { injectStyles(); } catch (_) {}
      buildShell(view);
      renderPreview();

      if (!tripId) {
        if (feedEl) {
          feedEl.innerHTML = "";
          var box = el('<div class="gc-empty"></div>');
          box.innerHTML = app.mascot({ size: 80, mood: "worried", glow: false });
          var p = document.createElement("div"); p.className = "gc-empty-txt lower";
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
