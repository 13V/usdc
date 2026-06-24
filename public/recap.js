/* Divvy — Recap: a shareable settle-up recap card (pure <canvas>, no libs).
   Exposes window.Recap = { open(tripId) }.

   open(tripId) fetches GET /api/trips/<tripId> (via Auth.authFetch), draws a
   1080x1080 recap card on a canvas, and presents it in a small modal overlay
   with Share (Web Share API with files), Download (PNG), and Copy link actions.

   Trip shape (see trips.js): { id, name, totalFmt, members:[...],
     expenses:[{title,amountFmt,amountCents,...}], balances:[{direction,...}],
     settle?, shareUrlPath, shareToken }.
*/
(function () {
  "use strict";

  // Brand tokens mirrored from the styleguide :root (canvas can't read CSS vars).
  const GREEN = "#2775ca";          // --accent (USDC blue); name kept for API/back-compat
  const INK = "#04121a";            // --ink (app background)
  const SURFACE = "#0a1f2b";        // --surface (cards)
  const SURFACE_2 = "#0e2734";      // --surface-2 (raised rows)
  const CREAM = "#f6f1e7";          // --cream (primary text)
  const MUTED = "#a9b0a8";          // ~ --muted on dark (secondary text)
  const FAINT = "#727a74";          // ~ --faint (tertiary / hints)
  const TERRA = "#e0a892";          // --terra (you-owe / debit)
  const ACCENT_SOFT = "rgba(39,117,202,0.14)"; // --accent-soft
  const LINE = "rgba(246,241,231,0.10)";        // --line (hairline borders)
  const SANS = "'Space Grotesk', -apple-system, system-ui, sans-serif";
  const MONO = "'JetBrains Mono', ui-monospace, monospace";

  function authFetchFn() {
    return (window.Auth && window.Auth.authFetch) ? window.Auth.authFetch : fetch;
  }
  function authUser() { return (window.Auth && window.Auth.user) || null; }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Plain-text sanitiser for strings drawn on the canvas / used in share text.
  // Canvas fillText doesn't interpret HTML, but we still strip control chars and
  // collapse whitespace so untrusted trip data can't distort the layout.
  function clean(s) {
    return String(s == null ? "" : s).replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
  }

  // ── modal overlay ────────────────────────────────────────────────────────────
  let overlayEl = null;

  function closeModal() {
    if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
    document.removeEventListener("keydown", onKeydown);
  }
  function onKeydown(e) {
    if (e.key === "Escape") closeModal();
  }

  function buildOverlay(innerHtml) {
    closeModal();
    const ov = document.createElement("div");
    ov.id = "recapOverlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.style.cssText =
      "position:fixed; inset:0; z-index:9999; background:rgba(0,0,0,.6); " +
      "display:flex; align-items:center; justify-content:center; padding:16px;";
    const card = document.createElement("div");
    card.style.cssText =
      "background:" + SURFACE + "; color:" + CREAM + "; border:1px solid " + LINE + "; border-radius:16px; " +
      "max-width:420px; width:100%; max-height:90vh; overflow:auto; padding:16px; " +
      "font-family:" + SANS + "; box-shadow:0 10px 40px rgba(0,0,0,.5);";
    card.innerHTML = innerHtml;
    ov.appendChild(card);
    // Click outside the card closes.
    ov.addEventListener("click", (e) => { if (e.target === ov) closeModal(); });
    document.body.appendChild(ov);
    document.addEventListener("keydown", onKeydown);
    overlayEl = ov;
    return card;
  }

  function showMessage(msg) {
    const card = buildOverlay(
      '<div class="eyebrow" style="font-family:' + MONO + '; text-transform:uppercase; letter-spacing:.12em; ' +
        'font-size:.68rem; color:' + MUTED + '; margin:0 0 8px">Recap</div>' +
      '<p style="color:' + CREAM + '; margin:0 0 16px; font-size:1.05rem">' + esc(msg) + "</p>" +
      '<button id="recapClose" type="button" style="width:100%; padding:14px; border:0; ' +
      "border-radius:999px; background:" + GREEN + "; color:" + INK + "; font-weight:700; " +
      "font-family:" + SANS + '; cursor:pointer">Close</button>');
    const b = card.querySelector("#recapClose");
    if (b) b.onclick = closeModal;
  }

  // ── canvas drawing ───────────────────────────────────────────────────────────
  // Word-wrap helper: draws lines, returns the y after the last line.
  function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = String(text).split(" ");
    let line = "";
    let lines = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + " " + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        line = words[i];
        y += lineHeight;
        lines++;
        if (maxLines && lines >= maxLines - 1) {
          // last allowed line — draw the remainder (truncated with ellipsis if long)
          let rest = words.slice(i).join(" ");
          while (rest && ctx.measureText(rest + "…").width > maxWidth) rest = rest.slice(0, -1);
          ctx.fillText(rest + (rest === words.slice(i).join(" ") ? "" : "…"), x, y);
          return y + lineHeight;
        }
      } else {
        line = test;
      }
    }
    if (line) { ctx.fillText(line, x, y); y += lineHeight; }
    return y;
  }

  // Determine whether every balance in the trip is settled.
  function allSettled(trip) {
    if (trip.settle && trip.settle.allPaid) return true;
    const balances = Array.isArray(trip.balances) ? trip.balances : [];
    if (balances.length === 0) return false;
    return balances.every((b) => b.direction === "settled");
  }

  // Draw the Divvy slash mark (the "/" of the wordmark) as a chunky accent glyph.
  function drawSlashMark(ctx, x, y, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    const w = size * 0.5;     // stroke width of the slash
    ctx.moveTo(x + size, y);
    ctx.lineTo(x + size + w, y);
    ctx.lineTo(x + w, y + size);
    ctx.lineTo(x, y + size);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawCard(canvas, trip) {
    const W = 1080, H = 1080;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");

    // Background — app ink.
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, W, H);

    // Inner card surface (rounded), like a .card panel on the ink shell.
    const M = 40;
    ctx.fillStyle = SURFACE;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(M, M, W - M * 2, H - M * 2, 36);
    else ctx.rect(M, M, W - M * 2, H - M * 2);
    ctx.fill();

    // Hairline accent frame.
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(M, M, W - M * 2, H - M * 2, 36);
    else ctx.rect(M, M, W - M * 2, H - M * 2);
    ctx.stroke();

    const cx = 96;

    // Brand lockup: slash mark + Divvy wordmark.
    ctx.textBaseline = "alphabetic";
    drawSlashMark(ctx, cx, 104, 56, GREEN);
    ctx.fillStyle = CREAM;
    ctx.font = "700 60px " + SANS;
    ctx.fillText("Divvy", cx + 96, 156);

    // Eyebrow micro-label (mono, uppercase).
    ctx.fillStyle = MUTED;
    ctx.font = "600 26px " + MONO;
    ctx.fillText("S E T T L E - U P   R E C A P", cx, 214);

    // Trip name (wrapped, up to 2 lines) — sans display.
    ctx.fillStyle = CREAM;
    ctx.font = "700 72px " + SANS;
    let y = 330;
    y = wrapText(ctx, clean(trip.name) || "Trip", cx, y, W - cx * 2, 84, 2);

    // Hero stat — Total split (mono number in accent blue, money rule = paid/positive).
    y += 36;
    ctx.fillStyle = MUTED;
    ctx.font = "600 30px " + SANS;
    ctx.fillText("Total split", cx, y);
    y += 78;
    ctx.fillStyle = GREEN;
    ctx.font = "600 104px " + MONO;
    ctx.fillText(clean(trip.totalFmt) || "$0.00", cx, y);

    // People count.
    const members = Array.isArray(trip.members) ? trip.members : [];
    const expenses = Array.isArray(trip.expenses) ? trip.expenses : [];
    y += 84;
    ctx.fillStyle = CREAM;
    ctx.font = "600 38px " + SANS;
    ctx.fillText(members.length + " " + (members.length === 1 ? "person" : "people"), cx, y);

    // Breakdown: biggest expense + per-person average. Labels sans, numbers mono.
    // Biggest expense (by amountCents when available).
    let biggest = null;
    for (const e of expenses) {
      const c = Number(e.amountCents);
      if (!biggest || (isFinite(c) && c > Number(biggest.amountCents))) biggest = e;
    }
    if (biggest) {
      y += 70;
      ctx.fillStyle = MUTED;
      ctx.font = "500 34px " + SANS;
      const label = "Biggest: " + clean(biggest.title || "expense") +
        (biggest.amountFmt ? " — " + clean(biggest.amountFmt) : "");
      y = wrapText(ctx, label, cx, y, W - cx * 2, 44, 2);
    }

    // Per-person average from the total cents when derivable.
    let totalCents = 0;
    for (const e of expenses) { const c = Number(e.amountCents); if (isFinite(c)) totalCents += c; }
    if (members.length > 0 && totalCents > 0) {
      const avg = totalCents / members.length / 100;
      y += biggest ? 14 : 70;
      ctx.fillStyle = MUTED;
      ctx.font = "500 34px " + SANS;
      ctx.fillText("~ $" + avg.toFixed(2) + " per person", cx, y);
    }

    // "All settled" stamp — accent-soft fill + accent outline (no green).
    if (allSettled(trip)) {
      ctx.save();
      ctx.translate(W - 300, H - 250);
      ctx.rotate(-0.12);
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 5;
      ctx.fillStyle = ACCENT_SOFT;
      const sw = 360, sh = 112;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-sw / 2, -sh / 2, sw, sh, 999);
      else ctx.rect(-sw / 2, -sh / 2, sw, sh);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = GREEN;
      ctx.font = "700 42px " + SANS;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✓ All settled", 0, 4);
      ctx.restore();
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }

    // Footer: hairline divider + tagline + wordmark.
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, H - 160);
    ctx.lineTo(W - cx, H - 160);
    ctx.stroke();

    ctx.fillStyle = FAINT;
    ctx.font = "500 28px " + SANS;
    ctx.fillText("Split the bill. Settle in USDC on Solana.", cx, H - 108);

    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => {
      if (canvas.toBlob) canvas.toBlob((b) => resolve(b), "image/png");
      else {
        // Fallback: derive a Blob from the data URL.
        try {
          const dataUrl = canvas.toDataURL("image/png");
          const bin = atob(dataUrl.split(",")[1]);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: "image/png" }));
        } catch (_) { resolve(null); }
      }
    });
  }

  // ── public: open ─────────────────────────────────────────────────────────────
  async function open(tripId) {
    if (!tripId) { showMessage("No trip to recap."); return; }
    if (!authUser()) {
      showMessage("Sign in to share a trip recap.");
      return;
    }

    // Loading state.
    showMessage("Building your recap…");

    let trip;
    try {
      const res = await authFetchFn()("/api/trips/" + encodeURIComponent(tripId), {
        headers: { "content-type": "application/json" },
      });
      trip = await res.json();
      if (!res.ok) throw new Error((trip && trip.error) || "Couldn't load trip.");
    } catch (err) {
      showMessage(err && err.message ? err.message : "Couldn't load this trip.");
      return;
    }

    const canvas = document.createElement("canvas");
    try {
      drawCard(canvas, trip);
    } catch (_) {
      showMessage("Couldn't render the recap card.");
      return;
    }

    const dataUrl = canvas.toDataURL("image/png");
    const tripName = clean(trip.name) || "Trip";
    const shareLink = trip.shareUrlPath ? (location.origin + trip.shareUrlPath) : "";
    const shareText = "Recap for " + tripName + " — " + (clean(trip.totalFmt) || "$0.00") +
      " total, settled in USDC on Divvy." + (shareLink ? " " + shareLink : "");

    const card = buildOverlay(
      '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px">' +
        '<span class="eyebrow" style="font-family:' + MONO + '; text-transform:uppercase; letter-spacing:.12em; ' +
          'font-size:.68rem; color:' + MUTED + '">Trip recap</span>' +
        '<button id="recapX" type="button" aria-label="Close" style="width:auto; margin:0; padding:6px 12px; ' +
          "border:1px solid " + LINE + "; border-radius:999px; background:transparent; color:" + CREAM + "; " +
          "font-family:" + SANS + '; cursor:pointer">✕</button>' +
      "</div>" +
      '<img id="recapImg" alt="Recap card for ' + esc(tripName) + '" ' +
        "style=\"width:100%; border-radius:14px; display:block; margin-bottom:14px; border:1px solid " + LINE + '"/>' +
      '<div style="display:flex; gap:10px">' +
        '<button id="recapShare" type="button" style="flex:1; padding:14px; border:0; border-radius:999px; ' +
          "background:" + GREEN + "; color:" + INK + "; font-weight:700; font-family:" + SANS + '; cursor:pointer">Share</button>' +
        '<a id="recapDownload" download="divvy-recap.png" style="flex:1; text-align:center; padding:14px; ' +
          "border:1px solid " + LINE + "; border-radius:999px; color:" + CREAM + "; background:" + SURFACE_2 + "; " +
          "text-decoration:none; font-weight:600; font-family:" + SANS + '; cursor:pointer">Download</a>' +
      "</div>" +
      '<button id="recapCopy" type="button" style="width:100%; margin-top:10px; padding:12px; ' +
        "border:1px solid " + LINE + "; border-radius:999px; background:transparent; color:" + CREAM + "; " +
        "font-family:" + SANS + '; cursor:pointer">Copy link</button>' +
      '<div id="recapNote" class="muted" style="color:' + MUTED + "; font-family:" + MONO + '; font-size:.85rem; ' +
        'margin-top:8px; min-height:1em"></div>');

    const img = card.querySelector("#recapImg");
    if (img) img.src = dataUrl;
    const dl = card.querySelector("#recapDownload");
    if (dl) dl.href = dataUrl;
    const note = card.querySelector("#recapNote");
    const xBtn = card.querySelector("#recapX");
    if (xBtn) xBtn.onclick = closeModal;

    const shareBtn = card.querySelector("#recapShare");
    if (shareBtn) {
      shareBtn.onclick = async () => {
        const blob = await canvasToBlob(canvas);
        let file = null;
        try {
          if (blob) file = new File([blob], "divvy-recap.png", { type: "image/png" });
        } catch (_) { file = null; }
        const payload = { text: shareText };
        if (shareLink) payload.url = shareLink;
        // Prefer sharing the image file when supported.
        if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
          try {
            await navigator.share(Object.assign({ files: [file] }, payload));
            return;
          } catch (_) { /* cancelled or failed — fall through */ }
        }
        // Text/url share fallback.
        if (navigator.share) {
          try {
            await navigator.share(payload);
            return;
          } catch (_) { /* cancelled — fall through to download hint */ }
        }
        if (note) note.textContent = "Sharing isn't available — use Download instead.";
      };
    }

    const copyBtn = card.querySelector("#recapCopy");
    if (copyBtn) {
      copyBtn.onclick = async () => {
        if (!shareLink) { if (note) note.textContent = "No shareable link for this trip."; return; }
        try {
          await navigator.clipboard.writeText(shareLink);
        } catch (_) {
          const ta = document.createElement("textarea");
          ta.value = shareLink; document.body.appendChild(ta); ta.select();
          try { document.execCommand("copy"); } catch (e) {}
          document.body.removeChild(ta);
        }
        if (note) {
          note.textContent = "Link copied";
          setTimeout(() => { if (note) note.textContent = ""; }, 2500);
        }
      };
    }
  }

  window.Recap = { open };

  // Self-init only to be a good citizen on DOMContentLoaded; nothing to render
  // until open() is called by the integrator.
  document.addEventListener("DOMContentLoaded", function () { /* no-op */ });
})();
