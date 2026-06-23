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

  // ── signed-out state ─────────────────────────────────────────────────────────
  function renderSignedOut() {
    const c = root();
    if (!c) return;
    c.innerHTML = "";
    const box = el(`
      <div style="border:1px solid #8884; border-radius:12px; padding:16px; text-align:center">
        <p style="margin:0 0 4px; font-weight:600">Sign in to see your activity</p>
        <p class="muted" style="margin:0 0 12px">Connect a wallet to see recent expenses, payments, and IOUs.</p>
        <button id="aSignIn" class="connect" type="button" style="margin:0">Connect wallet</button>
        <div id="aSignInMsg" class="muted" style="margin-top:8px"></div>
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

  // ── main render ──────────────────────────────────────────────────────────────
  async function render() {
    const c = root();
    if (!c) return;

    if (!authUser()) { renderSignedOut(); return; }

    c.innerHTML = "";
    const view = el(`
      <div>
        <h1 style="font-size:1.4rem">Activity</h1>
        <p class="tag">Recent expenses, payments, and IOUs across your trips.</p>
        <div id="aList"><p class="muted">Loading…</p></div>
      </div>
    `);
    c.appendChild(view);

    const list = view.querySelector("#aList");
    let items;
    try {
      items = await api("/api/activity");
    } catch (err) {
      if (err && err.status === 401) { renderSignedOut(); return; }
      list.innerHTML = '<p class="muted">Couldn\'t load activity.</p>';
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      list.innerHTML = '<p class="muted">No activity yet.</p>';
      return;
    }

    list.innerHTML = "";
    for (const it of items) {
      const amount = it.amountFmt
        ? `<span class="badge">${esc(it.amountFmt)}</span>`
        : "";
      const when = relTime(it.at);
      const trip = it.tripName
        ? `<span class="muted">${esc(it.tripName)}</span>`
        : "<span></span>";
      const row = el(`
        <div class="hist-item" style="cursor:default">
          <div class="top">
            <span>${esc(it.text)}</span>
            <span>${amount}</span>
          </div>
          <div class="sub muted">
            ${trip}
            <span>${esc(when)}</span>
          </div>
        </div>
      `);
      list.appendChild(row);
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
