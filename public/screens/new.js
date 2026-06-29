/* screens/new.js — New tab / add expense.
   Built by lifting the EXACT inline-styled markup from
   design/handoff/New Split Playful.dc.html and wiring live data into it, so it
   pixel-matches the approved design.

   Route #/new; optional params[0] = a group (trip) id to add the tab to.
   On submit:
     - group  -> POST /api/trips/<id>/expenses  -> #/group/<id>
     - else   -> POST /api/bills                -> #/collect/<billId>
   Also: POST /api/scan to read a receipt total.

   Voice: lowercase, dry; plain dollars (never "crypto"). Mono numerals, chunky
   pills, real emoji, self-hosted fonts. Integer cents only. Never crash. */
(function () {
  "use strict";
  var app = window.app;

  // exact font stacks from the frame
  var F_DISPLAY = "'Clash Display','General Sans',sans-serif";
  var F_SANS = "'General Sans','Space Grotesk',sans-serif";
  var F_MONO = "'Space Mono',monospace";

  // ---- helpers ---------------------------------------------------------
  // Pick a group emoji from its name (mirrors home.js groupEmoji) — the trips
  // API doesn't return a top-level emoji, so we derive one client-side.
  function groupEmojiFromName(name) {
    var n = (name || "").toLowerCase();
    if (/tokyo|japan|trip|travel|flight/.test(n)) return "🗼";
    if (/apart|rent|house|home|flat/.test(n)) return "🏠";
    if (/bali|beach|island|vacation/.test(n)) return "🏝️";
    if (/room|mate/.test(n)) return "🧻";
    if (/food|dinner|lunch|eat/.test(n)) return "🍜";
    return "✨";
  }

  // parse a dollar string -> integer cents (best effort, never NaN-explodes).
  function toCents(str) {
    var v = String(str == null ? "" : str).replace(/[^0-9.]/g, "");
    var parts = v.split(".");
    if (parts.length > 2) v = parts[0] + "." + parts.slice(1).join("");
    var n = parseFloat(v);
    if (!isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
  }
  function dollars(cents) { return (Math.max(0, cents | 0) / 100).toFixed(2); }
  // split "12.34" into whole + ".34" pieces (for the smaller, lighter decimals)
  function splitDollars(cents) {
    var s = dollars(cents), d = s.indexOf(".");
    return { whole: s.slice(0, d), cents: s.slice(d) };
  }

  // tip presets — none default (no "custom"; per the spec keep none·15·18·20).
  var TIPS = [
    { key: "none", label: "none", pct: 0 },
    { key: "15", label: "15%", pct: 15 },
    { key: "18", label: "18%", pct: 18 },
    { key: "20", label: "20%", pct: 20 },
  ];
  // split methods — evenly (equally) / by share (custom).
  var MODES = [
    { key: "equally", label: "evenly" },
    { key: "custom", label: "by share" },
  ];

  // member avatar gradients lifted from the frame's MEMBERS palette
  var BGS = [
    "linear-gradient(150deg,#FFC65C,#FF6B5E)",
    "linear-gradient(150deg,#7fc0ff,#2775CA)",
    "linear-gradient(150deg,#3DE8C7,#2775CA)",
    "linear-gradient(150deg,#FFC65C,#FFB23E)",
    "linear-gradient(150deg,#FF8A7E,#FF6B5E)",
    "linear-gradient(150deg,#a78bfa,#8B5CF6)",
  ];
  var EMOJIS = ["🦊", "🐢", "🌸", "🦝", "🐙", "🦉", "🐸", "🐳", "🦄", "🐼", "🦜", "🐱"];

  // exact status bar + top bar (back chevron) from the frame -------------
  function shell(inner) {
    return '' +
    '<div style="position:relative; width:100%; min-height:100%; background:#0B1622; overflow:hidden; ' +
      'font-family:' + F_SANS + '; color:#F4F7FA; -webkit-font-smoothing:antialiased; display:flex; flex-direction:column;">' +
      '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 50% 18%, rgba(244,247,250,0.024) 0 1px, transparent 1px 8px); opacity:.6; pointer-events:none;"></div>' +
      '<div style="position:absolute; left:50%; top:-40px; width:380px; height:300px; transform:translateX(-50%); border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,0.18) 0%, rgba(39,117,202,0) 68%); pointer-events:none;"></div>' +
      inner +
    '</div>';
  }

  // top bar: back circle · centered mono eyebrow · spacer
  function topbar(eyebrow) {
    return '' +
    '<div style="position:relative; z-index:3; display:flex; align-items:center; justify-content:space-between; height:52px; padding:0 20px; flex:none;">' +
      '<div id="nBack" style="width:38px; height:38px; border-radius:50%; background:#13212E; border:1px solid rgba(244,247,250,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F4F7FA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
      '</div>' +
      '<span style="font-family:' + F_MONO + '; font-size:11px; letter-spacing:1.5px; color:rgba(244,247,250,0.5);">' + app.esc(eyebrow) + '</span>' +
      '<div style="width:38px;"></div>' +
    '</div>';
  }

  function signedOut(view) {
    view.innerHTML = shell(topbar("new tab") +
      '<div class="empty" style="padding-top:54px;">' +
        app.mascot({ size: 124, mood: "happy", glow: true }) +
        '<div class="title lower">connect a wallet to split</div>' +
        '<div class="hint">make a tab, snap a receipt, get paid back in dollars.</div>' +
        '<button class="btn" id="nConnect" style="max-width:280px;margin-top:10px;">create a wallet</button>' +
      '</div>');
    var b = document.getElementById("nConnect");
    if (b) b.onclick = function () {
      if (window.Auth) Auth.createWallet().catch(function (e) { app.toast(e.message); });
    };
  }

  // ---- the form --------------------------------------------------------
  function buildForm(view, params) {
    var groupId = params && params[0] ? String(params[0]) : null;

    // local state — integer cents everywhere for money.
    var st = {
      title: "",
      titleEmoji: "🍜",
      totalCents: 0,
      tipKey: "none",
      paidBy: null,
      mode: "equally",          // equally (evenly) | custom (by share)
      members: [],              // {id,name,emoji,bg,included,you}
      custom: {},               // id -> cents (only edited rows)
      scanning: false,
      editId: null,            // when set, we're editing an existing expense (PATCH)
      _groupName: null,
      _groupEmoji: "🗼",
    };

    // Edit intent handed over from the group tab sheet: pre-fill this expense.
    var editIntent = null;
    try {
      var raw = sessionStorage.getItem("divvy.editExpense");
      if (raw) { var ei = JSON.parse(raw); if (ei && groupId && ei.tripId === groupId) editIntent = ei; }
      sessionStorage.removeItem("divvy.editExpense");
    } catch (_) {}

    // Pre-fill the form from an existing expense (title, total, payer, who's in).
    function applyEdit(trip) {
      if (!editIntent || !trip || !trip.expenses) return;
      var ex = trip.expenses.filter(function (x) { return x.id === editIntent.id; })[0];
      if (!ex) return;
      st.editId = ex.id;
      st.title = ex.title || "";
      st.totalCents = ex.amountCents || 0;
      if (ex.title) st.titleEmoji = groupEmojiFromName(ex.title);
      var inSet = {}; (ex.participants || []).forEach(function (p) { inSet[p] = 1; });
      st.members.forEach(function (m) { m.included = !!inSet[m.id]; });
      if (ex.paidBy && memberById(ex.paidBy)) st.paidBy = ex.paidBy;
    }

    function tipPct() {
      var t = TIPS.filter(function (x) { return x.key === st.tipKey; })[0];
      return t ? t.pct : 0;
    }
    function grandCents() {
      return Math.round(st.totalCents * (1 + tipPct() / 100));
    }
    function included() { return st.members.filter(function (m) { return m.included; }); }
    // equal split with integer cents (remainder spread to the first few).
    function equalShares(total, n) {
      if (n <= 0) return [];
      var base = Math.floor(total / n), rem = total - base * n, out = [];
      for (var i = 0; i < n; i++) out.push(base + (i < rem ? 1 : 0));
      return out;
    }

    function seedMembers(groupMembers) {
      if (groupMembers && groupMembers.length) {
        st.members = groupMembers.map(function (m, i) {
          var isYou = m.claimed && window.Auth && window.Auth.user && m.userId === window.Auth.user.id;
          return { id: m.id, name: m.name || ("p" + (i + 1)), emoji: m.emoji || EMOJIS[i % EMOJIS.length],
            bg: BGS[i % BGS.length], included: true, you: isYou };
        });
      } else {
        st.members = [{ id: "you", name: "you", emoji: "🦊", bg: BGS[0], included: true, you: true }];
      }
      st.paidBy = (st.members.filter(function (m) { return m.you; })[0] || st.members[0]).id;
    }

    function memberById(id) {
      return st.members.filter(function (m) { return m.id === id; })[0] || st.members[0];
    }

    // ---- render ----
    function render() {
      var inGroup = !!groupId;
      var editing = !!st.editId;
      // The trip expenses endpoint only does even splits, so "by share" can't be
      // honored in-group — force evenly there rather than silently discarding it.
      if (inGroup && st.mode === "custom") st.mode = "equally";
      var n = included().length;
      var grand = grandCents();
      var shares = equalShares(grand, n);
      var eachCents = n > 0 ? shares[0] : 0; // top-of-list share (others within 1¢)
      var tipNote = tipPct() > 0 ? "incl. " + tipPct() + "% tip" : "no tip added";

      // headline
      var headline =
        '<h1 style="font-family:' + F_DISPLAY + '; font-weight:600; font-size:30px; letter-spacing:-0.6px; margin:4px 2px 0; color:#F4F7FA;">' +
          (editing ? "edit expense" : inGroup ? "add expense" : "new tab") + '</h1>';

      // adding-to-group pill (only when in a group)
      var grpPill = inGroup ?
        '<div style="display:inline-flex; align-items:center; gap:7px; background:rgba(39,117,202,0.14); border:1px solid rgba(39,117,202,0.35); border-radius:999px; padding:4px 11px 4px 8px; margin:11px 2px 0;">' +
          '<span style="font-size:14px;">' + app.esc(st._groupEmoji || "🧾") + '</span>' +
          '<span style="font-family:' + F_MONO + '; font-size:10px; letter-spacing:.5px; color:#9fccf5;">adding to ' + app.esc(st._groupName || "group") + '</span>' +
        '</div>' : '';

      // scan hero — exact frame markup; swap the icon/labels while scanning
      var heroIcon = st.scanning
        ? '<span style="font-size:24px;">⏳</span>'
        : '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3DE8C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M3 12h18"/></svg>';
      var hero =
        '<div id="nScan" style="position:relative; border-radius:22px; overflow:hidden; border:1.5px dashed rgba(39,117,202,0.5); background:linear-gradient(160deg, rgba(39,117,202,0.14), rgba(39,117,202,0.04)); padding:22px 20px; display:flex; align-items:center; gap:16px; cursor:pointer; margin-top:16px;">' +
          (st.scanning ? '' : '<div style="position:absolute; left:14px; right:14px; height:2px; background:linear-gradient(90deg, transparent, #3DE8C7, transparent); border-radius:2px; box-shadow:0 0 10px rgba(61,232,199,0.8); animation:nsScanLine 2.6s ease-in-out infinite alternate;"></div>') +
          '<div style="width:54px; height:54px; border-radius:15px; background:#13212E; border:1px solid rgba(244,247,250,0.12); display:flex; align-items:center; justify-content:center; flex:none;">' + heroIcon + '</div>' +
          '<div style="flex:1; min-width:0;">' +
            '<div style="font-family:' + F_DISPLAY + '; font-weight:600; font-size:18px; color:#F4F7FA;">' + (st.scanning ? "reading receipt…" : "scan receipt") + '</div>' +
            '<div style="font-family:' + F_SANS + '; font-size:13px; color:rgba(244,247,250,0.55); margin-top:2px;">snap it, we\'ll read the total</div>' +
          '</div>' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.4)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>' +
        '</div>' +
        '<input type="file" id="nFile" accept="image/*" style="display:none;">' +
        '<div style="text-align:center; margin-top:11px;">' +
          '<span id="nManual" style="font-family:' + F_SANS + '; font-size:13px; color:rgba(244,247,250,0.5); border-bottom:1px solid rgba(244,247,250,0.2); padding-bottom:1px; cursor:pointer;">enter manually</span>' +
        '</div>';

      // what's it for — exact frame card (emoji button + title input + mint caret)
      var whatFor =
        '<div style="margin-top:22px;">' +
          '<label style="font-family:' + F_MONO + '; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.5); display:block; margin:0;">WHAT\'S IT FOR?</label>' +
          '<div style="display:flex; align-items:center; gap:11px; background:#13212E; border:1px solid rgba(244,247,250,0.09); border-radius:15px; padding:14px 16px; margin-top:9px;">' +
            '<button id="nEmoji" style="appearance:none; border:none; background:transparent; font-size:22px; cursor:pointer; padding:0; line-height:1;">' + app.esc(st.titleEmoji) + '</button>' +
            '<input id="nTitle" enterkeyhint="next" value="' + app.esc(st.title) + '" placeholder="dinner" style="all:unset; flex:1; font-family:' + F_DISPLAY + '; font-weight:500; font-size:18px; color:#F4F7FA;">' +
            '<span style="width:1.5px; height:20px; background:#3DE8C7; margin-left:1px; border-radius:2px;"></span>' +
          '</div>' +
        '</div>';

      // total — exact frame card, big mono with smaller/lighter $ and decimals
      var tot = splitDollars(st.totalCents);
      var totalBlock =
        '<div style="margin-top:16px;">' +
          '<label style="font-family:' + F_MONO + '; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.5); display:block; margin:0;">TOTAL</label>' +
          '<div style="display:flex; align-items:center; background:#13212E; border:1px solid rgba(244,247,250,0.09); border-radius:15px; padding:13px 16px; margin-top:9px;">' +
            '<span style="font-family:' + F_MONO + '; font-weight:700; font-size:18px; opacity:.5;">$</span>' +
            '<input id="nTotal" inputmode="decimal" enterkeyhint="done" value="' + (st.totalCents ? dollars(st.totalCents) : '') + '" placeholder="0.00" ' +
              'style="all:unset; flex:1; font-family:' + F_MONO + '; font-weight:700; font-size:30px; letter-spacing:-1px; color:#F4F7FA;">' +
          '</div>' +
        '</div>';

      // tip — exact frame segmented control (none preselected)
      var tipSeg =
        '<div style="margin-top:16px;">' +
          '<div style="display:flex; align-items:center; justify-content:space-between;">' +
            '<label style="font-family:' + F_MONO + '; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.5); display:block; margin:0;">TIP</label>' +
            '<span style="font-family:' + F_MONO + '; font-size:9px; letter-spacing:.3px; color:rgba(244,247,250,0.38);">scanned totals often include it</span>' +
          '</div>' +
          '<div style="display:flex; background:#13212E; border:1px solid rgba(244,247,250,0.09); border-radius:13px; padding:4px; margin-top:9px; gap:3px;">' +
            TIPS.map(function (t) {
              var sel = st.tipKey === t.key;
              return '<button data-tip="' + t.key + '" style="appearance:none; border:none; cursor:pointer; flex:1; min-height:42px; border-radius:9px; ' +
                'background:' + (sel ? '#2775CA' : 'transparent') + '; font-family:' + F_MONO + '; font-weight:700; font-size:13px; ' +
                'color:' + (sel ? '#fff' : 'rgba(244,247,250,0.55)') + ';">' + t.label + '</button>';
            }).join("") +
          '</div>' +
        '</div>';

      // paid by — exact frame chip strip (selected ringed mint w/ glow)
      var paidByLabel = (memberById(st.paidBy).you ? "you" : memberById(st.paidBy).name) + " paid";
      var paidBy =
        '<div style="margin-top:20px;">' +
          '<div style="display:flex; align-items:center; justify-content:space-between;">' +
            '<label style="font-family:' + F_MONO + '; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.5); display:block; margin:0;">PAID BY</label>' +
            '<span style="font-family:' + F_MONO + '; font-size:10px; letter-spacing:.5px; color:#9fccf5;">' + app.esc(paidByLabel) + '</span>' +
          '</div>' +
          '<div class="ns-row" style="display:flex; gap:9px; overflow-x:auto; scrollbar-width:none; margin-top:9px; padding:2px;">' +
            st.members.map(function (m) {
              var sel = st.paidBy === m.id;
              return '<button data-paid="' + app.esc(m.id) + '" style="appearance:none; cursor:pointer; flex:none; display:flex; flex-direction:column; align-items:center; gap:5px; background:transparent; border:none; padding:2px; opacity:' + (sel ? '1' : '0.5') + ';">' +
                '<div style="width:46px; height:46px; border-radius:50%; background:' + m.bg + '; display:flex; align-items:center; justify-content:center; font-size:22px; border:2.5px solid ' + (sel ? '#3DE8C7' : 'transparent') + '; box-shadow:' + (sel ? '0 0 0 3px rgba(61,232,199,0.18)' : 'none') + ';">' + app.esc(m.emoji) + '</div>' +
                '<span style="font-family:' + F_MONO + '; font-size:9px; letter-spacing:.3px; color:' + (sel ? '#F4F7FA' : 'rgba(244,247,250,0.5)') + ';">' + app.esc(m.you ? "you" : m.name) + '</span>' +
              '</button>';
            }).join("") +
          '</div>' +
        '</div>';

      // ---- split between: header + stepper + mode toggle + member chips ----
      // The stepper only earns its space in "by share" mode. In the common
      // evenly path, adding people lives on the "+ add" chip and removing lives
      // in the edit sheet — so the −/+ box is redundant chrome on the hot path.
      var canStep = !inGroup && st.mode === "custom";
      var stepper = canStep ?
        '<div style="display:flex; align-items:center; gap:14px; background:#13212E; border:1px solid rgba(244,247,250,0.09); border-radius:13px; padding:8px 10px; margin-top:9px; width:fit-content;">' +
          '<button id="nMinus" style="appearance:none; border:none; cursor:pointer; width:34px; height:34px; border-radius:10px; background:#0e2734; color:#F4F7FA; font-size:20px; font-family:' + F_MONO + ';">−</button>' +
          '<span style="font-family:' + F_MONO + '; font-weight:700; font-size:18px; min-width:24px; text-align:center;">' + st.members.length + '</span>' +
          '<button id="nPlus" style="appearance:none; border:none; cursor:pointer; width:34px; height:34px; border-radius:10px; background:#0e2734; color:#F4F7FA; font-size:20px; font-family:' + F_MONO + ';">+</button>' +
        '</div>' : '';

      var modeToggle = inGroup ? '' :
        '<div style="display:flex; background:#0B1622; border:1px solid rgba(244,247,250,0.1); border-radius:13px; padding:4px; margin-top:13px; gap:3px;">' +
          MODES.map(function (o) {
            var sel = st.mode === o.key;
            return '<button data-mode="' + o.key + '" style="appearance:none; border:none; cursor:pointer; flex:1; min-height:38px; border-radius:9px; ' +
              'background:' + (sel ? '#2775CA' : 'transparent') + '; font-family:' + F_SANS + '; font-weight:500; font-size:13px; ' +
              'color:' + (sel ? '#fff' : 'rgba(244,247,250,0.55)') + ';">' + o.label + '</button>';
          }).join("") +
        '</div>';

      // tappable member avatars — exact frame markup (blue ring + check badge)
      var memberChips =
        '<div class="ns-row" style="display:flex; gap:8px; overflow-x:auto; scrollbar-width:none; margin-top:13px; padding:2px;">' +
          st.members.map(function (m) {
            var inc = m.included;
            var badge = inc ? '<span style="position:absolute; right:-3px; bottom:-3px; width:18px; height:18px; border-radius:50%; background:#2775CA; border:2px solid #0B1622; display:flex; align-items:center; justify-content:center;"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>' : '';
            return '<button data-edit="' + app.esc(m.id) + '" style="appearance:none; cursor:pointer; flex:none; position:relative; display:flex; flex-direction:column; align-items:center; gap:5px; background:transparent; border:none; padding:2px; opacity:' + (inc ? '1' : '0.42') + ';">' +
              '<div style="position:relative; width:46px; height:46px; border-radius:50%; background:' + m.bg + '; display:flex; align-items:center; justify-content:center; font-size:22px; border:2.5px solid ' + (inc ? '#2775CA' : 'rgba(244,247,250,0.12)') + '; filter:' + (inc ? 'none' : 'grayscale(0.4)') + ';">' + app.esc(m.emoji) + badge + '</div>' +
              '<span style="font-family:' + F_MONO + '; font-size:9px; letter-spacing:.3px; color:' + (inc ? '#F4F7FA' : 'rgba(244,247,250,0.45)') + ';">' + app.esc(m.you ? "you" : m.name) + '</span>' +
            '</button>';
          }).join("") +
          // add a friend / named person
          '<button id="nAddPerson" style="appearance:none; cursor:pointer; flex:none; display:flex; flex-direction:column; align-items:center; gap:5px; background:transparent; border:none; padding:2px;">' +
            '<div style="width:46px; height:46px; border-radius:50%; background:rgba(244,247,250,0.04); border:2px dashed rgba(244,247,250,0.22); display:flex; align-items:center; justify-content:center;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.55)" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></div>' +
            '<span style="font-family:' + F_MONO + '; font-size:9px; letter-spacing:.3px; color:rgba(244,247,250,0.5);">add</span>' +
          '</button>' +
        '</div>';

      // ---- body: EQUALLY (evenly) vs CUSTOM (by share) ----
      var body;
      if (st.mode === "custom") {
        var rowVal = function (id) {
          if (st.custom[id] !== undefined) return st.custom[id];
          var idx = included().map(function (x) { return x.id; }).indexOf(id);
          return idx >= 0 ? shares[idx] : 0;
        };
        var sum = included().reduce(function (a, m) { return a + rowVal(m.id); }, 0);
        var left = grand - sum;
        var leftEyebrow, leftLabel, leftColor, leftBg, leftBorder;
        if (left === 0) {
          leftEyebrow = "ALL SET"; leftLabel = "balanced ✨"; leftColor = "#3DE8C7";
          leftBg = "rgba(61,232,199,0.08)"; leftBorder = "rgba(61,232,199,0.3)";
        } else if (left > 0) {
          leftEyebrow = "LEFT TO ASSIGN"; leftLabel = "$" + dollars(left) + " left"; leftColor = "#FFC65C";
          leftBg = "rgba(255,198,92,0.07)"; leftBorder = "rgba(255,198,92,0.28)";
        } else {
          leftEyebrow = "OVER BY"; leftLabel = "$" + dollars(-left) + " over"; leftColor = "#FF6B5E";
          leftBg = "rgba(255,107,94,0.07)"; leftBorder = "rgba(255,107,94,0.3)";
        }
        body =
          '<div style="margin-top:16px; background:#13212E; border:1px solid rgba(244,247,250,0.09); border-radius:20px; padding:8px 8px;">' +
            included().map(function (m) {
              return '<div style="display:flex; align-items:center; gap:12px; padding:9px 10px;">' +
                '<div style="width:36px; height:36px; border-radius:50%; background:' + m.bg + '; display:flex; align-items:center; justify-content:center; font-size:18px; flex:none;">' + app.esc(m.emoji) + '</div>' +
                '<span style="flex:1; font-family:' + F_DISPLAY + '; font-weight:500; font-size:16px; color:#F4F7FA;">' + app.esc(m.you ? "you" : m.name) + '</span>' +
                '<div style="display:flex; align-items:center; gap:2px; background:#0B1622; border:1px solid rgba(244,247,250,0.12); border-radius:11px; padding:8px 12px; min-width:96px; justify-content:flex-end;">' +
                  '<span style="font-family:' + F_MONO + '; font-weight:700; font-size:16px; color:rgba(244,247,250,0.4);">$</span>' +
                  '<input data-custom="' + app.esc(m.id) + '" inputmode="decimal" enterkeyhint="done" value="' + dollars(rowVal(m.id)) + '" ' +
                    'style="all:unset; font-family:' + F_MONO + '; font-weight:700; font-size:16px; color:#F4F7FA; width:58px; text-align:right;">' +
                '</div>' +
              '</div>';
            }).join("") +
          '</div>' +
          '<div style="display:flex; align-items:center; justify-content:space-between; background:' + leftBg + '; border:1px solid ' + leftBorder + '; border-radius:14px; padding:13px 16px; margin-top:11px;">' +
            '<span style="font-family:' + F_MONO + '; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.55);">' + leftEyebrow + '</span>' +
            '<span style="font-family:' + F_MONO + '; font-weight:700; font-size:17px; color:' + leftColor + ';">' + leftLabel + '</span>' +
          '</div>';
      } else {
        // EQUALLY (evenly) — exact frame "EACH CHIPS IN" receipt block
        var sh = splitDollars(eachCents);
        var seg = '';
        for (var i = 0; i < n; i++) {
          seg += '<div style="flex:1; background:' + (i % 2 ? '#3DE8C7' : '#2775CA') + '; animation:nsSeg .3s ease;"></div>';
        }
        body =
          '<div style="position:relative; margin-top:16px; border-radius:20px; overflow:hidden; background:#13212E; border:1px solid rgba(244,247,250,0.09); padding:18px 18px 20px;">' +
            '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 88% 8%, rgba(255,255,255,0.04) 0 1px, transparent 1px 8px); opacity:.7; pointer-events:none;"></div>' +
            '<div style="position:relative;">' +
              '<div style="display:flex; align-items:baseline; justify-content:space-between;">' +
                '<span style="font-family:' + F_MONO + '; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.5);">EACH CHIPS IN</span>' +
                '<span style="font-family:' + F_MONO + '; font-size:10px; letter-spacing:.5px; color:rgba(244,247,250,0.42);">' + tipNote + '</span>' +
              '</div>' +
              '<div style="font-family:' + F_MONO + '; font-weight:700; font-size:42px; line-height:1; letter-spacing:-1.5px; color:#3DE8C7; margin-top:8px;"><span style="font-size:24px; opacity:.55;">$</span>' + sh.whole + '<span style="font-size:24px; opacity:.55;">' + sh.cents + '</span></div>' +
              '<div style="display:flex; gap:3px; height:14px; margin-top:16px; border-radius:8px; overflow:hidden;">' + seg + '</div>' +
              '<div style="display:flex; align-items:center; justify-content:space-between; margin-top:10px;">' +
                '<span style="font-family:' + F_MONO + '; font-size:10px; letter-spacing:.5px; color:rgba(244,247,250,0.5);">' + n + ' × $' + dollars(eachCents) + '</span>' +
                '<span style="font-family:' + F_MONO + '; font-size:10px; letter-spacing:.5px; color:rgba(244,247,250,0.5);">= $' + dollars(grand) + '</span>' +
              '</div>' +
            '</div>' +
          '</div>';
      }

      var splitBetween =
        '<div style="margin-top:22px;">' +
          '<div style="display:flex; align-items:center; justify-content:space-between;">' +
            '<label style="font-family:' + F_MONO + '; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.5); display:block; margin:0;">SPLIT BETWEEN</label>' +
            '<span style="font-family:' + F_MONO + '; font-size:10px; letter-spacing:.5px; color:rgba(244,247,250,0.4);">' + n + ' of ' + st.members.length + '</span>' +
          '</div>' +
          stepper + modeToggle + memberChips + body +
        '</div>';

      // scrollable content
      var scroll =
        '<div class="ns-scroll" style="position:relative; z-index:2; flex:1; overflow-y:auto; scrollbar-width:none; padding:6px 20px 150px;">' +
          headline + grpPill + hero + whatFor + totalBlock + tipSeg + paidBy + splitBetween +
        '</div>';

      // send footer — exact frame button + dry mono subline
      var footer =
        '<div style="position:fixed; left:0; right:0; bottom:0; z-index:55; padding:14px 20px calc(14px + env(safe-area-inset-bottom)); background:linear-gradient(180deg, rgba(11,22,34,0) 0%, #0B1622 24%);">' +
          '<button id="nSend" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:56px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:0 12px 30px rgba(39,117,202,0.45);">' +
            '<span style="font-family:' + F_DISPLAY + '; font-weight:600; font-size:17px; color:#fff;">' + (editing ? "save changes" : inGroup ? "add to tab" : "send the tab") + '</span>' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>' +
          '</button>' +
          '<div style="font-family:' + F_MONO + '; font-size:10px; letter-spacing:.3px; color:rgba(244,247,250,0.36); text-align:center; margin-top:10px;">no app needed to pay. dollars, just faster.</div>' +
        '</div>';

      view.innerHTML = shell(topbar(editing ? "edit expense" : inGroup ? "add expense" : "new tab") + scroll) + footer;
      wire();
    }

    // ---- event wiring (re-attached each render) ----
    function wire() {
      var back = document.getElementById("nBack");
      if (back) back.onclick = function () {
        if (groupId) location.hash = "#/group/" + encodeURIComponent(groupId);
        else app.go("home");
      };

      var scan = document.getElementById("nScan");
      var file = document.getElementById("nFile");
      var manual = document.getElementById("nManual");
      if (scan && file) scan.onclick = function () { file.click(); };
      if (manual) manual.onclick = function () {
        var t = document.getElementById("nTotal"); if (t) t.focus();
      };
      if (file) file.onchange = function () {
        var f = file.files && file.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () { doScan(reader.result); };
        reader.readAsDataURL(f);
      };

      var emoji = document.getElementById("nEmoji");
      if (emoji) emoji.onclick = function () { pickEmoji(); };

      var title = document.getElementById("nTitle");
      if (title) {
        title.oninput = function () { st.title = title.value; };
        // Enter on the title hops to the total field rather than reloading.
        title.onkeydown = function (ev) {
          if (ev.key === "Enter") {
            ev.preventDefault();
            var t = document.getElementById("nTotal"); if (t) t.focus();
          }
        };
      }

      var total = document.getElementById("nTotal");
      if (total) {
        total.oninput = function () { st.totalCents = toCents(total.value); };
        total.onblur = function () { st.totalCents = toCents(total.value); render(); };
        // Enter commits the amount and sends the tab (the common one-input flow).
        total.onkeydown = function (ev) {
          if (ev.key === "Enter") {
            ev.preventDefault();
            st.totalCents = toCents(total.value);
            total.blur();
            doSend();
          }
        };
      }

      [].forEach.call(document.querySelectorAll("[data-tip]"), function (b) {
        b.onclick = function () { st.tipKey = b.getAttribute("data-tip"); render(); };
      });
      [].forEach.call(document.querySelectorAll("[data-paid]"), function (b) {
        b.onclick = function () { st.paidBy = b.getAttribute("data-paid"); render(); };
      });
      [].forEach.call(document.querySelectorAll("[data-mode]"), function (b) {
        b.onclick = function () { st.mode = b.getAttribute("data-mode"); render(); };
      });
      // tap a member to rename / pick a friend / remove them
      [].forEach.call(document.querySelectorAll("[data-edit]"), function (b) {
        b.onclick = function () { personSheet(memberById(b.getAttribute("data-edit"))); };
      });
      var addPerson = document.getElementById("nAddPerson");
      if (addPerson) addPerson.onclick = function () { personSheet(null); };
      [].forEach.call(document.querySelectorAll("[data-custom]"), function (inp) {
        inp.oninput = function () { st.custom[inp.getAttribute("data-custom")] = toCents(inp.value); };
        inp.onblur = function () { render(); };
        // Enter commits the share and re-balances the receipt (same as blur).
        inp.onkeydown = function (ev) {
          if (ev.key === "Enter") {
            ev.preventDefault();
            st.custom[inp.getAttribute("data-custom")] = toCents(inp.value);
            inp.blur();
          }
        };
      });

      var minus = document.getElementById("nMinus");
      var plus = document.getElementById("nPlus");
      if (minus) minus.onclick = function () {
        if (st.members.length <= 1) return;
        var removed = st.members.pop();
        if (st.paidBy === removed.id) st.paidBy = st.members[0].id;
        delete st.custom[removed.id];
        render();
      };
      if (plus) plus.onclick = function () {
        if (st.members.length >= 12) return;
        personSheet(null); // pick a friend or name them, instead of a generic "person N"
      };

      var send = document.getElementById("nSend");
      if (send) send.onclick = doSend;
    }

    // Add or edit a person on the split: type a name OR pick one of your
    // friends. (A standalone tab is a share-link bill, so the name is what the
    // other person sees on their pay link; picking a friend also links them.)
    function ensureSwKeyframes() {
      if (document.getElementById("sw-keyframes")) return;
      var s = document.createElement("style"); s.id = "sw-keyframes";
      s.textContent =
        "@keyframes swSquish{0%,100%{border-radius:48% 52% 51% 49%/53% 49% 51% 47%}50%{border-radius:52% 48% 49% 51%/47% 51% 49% 53%}}" +
        "@keyframes swBlink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.14)}}" +
        "@keyframes swFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}";
      document.head.appendChild(s);
    }
    function swMascot() {
      return '<div style="position:relative; width:96px; height:96px; margin:0 auto; animation:swFloat 4.6s ease-in-out infinite;">' +
        '<div style="position:absolute; left:50%; top:50%; width:120px; height:120px; transform:translate(-50%,-50%); border-radius:50%; background:radial-gradient(circle, rgba(39,117,202,0.3) 0%, rgba(39,117,202,0) 68%);"></div>' +
        '<div style="position:absolute; left:8px; top:38px; width:17px; height:33px; border-radius:999px; background:linear-gradient(165deg,#3a90e2,#16487f); transform:rotate(15deg);"></div>' +
        '<div style="position:absolute; right:8px; top:38px; width:17px; height:33px; border-radius:999px; background:linear-gradient(165deg,#3a90e2,#16487f); transform:rotate(-15deg);"></div>' +
        '<div style="position:absolute; left:32px; bottom:2px; width:16px; height:25px; border-radius:999px; background:linear-gradient(165deg,#3a90e2,#16487f);"></div>' +
        '<div style="position:absolute; right:32px; bottom:2px; width:16px; height:25px; border-radius:999px; background:linear-gradient(165deg,#3a90e2,#16487f);"></div>' +
        '<div style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:84px; height:84px; background:linear-gradient(155deg,#4aa0f0,#2775CA 60%,#1c5697); animation:swSquish 5s ease-in-out infinite; box-shadow:0 12px 24px rgba(6,14,24,0.5), inset 0 4px 9px rgba(255,255,255,0.32), inset 0 -6px 12px rgba(13,40,72,0.5); display:flex; align-items:center; justify-content:center;">' +
          '<div style="position:absolute; top:12px; left:18px; width:34px; height:22px; border-radius:50%; background:radial-gradient(closest-side, rgba(255,255,255,0.4), rgba(255,255,255,0));"></div>' +
          '<div style="display:flex; gap:13px; margin-top:-4px;"><div style="width:9px; height:12px; border-radius:50%; background:#0B1622; animation:swBlink 5s infinite;"></div><div style="width:9px; height:12px; border-radius:50%; background:#0B1622; animation:swBlink 5s infinite;"></div></div>' +
          '<div style="position:absolute; bottom:24px; width:20px; height:10px; border:4px solid #0B1622; border-top:none; border-radius:0 0 13px 13px;"></div>' +
        '</div>' +
      '</div>';
    }

    // The "split with" sheet (v7 frame): search + tappable friend list + guest row.
    function personSheet(member) {
      ensureSwKeyframes();
      var editing = !!member;
      var html =
        '<div style="display:flex; flex-direction:column; max-height:74vh;">' +
          '<div style="flex:none;">' +
            '<h2 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:24px; letter-spacing:-0.6px; margin:0;">' + (editing ? "edit person" : "split with") + '</h2>' +
            '<div style="font-family:' + F_MONO + '; font-size:11px; color:rgba(244,247,250,0.45); margin-top:5px;">' + (editing ? "rename, pick a friend, or remove" : "tap a friend, or add a guest") + '</div>' +
          '</div>' +
          '<div style="flex:none; margin:14px 0 6px;"><div style="display:flex; align-items:center; gap:10px; background:#0e1a24; border:1px solid rgba(244,247,250,0.08); border-radius:14px; padding:11px 14px;">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.4)" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>' +
            '<input id="psSearch" type="text" placeholder="find a friend…" autocomplete="off" style="flex:1; background:transparent; border:none; outline:none; color:#F4F7FA; font-family:\'Space Mono\',monospace; font-size:12.5px;" /></div></div>' +
          '<div id="psList" class="appscroll" style="flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; min-height:64px; padding-top:6px;"><div style="font-family:' + F_MONO + '; font-size:11px; color:rgba(244,247,250,0.4); padding:8px 2px;">loading…</div></div>' +
          '<div style="flex:none;">' +
            '<div style="display:flex; align-items:center; gap:12px; margin:16px 2px 12px;"><div style="flex:1; height:1px; background:rgba(244,247,250,0.08);"></div><span style="font-family:' + F_MONO + '; font-size:10px; letter-spacing:1px; color:rgba(244,247,250,0.4);">' + (editing ? "or rename" : "or add a guest") + '</span><div style="flex:1; height:1px; background:rgba(244,247,250,0.08);"></div></div>' +
            '<div style="display:flex; gap:10px;">' +
              '<div style="flex:1; display:flex; align-items:center; gap:9px; background:#0e1a24; border:1px solid rgba(244,247,250,0.1); border-radius:14px; padding:12px 14px;"><span style="font-size:15px;">🙂</span><input id="psName" type="text" placeholder="guest name" value="' + (editing && !member.you ? app.esc(member.name) : "") + '" autocomplete="off" style="flex:1; background:transparent; border:none; outline:none; color:#F4F7FA; font-family:\'General Sans\',sans-serif; font-size:15px;" /></div>' +
              '<button id="psSave" style="appearance:none; border:none; cursor:pointer; padding:0 22px; border-radius:14px; background:linear-gradient(120deg,#3286db,#2775CA); font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:15px; color:#fff; box-shadow:0 8px 22px rgba(39,117,202,0.4);">' + (editing ? "save" : "add") + '</button>' +
            '</div>' +
            (editing && !member.you ? '<button id="psRemove" style="width:100%; margin-top:12px; appearance:none; cursor:pointer; min-height:46px; border-radius:999px; background:transparent; border:1px solid rgba(255,107,94,0.4); color:#FF6B5E; font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px;">remove from split</button>' : '') +
          '</div>' +
        '</div>';
      var el = app.sheet(html);

      function commit(name, uid, wallet, emoji) {
        name = (name || "").trim();
        if (!name) { app.toast("enter a name"); return; }
        if (editing) {
          member.name = name;
          if (uid) member.userId = uid;
          if (wallet) member.wallet = wallet;
          if (emoji) member.emoji = emoji;
        } else {
          if (st.members.length >= 12) { app.closeSheet(); return; }
          var i = st.members.length;
          st.members.push({ id: (uid ? "u_" + uid : "p" + (i + 1) + "_" + Date.now()), name: name,
            userId: uid || undefined, wallet: wallet || undefined,
            emoji: emoji || EMOJIS[i % EMOJIS.length], bg: BGS[i % BGS.length], included: true });
        }
        app.closeSheet(); render();
      }

      el.querySelector("#psSave").onclick = function () { commit(el.querySelector("#psName").value, null, null, null); };
      var rm = el.querySelector("#psRemove");
      if (rm) rm.onclick = function () {
        st.members = st.members.filter(function (x) { return x.id !== member.id; });
        if (st.paidBy === member.id && st.members[0]) st.paidBy = st.members[0].id;
        delete st.custom[member.id];
        app.closeSheet(); render();
      };

      function rowHtml(f) {
        var nm = f.displayName || f.handle || "friend"; var em = f.emoji || "🙂";
        var color = f.color || "linear-gradient(150deg,#2775CA,#3DE8C7)";
        var sub = f.handle ? ("@" + f.handle) : (f.primaryWallet ? (f.primaryWallet.slice(0, 4) + "…" + f.primaryWallet.slice(-4)) : "");
        return '<div class="psFriend" data-name="' + app.esc(nm) + '" data-uid="' + app.esc(f.id) + '" data-wallet="' + app.esc(f.primaryWallet || "") + '" data-emoji="' + app.esc(em) + '" ' +
          'style="display:flex; align-items:center; gap:13px; background:#0e1a24; border:1px solid rgba(244,247,250,0.05); border-radius:14px; padding:11px 12px; cursor:pointer; margin-bottom:8px;">' +
          '<div style="width:44px; height:44px; border-radius:14px; background:' + color + '; display:flex; align-items:center; justify-content:center; font-size:22px; flex:none; box-shadow:0 5px 14px rgba(0,0,0,0.25);">' + app.esc(em) + '</div>' +
          '<div style="flex:1; min-width:0;"><div style="font-family:\'General Sans\',sans-serif; font-weight:600; font-size:16px; color:#F4F7FA; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + app.esc(nm) + '</div>' + (sub ? '<div style="font-family:' + F_MONO + '; font-size:10.5px; color:rgba(244,247,250,0.4); margin-top:2px;">' + app.esc(sub) + '</div>' : '') + '</div>' +
          '<div style="display:inline-flex; align-items:center; gap:5px; background:rgba(39,117,202,0.14); border:1px solid rgba(39,117,202,0.45); border-radius:999px; padding:6px 13px 6px 10px; flex:none;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5BA6F0" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span style="font-family:\'General Sans\',sans-serif; font-weight:600; font-size:13px; color:#5BA6F0;">add</span></div>' +
        '</div>';
      }
      var allFriends = [];
      function paintList(query) {
        var box = el.querySelector("#psList"); if (!box) return;
        var q = (query || "").trim().toLowerCase();
        var fs = allFriends.filter(function (f) {
          if (!q) return true;
          return ((f.displayName || "") + " " + (f.handle || "")).toLowerCase().indexOf(q) >= 0;
        });
        if (!allFriends.length) {
          box.innerHTML = '<div style="display:flex; flex-direction:column; align-items:center; text-align:center; padding:18px 18px 6px;">' + swMascot() +
            '<div style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:15px; line-height:1.5; color:rgba(244,247,250,0.55); max-width:280px; margin-top:18px;">no friends here yet — add people on the <span style="color:#7fc0ff;">people</span> tab, then they\'ll show up here.</div></div>';
          return;
        }
        box.innerHTML = fs.length ? fs.map(rowHtml).join("")
          : '<div style="font-family:' + F_MONO + '; font-size:11px; color:rgba(244,247,250,0.4); padding:10px 2px;">no match — add them as a guest below</div>';
        [].forEach.call(box.querySelectorAll(".psFriend"), function (b) {
          b.onclick = function () { commit(b.getAttribute("data-name"), b.getAttribute("data-uid"), b.getAttribute("data-wallet"), b.getAttribute("data-emoji")); };
        });
      }
      var search = el.querySelector("#psSearch");
      if (search) search.oninput = function () { paintList(search.value); };

      app.api.get("/api/friends").then(function (r) {
        var have = {}; st.members.forEach(function (m) { if (m.userId) have[m.userId] = 1; });
        allFriends = ((r && r.friends) || []).filter(function (f) { return !have[f.id]; });
        paintList("");
      }).catch(function () { allFriends = []; paintList(""); });
    }

    function pickEmoji() {
      var opts = ["🍜", "🍕", "🍻", "🛒", "🏠", "🚕", "🎟️", "☕️", "🍣", "🧾", "🎁", "⛽️"];
      var html = '<h3 class="lower" style="font-size:18px;margin-bottom:14px;">what\'s it for?</h3>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;">' +
        opts.map(function (e) {
          return '<button data-e="' + e + '" style="appearance:none;border:1px solid var(--line);background:var(--card-2);' +
            'border-radius:14px;width:52px;height:52px;font-size:24px;cursor:pointer;">' + e + '</button>';
        }).join("") + '</div>';
      var el = app.sheet(html);
      [].forEach.call(el.querySelectorAll("[data-e]"), function (b) {
        b.onclick = function () { st.titleEmoji = b.getAttribute("data-e"); app.closeSheet(); render(); };
      });
    }

    async function doScan(dataUrl) {
      st.scanning = true; render();
      try {
        var r = await app.api.post("/api/scan", { image: dataUrl });
        if (r && r.total != null) {
          st.totalCents = toCents(r.total);
          st.tipKey = "none"; // after a scan keep tip none
          if (r.merchant && !st.title) st.title = String(r.merchant).toLowerCase();
          app.toast("read " + (r.totalFmt || ("$" + dollars(st.totalCents))) + " ✨");
        } else if (r && r.needsManualEntry) {
          app.toast("couldn't read it — enter manually");
        }
      } catch (e) {
        app.toast(e && e.message ? e.message : "scan failed — enter manually");
      }
      st.scanning = false; render();
    }

    async function doSend() {
      if (st.totalCents <= 0) { app.toast("add a total first"); return; }
      var inc = included();
      if (!inc.length) { app.toast("pick at least one person"); return; }
      var grand = grandCents();
      var title = st.title.trim() || "tab";
      var send = document.getElementById("nSend");

      // Standalone "by share": send the per-person amounts (the /api/bills path
      // honors customCents) and require they balance to the total first.
      var customCents = null;
      if (!groupId && st.mode === "custom") {
        var evenly = equalShares(grand, inc.length);
        customCents = inc.map(function (m, i) {
          return st.custom[m.id] !== undefined ? st.custom[m.id] : evenly[i];
        });
        var csum = customCents.reduce(function (a, b) { return a + b; }, 0);
        if (csum !== grand) {
          app.toast(csum < grand ? "assign the rest before sending" : "those shares go over the total");
          return;
        }
      }

      if (send) { send.disabled = true; send.style.opacity = ".6"; }

      try {
        if (groupId) {
          var payload = {
            title: title,
            amountCents: grand,
            paidBy: st.paidBy,
            participants: inc.map(function (m) { return m.id; }),
          };
          if (st.editId) {
            await app.api.patch("/api/trips/" + encodeURIComponent(groupId) + "/expenses/" + encodeURIComponent(st.editId), payload);
            app.toast("saved ✨");
          } else {
            await app.api.post("/api/trips/" + encodeURIComponent(groupId) + "/expenses", payload);
            app.toast("added to the tab ✨");
          }
          location.hash = "#/group/" + encodeURIComponent(groupId);
        } else {
          var bill = await app.api.post("/api/bills", {
            title: title,
            total: dollars(grand),     // dollars; server re-derives cents
            tipPercent: 0,             // tip already baked into total
            names: inc.map(function (m) { return m.you ? "you" : m.name; }),
            mode: customCents ? "custom" : "equal",
            customCents: customCents || undefined,
          });
          var id = bill && (bill.id || bill.billId);
          if (!id) throw new Error("no bill id");
          location.hash = "#/collect/" + encodeURIComponent(id);
        }
      } catch (e) {
        if (send) { send.disabled = false; send.style.opacity = "1"; }
        app.toast(e && e.message ? e.message : "couldn't send the tab");
      }
    }

    // ---- boot the form: load group members if a group id was passed ----
    if (groupId) {
      view.innerHTML = shell(topbar("add expense") +
        '<div style="padding:6px 20px;"><div class="skeleton" style="height:120px;margin:10px 0;"></div>' +
        '<div class="skeleton" style="height:60px;margin:10px 0;"></div>' +
        '<div class="skeleton" style="height:60px;margin:10px 0;"></div></div>');
      app.api.get("/api/trips/" + encodeURIComponent(groupId)).then(function (trip) {
        st._groupName = trip && trip.name;
        // The API doesn't return a top-level trip emoji, so derive one from the
        // name (mirrors home.js groupEmoji) rather than silently keeping the
        // default. Honor an explicit trip.emoji if the API ever adds one.
        if (trip && trip.emoji) st._groupEmoji = trip.emoji;
        else if (trip && trip.name) st._groupEmoji = groupEmojiFromName(trip.name);
        seedMembers(trip && trip.members);
        applyEdit(trip);
        render();
      }).catch(function () {
        // group didn't load — fall back to a standalone tab so we never crash.
        groupId = null;
        seedMembers(null);
        render();
      });
    } else {
      seedMembers(null);
      render();
    }
  }

  // inject the scan-line + segment keyframes once (lifted from the frame).
  function ensureKeyframes() {
    if (document.getElementById("ns-kf")) return;
    var s = document.createElement("style");
    s.id = "ns-kf";
    s.textContent =
      "@keyframes nsScanLine{0%{top:8%}100%{top:88%}}" +
      "@keyframes nsSeg{from{opacity:.4}to{opacity:1}}" +
      ".ns-scroll::-webkit-scrollbar{width:0;height:0}" +
      ".ns-row::-webkit-scrollbar{width:0;height:0}";
    document.head.appendChild(s);
  }

  window.Screens = window.Screens || {};
  window.Screens.new = {
    title: "new tab",
    render: function (view, params) {
      ensureKeyframes();
      var user = window.Auth && window.Auth.user;
      if (user) return buildForm(view, params);
      signedOut(view);
      if (window.Auth && window.Auth.onChange) window.Auth.onChange(function (u) {
        if ((location.hash || "").indexOf("new") >= 0) {
          if (u) buildForm(view, params); else signedOut(view);
        }
      });
    },
  };
})();
