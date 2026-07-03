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

  // Brand tokens mirrored from divvy.css :root — JOURNAL theme (canvas can't
  // read CSS vars). Names kept for API/back-compat: INK is the page bg, CREAM
  // is the primary text ink.
  const GREEN = "#2775CA";
  const INK = "#F7F1E3";            // paper background
  const SURFACE = "#FFFDF7";        // card stock
  const SURFACE_2 = "#FBF6EA";      // raised rows
  const CREAM = "#2B2118";          // primary text (warm ink)
  const MUTED = "rgba(43,33,24,0.60)";
  const FAINT = "rgba(43,33,24,0.42)";
  const TERRA = "#FF6B5E";          // you-owe / debit (coral)
  const ACCENT_SOFT = "rgba(39,117,202,0.12)";
  const LINE = "rgba(43,33,24,0.15)";
  const SANS = "'Clash Display', 'General Sans', -apple-system, system-ui, sans-serif";
  const MONO = "'Space Mono', ui-monospace, monospace";

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
  // Navigating away (back button / any hash route change) dismisses the modal —
  // a fixed overlay must never outlive the screen it was opened from.
  window.addEventListener("hashchange", closeModal);

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
      "background:" + SURFACE + "; color:" + CREAM + "; border:2px solid #2B2118; border-radius:20px; " +
      "max-width:420px; width:100%; max-height:90vh; overflow:auto; padding:16px; " +
      "font-family:" + SANS + "; box-shadow:4px 5px 0 rgba(43,33,24,0.85), 0 18px 50px rgba(43,33,24,0.35);";
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

  // Journal palette for the drawn card.
  const PEN = "#2B2118";
  const MINT = "#3DE8C7";
  const SUNSHINE = "#FFC65C";

  // rounded-rect path helper (roundRect isn't everywhere).
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  // A little inked pill "chip" with emoji + mono text. Returns chip width.
  function drawChip(ctx, x, y, text, fill) {
    ctx.font = "700 30px " + MONO;
    const tw = ctx.measureText(text).width;
    const w = tw + 64, h = 72, r = 999;
    ctx.fillStyle = "rgba(43,33,24,0.85)";
    rr(ctx, x + 5, y + 7, w, h, r); ctx.fill();       // offset solid shadow
    ctx.fillStyle = fill;
    rr(ctx, x, y, w, h, r); ctx.fill();
    ctx.strokeStyle = PEN; ctx.lineWidth = 5;
    rr(ctx, x, y, w, h, r); ctx.stroke();
    ctx.fillStyle = PEN;
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 32, y + h / 2 + 2);
    ctx.textBaseline = "alphabetic";
    return w;
  }

  // Up to 3 "superlatives" derived from the trip data the card already has.
  // Rules (each only included when the data supports it, then deduped by the
  // member it lands on so different people get a shout-out where possible):
  //   🐋 big spender   — most total paid
  //   🧾 most tabs      — most expenses started (needs a real leader, >= 2)
  //   🍔 biggest tab    — who paid for the single largest expense
  //   🫠 owes the most  — biggest debtor, only while the trip isn't fully settled
  // Skipped entirely for tiny trips (<2 members or <2 expenses) — a settlement's
  // stored data has no per-member paid time, so a "fastest settler" superlative
  // isn't supported; "most tabs" / "biggest tab" stand in for it.
  function computeSuperlatives(trip) {
    const members = Array.isArray(trip.members) ? trip.members : [];
    const expenses = Array.isArray(trip.expenses) ? trip.expenses : [];
    if (members.length < 2 || expenses.length < 2) return [];

    const nameById = {};
    const stat = {};
    for (const m of members) { nameById[m.id] = m.name; stat[m.id] = { paid: 0, count: 0 }; }

    let biggest = null;
    for (const e of expenses) {
      const c = Number(e.amountCents);
      const pid = e.paidBy;
      if (pid != null && stat[pid]) {
        if (isFinite(c)) stat[pid].paid += c;
        stat[pid].count += 1;
      }
      if (isFinite(c) && (!biggest || c > Number(biggest.amountCents))) biggest = e;
    }

    const cands = [];
    let topPaid = null;
    for (const m of members) {
      if (stat[m.id].paid > 0 && (topPaid == null || stat[m.id].paid > stat[topPaid].paid)) topPaid = m.id;
    }
    if (topPaid != null) cands.push({ emoji: "🐋", label: "big spender", name: nameById[topPaid], key: topPaid });

    let topCount = null;
    for (const m of members) {
      if (stat[m.id].count > 0 && (topCount == null || stat[m.id].count > stat[topCount].count)) topCount = m.id;
    }
    if (topCount != null && stat[topCount].count >= 2) cands.push({ emoji: "🧾", label: "most tabs", name: nameById[topCount], key: topCount });

    if (biggest && biggest.paidBy != null && nameById[biggest.paidBy]) {
      cands.push({ emoji: "🍔", label: "biggest tab", name: nameById[biggest.paidBy], key: biggest.paidBy });
    }

    if (!allSettled(trip)) {
      const balances = Array.isArray(trip.balances) ? trip.balances : [];
      let debtor = null;
      for (const b of balances) {
        if (b.direction === "owes" && (debtor == null || Math.abs(b.cents) > Math.abs(debtor.cents))) debtor = b;
      }
      if (debtor && debtor.name) cands.push({ emoji: "🫠", label: "owes the most", name: debtor.name, key: debtor.memberId });
    }

    const seen = {};
    const out = [];
    for (const c of cands) {
      if (!c.name) continue;
      const memberKey = String(c.key);
      if (seen[memberKey]) continue;
      seen[memberKey] = true;
      out.push(c);
      if (out.length >= 3) break;
    }
    return out;
  }

  function drawCard(canvas, trip) {
    const W = 1080, H = 1080;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");

    // Paper background with ruled notebook lines + a coral margin line.
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(39,117,202,0.12)";
    ctx.lineWidth = 2;
    for (let ly = 120; ly < H; ly += 58) {
      ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W, ly); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,107,94,0.30)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(72, 0); ctx.lineTo(72, H); ctx.stroke();

    // Card stock panel: offset solid shadow, then card, then chunky pen border.
    const M = 96;
    ctx.fillStyle = "rgba(43,33,24,0.85)";
    rr(ctx, M + 10, M + 14, W - M * 2, H - M * 2, 44); ctx.fill();
    ctx.fillStyle = SURFACE;
    rr(ctx, M, M, W - M * 2, H - M * 2, 44); ctx.fill();
    ctx.strokeStyle = PEN;
    ctx.lineWidth = 7;
    rr(ctx, M, M, W - M * 2, H - M * 2, 44); ctx.stroke();

    // Washi tape holding the card down (mint top-center, coral corner).
    ctx.save();
    ctx.translate(W / 2, M + 2); ctx.rotate(-0.035);
    ctx.fillStyle = "rgba(61,232,199,0.82)";
    ctx.fillRect(-120, -28, 240, 56);
    ctx.restore();
    ctx.save();
    ctx.translate(W - M - 30, M + 26); ctx.rotate(0.6);
    ctx.fillStyle = "rgba(255,198,92,0.85)";
    ctx.fillRect(-100, -24, 200, 48);
    ctx.restore();

    const cx = 168;

    // Brand lockup: slash mark + Divvy wordmark.
    ctx.textBaseline = "alphabetic";
    drawSlashMark(ctx, cx, 180, 56, GREEN);
    ctx.fillStyle = CREAM;
    ctx.font = "700 60px " + SANS;
    ctx.fillText("Divvy", cx + 96, 232);

    // Eyebrow micro-label (mono, coral).
    ctx.fillStyle = TERRA;
    ctx.font = "700 26px " + MONO;
    ctx.fillText("S E T T L E - U P   R E C A P !!", cx, 292);

    // Trip name (wrapped, up to 2 lines) + a hand-drawn wavy underline.
    ctx.fillStyle = CREAM;
    ctx.font = "700 76px " + SANS;
    let y = 396;
    y = wrapText(ctx, clean(trip.name) || "Trip", cx, y, W - cx * 2, 88, 2);
    ctx.strokeStyle = SUNSHINE;
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let wx = 0; wx <= 300; wx += 6) {
      const wy = y - 62 + Math.sin(wx / 14) * 6;
      if (wx === 0) ctx.moveTo(cx + wx, wy); else ctx.lineTo(cx + wx, wy);
    }
    ctx.stroke();

    // Hero stat — Total split (big mono blue).
    y += 44;
    ctx.fillStyle = MUTED;
    ctx.font = "600 30px " + SANS;
    ctx.fillText("total split", cx, y);
    y += 96;
    ctx.fillStyle = GREEN;
    ctx.font = "700 112px " + MONO;
    ctx.fillText(clean(trip.totalFmt) || "$0.00", cx, y);

    // Colorful stat chips: people · tabs · per-person average.
    const members = Array.isArray(trip.members) ? trip.members : [];
    const expenses = Array.isArray(trip.expenses) ? trip.expenses : [];
    let totalCents = 0;
    for (const e of expenses) { const c = Number(e.amountCents); if (isFinite(c)) totalCents += c; }
    y += 66;
    let chipX = cx;
    chipX += drawChip(ctx, chipX, y, members.length + " " + (members.length === 1 ? "person" : "people"), "rgba(255,198,92,0.55)") + 26;
    chipX += drawChip(ctx, chipX, y, expenses.length + " " + (expenses.length === 1 ? "tab" : "tabs"), "rgba(61,232,199,0.5)") + 26;
    if (members.length > 0 && totalCents > 0) {
      const avg = totalCents / members.length / 100;
      drawChip(ctx, chipX, y, "~$" + avg.toFixed(2) + " each", "rgba(39,117,202,0.18)");
    }

    // ── Lower section — superlatives (fun trips) or the biggest-expense line ──
    const supers = computeSuperlatives(trip);
    const settled = allSettled(trip);

    if (supers.length) {
      // Awards block. Its dashed rule doubles as the footer perforation.
      y += 92;                                    // clear the stat-chip row
      ctx.strokeStyle = LINE; ctx.lineWidth = 3; ctx.setLineDash([14, 12]);
      ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(W - cx, y); ctx.stroke();
      ctx.setLineDash([]);

      y += 34;
      ctx.fillStyle = TERRA; ctx.font = "700 24px " + MONO;
      ctx.fillText("T H E   A W A R D S 🏅", cx, y);

      y += 36;
      ctx.font = "700 30px " + MONO;
      // Keep award text clear of the bottom-right "all settled" stamp when shown.
      const awMax = settled ? 360 : (W - cx - 168);
      for (const s of supers) {
        let line = s.emoji + "  " + s.label + ": " + clean(s.name);
        let cut = false;
        while (ctx.measureText(line + "…").width > awMax && line.length > 6) { line = line.slice(0, -1); cut = true; }
        ctx.fillStyle = CREAM;
        ctx.fillText(line + (cut ? "…" : ""), cx, y);
        y += 38;
      }
    } else {
      // Biggest expense line (single-stat fallback for tiny trips).
      let biggest = null;
      for (const e of expenses) {
        const c = Number(e.amountCents);
        if (!biggest || (isFinite(c) && c > Number(biggest.amountCents))) biggest = e;
      }
      if (biggest) {
        y += 150;
        ctx.fillStyle = MUTED;
        ctx.font = "500 34px " + SANS;
        const label = "biggest: " + clean(biggest.title || "expense") +
          (biggest.amountFmt ? " — " + clean(biggest.amountFmt) : "") + " 🏆";
        y = wrapText(ctx, label, cx, y, W - cx * 2, 44, 2);
      }
    }

    // "All settled" stamp — mint ink stamp, tilted like it was pressed on. Drawn
    // on top of the section above so it reads as pressed onto the card.
    if (settled) {
      ctx.save();
      ctx.translate(W - 340, H - 300);
      ctx.rotate(-0.12);
      const sw = 380, sh = 116;
      ctx.fillStyle = "rgba(43,33,24,0.85)";
      rr(ctx, -sw / 2 + 5, -sh / 2 + 7, sw, sh, 999); ctx.fill();
      ctx.fillStyle = "rgba(61,232,199,0.55)";
      rr(ctx, -sw / 2, -sh / 2, sw, sh, 999); ctx.fill();
      ctx.strokeStyle = PEN;
      ctx.lineWidth = 6;
      rr(ctx, -sw / 2, -sh / 2, sw, sh, 999); ctx.stroke();
      ctx.fillStyle = PEN;
      ctx.font = "700 42px " + SANS;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✓ all settled", 0, 4);
      ctx.restore();
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }

    // Footer: dashed perforation + tagline. In the awards layout the perforation
    // is the awards rule drawn above, and the tagline follows the awards list.
    if (!supers.length) {
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 3;
      ctx.setLineDash([14, 12]);
      ctx.beginPath();
      ctx.moveTo(cx, H - 236);
      ctx.lineTo(W - cx, H - 236);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = FAINT;
    ctx.font = "500 28px " + SANS;
    ctx.fillText("split the bill. settle in dollars, instantly. ✨", cx, supers.length ? y + 4 : H - 176);

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
        'style="width:100%; border-radius:14px; display:block; margin-bottom:16px; border:2px solid #2B2118; box-shadow:3px 4px 0 rgba(43,33,24,0.85); transform:rotate(-0.5deg);"/>' +
      '<div style="display:flex; gap:10px">' +
        '<button id="recapShare" type="button" style="flex:1; padding:14px; border:2px solid #2B2118; border-radius:999px; ' +
          "background:" + GREEN + '; color:#fff; font-weight:700; font-family:' + SANS + '; cursor:pointer; box-shadow:3px 3px 0 rgba(43,33,24,0.85);">share ↗</button>' +
        '<a id="recapDownload" download="divvy-recap.png" style="flex:1; text-align:center; padding:14px; ' +
          'border:2px solid #2B2118; border-radius:999px; color:#2B2118; background:rgba(255,198,92,0.55); ' +
          "text-decoration:none; font-weight:700; font-family:" + SANS + '; cursor:pointer; box-shadow:3px 3px 0 rgba(43,33,24,0.85);">download</a>' +
      "</div>" +
      '<button id="recapCopy" type="button" style="width:100%; margin-top:12px; padding:12px; ' +
        'border:2px dashed rgba(43,33,24,0.4); border-radius:999px; background:transparent; color:' + CREAM + "; " +
        "font-weight:600; font-family:" + SANS + '; cursor:pointer">copy link 🔗</button>' +
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
