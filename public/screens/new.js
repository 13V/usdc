/* screens/new.js — New tab / add expense. Matches design/frames/New Split Playful.dc.html.
   Route #/new; optional params[0] = a group (trip) id to add the tab to.
   Integer cents only; lowercase dry voice; money via app.money(); never crash. */
(function () {
  "use strict";
  var app = window.app;

  // ---- helpers ---------------------------------------------------------
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
  var TIPS = [
    { key: "none", label: "none", pct: 0 },
    { key: "15", label: "15%", pct: 15 },
    { key: "18", label: "18%", pct: 18 },
    { key: "20", label: "20%", pct: 20 },
  ];
  var EMOJIS = ["🦊", "🐢", "🌸", "🦝", "🐙", "🐳", "🦉", "🐸", "🦄", "🐼"];

  function topbar(eyebrow) {
    return '<div class="topbar">' +
      '<div class="brand"><span class="mark"><span>/</span></span><span class="word">divvy</span></div>' +
      '<span class="eyebrow" style="letter-spacing:1.5px;">' + app.esc(eyebrow || "new tab") + '</span>' +
      '</div>';
  }

  function signedOut(view) {
    view.innerHTML = topbar("new tab") +
      '<div class="empty" style="padding-top:54px;">' +
        app.mascot({ size: 124, mood: "happy", glow: true }) +
        '<div class="title lower">connect a wallet to split</div>' +
        '<div class="hint">make a tab, snap a receipt, get paid back in usdc.</div>' +
        '<button class="btn" id="nConnect" style="max-width:280px;margin-top:10px;">create a wallet</button>' +
      '</div>';
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
      mode: "equally",          // equally | custom
      members: [],              // {id,name,emoji,included}
      custom: {},               // id -> cents (only edited rows)
      scanning: false,
    };

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
          return { id: m.id, name: m.name || ("p" + (i + 1)), emoji: EMOJIS[i % EMOJIS.length], included: true, you: isYou };
        });
      } else {
        st.members = [{ id: "you", name: "you", emoji: "🦊", included: true, you: true }];
      }
      st.paidBy = (st.members.filter(function (m) { return m.you; })[0] || st.members[0]).id;
    }

    function memberById(id) {
      return st.members.filter(function (m) { return m.id === id; })[0] || st.members[0];
    }

    // ---- render ----
    function render() {
      var inGroup = !!groupId;
      var n = included().length;
      var grand = grandCents();
      var shares = equalShares(grand, n);
      var eachCents = n > 0 ? shares[0] : 0; // top-of-list share (others within 1¢)

      var tipNote = tipPct() > 0 ? "incl. " + tipPct() + "% tip" : "no tip added";

      // scan hero
      var hero =
        '<div id="nScan" style="position:relative;border-radius:22px;overflow:hidden;cursor:pointer;margin-top:6px;' +
          'border:1.5px dashed rgba(39,117,202,0.5);background:linear-gradient(160deg,rgba(39,117,202,0.14),rgba(39,117,202,0.04));' +
          'padding:22px 20px;display:flex;align-items:center;gap:16px;">' +
          (st.scanning ? '' :
            '<div style="position:absolute;left:14px;right:14px;height:2px;background:linear-gradient(90deg,transparent,var(--mint),transparent);' +
              'border-radius:2px;box-shadow:0 0 10px rgba(61,232,199,0.8);animation:nsScan 2.6s ease-in-out infinite alternate;"></div>') +
          '<div style="width:54px;height:54px;border-radius:15px;background:var(--card);border:1px solid var(--line);' +
            'display:flex;align-items:center;justify-content:center;flex:none;font-size:24px;">' +
            (st.scanning ? '⏳' : '🧾') + '</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div class="display" style="font-size:18px;">' + (st.scanning ? 'reading receipt…' : 'scan receipt') + '</div>' +
            '<div style="font-size:13px;color:var(--muted);margin-top:2px;">snap it, we\'ll read the total</div>' +
          '</div>' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>' +
        '</div>' +
        '<input type="file" id="nFile" accept="image/*" style="display:none;">' +
        '<div style="text-align:center;margin-top:11px;">' +
          '<span id="nManual" style="font-size:13px;color:var(--faint);border-bottom:1px solid var(--line-2);padding-bottom:1px;cursor:pointer;">enter manually</span>' +
        '</div>';

      // adding-to-group pill
      var grpPill = inGroup ?
        '<div style="display:inline-flex;align-items:center;gap:7px;background:rgba(39,117,202,0.14);border:1px solid rgba(39,117,202,0.35);' +
          'border-radius:999px;padding:4px 12px;margin-top:12px;">' +
          '<span style="font-size:14px;">🧾</span>' +
          '<span class="mono" style="font-size:10px;letter-spacing:.5px;color:var(--blue-bright);">adding to ' + app.esc(st._groupName || "group") + '</span>' +
        '</div>' : '';

      // what's it for
      var whatFor =
        '<div style="margin-top:22px;">' +
          '<label>what\'s it for?</label>' +
          '<div style="display:flex;align-items:center;gap:11px;" class="input">' +
            '<button id="nEmoji" style="appearance:none;border:none;background:transparent;font-size:22px;cursor:pointer;padding:0;line-height:1;">' + app.esc(st.titleEmoji) + '</button>' +
            '<input id="nTitle" class="lower" value="' + app.esc(st.title) + '" placeholder="dinner" ' +
              'style="all:unset;flex:1;font-family:var(--display);font-weight:500;font-size:18px;color:var(--text);">' +
          '</div>' +
        '</div>';

      // total (big mono)
      var totalBlock =
        '<div style="margin-top:16px;">' +
          '<label>total</label>' +
          '<div class="input mono" style="display:flex;align-items:center;padding-top:10px;padding-bottom:10px;">' +
            '<span style="font-size:18px;opacity:.5;font-weight:700;">$</span>' +
            '<input id="nTotal" inputmode="decimal" value="' + (st.totalCents ? dollars(st.totalCents) : '') + '" placeholder="0.00" ' +
              'style="all:unset;flex:1;font-family:var(--mono);font-weight:700;font-size:30px;letter-spacing:-1px;color:var(--text);">' +
          '</div>' +
        '</div>';

      // tip segmented (none preselected)
      var tipSeg =
        '<div style="margin-top:16px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;">' +
            '<label style="margin:0;">tip</label>' +
            '<span class="mono" style="font-size:9px;color:var(--faint);">scanned totals often include it</span>' +
          '</div>' +
          '<div style="display:flex;background:var(--card);border:1px solid var(--line);border-radius:13px;padding:4px;margin-top:9px;gap:3px;">' +
            TIPS.map(function (t) {
              var sel = st.tipKey === t.key;
              return '<button data-tip="' + t.key + '" style="appearance:none;border:none;cursor:pointer;flex:1;min-height:42px;border-radius:9px;' +
                'background:' + (sel ? 'var(--blue)' : 'transparent') + ';font-family:var(--mono);font-weight:700;font-size:13px;' +
                'color:' + (sel ? '#fff' : 'var(--muted)') + ';">' + t.label + '</button>';
            }).join("") +
          '</div>' +
        '</div>';

      // paid by
      var paidByLabel = (memberById(st.paidBy).you ? "you" : memberById(st.paidBy).name) + " paid";
      var paidBy =
        '<div style="margin-top:20px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;">' +
            '<label style="margin:0;">paid by</label>' +
            '<span class="mono" style="font-size:10px;color:var(--blue-bright);">' + app.esc(paidByLabel) + '</span>' +
          '</div>' +
          '<div class="nsrow" style="display:flex;gap:9px;overflow-x:auto;margin-top:9px;padding:2px;">' +
            st.members.map(function (m) {
              var sel = st.paidBy === m.id;
              return '<button data-paid="' + app.esc(m.id) + '" style="appearance:none;cursor:pointer;flex:none;display:flex;flex-direction:column;' +
                'align-items:center;gap:5px;background:transparent;border:none;padding:2px;opacity:' + (sel ? '1' : '0.5') + ';">' +
                '<span class="avatar round" style="border:2.5px solid ' + (sel ? 'var(--mint)' : 'transparent') + ';' +
                  (sel ? 'box-shadow:0 0 0 3px rgba(61,232,199,0.18);' : '') + '">' + app.esc(m.emoji) + '</span>' +
                '<span class="mono" style="font-size:9px;color:' + (sel ? 'var(--text)' : 'var(--faint)') + ';">' + app.esc(m.you ? "you" : m.name) + '</span>' +
              '</button>';
            }).join("") +
          '</div>' +
        '</div>';

      // split between — stepper + members + mode toggle
      var canStep = !inGroup;
      var stepper = canStep ?
        '<div style="display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:13px;padding:8px 10px;margin-top:9px;width:fit-content;">' +
          '<button id="nMinus" style="appearance:none;border:none;cursor:pointer;width:34px;height:34px;border-radius:10px;background:var(--card-2);color:var(--text);font-size:20px;font-family:var(--mono);">−</button>' +
          '<span class="mono" style="font-weight:700;font-size:18px;min-width:24px;text-align:center;">' + st.members.length + '</span>' +
          '<button id="nPlus" style="appearance:none;border:none;cursor:pointer;width:34px;height:34px;border-radius:10px;background:var(--card-2);color:var(--text);font-size:20px;font-family:var(--mono);">+</button>' +
        '</div>' : '';

      var modeToggle =
        '<div style="display:flex;background:var(--ink);border:1px solid var(--line);border-radius:13px;padding:4px;margin-top:13px;gap:3px;">' +
          [["equally", "equally"], ["custom", "custom"]].map(function (o) {
            var sel = st.mode === o[0];
            return '<button data-mode="' + o[0] + '" style="appearance:none;border:none;cursor:pointer;flex:1;min-height:38px;border-radius:9px;' +
              'background:' + (sel ? 'var(--blue)' : 'transparent') + ';font-family:var(--sans);font-weight:500;font-size:13px;' +
              'color:' + (sel ? '#fff' : 'var(--muted)') + ';">' + o[1] + '</button>';
          }).join("") +
        '</div>';

      var memberChips =
        '<div class="nsrow" style="display:flex;gap:8px;overflow-x:auto;margin-top:13px;padding:2px;">' +
          st.members.map(function (m) {
            var inc = m.included;
            return '<button data-toggle="' + app.esc(m.id) + '" style="appearance:none;cursor:pointer;flex:none;position:relative;display:flex;' +
              'flex-direction:column;align-items:center;gap:5px;background:transparent;border:none;padding:2px;opacity:' + (inc ? '1' : '0.42') + ';">' +
              '<span class="avatar round" style="position:relative;border:2.5px solid ' + (inc ? 'var(--blue)' : 'var(--line)') + ';' +
                (inc ? '' : 'filter:grayscale(.4);') + '">' + app.esc(m.emoji) +
                (inc ? '<span style="position:absolute;right:-3px;bottom:-3px;width:18px;height:18px;border-radius:50%;background:var(--blue);' +
                  'border:2px solid var(--ink);display:flex;align-items:center;justify-content:center;">' +
                  '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>' : '') +
              '</span>' +
              '<span class="mono" style="font-size:9px;color:' + (inc ? 'var(--text)' : 'var(--faint)') + ';">' + app.esc(m.you ? "you" : m.name) + '</span>' +
            '</button>';
          }).join("") +
        '</div>';

      // body: equally vs custom
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
        if (Math.abs(left) === 0) {
          leftEyebrow = "all set"; leftLabel = "balanced ✨"; leftColor = "var(--mint)";
          leftBg = "rgba(61,232,199,0.08)"; leftBorder = "rgba(61,232,199,0.3)";
        } else if (left > 0) {
          leftEyebrow = "left to assign"; leftLabel = "$" + dollars(left) + " left"; leftColor = "var(--sunshine)";
          leftBg = "rgba(255,198,92,0.07)"; leftBorder = "rgba(255,198,92,0.28)";
        } else {
          leftEyebrow = "over by"; leftLabel = "$" + dollars(-left) + " over"; leftColor = "var(--coral)";
          leftBg = "rgba(255,107,94,0.07)"; leftBorder = "rgba(255,107,94,0.3)";
        }
        body =
          '<div style="margin-top:16px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:8px;">' +
            included().map(function (m) {
              return '<div style="display:flex;align-items:center;gap:12px;padding:9px 10px;">' +
                '<span class="avatar sm round">' + app.esc(m.emoji) + '</span>' +
                '<span class="lower" style="flex:1;font-family:var(--display);font-weight:500;font-size:16px;">' + app.esc(m.you ? "you" : m.name) + '</span>' +
                '<div style="display:flex;align-items:center;gap:2px;background:var(--ink);border:1px solid var(--line-2);border-radius:11px;padding:8px 12px;min-width:96px;justify-content:flex-end;">' +
                  '<span style="font-family:var(--mono);font-weight:700;font-size:16px;color:var(--faint);">$</span>' +
                  '<input data-custom="' + app.esc(m.id) + '" inputmode="decimal" value="' + dollars(rowVal(m.id)) + '" ' +
                    'style="all:unset;font-family:var(--mono);font-weight:700;font-size:16px;color:var(--text);width:58px;text-align:right;">' +
                '</div>' +
              '</div>';
            }).join("") +
          '</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;background:' + leftBg + ';border:1px solid ' + leftBorder + ';' +
            'border-radius:14px;padding:13px 16px;margin-top:11px;">' +
            '<span class="mono" style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);">' + leftEyebrow + '</span>' +
            '<span class="mono" style="font-weight:700;font-size:17px;color:' + leftColor + ';">' + leftLabel + '</span>' +
          '</div>';
      } else {
        body =
          '<div class="receipt paper" style="margin-top:16px;">' +
            '<div style="display:flex;align-items:baseline;justify-content:space-between;">' +
              '<span class="mono" style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);">each chips in</span>' +
              '<span class="mono" style="font-size:10px;color:var(--faint);">' + tipNote + '</span>' +
            '</div>' +
            '<div style="margin-top:8px;font-family:var(--mono);font-weight:700;font-size:42px;line-height:1;letter-spacing:-1.5px;color:var(--mint);">' +
              '<span style="font-size:24px;opacity:.55;">$</span>' + dollars(eachCents).split(".")[0] + '<span style="font-size:24px;opacity:.55;">.' + dollars(eachCents).split(".")[1] + '</span></div>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;">' +
              '<span class="mono" style="font-size:10px;color:var(--muted);">' + n + ' × $' + dollars(eachCents) + '</span>' +
              '<span class="mono" style="font-size:10px;color:var(--muted);">= $' + dollars(grand) + '</span>' +
            '</div>' +
          '</div>';
      }

      var splitBetween =
        '<div style="margin-top:22px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;">' +
            '<label style="margin:0;">split between</label>' +
            '<span class="mono" style="font-size:10px;color:var(--faint);">' + n + ' of ' + st.members.length + '</span>' +
          '</div>' +
          stepper + modeToggle + memberChips + body +
        '</div>';

      view.innerHTML = topbar(inGroup ? "add expense" : "new tab") +
        '<div class="appscroll" style="padding-bottom:150px;">' +
          '<h1 class="lower" style="font-size:30px;margin:4px 2px 0;">' + (inGroup ? "add expense" : "new tab") + '</h1>' +
          grpPill + hero + whatFor + totalBlock + tipSeg + paidBy + splitBetween +
        '</div>' +
        // sticky footer
        '<div style="position:fixed;left:0;right:0;bottom:0;z-index:55;padding:14px 20px calc(14px + env(safe-area-inset-bottom));' +
          'background:linear-gradient(180deg,rgba(11,22,34,0) 0%,var(--ink) 24%);">' +
          '<button class="btn" id="nSend">' + (inGroup ? "add to tab" : "send the tab") +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button>' +
          '<div class="mono" style="font-size:10px;color:var(--faint);text-align:center;margin-top:10px;">no app needed to pay. dollars, just faster.</div>' +
        '</div>';

      wire();
    }

    // ---- event wiring (re-attached each render) ----
    function wire() {
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
      if (title) title.oninput = function () { st.title = title.value; };

      var total = document.getElementById("nTotal");
      if (total) {
        total.oninput = function () { st.totalCents = toCents(total.value); };
        total.onblur = function () { st.totalCents = toCents(total.value); render(); };
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
      [].forEach.call(document.querySelectorAll("[data-toggle]"), function (b) {
        b.onclick = function () {
          var id = b.getAttribute("data-toggle");
          var m = memberById(id);
          var willHave = st.members.filter(function (x) { return x.included; }).length + (m.included ? -1 : 1);
          if (willHave < 1) return; // keep at least one
          m.included = !m.included;
          delete st.custom[id]; // re-balance on membership change
          render();
        };
      });
      [].forEach.call(document.querySelectorAll("[data-custom]"), function (inp) {
        inp.oninput = function () { st.custom[inp.getAttribute("data-custom")] = toCents(inp.value); };
        inp.onblur = function () { render(); };
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
        var i = st.members.length;
        st.members.push({ id: "p" + (i + 1) + "_" + Date.now(), name: "person " + (i + 1), emoji: EMOJIS[i % EMOJIS.length], included: true });
        render();
      };

      var send = document.getElementById("nSend");
      if (send) send.onclick = doSend;
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
      if (send) { send.disabled = true; send.style.opacity = ".6"; }

      try {
        if (groupId) {
          await app.api.post("/api/trips/" + encodeURIComponent(groupId) + "/expenses", {
            title: title,
            amountCents: grand,
            paidBy: st.paidBy,
            participants: inc.map(function (m) { return m.id; }),
          });
          app.toast("added to the tab ✨");
          location.hash = "#/group/" + encodeURIComponent(groupId);
        } else {
          var bill = await app.api.post("/api/bills", {
            title: title,
            total: dollars(grand),     // dollars; server re-derives cents
            tipPercent: 0,             // tip already baked into total
            names: inc.map(function (m) { return m.you ? "you" : m.name; }),
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
      view.innerHTML = topbar("add expense") +
        '<div class="appscroll"><div class="skeleton" style="height:120px;margin:10px 0;"></div>' +
        '<div class="skeleton" style="height:60px;margin:10px 0;"></div>' +
        '<div class="skeleton" style="height:60px;margin:10px 0;"></div></div>';
      app.api.get("/api/trips/" + encodeURIComponent(groupId)).then(function (trip) {
        st._groupName = trip && trip.name;
        seedMembers(trip && trip.members);
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

  // inject the scan-line keyframe once.
  function ensureKeyframes() {
    if (document.getElementById("ns-kf")) return;
    var s = document.createElement("style");
    s.id = "ns-kf";
    s.textContent = "@keyframes nsScan{0%{top:8%}100%{top:88%}}.nsrow::-webkit-scrollbar{width:0;height:0}.nsrow{scrollbar-width:none}";
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
