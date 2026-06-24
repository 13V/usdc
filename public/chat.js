/* Divvy — Group chat / receipt feed for a Trip.
   Exposes window.Chat = { open(tripId, shareToken), close() }.

   An integrator wires a "Chat" button in the trip detail that calls
   window.Chat.open(tripId, shareToken). This module owns a full-screen-ish
   overlay it appends to <body>; nothing else in the app is touched.

   The feed MERGES two server sources into one chronological timeline:
     - chat messages (text or receipt photo), and
     - the trip's expenses (rendered as distinct "receipt cards"),
   so the whole group sees every receipt/expense inline with the chatter.

   API contract:
     GET  /api/trips/:id/messages?after=<iso?>
            -> { messages:[{ id, userId, author, text, image, createdAt }] }  (ascending)
     POST /api/trips/:id/messages { text?, image? } -> the new message
            (image is a data: URL; server caps ~1.5MB)
     GET  /api/trips/:id -> full trip incl. expenses:[{ id, title, amountFmt,
            paidByName?, participantNames?, fxNote?, createdAt }] and members.

   Authorization: send `X-Trip-Token: <shareToken>` on these requests (the
   trip's capability token). Also send the Bearer session via Auth.authFetch
   when signed in — so a link-holder works signed-out, and signed-in users get
   their identity too.
*/
(function () {
  "use strict";

  const GREEN = "#2775ca";
  const INK = "#04121a";
  const POLL_MS = 4000;
  // Client-side downscale target: longest edge ~1000px, JPEG quality ~0.7.
  // This keeps a phone photo well under the server's ~1.5MB data-URL cap.
  const MAX_EDGE = 1000;
  const JPEG_QUALITY = 0.7;

  // ── state ────────────────────────────────────────────────────────────────────
  let tripId = null;
  let shareToken = null;
  let overlayEl = null;
  let feedEl = null;
  let textInput = null;
  let pendingImage = null;     // a downscaled data: URL waiting to be sent
  let pollTimer = null;
  let lastSeenISO = null;      // newest message createdAt we've rendered
  let seenMsgIds = null;       // Set of message ids already in the feed (dedupe)
  let sending = false;

  // ── helpers ──────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function authUser() { return (window.Auth && window.Auth.user) || null; }
  function authFetchFn() {
    return (window.Auth && window.Auth.authFetch) ? window.Auth.authFetch : fetch;
  }

  // request(path, opts) — JSON helper that always attaches the trip capability
  // token (X-Trip-Token) and, when signed in, the Bearer session (Auth.authFetch).
  async function request(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    if (shareToken) headers["X-Trip-Token"] = shareToken;
    const fetchFn = authFetchFn();
    const res = await fetchFn(path, Object.assign({}, opts, { headers }));
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok) {
      const err = new Error((data && data.error) || ("Request failed (" + res.status + ")"));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // A short, locale-aware time stamp for a message/expense.
  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    try {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (_) {
      return d.toISOString().slice(11, 16);
    }
  }

  // Is this message authored by the signed-in user? (right-aligned bubble.)
  function isMine(msg) {
    const u = authUser();
    return !!(u && msg && msg.userId && msg.userId === u.id);
  }

  // ── image downscale (canvas) ─────────────────────────────────────────────────
  // Read a picked File, draw it into a canvas scaled so its longest edge is at
  // most MAX_EDGE, then export JPEG at JPEG_QUALITY. Produces a compact data: URL
  // that stays well under the server's ~1.5MB cap regardless of original size.
  function downscaleImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Couldn't read that image."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Couldn't load that image."));
        img.onload = () => {
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (!w || !h) { reject(new Error("That image looks empty.")); return; }
          const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) { reject(new Error("Canvas unavailable.")); return; }
          // White backdrop so transparent PNGs don't turn black under JPEG.
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          let dataUrl;
          try {
            dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
          } catch (e) {
            reject(new Error("Couldn't process that image."));
            return;
          }
          resolve(dataUrl);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ── timeline rendering ────────────────────────────────────────────────────────
  function nearBottom() {
    if (!feedEl) return true;
    return feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 80;
  }

  function scrollToBottom(smooth) {
    if (!feedEl) return;
    try {
      feedEl.scrollTo({ top: feedEl.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    } catch (_) {
      feedEl.scrollTop = feedEl.scrollHeight;
    }
  }

  // Build a chat bubble (text and/or receipt photo) node.
  function bubbleNode(msg) {
    const mine = isMine(msg);
    const row = el('<div class="chatRow' + (mine ? " mine" : "") + '"></div>');
    const bubble = el('<div class="chatBubble"></div>');
    if (!mine) {
      const author = el('<div class="chatAuthor"></div>');
      author.textContent = msg.author || "Someone";
      bubble.appendChild(author);
    }
    if (msg.image) {
      const im = el('<img class="chatImg" alt="Receipt photo" />');
      im.src = msg.image; // a data: URL from the server; set via property, not raw HTML
      im.addEventListener("click", () => enlarge(msg.image));
      bubble.appendChild(im);
    }
    if (msg.text) {
      const txt = el('<div class="chatText"></div>');
      txt.textContent = msg.text; // textContent — never inject raw message HTML
      bubble.appendChild(txt);
    }
    const meta = el('<div class="chatMeta"></div>');
    meta.textContent = fmtTime(msg.createdAt);
    bubble.appendChild(meta);
    row.appendChild(bubble);
    return row;
  }

  // Build a distinct "receipt card" for a trip expense.
  function expenseNode(e) {
    const who = e.paidByName ? esc(e.paidByName) : "Someone";
    const title = esc(e.title || "an expense");
    const amount = esc(e.amountFmt || "");
    const card = el(
      '<div class="rcptCard">' +
        '<div class="rcptHead">' +
          '<span class="rcptIcon" aria-hidden="true">🧾</span>' +
          '<span class="rcptLine"><strong>' + who + '</strong> added <strong>' + title + '</strong>' +
          (amount ? ' — <strong>' + amount + "</strong>" : "") + "</span>" +
        "</div>" +
      "</div>");
    const names = Array.isArray(e.participantNames) ? e.participantNames : [];
    if (names.length) {
      const split = el('<div class="rcptSplit muted"></div>');
      split.textContent = "split among " + names.join(", ");
      card.appendChild(split);
    }
    if (e.fxNote) {
      const fx = el('<div class="rcptFx muted"></div>');
      fx.textContent = e.fxNote;
      card.appendChild(fx);
    }
    const meta = el('<div class="chatMeta rcptMeta"></div>');
    meta.textContent = fmtTime(e.createdAt);
    card.appendChild(meta);
    return card;
  }

  // Merge messages + expenses into one ascending timeline of typed items.
  function buildTimeline(messages, expenses) {
    const items = [];
    for (const m of (messages || [])) {
      items.push({ kind: "msg", at: m.createdAt, ts: Date.parse(m.createdAt) || 0, data: m });
    }
    for (const e of (expenses || [])) {
      items.push({ kind: "exp", at: e.createdAt, ts: Date.parse(e.createdAt) || 0, data: e });
    }
    items.sort((a, b) => a.ts - b.ts);
    return items;
  }

  // Full (re)render of the feed from a timeline. Resets dedupe/lastSeen state.
  function renderFeed(items) {
    if (!feedEl) return;
    feedEl.innerHTML = "";
    seenMsgIds = new Set();
    lastSeenISO = null;
    if (items.length === 0) {
      feedEl.appendChild(el(
        '<div class="chatEmpty">' +
          '<div class="empty-glyph" aria-hidden="true">💬</div>' +
          '<div class="empty-title">No messages yet</div>' +
          '<div class="empty-hint">Say hi or drop a receipt 📷</div>' +
        "</div>"));
      return;
    }
    for (const it of items) {
      if (it.kind === "msg") {
        feedEl.appendChild(bubbleNode(it.data));
        if (it.data.id != null) seenMsgIds.add(String(it.data.id));
        trackSeen(it.data.createdAt);
      } else {
        feedEl.appendChild(expenseNode(it.data));
      }
    }
  }

  function trackSeen(iso) {
    if (!iso) return;
    if (!lastSeenISO || (Date.parse(iso) || 0) > (Date.parse(lastSeenISO) || 0)) {
      lastSeenISO = iso;
    }
  }

  // Append newly-polled messages (dedup by id), keeping scroll pinned if at bottom.
  function appendMessages(messages) {
    if (!feedEl || !messages || messages.length === 0) return;
    const wasNearBottom = nearBottom();
    let added = false;
    // If the feed was empty (placeholder), clear it before appending.
    const placeholder = feedEl.querySelector(".chatEmpty");
    for (const m of messages) {
      const key = m.id != null ? String(m.id) : null;
      if (key && seenMsgIds.has(key)) continue;
      if (!added && placeholder && feedEl.children.length === 1) {
        feedEl.innerHTML = "";
      }
      feedEl.appendChild(bubbleNode(m));
      if (key) seenMsgIds.add(key);
      trackSeen(m.createdAt);
      added = true;
    }
    if (added && wasNearBottom) scrollToBottom(true);
  }

  // ── enlarge (tap receipt photo) ───────────────────────────────────────────────
  function enlarge(src) {
    const ov = el(
      '<div class="chatLightbox" role="dialog" aria-modal="true" aria-label="Receipt photo"></div>');
    const im = el('<img alt="Receipt photo" />');
    im.src = src;
    ov.appendChild(im);
    ov.addEventListener("click", () => {
      if (ov.parentNode) ov.parentNode.removeChild(ov);
    });
    overlayEl.appendChild(ov);
  }

  // ── styles (scoped, injected once) ────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("chatStyles")) return;
    const css =
      "#chatOverlay{position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;" +
        "background:var(--ink);color:var(--cream);" +
        "font-family:var(--sans);}" +
      "#chatOverlay .chatHeader{flex:0 0 auto;display:flex;align-items:center;gap:10px;" +
        "padding:14px 16px;border-bottom:1px solid var(--line);background:var(--surface);}" +
      "#chatOverlay .chatHeader h2{margin:0;font-size:1.05rem;font-weight:600;flex:1;min-width:0;" +
        "color:var(--cream);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      "#chatOverlay .chatClose{width:40px;height:40px;flex:0 0 auto;margin:0;padding:0;" +
        "border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-2);" +
        "color:var(--cream);font-size:1.2rem;line-height:1;cursor:pointer;}" +
      "#chatOverlay .chatClose:active{transform:scale(.97);}" +
      "#chatOverlay .chatFeed{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;" +
        "padding:14px 14px 18px;display:flex;flex-direction:column;gap:10px;}" +
      "#chatOverlay .chatRow{display:flex;justify-content:flex-start;" +
        "animation:chatRise 160ms ease both;}" +
      "#chatOverlay .chatRow.mine{justify-content:flex-end;}" +
      "@keyframes chatRise{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}" +
      "@media (prefers-reduced-motion:reduce){#chatOverlay .chatRow{animation:none;}}" +
      "#chatOverlay .chatBubble{max-width:78%;background:var(--surface-2);border-radius:var(--radius);" +
        "padding:9px 12px;border:1px solid var(--line);}" +
      "#chatOverlay .chatRow.mine .chatBubble{background:var(--accent-soft);" +
        "border-color:var(--accent-line);border-right:3px solid var(--accent);}" +
      "#chatOverlay .chatAuthor{font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;" +
        "text-transform:uppercase;font-weight:600;color:var(--accent);margin-bottom:3px;}" +
      "#chatOverlay .chatText{font-size:.95rem;line-height:1.4;color:var(--cream);" +
        "white-space:pre-wrap;word-break:break-word;}" +
      "#chatOverlay .chatImg{display:block;max-width:100%;width:240px;border-radius:var(--radius-sm);" +
        "margin:2px 0;cursor:pointer;border:1px solid var(--line);}" +
      "#chatOverlay .chatMeta{font-family:var(--mono);font-size:.62rem;letter-spacing:.08em;" +
        "color:var(--faint);margin-top:5px;text-align:right;}" +
      "#chatOverlay .rcptCard{align-self:stretch;background:var(--surface);" +
        "border:1px solid var(--line);border-left:3px solid var(--accent);" +
        "border-radius:var(--radius);padding:12px 14px;margin:2px 0;" +
        "animation:chatRise 160ms ease both;}" +
      "#chatOverlay .rcptHead{display:flex;gap:8px;align-items:flex-start;}" +
      "#chatOverlay .rcptIcon{font-size:1.1rem;line-height:1.3;}" +
      "#chatOverlay .rcptLine{font-size:.92rem;line-height:1.4;color:var(--cream);}" +
      "#chatOverlay .rcptLine strong{color:var(--cream);font-weight:600;}" +
      "#chatOverlay .rcptSplit,#chatOverlay .rcptFx{font-size:.8rem;margin-top:5px;" +
        "color:var(--muted) !important;}" +
      "#chatOverlay .rcptMeta{color:var(--faint);}" +
      "#chatOverlay .chatComposer{flex:0 0 auto;position:sticky;bottom:0;display:flex;" +
        "align-items:flex-end;gap:8px;padding:10px 12px;" +
        "padding-bottom:calc(10px + env(safe-area-inset-bottom));" +
        "border-top:1px solid var(--line);background:var(--surface);}" +
      "#chatOverlay .chatPhotoBtn{width:46px;height:46px;flex:0 0 auto;margin:0;padding:0;" +
        "border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-2);" +
        "color:var(--cream);font-size:1.25rem;cursor:pointer;}" +
      "#chatOverlay .chatPhotoBtn:active{transform:scale(.97);}" +
      "#chatOverlay .chatPhotoBtn.has{background:var(--accent);color:var(--accent-ink);" +
        "border-color:var(--accent);}" +
      "#chatOverlay .chatInput{flex:1 1 auto;width:auto;min-width:0;margin:0;padding:12px;" +
        "border-radius:var(--radius-sm);border:1px solid var(--line);background:var(--surface-2);" +
        "color:var(--cream);font-size:1rem;resize:none;max-height:120px;line-height:1.3;" +
        "font-family:var(--sans);}" +
      "#chatOverlay .chatInput::placeholder{color:var(--faint);}" +
      "#chatOverlay .chatSend{width:auto;flex:0 0 auto;margin:0;padding:0 20px;height:46px;" +
        "border:0;border-radius:999px;background:var(--accent);color:var(--accent-ink);" +
        "font-family:var(--sans);font-weight:700;cursor:pointer;}" +
      "#chatOverlay .chatSend:active{transform:scale(.97);}" +
      "#chatOverlay .chatSend:disabled{opacity:.5;cursor:default;transform:none;}" +
      "#chatOverlay .chatPreview{flex:0 0 auto;display:flex;align-items:center;gap:8px;" +
        "padding:8px 14px;border-top:1px solid var(--line);background:var(--surface);}" +
      "#chatOverlay .chatPreview img{width:40px;height:40px;object-fit:cover;" +
        "border-radius:var(--radius-sm);border:1px solid var(--line);}" +
      "#chatOverlay .chatPreview .chatPreviewLabel{font-family:var(--mono);font-size:.68rem;" +
        "letter-spacing:.12em;text-transform:uppercase;color:var(--muted);}" +
      "#chatOverlay .chatPreview .x{margin-left:auto;width:auto;background:none;border:0;" +
        "color:var(--muted);font-size:.85rem;cursor:pointer;padding:4px 8px;}" +
      "#chatOverlay .chatStatus{font-family:var(--mono);font-size:.68rem;letter-spacing:.08em;" +
        "color:var(--muted);padding:0 14px 4px;}" +
      "#chatOverlay .chatStatus:empty{display:none;}" +
      "#chatOverlay .chatEmpty{margin:auto;text-align:center;padding:36px 16px;}" +
      "#chatOverlay .chatEmpty .empty-glyph{font-size:40px;opacity:.5;line-height:1;}" +
      "#chatOverlay .chatEmpty .empty-title{margin-top:12px;font-size:1rem;font-weight:600;" +
        "color:var(--cream);}" +
      "#chatOverlay .chatEmpty .empty-hint{margin-top:4px;font-size:.85rem;color:var(--muted);}" +
      "#chatOverlay .chatLoading{display:flex;flex-direction:column;gap:10px;padding:4px 0;}" +
      "#chatOverlay .chatLoading .skeleton{height:46px;border-radius:var(--radius);" +
        "max-width:78%;}" +
      "#chatOverlay .chatLoading .skeleton.mine{align-self:flex-end;}" +
      "#chatOverlay .skeleton{background:linear-gradient(90deg,var(--surface-2) 25%," +
        "var(--surface) 37%,var(--surface-2) 63%);background-size:400% 100%;" +
        "animation:chatShimmer 1.4s ease infinite;}" +
      "@keyframes chatShimmer{from{background-position:100% 0;}to{background-position:-100% 0;}}" +
      "#chatOverlay .chatLightbox{position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.92);" +
        "display:flex;align-items:center;justify-content:center;padding:16px;cursor:zoom-out;}" +
      "#chatOverlay .chatLightbox img{max-width:100%;max-height:100%;border-radius:var(--radius-sm);}";
    const style = document.createElement("style");
    style.id = "chatStyles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── composer wiring ────────────────────────────────────────────────────────────
  function setStatus(text) {
    const s = overlayEl && overlayEl.querySelector(".chatStatus");
    if (s) s.textContent = text || "";
  }

  function showAccessDenied() {
    if (!feedEl) return;
    feedEl.innerHTML = "";
    feedEl.appendChild(el(
      '<div class="chatEmpty">' +
        '<div class="empty-glyph" aria-hidden="true">🔒</div>' +
        '<div class="empty-title">No access to this group\'s chat</div>' +
        '<div class="empty-hint">Ask someone in the trip to share the link with you.</div>' +
      "</div>"));
    stopPolling();
  }

  function renderPreview() {
    const wrap = overlayEl && overlayEl.querySelector(".chatPreview");
    if (!wrap) return;
    if (!pendingImage) {
      wrap.style.display = "none";
      wrap.innerHTML = "";
      const btn = overlayEl.querySelector(".chatPhotoBtn");
      if (btn) btn.classList.remove("has");
      return;
    }
    wrap.style.display = "flex";
    wrap.innerHTML = "";
    const im = el('<img alt="Selected receipt" />');
    im.src = pendingImage;
    const label = el('<span class="chatPreviewLabel">Photo attached</span>');
    const x = el('<button type="button" class="x" aria-label="Remove photo">✕ remove</button>');
    x.addEventListener("click", () => {
      pendingImage = null;
      renderPreview();
    });
    wrap.appendChild(im);
    wrap.appendChild(label);
    wrap.appendChild(x);
    const btn = overlayEl.querySelector(".chatPhotoBtn");
    if (btn) btn.classList.add("has");
  }

  async function onPhotoPicked(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setStatus("Processing photo…");
    try {
      pendingImage = await downscaleImage(file);
      setStatus("");
      renderPreview();
    } catch (err) {
      pendingImage = null;
      setStatus(err.message || "Couldn't process that photo.");
    }
  }

  async function send() {
    if (sending) return;
    const text = (textInput && textInput.value || "").trim();
    const image = pendingImage;
    if (!text && !image) return;
    sending = true;
    const sendBtn = overlayEl && overlayEl.querySelector(".chatSend");
    if (sendBtn) sendBtn.disabled = true;
    setStatus("Sending…");
    try {
      const body = {};
      if (text) body.text = text;
      if (image) body.image = image;
      const msg = await request(
        "/api/trips/" + encodeURIComponent(tripId) + "/messages",
        { method: "POST", body: JSON.stringify(body) });
      // Clear inputs.
      if (textInput) { textInput.value = ""; autoGrow(); }
      pendingImage = null;
      renderPreview();
      setStatus("");
      // Append the returned message (dedup-safe against the next poll).
      if (msg && msg.id != null) {
        appendMessages([msg]);
      }
      scrollToBottom(true);
    } catch (err) {
      if (err.status === 403) {
        setStatus("You don't have access to this group's chat.");
      } else {
        setStatus(err.message || "Couldn't send — try again.");
      }
    } finally {
      sending = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function autoGrow() {
    if (!textInput) return;
    textInput.style.height = "auto";
    textInput.style.height = Math.min(textInput.scrollHeight, 120) + "px";
  }

  // ── polling ────────────────────────────────────────────────────────────────────
  async function poll() {
    if (!tripId) return;
    let path = "/api/trips/" + encodeURIComponent(tripId) + "/messages";
    if (lastSeenISO) path += "?after=" + encodeURIComponent(lastSeenISO);
    try {
      const data = await request(path);
      appendMessages((data && data.messages) || []);
    } catch (err) {
      if (err.status === 403) showAccessDenied();
      // Other errors (transient network) are ignored; the next tick retries.
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(poll, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ── initial load ────────────────────────────────────────────────────────────────
  async function loadInitial() {
    setStatus("");
    if (feedEl) {
      feedEl.innerHTML = "";
      feedEl.appendChild(el(
        '<div class="chatLoading" aria-hidden="true">' +
          '<div class="skeleton" style="width:62%"></div>' +
          '<div class="skeleton mine" style="width:54%"></div>' +
          '<div class="skeleton" style="width:70%"></div>' +
        "</div>"));
    }
    try {
      // Fetch the trip (for expenses) and the messages in parallel.
      const tripPath = "/api/trips/" + encodeURIComponent(tripId);
      const msgPath = "/api/trips/" + encodeURIComponent(tripId) + "/messages";
      const [trip, msgData] = await Promise.all([
        request(tripPath),
        request(msgPath),
      ]);
      const expenses = (trip && trip.expenses) || [];
      const messages = (msgData && msgData.messages) || [];
      // Surface the trip name in the header if we have it.
      const h2 = overlayEl && overlayEl.querySelector(".chatHeader h2");
      if (h2 && trip && trip.name) h2.textContent = trip.name;
      const items = buildTimeline(messages, expenses);
      renderFeed(items);
      setStatus("");
      scrollToBottom(false);
      startPolling();
    } catch (err) {
      if (err.status === 403) { showAccessDenied(); return; }
      setStatus("");
      if (feedEl) {
        feedEl.innerHTML = "";
        feedEl.appendChild(el(
          '<div class="chatEmpty">' +
            '<div class="empty-glyph" aria-hidden="true">⚠️</div>' +
            '<div class="empty-title">Couldn\'t load this chat</div>' +
            '<div class="empty-hint">' + esc(err.message || "Please try again.") + "</div>" +
          "</div>"));
      }
    }
  }

  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  // ── public API ──────────────────────────────────────────────────────────────────
  function open(id, token) {
    if (id == null) return;
    // If already open for some trip, close it cleanly first.
    if (overlayEl) close();
    tripId = String(id);
    shareToken = token || null;
    pendingImage = null;
    lastSeenISO = null;
    seenMsgIds = new Set();
    sending = false;

    injectStyles();

    overlayEl = el(
      '<div id="chatOverlay" role="dialog" aria-modal="true" aria-label="Trip chat">' +
        '<div class="chatHeader">' +
          '<button class="chatClose" type="button" aria-label="Close chat">✕</button>' +
          "<h2>Group chat</h2>" +
        "</div>" +
        '<div class="chatFeed"></div>' +
        '<div class="chatStatus"></div>' +
        '<div class="chatPreview" style="display:none"></div>' +
        '<div class="chatComposer">' +
          '<button class="chatPhotoBtn" type="button" aria-label="Add receipt photo">📷</button>' +
          '<input class="chatFile" type="file" accept="image/*" capture="environment" ' +
            'style="display:none" />' +
          '<textarea class="chatInput" rows="1" placeholder="Message…" ' +
            'aria-label="Message"></textarea>' +
          '<button class="chatSend" type="button">Send</button>' +
        "</div>" +
      "</div>");

    document.body.appendChild(overlayEl);
    // Prevent the page behind from scrolling while the chat is open.
    overlayEl.dataset.prevOverflow = document.body.style.overflow || "";
    document.body.style.overflow = "hidden";

    feedEl = overlayEl.querySelector(".chatFeed");
    textInput = overlayEl.querySelector(".chatInput");
    const fileInput = overlayEl.querySelector(".chatFile");
    const photoBtn = overlayEl.querySelector(".chatPhotoBtn");
    const sendBtn = overlayEl.querySelector(".chatSend");
    const closeBtn = overlayEl.querySelector(".chatClose");

    closeBtn.addEventListener("click", close);
    photoBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", onPhotoPicked);
    sendBtn.addEventListener("click", send);
    textInput.addEventListener("input", autoGrow);
    // Enter to send (Shift+Enter for newline), mobile keyboards send a newline.
    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    document.addEventListener("keydown", onKeydown);

    loadInitial();
  }

  function close() {
    stopPolling();
    document.removeEventListener("keydown", onKeydown);
    if (overlayEl) {
      document.body.style.overflow = overlayEl.dataset.prevOverflow || "";
      if (overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
    feedEl = null;
    textInput = null;
    tripId = null;
    shareToken = null;
    pendingImage = null;
    lastSeenISO = null;
    seenMsgIds = null;
    sending = false;
  }

  window.Chat = { open, close };
})();
