/* Divvy — Recurring: a tab for recurring trip expenses.
   Renders into #recurring. Exposes window.Recurring = { show }.

   Requires a signed-in user (Auth.authFetch attaches the Bearer token).
   Backend API contract:
     GET    /api/recurring
       -> [{ id, tripId, tripName, title, amountCals?, amountFmt, paidBy,
              participants, interval, nextDue, createdAt }]
     POST   /api/recurring   { tripId, title, total, paidBy, participants, interval }
     DELETE /api/recurring/:id
     GET    /api/trips?mine=1 -> [{ id, name, members:[{id,name,...}] }]  (via Auth.authFetch)
*/
(function () {
  "use strict";

  const root = () => document.getElementById("recurring");

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

  // Short date for display: "Jun 23" style, tolerant of bad input.
  function shortDate(v) {
    if (!v) return "—";
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    try {
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch (_) {
      return d.toISOString().slice(0, 10);
    }
  }

  // JSON helper over Auth.authFetch. Throws Error(message).status on non-2xx.
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

  // ── signed-out state ─────────────────────────────────────────────────────────
  function renderSignedOut() {
    const c = root();
    if (!c) return;
    c.innerHTML = "";
    const box = el(`
      <div style="border:1px solid #8884; border-radius:12px; padding:16px; text-align:center">
        <p style="margin:0 0 4px; font-weight:600">Sign in to manage recurring splits</p>
        <p class="muted" style="margin:0 0 12px">Connect a wallet to set up rent, subscriptions, and other repeating expenses.</p>
        <button id="rSignIn" class="connect" type="button" style="margin:0">Connect wallet</button>
        <div id="rSignInMsg" class="muted" style="margin-top:8px"></div>
      </div>
    `);
    c.appendChild(box);
    const btn = box.querySelector("#rSignIn");
    const msg = box.querySelector("#rSignInMsg");
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
  // Trips cache for the picker (loaded lazily when the form opens). Each entry:
  // { id, name, members:[{id,name}] }.
  let myTrips = [];

  async function render() {
    const c = root();
    if (!c) return;

    if (!authUser()) { renderSignedOut(); return; }

    c.innerHTML = "";
    const view = el(`
      <div>
        <h1 style="font-size:1.4rem">Recurring</h1>
        <p class="tag">Rent, subscriptions, the weekly grocery run — set it once and Divvy adds the expense to the trip automatically each period.</p>

        <div id="rNewWrap" style="border:1px solid #8884; border-radius:12px; padding:0 14px 14px; margin-bottom:14px;">
          <button id="rNewToggle" class="toggle-link" type="button">＋ New recurring</button>
          <div id="rNewForm" style="display:none">
            <label>Trip</label>
            <select id="rTrip"><option value="">Loading your trips…</option></select>

            <label>What's it for?</label>
            <input id="rTitle" placeholder="e.g. Rent" />

            <label>Amount ($)</label>
            <input id="rAmount" type="number" step="0.01" placeholder="0.00" />

            <label>How often?</label>
            <select id="rInterval">
              <option value="weekly">Weekly</option>
              <option value="monthly" selected>Monthly</option>
            </select>

            <label>Paid by</label>
            <select id="rPaidBy"><option value="">Pick a trip first</option></select>

            <label>Split among</label>
            <div id="rParts" class="chips"><span class="muted">Pick a trip first.</span></div>

            <button id="rSave">Add recurring split</button>
            <div id="rStatus" class="muted"></div>
          </div>
        </div>

        <div id="rList"><p class="muted">Loading…</p></div>
      </div>
    `);
    c.appendChild(view);

    view.querySelector("#rNewToggle").onclick = async () => {
      const f = view.querySelector("#rNewForm");
      const open = f.style.display === "none";
      f.style.display = open ? "block" : "none";
      view.querySelector("#rNewToggle").textContent = open ? "＋ New recurring ▴" : "＋ New recurring";
      if (open) await loadTripsIntoPicker();
    };

    const tripSel = view.querySelector("#rTrip");
    tripSel.onchange = () => renderTripMembers(tripSel.value);

    view.querySelector("#rSave").onclick = saveRecurring;

    await loadList();
  }

  // Load the user's trips into the picker (with their members for paid-by/split).
  async function loadTripsIntoPicker() {
    const tripSel = document.getElementById("rTrip");
    if (!tripSel) return;
    try {
      const trips = await api("/api/trips?mine=1");
      myTrips = Array.isArray(trips) ? trips : [];
    } catch (err) {
      myTrips = [];
      tripSel.innerHTML = '<option value="">Couldn\'t load trips</option>';
      return;
    }
    if (myTrips.length === 0) {
      tripSel.innerHTML = '<option value="">No trips yet — create one first</option>';
      renderTripMembers("");
      return;
    }
    tripSel.innerHTML = '<option value="">— pick a trip —</option>' +
      myTrips.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
    renderTripMembers("");
  }

  function tripById(id) {
    return myTrips.find((t) => String(t.id) === String(id)) || null;
  }

  // Render the paid-by select and participant chips for the chosen trip's members.
  function renderTripMembers(tripId) {
    const paidBy = document.getElementById("rPaidBy");
    const parts = document.getElementById("rParts");
    if (!paidBy || !parts) return;
    const trip = tripById(tripId);
    const members = (trip && Array.isArray(trip.members)) ? trip.members : [];
    if (!trip || members.length === 0) {
      paidBy.innerHTML = '<option value="">Pick a trip first</option>';
      parts.innerHTML = '<span class="muted">Pick a trip first.</span>';
      return;
    }
    paidBy.innerHTML = members.map((m) =>
      `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("");
    parts.innerHTML = "";
    // Default: everyone is a participant.
    for (const m of members) {
      const chip = el(`<button type="button" class="chip selected" data-mid="${esc(m.id)}">${esc(m.name)}</button>`);
      chip.onclick = () => chip.classList.toggle("selected");
      parts.appendChild(chip);
    }
  }

  async function saveRecurring() {
    const status = document.getElementById("rStatus");
    const tripId = (document.getElementById("rTrip").value || "").trim();
    const title = (document.getElementById("rTitle").value || "").trim();
    const total = Number(document.getElementById("rAmount").value);
    const interval = document.getElementById("rInterval").value;
    const paidBy = (document.getElementById("rPaidBy").value || "").trim();
    const participants = Array.from(document.querySelectorAll("#rParts .chip.selected"))
      .map((chip) => chip.getAttribute("data-mid"));

    if (!tripId) { status.textContent = "Pick a trip."; return; }
    if (!title) { status.textContent = "What's it for?"; return; }
    if (!(total > 0)) { status.textContent = "Enter an amount."; return; }
    if (!paidBy) { status.textContent = "Who pays?"; return; }
    if (participants.length === 0) { status.textContent = "Pick at least one person to split among."; return; }

    status.textContent = "Saving…";
    try {
      await api("/api/recurring", {
        method: "POST",
        body: JSON.stringify({ tripId, title, total, paidBy, participants, interval }),
      });
      render(); // re-render on success (resets the form + refreshes the list)
    } catch (err) {
      status.textContent = err.message || "Couldn't add recurring split.";
    }
  }

  // ── list ─────────────────────────────────────────────────────────────────────
  async function loadList() {
    const wrap = document.getElementById("rList");
    if (!wrap) return;
    let items;
    try {
      const raw = await api("/api/recurring");
      // Backend returns { rules: [...] }; tolerate a bare array too.
      items = Array.isArray(raw) ? raw : (raw && raw.rules) || [];
    } catch (err) {
      if (err && err.status === 401) { renderSignedOut(); return; }
      wrap.innerHTML = '<p class="muted">Couldn\'t load recurring splits.</p>';
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      wrap.innerHTML = '<p class="muted">No recurring splits yet. Add one above.</p>';
      return;
    }
    wrap.innerHTML = "";
    wrap.appendChild(el('<h1 style="font-size:1.05rem; margin-top:6px">Your recurring splits</h1>'));
    for (const it of items) {
      wrap.appendChild(renderItem(it));
    }
  }

  function renderItem(it) {
    const summary =
      esc(it.title) + " — " + esc(it.amountFmt || "") +
      " · " + esc(it.interval || "") +
      " · next " + esc(shortDate(it.nextDue)) +
      " · " + esc(it.tripName || "");
    const row = el(`
      <div class="person" style="flex-wrap:wrap">
        <div class="meta">
          <div class="amt" style="font-size:1rem">${summary}</div>
          <div class="muted">Added to ${esc(it.tripName || "the trip")} automatically each ${esc(it.interval || "period")}.</div>
        </div>
        <button class="chip rDel" type="button" style="margin:0" aria-label="Delete">✕</button>
      </div>
    `);
    row.querySelector(".rDel").onclick = async () => {
      if (!confirm("Delete this recurring split?")) return;
      try {
        await api("/api/recurring/" + encodeURIComponent(it.id), { method: "DELETE" });
        render();
      } catch (err) {
        alert(err.message || "Couldn't delete recurring split.");
      }
    };
    return row;
  }

  // ── public API ───────────────────────────────────────────────────────────────
  function show() {
    render();
  }

  window.Recurring = { show };

  // Re-render when sign-in state changes (so the signed-out prompt and the list
  // stay in sync), but only when the tab is actually visible.
  function onAuthChange() {
    const c = root();
    if (!c || c.style.display === "none") return;
    render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!root()) return; // integrator hasn't added the #recurring container — no-op
    if (window.Auth && typeof window.Auth.onChange === "function") {
      window.Auth.onChange(onAuthChange);
    }
  });
})();
