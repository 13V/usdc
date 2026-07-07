/* bags.js — client for /bags, the Friend Debt Portfolio generator.
   Pure client: reads the debt rows, renders a 1600×900 trenches-terminal
   portfolio card on <canvas>, and offers download / Web Share / tweet-intent.
   Nothing is sent anywhere. Exposes window.BagsLab = { render, toDataURL,
   state } for tests, mirroring memes.js. */
(function () {
  "use strict";

  var W = 1600, H = 900;
  var BG = "#100D09", CREAM = "#F3EAD9", MINT = "#3DE8C7", CORAL = "#FF6B5E", BLUE = "#2775CA";
  var MONO = "'Space Mono',ui-monospace,Menlo,monospace";
  var SANS = "'General Sans',-apple-system,system-ui,sans-serif";
  var CLASH = "'Clash Display'," + SANS;

  var canvas, ctx, frogImg = null;

  // seed bags — instantly funny, instantly editable
  var state = { bags: [
    { who: "jake", amt: 38, days: 247 },
    { who: "ty", amt: 12, days: 30 },
    { who: "dev", amt: 87, days: 9 },
  ] };

  // tiny Mochi face (distinct divvy art — mint rounded face, NOT pepe-anything)
  function frogSvg() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 96" width="200" height="192">' +
      '<circle cx="32" cy="16" r="13" fill="#7FF2DC" stroke="#2B2118" stroke-width="5"/>' +
      '<circle cx="68" cy="16" r="13" fill="#7FF2DC" stroke="#2B2118" stroke-width="5"/>' +
      '<circle cx="32" cy="16" r="4.5" fill="#2B2118"/><circle cx="68" cy="16" r="4.5" fill="#2B2118"/>' +
      '<rect x="8" y="22" width="84" height="66" rx="30" fill="#7FF2DC" stroke="#2B2118" stroke-width="5"/>' +
      '<circle cx="27" cy="58" r="6" fill="#F6A9A0"/><circle cx="73" cy="58" r="6" fill="#F6A9A0"/>' +
      '<path d="M38 56 q6 7 12 0 q6 7 12 0" fill="none" stroke="#2B2118" stroke-width="5" stroke-linecap="round"/>' +
      '</svg>';
  }

  function money(n) {
    return "$" + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function grid() {
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(61,232,199,0.045)"; ctx.lineWidth = 1;
    for (var x = 0.5; x < W; x += 44) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (var y = 0.5; y < H; y += 44) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function render() {
    var bags = state.bags.filter(function (b) { return b.who && b.amt > 0; });
    var total = bags.reduce(function (s, b) { return s + Number(b.amt || 0); }, 0);
    var worst = bags.slice().sort(function (a, b) { return (b.days || 0) - (a.days || 0); })[0];

    grid();
    // panel
    rr(56, 52, W - 112, H - 140, 24);
    ctx.fillStyle = "rgba(16,13,9,0.74)"; ctx.fill();
    ctx.strokeStyle = "rgba(61,232,199,0.30)"; ctx.lineWidth = 2; ctx.stroke();

    // header: wordmark + frog
    rr(124, 108, 26, 26, 8); ctx.fillStyle = BLUE; ctx.fill();
    ctx.strokeStyle = "rgba(243,234,217,0.9)"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = CREAM; ctx.font = "700 40px " + CLASH; ctx.textBaseline = "middle";
    ctx.fillText("divvy", 166, 123);
    if (frogImg) ctx.drawImage(frogImg, W - 124 - 74, 96, 74, 71);

    // tag + total
    ctx.font = "700 21px " + MONO; ctx.fillStyle = MINT;
    ctx.fillText("● FRIEND DEBT PORTFOLIO — UNREALIZED", 124, 218);
    ctx.font = "700 104px " + MONO; ctx.fillStyle = CORAL;
    ctx.shadowColor = "rgba(255,107,94,0.35)"; ctx.shadowBlur = 30;
    ctx.fillText("-" + money(total) + " USDC", 118, 306);
    ctx.shadowBlur = 0;
    ctx.font = "400 27px " + SANS; ctx.fillStyle = "rgba(243,234,217,0.62)";
    ctx.fillText("the boys are farming you as exit liquidity.", 124, 376);

    // bag rows
    var y = 452, rowH = Math.min(64, 250 / Math.max(bags.length, 1) + 22);
    bags.slice(0, 6).forEach(function (b) {
      ctx.font = "700 27px " + MONO; ctx.fillStyle = "rgba(243,234,217,0.88)";
      ctx.fillText((b.who + "").toUpperCase().slice(0, 14) + "/USDC", 124, y);
      ctx.fillStyle = CORAL; ctx.fillText("-" + money(b.amt), 640, y);
      ctx.font = "400 24px " + MONO; ctx.fillStyle = "rgba(243,234,217,0.40)";
      ctx.fillText("held " + (b.days || 0) + " day" + (b.days === 1 ? "" : "s"), 920, y);
      ctx.fillStyle = (b.days || 0) >= 90 ? CORAL : "rgba(243,234,217,0.40)";
      ctx.fillText((b.days || 0) >= 90 ? "▼ DOWN BAD" : "▼ down", 1230, y);
      y += rowH;
    });

    // worst bag callout
    if (worst) {
      ctx.font = "700 23px " + MONO; ctx.fillStyle = "#FFC65C";
      ctx.fillText("WORST BAG: " + (worst.who + "").toUpperCase() + " — " + (worst.days || 0) + " days. no chart. no exit. just vibes.", 124, Math.max(y + 14, 738));
    }

    // footer
    ctx.font = "400 20px " + MONO; ctx.fillStyle = "rgba(243,234,217,0.38)";
    ctx.fillText("recovery protocol → divvysol.com   ·   no token. just settled tabs.", 124, H - 42);
  }

  // ── UI ──────────────────────────────────────────────────────────────────────
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function rowEl(bag) {
    var r = el("div", "row");
    var who = el("input"); who.placeholder = "who"; who.maxLength = 14; who.value = bag.who;
    var amt = el("input"); amt.type = "number"; amt.min = "0"; amt.placeholder = "$"; amt.value = bag.amt;
    var days = el("input"); days.type = "number"; days.min = "0"; days.placeholder = "days"; days.value = bag.days;
    var x = el("button", "x", "✕"); x.type = "button"; x.title = "remove";
    who.addEventListener("input", function () { bag.who = who.value; });
    amt.addEventListener("input", function () { bag.amt = Number(amt.value) || 0; });
    days.addEventListener("input", function () { bag.days = Math.round(Number(days.value)) || 0; });
    x.addEventListener("click", function () {
      state.bags = state.bags.filter(function (b) { return b !== bag; });
      r.remove(); render();
    });
    [who, amt, days, x].forEach(function (c) { r.appendChild(c); });
    return r;
  }

  function drawRows() {
    var host = document.getElementById("rows");
    host.innerHTML = "";
    state.bags.forEach(function (b) { host.appendChild(rowEl(b)); });
  }

  function toDataURL() { return canvas.toDataURL("image/png"); }
  function toBlob(cb) { canvas.toBlob(cb, "image/png"); }
  function fileName() { return "friend-debt-portfolio.png"; }

  function downloadPng() {
    toBlob(function (blob) {
      if (!blob) { window.open(toDataURL(), "_blank"); return; }
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = fileName();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
  }

  function tweetUrl() {
    var total = state.bags.reduce(function (s, b) { return s + Number(b.amt || 0); }, 0);
    return "https://twitter.com/intent/tweet?text=" + encodeURIComponent(
      "portfolio update: down " + money(total) + " on the boys. unrealized. 💀\n\ndivvysol.com/bags");
  }

  function share() {
    toBlob(function (blob) {
      var f = blob && new File([blob], fileName(), { type: "image/png" });
      if (f && navigator.canShare && navigator.canShare({ files: [f] })) {
        navigator.share({ files: [f], text: "my friend debt portfolio 💀 divvysol.com/bags" }).catch(function () { });
      } else downloadPng();
    });
  }

  function boot() {
    canvas = document.getElementById("bagCanvas");
    ctx = canvas.getContext("2d");
    drawRows();
    document.getElementById("addRow").addEventListener("click", function () {
      if (state.bags.length >= 6) return;
      var b = { who: "", amt: 0, days: 0 };
      state.bags.push(b);
      document.getElementById("rows").appendChild(rowEl(b));
    });
    document.getElementById("render").addEventListener("click", render);
    document.getElementById("download").addEventListener("click", downloadPng);
    document.getElementById("share").addEventListener("click", share);
    document.getElementById("tweet").addEventListener("click", function () { window.open(tweetUrl(), "_blank"); });

    var img = new Image();
    img.onload = function () { frogImg = img; render(); };
    img.onerror = function () { render(); };
    img.src = "data:image/svg+xml," + encodeURIComponent(frogSvg());

    if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.BagsLab = { render: render, toDataURL: function () { return canvas ? toDataURL() : null; }, state: state };
})();
