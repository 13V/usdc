/* screens/receipt.js — Receipt detail: the on-chain proof of a settlement.
   Route #/receipt/<sig> ; params[0] = a tx signature or settlement id.
   Data comes from window.__receipt (a handoff object) or the hash params,
   with a graceful placeholder fallback that still renders the layout + sig.
   Matches design/frames/Receipt Detail Frames.dc.html. (see design/BUILD.md) */
(function () {
  "use strict";
  var app = window.app;

  function shorten(addr, head, tail) {
    addr = String(addr || "");
    if (!addr) return "";
    head = head || 4; tail = tail || 4;
    if (addr.length <= head + tail + 1) return addr;
    return addr.slice(0, head) + "…" + addr.slice(-tail);
  }

  // back/close header (lowercase, dry). left = back, right = close — both go back.
  function header() {
    return '<div style="position:relative;z-index:6;display:flex;align-items:center;justify-content:space-between;height:50px;padding:0 4px;margin:2px 0 0;flex:none;">' +
      '<button id="rcBack" aria-label="back" style="appearance:none;width:38px;height:38px;border-radius:50%;background:var(--card);border:1px solid var(--line);color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer;">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
      '</button>' +
      '<span class="display" style="font-size:17px;letter-spacing:-0.2px;">receipt</span>' +
      '<button id="rcClose" aria-label="close" style="appearance:none;width:38px;height:38px;border-radius:50%;background:var(--card);border:1px solid var(--line);color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer;">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
      '</button>' +
    '</div>';
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
      // direction: 'received' (blue +) | 'sent' (coral −)
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

  function metaRow(label, valueHtml) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
      '<span class="mono" style="font-size:11.5px;color:var(--faint);">' + label + '</span>' +
      '<span class="mono" style="font-size:12px;color:var(--text);max-width:62%;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + valueHtml + '</span>' +
    '</div>';
  }

  function copyIcon() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="cursor:pointer;flex:none;"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  }

  function render(view, params) {
    var r = resolve(params);

    var accent = r.direction === "sent" ? "var(--coral)" : "var(--blue-bright)";
    var glowColor = r.direction === "sent" ? "rgba(255,107,94,0.28)" : "rgba(39,117,202,0.22)";
    var sign = r.direction === "sent" ? "−" : "+";
    var moneyKind = r.direction === "sent" ? "neg" : "pos";

    var fromName = r.from.name || (r.direction === "sent" ? "you" : "someone");
    var toName = r.to.name || (r.direction === "sent" ? "someone" : "you");
    var headline = (r.direction === "sent" ? "you" : app.esc(fromName)) + " chipped in";
    var flowFrom = r.direction === "sent" ? "you" : app.esc(fromName);
    var flowTo = r.direction === "sent" ? app.esc(toName) : "you";
    var subline = r.direction === "sent" ? "you sent · settled" : "you received · settled";

    // big amount block (mono), via app.money when we have a real number.
    var amountBlock;
    if (r.amountCents != null) {
      var usdc = (Math.abs(r.amountCents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      amountBlock =
        '<div class="mono" style="font-weight:700;font-size:58px;line-height:.95;letter-spacing:-2.5px;color:' + accent + ';text-shadow:0 0 34px ' + glowColor + ';">' +
          '<span style="font-size:30px;opacity:.5;">' + sign + '$</span>' +
          app.esc(Math.floor(Math.abs(r.amountCents) / 100).toLocaleString()) +
          '<span style="font-size:30px;opacity:.5;">.' + ((Math.abs(r.amountCents) % 100) < 10 ? "0" : "") + (Math.abs(r.amountCents) % 100) + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap;">' +
          '<span style="font-size:14px;color:var(--muted);">' + subline + '</span>' +
          '<span class="mono" style="font-size:10px;letter-spacing:1px;color:var(--faint);">· ' + usdc + ' usdc</span>' +
        '</div>';
    } else {
      amountBlock =
        '<div class="mono" style="font-weight:700;font-size:46px;line-height:1;letter-spacing:-2px;color:var(--faint);">' + sign + '$—.—</div>' +
        '<div style="margin-top:9px;font-size:14px;color:var(--muted);">amount unavailable · settled on-chain</div>';
    }

    var dateLine = (r.context ? app.esc(r.context) + " · " : "") + (r.date || "settled");

    // ---- on-chain metadata (all mono, lowercase labels) ----
    var fromWallet = r.from.wallet ? shorten(r.from.wallet) : "—";
    var toWallet = r.to.wallet ? shorten(r.to.wallet) : "—";
    var fromTag = r.from.name ? ' <span style="color:var(--faint);">(' + app.esc(String(r.from.name).toLowerCase()) + ')</span>' : "";
    var toTag = r.to.name ? ' <span style="color:var(--faint);">(' + app.esc(String(r.to.name).toLowerCase()) + ')</span>' : "";

    var meta =
      metaRow("from", app.esc(fromWallet) + fromTag) +
      metaRow("to", app.esc(toWallet) + toTag) +
      metaRow("network",
        '<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--mint);box-shadow:0 0 6px rgba(61,232,199,0.8);"></span>' + app.esc(r.network) + '</span>') +
      metaRow("fee", '<span style="color:var(--mint);">' + app.esc(r.feeUsd) + '</span>') +
      metaRow("reference", app.esc(r.reference ? shorten(r.reference) : "—")) +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
        '<span class="mono" style="font-size:11.5px;color:var(--faint);">signature</span>' +
        '<span style="display:inline-flex;align-items:center;gap:7px;min-width:0;">' +
          '<span class="mono" style="font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + app.esc(r.signature ? shorten(r.signature) : "—") + '</span>' +
          (r.signature ? '<span id="rcCopy">' + copyIcon() + '</span>' : '') +
        '</span>' +
      '</div>';

    var solscan = r.signature ? "https://solscan.io/tx/" + encodeURIComponent(r.signature) : "";
    var solscanLink = '<a ' + (solscan ? 'href="' + app.esc(solscan) + '" target="_blank" rel="noopener"' : 'style="pointer-events:none;opacity:.4;"') +
      ' style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line);text-decoration:none;">' +
      '<span class="mono" style="font-size:12px;color:var(--blue-bright);">view on solscan</span>' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--blue-bright)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>' +
    '</a>';

    // ---- the receipt card (money texture + foil + dashed divider + perforated edge) ----
    var card =
      '<div style="position:relative;margin-top:40px;">' +
        // peeking full-body mascot (the locked asset), nudged over the top edge
        '<div style="position:absolute;top:-44px;right:24px;z-index:4;width:64px;height:64px;overflow:visible;display:flex;justify-content:center;">' +
          '<div style="transform:scale(.5);transform-origin:top center;">' + app.mascot({ size: 120, mood: "happy", glow: true }) + '</div>' +
        '</div>' +

        '<div style="position:relative;background:var(--card);border-radius:24px 24px 0 0;border:1px solid var(--line);border-bottom:none;box-shadow:0 18px 46px rgba(0,0,0,0.4);overflow:hidden;">' +
          // guilloché money texture
          '<div style="position:absolute;inset:0;background-image:repeating-radial-gradient(circle at 90% 4%, rgba(255,255,255,0.04) 0 1px, transparent 1px 8px);opacity:.7;pointer-events:none;"></div>' +
          // soft foil shimmer
          '<div style="position:absolute;top:0;bottom:0;right:0;width:140px;background:linear-gradient(102deg, transparent 0%, rgba(127,192,255,0.045) 48%, rgba(255,255,255,0.03) 58%, transparent 100%);pointer-events:none;"></div>' +
          // top accent stripe
          '<div style="position:absolute;left:0;right:0;top:0;height:4px;background:linear-gradient(90deg,var(--blue),var(--mint));"></div>' +

          '<div style="position:relative;padding:22px 22px 8px;">' +
            // finalized pill
            '<div style="display:flex;align-items:center;justify-content:space-between;">' +
              '<span class="state finalized">finalized</span>' +
            '</div>' +

            // who: from → to avatars + headline
            '<div style="display:flex;align-items:center;gap:12px;margin-top:22px;">' +
              '<div style="display:flex;align-items:center;">' +
                app.avatar({ name: fromName, emoji: r.from.emoji, color: r.from.color, id: r.from.wallet }) +
                '<svg width="20" height="14" viewBox="0 0 26 14" fill="none" stroke="var(--faint)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="margin:0 -2px 0 6px;"><path d="M1 7h22m-5-5 5 5-5 5"/></svg>' +
                '<span style="margin-left:6px;display:inline-flex;">' + app.avatar({ name: toName, emoji: r.to.emoji, color: r.to.color, id: r.to.wallet }) + '</span>' +
              '</div>' +
              '<div style="flex:1;min-width:0;">' +
                '<div class="lower" style="font-weight:500;font-size:16px;color:var(--text);">' + headline + '</div>' +
                '<div class="mono" style="font-size:10px;letter-spacing:.3px;color:var(--faint);margin-top:3px;">' + flowFrom + ' → ' + flowTo + '</div>' +
              '</div>' +
            '</div>' +

            // big amount
            '<div style="margin-top:20px;">' + amountBlock + '</div>' +

            '<div class="mono" style="font-size:11px;letter-spacing:.3px;color:var(--muted);margin-top:16px;">' + app.esc(dateLine) + '</div>' +
          '</div>' +

          // dashed divider with notches
          '<div style="position:relative;height:1px;margin:14px 0 0;border-top:1.5px dashed var(--line-2);">' +
            '<div style="position:absolute;left:-9px;top:-9px;width:18px;height:18px;border-radius:50%;background:var(--ink);"></div>' +
            '<div style="position:absolute;right:-9px;top:-9px;width:18px;height:18px;border-radius:50%;background:var(--ink);"></div>' +
          '</div>' +

          // on-chain metadata block
          '<div style="position:relative;padding:18px 22px 22px;">' +
            '<div class="mono" style="font-size:9px;letter-spacing:2px;color:var(--faint);margin-bottom:14px;text-transform:lowercase;">on-chain proof</div>' +
            '<div style="display:flex;flex-direction:column;gap:13px;">' + meta + '</div>' +
            solscanLink +
          '</div>' +
        '</div>' +
      '</div>' +

      // perforated bottom edge
      '<div style="height:14px;background:radial-gradient(circle at 10px 14px, var(--ink) 0 7px, transparent 7.5px);background-size:20px 14px;background-repeat:repeat-x;margin-bottom:8px;"></div>';

    var placeholderNote = r.placeholder ?
      '<div class="mono" style="text-align:center;font-size:11px;color:var(--faint);margin:2px 0 10px;">couldn\'t load the full receipt — showing what we know ✨</div>' : '';

    // ---- actions ----
    var actions =
      '<div style="flex:1;min-height:14px;"></div>' +
      placeholderNote +
      '<button id="rcShare" class="btn glow-blue" style="gap:9px;">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>' +
        '<span>share</span><span style="font-size:15px;">✨</span>' +
      '</button>' +
      '<div style="display:flex;justify-content:center;margin-top:14px;">' +
        '<span id="rcDone" style="font-size:15px;color:var(--muted);cursor:pointer;padding:6px 18px;">done</span>' +
      '</div>';

    view.innerHTML = header() +
      '<div class="appscroll" style="display:flex;flex-direction:column;padding-bottom:30px;">' +
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
      var text = (r.direction === "sent" ? "chipped in " : "got paid ") + amt + " · settled in usdc on solana";
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
