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

  const GREEN = "#14f195";
  const INK = "#04121a";

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
      "background:" + INK + "; color:#fff; border:1px solid #8884; border-radius:16px; " +
      "max-width:420px; width:100%; max-height:90vh; overflow:auto; padding:16px; " +
      "box-shadow:0 10px 40px rgba(0,0,0,.5);";
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
      '<p style="margin:0 0 12px; font-weight:600">Recap</p>' +
      '<p class="muted" style="color:#bbb; margin:0 0 16px">' + esc(msg) + "</p>" +
      '<button id="recapClose" type="button" style="width:100%; padding:14px; border:0; ' +
      "border-radius:12px; background:" + GREEN + "; color:" + INK + '; font-weight:700; cursor:pointer">Close</button>');
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

  function drawCard(canvas, trip) {
    const W = 1080, H = 1080;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");

    // Background.
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, W, H);

    // Subtle green frame.
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 6;
    ctx.strokeRect(40, 40, W - 80, H - 80);

    const cx = 90;

    // Brand wordmark.
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = GREEN;
    ctx.font = "700 56px -apple-system, system-ui, sans-serif";
    ctx.fillText("Divvy", cx, 150);
    ctx.fillStyle = "#7d8a91";
    ctx.font = "600 26px -apple-system, system-ui, sans-serif";
    ctx.fillText("settle-up recap", cx, 192);

    // Trip name (wrapped, up to 2 lines).
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 72px -apple-system, system-ui, sans-serif";
    let y = 320;
    y = wrapText(ctx, clean(trip.name) || "Trip", cx, y, W - cx * 2, 84, 2);

    // Total spent.
    y += 30;
    ctx.fillStyle = "#9fb0b8";
    ctx.font = "600 32px -apple-system, system-ui, sans-serif";
    ctx.fillText("Total spent", cx, y);
    y += 64;
    ctx.fillStyle = GREEN;
    ctx.font = "800 88px -apple-system, system-ui, sans-serif";
    ctx.fillText(clean(trip.totalFmt) || "$0.00", cx, y);

    // People count.
    const members = Array.isArray(trip.members) ? trip.members : [];
    const expenses = Array.isArray(trip.expenses) ? trip.expenses : [];
    y += 80;
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 40px -apple-system, system-ui, sans-serif";
    ctx.fillText(members.length + " " + (members.length === 1 ? "person" : "people"), cx, y);

    // A couple of detail lines: biggest expense + per-person average.
    ctx.font = "500 34px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = "#9fb0b8";

    // Biggest expense (by amountCents when available).
    let biggest = null;
    for (const e of expenses) {
      const c = Number(e.amountCents);
      if (!biggest || (isFinite(c) && c > Number(biggest.amountCents))) biggest = e;
    }
    if (biggest) {
      y += 72;
      const label = "Biggest: " + clean(biggest.title || "expense") +
        (biggest.amountFmt ? " — " + clean(biggest.amountFmt) : "");
      y = wrapText(ctx, label, cx, y, W - cx * 2, 44, 2);
    }

    // Per-person average from the total cents when derivable.
    let totalCents = 0;
    for (const e of expenses) { const c = Number(e.amountCents); if (isFinite(c)) totalCents += c; }
    if (members.length > 0 && totalCents > 0) {
      const avg = totalCents / members.length / 100;
      y += biggest ? 14 : 72;
      ctx.fillStyle = "#9fb0b8";
      ctx.font = "500 34px -apple-system, system-ui, sans-serif";
      ctx.fillText("~ $" + avg.toFixed(2) + " per person", cx, y);
    }

    // "All settled" stamp.
    if (allSettled(trip)) {
      ctx.save();
      ctx.translate(W - 300, H - 230);
      ctx.rotate(-0.12);
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 6;
      ctx.fillStyle = "rgba(20,241,149,0.12)";
      const sw = 340, sh = 110;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-sw / 2, -sh / 2, sw, sh, 16);
      else ctx.rect(-sw / 2, -sh / 2, sw, sh);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = GREEN;
      ctx.font = "800 44px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✓ All settled", 0, 4);
      ctx.restore();
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }

    // Footer tagline.
    ctx.fillStyle = "#5f6e75";
    ctx.font = "500 28px -apple-system, system-ui, sans-serif";
    ctx.fillText("Split the bill. Settle in USDC on Solana.", cx, H - 110);

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
      '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px">' +
        '<span style="font-weight:700">Trip recap</span>' +
        '<button id="recapX" type="button" aria-label="Close" style="width:auto; margin:0; padding:6px 12px; ' +
          'border:1px solid #8884; border-radius:999px; background:transparent; color:#fff; cursor:pointer">✕</button>' +
      "</div>" +
      '<img id="recapImg" alt="Recap card for ' + esc(tripName) + '" ' +
        'style="width:100%; border-radius:12px; display:block; margin-bottom:14px" />' +
      '<div style="display:flex; gap:10px">' +
        '<button id="recapShare" type="button" style="flex:1; padding:14px; border:0; border-radius:12px; ' +
          "background:" + GREEN + "; color:" + INK + '; font-weight:700; cursor:pointer">Share</button>' +
        '<a id="recapDownload" download="divvy-recap.png" style="flex:1; text-align:center; padding:14px; ' +
          'border:1px solid #8884; border-radius:12px; color:#fff; text-decoration:none; cursor:pointer">Download</a>' +
      "</div>" +
      '<button id="recapCopy" type="button" style="width:100%; margin-top:10px; padding:12px; border:1px solid #8884; ' +
        'border-radius:12px; background:transparent; color:#fff; cursor:pointer">Copy link</button>' +
      '<div id="recapNote" class="muted" style="color:#9fb0b8; margin-top:8px; min-height:1em"></div>');

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
