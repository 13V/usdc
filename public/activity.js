/* Divvy — Activity: a reverse-chron feed of recent events.
   Renders into #activity. Exposes window.Activity = { show }.

   Requires a signed-in user (Auth.authFetch attaches the Bearer token).
   Backend API contract:
     GET /api/activity
       -> [{ type, tripId, tripName, text, amountFmt?, at }]   (newest first)
*/
(function () {
  "use strict";

  const root = () => document.getElementById("activity");

  function authUser() { return (window.Auth && window.Auth.user) || null; }
  function authFetchFn() {
    return (window.Auth && window.Auth.authFetch) ? window.Auth.authFetch : fetch;
  }

  // ── helpers ────────────────────────────────────────────────────────────────
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

  async function api(path, opts) {
    opts = opts || {};
    const reqOpts = Object.assign({ headers: { "content-type": "application/json" } }, opts);
    const res = await authFetchFn()(path, reqOpts);
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

  // Short relative timestamp: "just now", "5m", "3h", "2d", else a short date.
  function relTime(at) {
    if (at == null || at === "") return "";
    const then = new Date(at).getTime();
    if (!isFinite(then)) return esc(String(at));
    const diff = Date.now() - then;
    if (diff < 0) return "just now";
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return min + "m";
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h";
    const day = Math.floor(hr / 24);
    if (day < 7) return day + "d";
    try {
      return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch (_) {
      return day + "d";
    }
  }

  // Day bucket key + label for grouping the feed by date.
  function dayKey(at) {
    const t = new Date(at).getTime();
    if (!isFinite(t)) return "";
    const d = new Date(t);
    return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
  }
  function dayLabel(at) {
    const t = new Date(at).getTime();
    if (!isFinite(t)) return "EARLIER";
    const d = new Date(t);
    const today = new Date();
    const yest = new Date(); yest.setDate(today.getDate() - 1);
    if (dayKey(d) === dayKey(today)) return "TODAY";
    if (dayKey(d) === dayKey(yest)) return "YESTERDAY";
    try {
      return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
    } catch (_) {
      return "EARLIER";
    }
  }

  // Infer a money-rule color from a formatted amount string.
  // Leading "-" / "owe" => you owe (terra). "+" / "paid" / plain positive => accent.
  function amountColor(amountFmt) {
    const s = String(amountFmt || "").trim().toLowerCase();
    if (!s) return "var(--cream)";
    if (/^[-−]/.test(s) || /\bowe/.test(s)) return "var(--terra)";
    return "var(--accent)";
  }

  // Pick a leading glyph + (optional) on-chain state chip from the event type.
  // Type strings are best-effort; unknown types fall back to a neutral dot.
  function eventVisual(type) {
    const t = String(type || "").toLowerCase();
    if (/settl|paid|payment|pay/.test(t))
      return { glyph: "↗", chip: "settled", chipLabel: "SETTLED" };
    if (/final/.test(t))
      return { glyph: "✓", chip: "finalized", chipLabel: "FINALIZED" };
    if (/confirm|chain|tx|onchain/.test(t))
      return { glyph: "⛓", chip: "confirmed", chipLabel: "CONFIRMED" };
    if (/expense|bill|add|charge/.test(t))
      return { glyph: "＋", chip: null, chipLabel: "" };
    if (/join|member|invite/.test(t))
      return { glyph: "◍", chip: null, chipLabel: "" };
    if (/trip|create|new/.test(t))
      return { glyph: "✦", chip: null, chipLabel: "" };
    return { glyph: "•", chip: null, chipLabel: "" };
  }

  // ── signed-out state ─────────────────────────────────────────────────────────
  function renderSignedOut() {
    const c = root();
    if (!c) return;
    c.innerHTML = "";
    const box = el(`
      <div class="empty">
        <div class="empty-glyph">◎</div>
        <p class="empty-title">Sign in to see your activity</p>
        <p class="empty-hint">Connect a wallet to see recent expenses, payments, and IOUs.</p>
        <button id="aSignIn" class="btn" type="button" style="margin-top:16px">Connect wallet</button>
        <div id="aSignInMsg" class="eyebrow" style="margin-top:10px"></div>
      </div>
    `);
    c.appendChild(box);
    const btn = box.querySelector("#aSignIn");
    const msg = box.querySelector("#aSignInMsg");
    btn.onclick = async () => {
      if (!(window.Auth && typeof window.Auth.signInWithWallet === "function")) {
        msg.textContent = "Sign-in is unavailable right now.";
        return;
      }
      msg.textContent = "Connecting…";
      try {
        await window.Auth.signInWithWallet();
        // Auth.onChange -> onAuthChange re-renders once signed in.
      } catch (err) {
        msg.textContent = err.message || "Couldn't connect.";
      }
    };
  }

  // A loading placeholder: a few shimmer rows.
  function skeletonRows(n) {
    let out = "";
    for (let i = 0; i < (n || 3); i++) {
      out += `
        <div class="row" style="border-bottom:1px solid var(--line)">
          <div class="skeleton" style="width:38px;height:38px;border-radius:999px;flex:0 0 auto"></div>
          <div style="flex:1 1 auto">
            <div class="skeleton" style="height:12px;width:62%;border-radius:6px"></div>
            <div class="skeleton" style="height:10px;width:34%;border-radius:6px;margin-top:8px"></div>
          </div>
          <div class="skeleton" style="height:14px;width:54px;border-radius:6px;flex:0 0 auto"></div>
        </div>`;
    }
    return out;
  }

  // Build one feed row for an activity item.
  function buildRow(it) {
    const vis = eventVisual(it.type);
    const when = relTime(it.at);
    const trip = it.tripName ? `<span class="muted">${esc(it.tripName)}</span>` : "";
    const chip = vis.chip
      ? `<span class="state-chip ${esc(vis.chip)}"><i></i>${esc(vis.chipLabel)}</span>`
      : "";

    const amount = it.amountFmt
      ? `<span class="mono" style="font-weight:600;white-space:nowrap;color:${amountColor(it.amountFmt)}">${esc(it.amountFmt)}</span>`
      : "";

    const sub = [trip, chip].filter(Boolean).join('<span class="faint">·</span>');

    return el(`
      <div class="row" style="cursor:default;border-bottom:1px solid var(--line)">
        <div class="avatar" aria-hidden="true">${esc(vis.glyph)}</div>
        <div class="meta" style="flex:1 1 auto;min-width:0">
          <div style="display:flex;align-items:baseline;gap:8px;justify-content:space-between">
            <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis">${esc(it.text)}</span>
            ${amount}
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:3px">
            <span class="eyebrow" style="margin:0">${esc(when)}</span>
            ${sub}
          </div>
        </div>
      </div>
    `);
  }

  // ── main render ──────────────────────────────────────────────────────────────
  async function render() {
    const c = root();
    if (!c) return;

    if (!authUser()) { renderSignedOut(); return; }

    c.innerHTML = "";
    const view = el(`
      <div>
        <p class="eyebrow" style="margin:0 0 6px">ON-CHAIN ACTIVITY</p>
        <h1 style="font-size:1.6rem;margin:0 0 4px">Activity</h1>
        <p class="tag muted" style="margin:0 0 14px">Recent expenses, payments, and IOUs across your trips.</p>
        <div id="aList">${skeletonRows(3)}</div>
      </div>
    `);
    c.appendChild(view);

    const list = view.querySelector("#aList");
    let items;
    try {
      items = await api("/api/activity");
    } catch (err) {
      if (err && err.status === 401) { renderSignedOut(); return; }
      list.innerHTML = `
        <div class="empty">
          <div class="empty-glyph">⚠</div>
          <p class="empty-title">Couldn't load activity</p>
          <p class="empty-hint">Check your connection and try again.</p>
        </div>`;
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      list.innerHTML = `
        <div class="empty">
          <div class="empty-glyph">🧾</div>
          <p class="empty-title">No activity yet</p>
          <p class="empty-hint">Add an expense or settle up — your feed of on-chain receipts shows up here.</p>
        </div>`;
      return;
    }

    list.innerHTML = "";

    // Group consecutive items by day with a small mono date header.
    let lastDay = null;
    for (const it of items) {
      const key = dayKey(it.at);
      if (key !== lastDay) {
        lastDay = key;
        const header = el(`
          <p class="eyebrow" style="margin:18px 0 4px">${esc(dayLabel(it.at))}</p>
        `);
        list.appendChild(header);
      }
      list.appendChild(buildRow(it));
    }
  }

  // ── public API ───────────────────────────────────────────────────────────────
  function show() {
    render();
  }

  window.Activity = { show };

  function onAuthChange() {
    const c = root();
    if (!c || c.style.display === "none") return; // not visible — nothing to redraw
    render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!root()) return;
    if (window.Auth && typeof window.Auth.onChange === "function") {
      window.Auth.onChange(onAuthChange);
    }
  });
})();
