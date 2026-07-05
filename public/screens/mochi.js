/* screens/mochi.js — "Ask Mochi": chat-style sheet for natural-language expense
   entry + questions ("who owes me?", "add $7 coffee with sam"). Journal
   aesthetic: user messages are tilted handwriting-style notes, Mochi replies
   next to his face (Mascot.mini), pending money-writes render as confirm cards
   that call the REAL API routes only when the user taps confirm.
   Degrades gracefully: no API key server-side → "mochi is napping" + deep
   links; no Web Speech API → the mic button simply doesn't render. */
(function () {
  "use strict";
  var app = window.app;

  var INKC = "#2B2118";
  var MONO = "'Space Mono',monospace";
  var SANS = "'General Sans',sans-serif";
  var DISPLAY = "'Clash Display','General Sans',sans-serif";

  // Conversation state survives in-app navigation (module scope), resets on reload.
  var convo = []; // {role:'user'|'mochi', text}
  var HISTORY_MAX = 10;

  var SUGGESTIONS = [
    "who owes me the most?",
    "what do my subscriptions cost?",
    "add $7 coffee with a friend",
    "how much did my last trip cost me?",
  ];

  // one-time CSS for the typing bob + entrance
  if (!document.getElementById("divvy-mochi-css")) {
    var st = document.createElement("style");
    st.id = "divvy-mochi-css";
    st.textContent =
      "@keyframes mochiBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}" +
      "@keyframes mochiDot{0%,80%,100%{opacity:.25}40%{opacity:.9}}" +
      "@keyframes mochiIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}" +
      ".mochi-in{animation:mochiIn .24s cubic-bezier(.2,.7,.2,1) both}" +
      "@media (prefers-reduced-motion: reduce){.mochi-in{animation:none}.mochi-bob{animation:none!important}}";
    document.head.appendChild(st);
  }

  function header() {
    return '' +
      '<div style="display:flex; align-items:center; gap:11px; height:56px; padding:0 16px; flex:none;">' +
        '<button id="mBack" aria-label="back" style="appearance:none; cursor:pointer; width:36px; height:36px; border-radius:50%; background:#FFFDF7; border:2px solid ' + INKC + '; display:flex; align-items:center; justify-content:center; flex:none;">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="' + INKC + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>' +
        '</button>' +
        '<span style="flex:none;">' + (window.Mascot ? window.Mascot.mini(30) : "🐸") + '</span>' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="font-family:' + DISPLAY + '; font-weight:600; font-size:19px; letter-spacing:-0.3px; color:' + INKC + ';">ask mochi</div>' +
          '<div style="font-family:' + MONO + '; font-size:9.5px; letter-spacing:.5px; color:rgba(43,33,24,0.5);">your money, in plain words</div>' +
        '</div>' +
      '</div>';
  }

  // ---- bubbles ----------------------------------------------------------------

  // user note: a slip of card stock, slightly tilted, like a margin scribble.
  function userBubble(text) {
    return '<div class="mochi-in" style="display:flex; justify-content:flex-end; padding:4px 0;">' +
      '<div style="max-width:78%; background:#FFFDF7; border:2px solid ' + INKC + '; border-radius:15px 15px 4px 15px; box-shadow:2.5px 3px 0 rgba(43,33,24,0.85); padding:10px 14px; transform:rotate(0.8deg);' +
        'font-family:' + SANS + '; font-style:italic; font-weight:500; font-size:14.5px; color:' + INKC + '; overflow-wrap:break-word;">' + app.esc(text) + '</div>' +
    '</div>';
  }

  function mochiBubble(text) {
    return '<div class="mochi-in" style="display:flex; align-items:flex-end; gap:8px; padding:4px 0;">' +
      '<span style="flex:none; margin-bottom:2px;">' + (window.Mascot ? window.Mascot.mini(24) : "🐸") + '</span>' +
      '<div style="max-width:78%; background:rgba(61,232,199,0.16); border:1.5px solid rgba(43,33,24,0.35); border-radius:15px 15px 15px 4px; padding:10px 14px;' +
        'font-family:' + SANS + '; font-size:14.5px; color:' + INKC + '; overflow-wrap:break-word;">' + app.esc(text) + '</div>' +
    '</div>';
  }

  function typingBubble() {
    var dots = "";
    for (var i = 0; i < 3; i++) {
      dots += '<span style="width:6px; height:6px; border-radius:50%; background:' + INKC + '; animation:mochiDot 1.1s ease-in-out ' + (i * 0.18) + 's infinite;"></span>';
    }
    return '<div id="mTyping" class="mochi-in" style="display:flex; align-items:flex-end; gap:8px; padding:4px 0;">' +
      '<span class="mochi-bob" style="flex:none; margin-bottom:2px; display:inline-block; animation:mochiBob .9s ease-in-out infinite;">' + (window.Mascot ? window.Mascot.mini(24) : "🐸") + '</span>' +
      '<div style="display:flex; gap:5px; align-items:center; background:rgba(61,232,199,0.16); border:1.5px solid rgba(43,33,24,0.35); border-radius:15px 15px 15px 4px; padding:13px 15px;">' + dots + '</div>' +
    '</div>';
  }

  // ---- confirm cards (money writes: mochi proposes, the user disposes) ----------

  function actionCard(action, idx) {
    return '<div class="mochi-in" data-action-card="' + idx + '" style="margin:6px 0 6px 32px; background:#FFFDF7; border:2px solid ' + INKC + '; border-radius:15px; box-shadow:3px 4px 0 rgba(43,33,24,0.85); padding:13px 14px;">' +
      '<div style="font-family:' + MONO + '; font-size:9.5px; font-weight:700; letter-spacing:1.5px; color:#FF6B5E;">CONFIRM?</div>' +
      '<div style="font-family:' + SANS + '; font-weight:500; font-size:14.5px; color:' + INKC + '; margin:6px 0 12px;">' + app.esc(action.summary) + '</div>' +
      '<div style="display:flex; gap:9px;">' +
        '<button data-confirm="' + idx + '" style="appearance:none; cursor:pointer; flex:1; min-height:42px; border-radius:999px; background:#2775CA; border:2px solid ' + INKC + '; box-shadow:2.5px 2.5px 0 rgba(43,33,24,0.9); font-family:' + DISPLAY + '; font-weight:600; font-size:14.5px; color:#fff;">confirm ✓</button>' +
        '<button data-dismiss="' + idx + '" style="appearance:none; cursor:pointer; flex:none; min-height:42px; padding:0 16px; border-radius:999px; background:#FFFDF7; border:2px solid ' + INKC + '; font-family:' + DISPLAY + '; font-weight:600; font-size:14.5px; color:' + INKC + ';">nah</button>' +
      '</div>' +
    '</div>';
  }

  // ---- suggestion chips ----------------------------------------------------------

  function chipsHtml(items) {
    return '<div id="mChips" style="display:flex; flex-wrap:wrap; gap:8px; padding:8px 0 4px;">' +
      items.map(function (s) {
        return '<button data-chip="' + app.esc(s) + '" style="appearance:none; cursor:pointer; background:#FFFDF7; border:1.5px dashed rgba(43,33,24,0.35); border-radius:999px; padding:8px 13px; font-family:' + MONO + '; font-size:11.5px; color:rgba(43,33,24,0.75);">' + app.esc(s) + '</button>';
      }).join("") +
    '</div>';
  }

  // degraded mode (no key server-side): plain deep links instead of chat answers
  function napLinks() {
    function link(href, label) {
      return '<a href="' + href + '" style="text-decoration:none; display:flex; align-items:center; gap:9px; background:#FFFDF7; border:1.5px dashed rgba(43,33,24,0.35); border-radius:13px; padding:11px 13px; font-family:' + SANS + '; font-weight:500; font-size:13.5px; color:' + INKC + ';">' + label + ' <span style="margin-left:auto; font-family:' + MONO + '; color:#2775CA;">→</span></a>';
    }
    return '<div class="mochi-in" style="display:flex; flex-direction:column; gap:8px; margin:6px 0 6px 32px;">' +
      link("#/home", "💰 see who owes you") +
      link("#/tabs", "☕️ friend tabs") +
      link("#/subscriptions", "🍿 subscriptions & what they cost") +
      link("#/new", "🧾 split a new bill") +
    '</div>';
  }

  // ---- screen ---------------------------------------------------------------------

  function render(view) {
    if (!(window.Auth && window.Auth.user)) {
      view.innerHTML = header() +
        '<div class="empty" style="padding-top:40px;">' + (app.mascot ? app.mascot({ size: 96, mood: "sleepy" }) : "") +
        '<div class="title lower">sign in to ask mochi</div><div class="hint">he only talks about your own tabs 🐸</div>' +
        '<button class="btn" style="max-width:220px; margin-top:8px;" onclick="location.hash=\'#/home\'">go sign in</button></div>';
      var bb = view.querySelector("#mBack");
      if (bb) bb.onclick = goBack;
      return;
    }

    view.innerHTML = header() +
      '<div id="mScroll" class="appscroll" style="padding-bottom:calc(150px + env(safe-area-inset-bottom));">' +
        '<div id="mMsgs" style="display:flex; flex-direction:column; padding-top:4px;"></div>' +
      '</div>' +
      // composer pinned above the safe area (tab bar is hidden on sub-screens)
      '<div style="position:fixed; left:0; right:0; bottom:0; z-index:40; display:flex; justify-content:center; pointer-events:none;">' +
        '<div style="width:100%; max-width:430px; padding:10px 14px calc(14px + env(safe-area-inset-bottom)); background:linear-gradient(transparent, #F7F1E3 30%); pointer-events:auto;">' +
          '<div style="display:flex; align-items:center; gap:8px; background:#FFFDF7; border:2px solid ' + INKC + '; border-radius:999px; box-shadow:3px 3.5px 0 rgba(43,33,24,0.9); padding:6px 6px 6px 16px;">' +
            '<input id="mInput" autocomplete="off" maxlength="500" placeholder="ask or add… &quot;$7 coffee with sam&quot;" style="flex:1; min-width:0; background:transparent; border:none; outline:none; font-family:' + SANS + '; font-size:15px; color:' + INKC + ';">' +
            '<button id="mMic" aria-label="dictate" style="display:none; appearance:none; cursor:pointer; width:38px; height:38px; border-radius:50%; background:transparent; border:none; align-items:center; justify-content:center; flex:none;">' +
              '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.65)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"/></svg>' +
            '</button>' +
            '<button id="mSend" aria-label="send" style="appearance:none; cursor:pointer; width:40px; height:40px; border-radius:50%; background:#2775CA; border:2px solid ' + INKC + '; display:flex; align-items:center; justify-content:center; flex:none;">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var msgs = view.querySelector("#mMsgs");
    var scroller = view.querySelector("#mScroll");
    var input = view.querySelector("#mInput");
    var back = view.querySelector("#mBack");
    if (back) back.onclick = goBack;

    function scrollDown() {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      // #view is the real scroll area; nudge it too
      try { view.scrollTop = view.scrollHeight; } catch (_) {}
    }
    function push(html) {
      var d = document.createElement("div");
      d.innerHTML = html;
      while (d.firstChild) msgs.appendChild(d.firstChild);
      scrollDown();
    }

    // replay any prior conversation from this session, else greet + chips.
    if (convo.length) {
      convo.forEach(function (m) { push(m.role === "user" ? userBubble(m.text) : mochiBubble(m.text)); });
    } else {
      push(mochiBubble("hi! i'm mochi 🐸 ask me about your tabs — or tell me an expense and i'll log it."));
      push(chipsHtml(SUGGESTIONS));
    }

    function wireChips() {
      Array.prototype.forEach.call(view.querySelectorAll("[data-chip]"), function (b) {
        b.onclick = function () {
          input.value = b.getAttribute("data-chip");
          input.focus();
          send();
        };
      });
    }
    wireChips();

    var busy = false;
    var actionSeq = 0;

    function wireActionCard(card, action) {
      var confirmBtn = card.querySelector("[data-confirm]");
      var dismissBtn = card.querySelector("[data-dismiss]");
      if (dismissBtn) dismissBtn.onclick = function () { card.remove(); };
      if (confirmBtn) confirmBtn.onclick = function () {
        // client-side sanity: mochi only ever proposes POSTs to our own /api.
        if (action.method !== "POST" || String(action.path).indexOf("/api/") !== 0) { card.remove(); return; }
        confirmBtn.disabled = true;
        dismissBtn && (dismissBtn.disabled = true);
        confirmBtn.textContent = "adding…";
        app.api.post(action.path, action.body).then(function () {
          card.innerHTML = '<div style="display:flex; align-items:center; gap:9px;">' +
            '<span style="font-size:17px;">🎉</span>' +
            '<span style="font-family:' + SANS + '; font-weight:500; font-size:14px; color:' + INKC + ';">done — ' + app.esc(action.summary) + '</span></div>';
          app.toast("logged it ✨");
          app.haptic([20, 30, 20]);
        }).catch(function (e) {
          confirmBtn.disabled = false;
          dismissBtn && (dismissBtn.disabled = false);
          confirmBtn.textContent = "confirm ✓";
          app.toast((e && e.message) || "couldn't add that");
        });
      };
    }

    function send() {
      var text = String(input.value || "").trim();
      if (!text || busy) return;
      input.value = "";
      var chips = view.querySelector("#mChips");
      if (chips) chips.remove();

      push(userBubble(text));
      var history = convo.slice(-HISTORY_MAX);
      convo.push({ role: "user", text: text });

      busy = true;
      push(typingBubble());
      app.api.post("/api/mochi", { message: text, history: history }).then(function (r) {
        busy = false;
        var t = view.querySelector("#mTyping");
        if (t) t.remove();
        var reply = (r && r.text) || "ribbit?";
        push(mochiBubble(reply));
        convo.push({ role: "mochi", text: reply });
        if (r && r.napping) {
          push(napLinks());
          return;
        }
        ((r && r.actions) || []).slice(0, 3).forEach(function (a) {
          if (!a || !a.summary || !a.path) return;
          var idx = actionSeq++;
          push(actionCard(a, idx));
          var card = msgs.querySelector('[data-action-card="' + idx + '"]');
          if (card) wireActionCard(card, a);
        });
      }).catch(function (e) {
        busy = false;
        var t = view.querySelector("#mTyping");
        if (t) t.remove();
        var msg = e && e.status === 429 ? "one at a time! give me a sec 🐸" : "ribbit… something croaked. try again?";
        push(mochiBubble(msg));
      });
    }

    var sendBtn = view.querySelector("#mSend");
    if (sendBtn) sendBtn.onclick = send;
    input.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); send(); } };

    // ---- mic (Web Speech API — render only where supported, degrade silently) ----
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var mic = view.querySelector("#mMic");
    if (SR && mic) {
      mic.style.display = "flex";
      var listening = false, rec = null;
      mic.onclick = function () {
        if (listening) { try { rec && rec.stop(); } catch (_) {} return; }
        try {
          rec = new SR();
          rec.lang = (navigator.language || "en-US");
          rec.interimResults = false;
          rec.maxAlternatives = 1;
          rec.onresult = function (ev) {
            var t = ev.results && ev.results[0] && ev.results[0][0] && ev.results[0][0].transcript;
            if (t) { input.value = t; input.focus(); }
          };
          rec.onend = function () {
            listening = false;
            mic.style.background = "transparent";
          };
          rec.onerror = rec.onend;
          rec.start();
          listening = true;
          mic.style.background = "rgba(255,107,94,0.25)";
          app.haptic(10);
        } catch (_) { /* degrade silently */ }
      };
    }

    setTimeout(scrollDown, 60);
  }

  function goBack() {
    if (history.length > 1) history.back();
    else location.hash = "#/home";
  }

  window.Screens = window.Screens || {};
  window.Screens.mochi = { title: "ask mochi", render: render };
})();
