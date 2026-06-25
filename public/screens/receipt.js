/* screens/receipt.js — Transaction receipt: premium on-chain proof a payment moved.
   Route #/receipt/<sig> ; params[0] = a tx signature or settlement id.

   Built by LIFTING the exact inline-styled markup from
   design/handoff/Receipt Detail Frames.dc.html and wiring live data into it, so it
   pixel-matches the approved design. Data comes from window.__receipt (a handoff
   object) or the hash params, with a graceful placeholder fallback that still
   renders the full layout + signature.

   direction state variant: 'received' (blue, +, "you received · settled")
                            'sent'     (coral, −, "you sent · settled"). */
(function () {
  "use strict";
  var app = window.app;

  function shorten(addr, head, tail) {
    addr = String(addr || "");
    if (!addr) return "";
    head = head || 4; tail = tail || 3;
    if (addr.length <= head + tail + 1) return addr;
    return addr.slice(0, head) + "…" + addr.slice(-tail);
  }

  // resolve receipt data from handoff / hash, with a placeholder fallback.
  function resolve(params) {
    var sig = decodeURIComponent((params && params[0]) || "");
    var h = window.__receipt || {};
    // only honor the handoff if it matches this sig (or no sig given / handoff has none)
    var match = !sig || !h.signature || h.signature === sig;
    var d = match ? h : {};
    var signature = d.signature || sig || "";

    return {
      placeholder: !match || (!d.amountCents && d.amountCents !== 0),
      signature: signature,
      direction: d.direction === "sent" ? "sent" : "received",
      amountCents: typeof d.amountCents === "number" ? d.amountCents : null,
      from: d.from || {},                 // { name, emoji, color, wallet }
      to: d.to || {},                     // { name, emoji, color, wallet }
      network: d.network || "solana",
      feeUsd: d.feeUsd || "~$0.0001",
      reference: d.reference || "",
      date: d.date || "",                 // human string e.g. "jun 24, 9:32pm"
      context: d.context || "",           // e.g. group / bill name
    };
  }

  // exact 42px from→to avatar (lifted), tinted from the person identity.
  function avatarTile(p, fallbackGrad) {
    var bg = p && p.color ? app.esc(p.color) : fallbackGrad;
    var emoji = (p && p.emoji) || (p && p.name ? String(p.name).trim()[0].toUpperCase() : "🙂");
    return '<div style="width:42px; height:42px; border-radius:50%; background:' + bg +
      '; border:2px solid #13212E; display:flex; align-items:center; justify-content:center; font-size:20px;">' +
      app.esc(emoji) + '</div>';
  }

  // one mono label/value row from the on-chain proof block (lifted).
  function proofRow(label, valueHtml) {
    return '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:11.5px; color:rgba(244,247,250,0.45);">' + label + '</span>' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:12px; color:#F4F7FA; max-width:62%; text-align:right; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + valueHtml + '</span>' +
    '</div>';
  }

  function copyIcon() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.55)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="cursor:pointer; flex:none;"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  }

  function render(view, params) {
    var r = resolve(params);

    // ---- direction state variant ----
    var sent = r.direction === "sent";
    var accent = sent ? "#FF6B5E" : "#3B92E8";
    var glowColor = sent ? "rgba(255,107,94,0.28)" : "rgba(39,117,202,0.22)";
    var sign = sent ? "−" : "+";

    var fromName = r.from.name || (sent ? "you" : "ava");
    var toName = r.to.name || (sent ? "ava" : "you");
    var headline = (sent ? "you" : app.esc(fromName)) + " chipped in";
    var flowFrom = sent ? "you" : app.esc(fromName);
    var flowTo = sent ? app.esc(toName) : "you";
    var flow = flowFrom + " → " + flowTo;
    var subline = sent ? "you sent · settled" : "you received · settled";

    // ---- big mono amount block (lifted; $ + decimals smaller/lighter) ----
    var amountBlock;
    if (r.amountCents != null) {
      var abs = Math.abs(r.amountCents);
      var usdc = (abs / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      var whole = Math.floor(abs / 100).toLocaleString();
      var dec = "." + ((abs % 100) < 10 ? "0" : "") + (abs % 100);
      amountBlock =
        '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:58px; line-height:.95; letter-spacing:-2.5px; color:' + accent + '; text-shadow:0 0 34px ' + glowColor + ';"><span style="font-size:30px; opacity:.5;">' + sign + '$</span>' + app.esc(whole) + '<span style="font-size:30px; opacity:.5;">' + app.esc(dec) + '</span></div>' +
        '<div style="display:flex; align-items:center; gap:8px; margin-top:9px; flex-wrap:wrap;">' +
          '<span style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(244,247,250,0.55);">' + subline + '</span>' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1px; color:rgba(244,247,250,0.35);">· ' + app.esc(usdc) + ' usdc</span>' +
        '</div>';
    } else {
      amountBlock =
        '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:46px; line-height:1; letter-spacing:-2px; color:rgba(244,247,250,0.4);">' + sign + '$—.—</div>' +
        '<div style="font-family:\'General Sans\',sans-serif; font-size:14px; color:rgba(244,247,250,0.55); margin-top:9px;">amount unavailable · settled on-chain</div>';
    }

    var dateLine = (r.context ? app.esc(r.context) + " · " : "") + (r.date ? app.esc(r.date) : "settled");

    // ---- on-chain proof rows (mono, lowercase labels) ----
    var fromWallet = r.from.wallet ? shorten(r.from.wallet) : "—";
    var toWallet = r.to.wallet ? shorten(r.to.wallet) : "—";
    var fromTag = r.from.name ? ' <span style="color:rgba(244,247,250,0.4);">(' + app.esc(String(r.from.name).toLowerCase()) + ')</span>' : "";
    var toTag = r.to.name ? ' <span style="color:rgba(244,247,250,0.4);">(' + app.esc(String(r.to.name).toLowerCase()) + ')</span>' : "";

    var proof =
      proofRow("from", app.esc(fromWallet) + fromTag) +
      proofRow("to", app.esc(toWallet) + toTag) +
      proofRow("network",
        '<span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:6px; height:6px; border-radius:50%; background:#3DE8C7; box-shadow:0 0 6px rgba(61,232,199,0.8);"></span>' + app.esc(r.network) + '</span>') +
      proofRow("fee", '<span style="color:#3DE8C7;">' + app.esc(r.feeUsd) + '</span>') +
      proofRow("reference", app.esc(r.reference ? shorten(r.reference) : "—")) +
      '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">' +
        '<span style="font-family:\'Space Mono\',monospace; font-size:11.5px; color:rgba(244,247,250,0.45);">signature</span>' +
        '<span style="display:inline-flex; align-items:center; gap:7px; min-width:0;">' +
          '<span style="font-family:\'Space Mono\',monospace; font-size:12px; color:#F4F7FA; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + app.esc(r.signature ? shorten(r.signature) : "—") + '</span>' +
          (r.signature ? '<span id="rcCopy">' + copyIcon() + '</span>' : '') +
        '</span>' +
      '</div>';

    var solscan = r.signature ? "https://solscan.io/tx/" + encodeURIComponent(r.signature) : "";
    var solscanLink = '<a ' + (solscan ? 'href="' + app.esc(solscan) + '" target="_blank" rel="noopener"' : 'style="pointer-events:none; opacity:.4;"') +
      ' style="display:flex; align-items:center; justify-content:center; gap:6px; margin-top:18px; padding-top:16px; border-top:1px solid rgba(244,247,250,0.07); cursor:pointer; text-decoration:none;">' +
      '<span style="font-family:\'Space Mono\',monospace; font-size:12px; color:#7fc0ff;">view on solscan</span>' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7fc0ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>' +
    '</a>';

    // ---- top bar (lifted) — back circle, "receipt", close ✕. both go back. ----
    var topbar =
      '<div style="position:relative; z-index:6; display:flex; align-items:center; justify-content:space-between; height:50px; padding:0 16px; flex:none;">' +
        '<div id="rcBack" role="button" aria-label="back" style="width:38px; height:38px; border-radius:50%; background:#13212E; border:1px solid rgba(244,247,250,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F4F7FA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></div>' +
        '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; letter-spacing:-0.2px; color:#F4F7FA;">receipt</span>' +
        '<div id="rcClose" role="button" aria-label="close" style="width:38px; height:38px; border-radius:50%; background:#13212E; border:1px solid rgba(244,247,250,0.1); display:flex; align-items:center; justify-content:center; cursor:pointer;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F4F7FA" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></div>' +
      '</div>';

    // ---- peeking full-body mascot (real asset, scaled to ~62px over the top edge) ----
    var peekMascot =
      '<div style="position:absolute; top:-66px; right:14px; z-index:4; transform:scale(.52); transform-origin:bottom center; pointer-events:none;">' +
        app.mascot({ size: 96, mood: "happy", glow: true }) +
      '</div>';

    // ---- the receipt card (lifted: money texture + foil shimmer + blue→mint edge
    //      + dashed tear divider + on-chain proof + perforated bottom edge) ----
    var card =
      // wrapper so the mascot can peek over the top edge (not on the avatars)
      '<div style="position:relative; margin-top:40px;">' +
        peekMascot +

        '<div style="position:relative; background:#13212E; border-radius:24px 24px 0 0; border:1px solid rgba(244,247,250,0.08); border-bottom:none; box-shadow:0 18px 46px rgba(0,0,0,0.4); overflow:hidden;">' +
          // money texture (guilloché)
          '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 90% 4%, rgba(255,255,255,0.04) 0 1px, transparent 1px 8px); opacity:.7; pointer-events:none;"></div>' +
          // soft foil shimmer (barely visible, no hard line)
          '<div style="position:absolute; top:0; bottom:0; right:0; width:140px; background:linear-gradient(102deg, transparent 0%, rgba(127,192,255,0.045) 48%, rgba(255,255,255,0.03) 58%, transparent 100%); pointer-events:none;"></div>' +
          // blue→mint top accent edge
          '<div style="position:absolute; left:0; right:0; top:0; height:4px; background:linear-gradient(90deg,#2775CA,#3DE8C7);"></div>' +

          '<div style="position:relative; padding:22px 22px 8px;">' +
            // FINALIZED pill (pulsing mint dot)
            '<div style="display:flex; align-items:center; justify-content:space-between;">' +
              '<span style="display:inline-flex; align-items:center; gap:7px; background:rgba(61,232,199,0.12); border:1px solid rgba(61,232,199,0.42); border-radius:999px; padding:5px 12px;">' +
                '<span style="width:6px; height:6px; border-radius:50%; background:#3DE8C7; box-shadow:0 0 8px rgba(61,232,199,0.9); animation:rcPulse 2.4s ease-in-out infinite;"></span>' +
                '<span style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:10px; letter-spacing:1px; color:#3DE8C7;">FINALIZED</span>' +
              '</span>' +
            '</div>' +

            // who: from → to avatars + headline + flow
            '<div style="display:flex; align-items:center; gap:12px; margin-top:22px;">' +
              '<div style="display:flex; align-items:center;">' +
                avatarTile(r.from, "linear-gradient(150deg,#3DE8C7,#2775CA)") +
                '<svg width="20" height="14" viewBox="0 0 26 14" fill="none" stroke="rgba(244,247,250,0.4)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="margin:0 -2px 0 6px;"><path d="M1 7h22m-5-5 5 5-5 5"/></svg>' +
                '<span style="margin-left:6px; display:inline-flex;">' + avatarTile(r.to, "linear-gradient(150deg,#FFC65C,#FF6B5E)") + '</span>' +
              '</div>' +
              '<div style="flex:1; min-width:0;">' +
                '<div style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:16px; color:#F4F7FA;">' + headline + '</div>' +
                '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:.3px; color:rgba(244,247,250,0.45); margin-top:3px;">' + flow + '</div>' +
              '</div>' +
            '</div>' +

            // big amount
            '<div style="margin-top:20px;">' + amountBlock + '</div>' +

            '<div style="font-family:\'Space Mono\',monospace; font-size:11px; letter-spacing:.3px; color:rgba(244,247,250,0.5); margin-top:16px;">' + dateLine + '</div>' +
          '</div>' +

          // dashed tear divider (two notch circles)
          '<div style="position:relative; height:1px; margin:14px 0 0; border-top:1.5px dashed rgba(244,247,250,0.16);">' +
            '<div style="position:absolute; left:-9px; top:-9px; width:18px; height:18px; border-radius:50%; background:#0B1622;"></div>' +
            '<div style="position:absolute; right:-9px; top:-9px; width:18px; height:18px; border-radius:50%; background:#0B1622;"></div>' +
          '</div>' +

          // on-chain proof block
          '<div style="position:relative; padding:18px 22px 22px;">' +
            '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:2px; color:rgba(244,247,250,0.4); margin-bottom:14px;">on-chain proof</div>' +
            '<div style="display:flex; flex-direction:column; gap:13px;">' + proof + '</div>' +
            solscanLink +
          '</div>' +
        '</div>' +
      '</div>' +

      // perforated bottom edge (row of half-circles)
      '<div style="height:14px; background:radial-gradient(circle at 10px 14px, #0B1622 0 7px, transparent 7.5px); background-size:20px 14px; background-repeat:repeat-x; margin-bottom:8px;"></div>';

    var placeholderNote = r.placeholder ?
      '<div style="font-family:\'Space Mono\',monospace; text-align:center; font-size:11px; color:rgba(244,247,250,0.4); margin:2px 0 10px;">couldn\'t load the full receipt — showing what we know ✨</div>' : '';

    // ---- sticky actions (lifted): glowing-blue "share proof ✨" + quiet "done" ----
    var actions =
      '<div style="flex:1; min-height:14px;"></div>' +
      placeholderNote +
      '<button id="rcShare" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:56px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:0 12px 30px rgba(39,117,202,0.5), inset 0 1px 0 rgba(255,255,255,0.25);">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>' +
        '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#fff;">share proof</span>' +
        '<span style="font-size:15px;">✨</span>' +
      '</button>' +
      '<div style="display:flex; justify-content:center; margin-top:14px;">' +
        '<span id="rcDone" style="font-family:\'General Sans\',sans-serif; font-size:15px; color:rgba(244,247,250,0.5); cursor:pointer; padding:6px 18px;">done</span>' +
      '</div>';

    // keyframes the lifted card relies on (FINALIZED dot pulse) — inject once.
    if (!document.getElementById("rc-keyframes")) {
      var st = document.createElement("style");
      st.id = "rc-keyframes";
      st.textContent = "@keyframes rcPulse{0%,100%{opacity:.5}50%{opacity:1}}";
      document.head.appendChild(st);
    }

    view.innerHTML = topbar +
      // accent radial glow behind the card (tinted per direction)
      '<div style="position:absolute; left:50%; top:60px; width:360px; height:300px; transform:translateX(-50%); border-radius:50%; background:radial-gradient(circle, ' + glowColor + ' 0%, rgba(39,117,202,0) 70%); pointer-events:none; z-index:0;"></div>' +
      '<div class="appscroll" style="position:relative; z-index:2; display:flex; flex-direction:column; padding:8px 20px 30px;">' +
        card + actions +
      '</div>';

    // ---- wiring ----
    function back() {
      if (window.history.length > 1) window.history.back();
      else app.go("home");
    }
    var b = document.getElementById("rcBack"); if (b) b.onclick = back;
    var x = document.getElementById("rcClose"); if (x) x.onclick = back;
    var done = document.getElementById("rcDone"); if (done) done.onclick = back;

    var copy = document.getElementById("rcCopy");
    if (copy) copy.onclick = function () {
      var txt = r.signature;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt);
        else {
          var ta = document.createElement("textarea");
          ta.value = txt; document.body.appendChild(ta); ta.select();
          try { document.execCommand("copy"); } catch (_) {}
          ta.remove();
        }
      } catch (_) {}
      app.toast("copied");
    };

    var share = document.getElementById("rcShare");
    if (share) share.onclick = function () {
      var url = solscan || location.href;
      var amt = r.amountCents != null ? "$" + (Math.abs(r.amountCents) / 100).toFixed(2) : "";
      var text = (sent ? "chipped in " : "got paid ") + amt + " · settled in usdc on solana";
      try {
        if (navigator.share) {
          navigator.share({ title: "divvy receipt", text: text, url: url }).catch(function () {});
          return;
        }
      } catch (_) {}
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url);
      } catch (_) {}
      app.toast("link copied");
    };
  }

  window.Screens = window.Screens || {};
  window.Screens.receipt = { title: "receipt", render: render };
})();
