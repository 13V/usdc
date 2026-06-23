/* Divvy — Trips: shared multi-payer ledger + settle-up.
   Renders into #trips. Exposes window.Trips = { show, openShared }.
   Backend API contract (see app spec):
     POST   /api/trips
     GET    /api/trips
     GET    /api/trips/:idOrToken
     POST   /api/trips/:id/members
     PATCH  /api/trips/:id/members/:mid
     POST   /api/trips/:id/expenses
     DELETE /api/trips/:id/expenses/:eid
     POST   /api/trips/:id/settle
     POST   /api/trips/:id/settle/verify
*/
(function () {
  "use strict";

  const WALLET_KEY = "divvy.collector";
  const root = () => document.getElementById("trips");

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
    const res = await fetch(path, Object.assign({ headers: { "content-type": "application/json" } }, opts || {}));
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok) {
      const msg = (data && data.error) || ("Request failed (" + res.status + ")");
      throw new Error(msg);
    }
    return data;
  }

  function qrSrc(url) {
    return "https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=" + encodeURIComponent(url);
  }

  function meKey(tripId) { return "divvy.trip." + tripId + ".me"; }

  // FX currencies mirror the existing converter in index.html.
  const FX_CURRENCIES = ["USD", "EUR", "GBP", "THB", "IDR", "JPY", "AUD", "VND", "MXN", "INR", "TRY"];

  // ── view: LIST ───────────────────────────────────────────────────────────────
  // Members staged for a brand-new trip (before it exists server-side).
  let newTripMembers = [];

  async function showList() {
    const c = root();
    c.innerHTML = "";

    // seed the first member's wallet from the saved collector wallet ("you").
    if (newTripMembers.length === 0) {
      const saved = (localStorage.getItem(WALLET_KEY) || "").trim();
      newTripMembers = [{ name: "", wallet: saved, you: true }];
    }

    const view = el(`
      <div>
        <h1 style="font-size:1.4rem">Trips</h1>
        <p class="tag">A shared ledger for the whole crew. Anyone pays, everyone settles up in USDC.</p>

        <div id="tNewWrap" style="border:1px solid #8884; border-radius:12px; padding:0 14px 14px; margin-bottom:14px;">
          <button id="tNewToggle" class="toggle-link" type="button">＋ New trip</button>
          <div id="tNewForm" style="display:none">
            <label>Trip name</label>
            <input id="tName" placeholder="e.g. Bali 2026" />

            <label>Members</label>
            <div id="tMembers"></div>
            <button id="tAddMember" class="secondary" type="button" style="margin-top:8px">＋ Add member</button>

            <button id="tCreate">Create trip</button>
            <div id="tCreateStatus" class="muted"></div>
          </div>
        </div>

        <div id="tList"><p class="muted">Loading…</p></div>
      </div>
    `);
    c.appendChild(view);

    document.getElementById("tNewToggle").onclick = () => {
      const f = document.getElementById("tNewForm");
      const open = f.style.display === "none";
      f.style.display = open ? "block" : "none";
      document.getElementById("tNewToggle").textContent = open ? "＋ New trip ▴" : "＋ New trip";
    };

    renderNewMembers();
    document.getElementById("tAddMember").onclick = () => {
      newTripMembers.push({ name: "", wallet: "" });
      renderNewMembers();
    };
    document.getElementById("tCreate").onclick = createTrip;

    await loadTripList();
  }

  function renderNewMembers() {
    const wrap = document.getElementById("tMembers");
    if (!wrap) return;
    wrap.innerHTML = "";
    newTripMembers.forEach((m, i) => {
      const rowEl = el(`
        <div style="border:1px solid #8884; border-radius:10px; padding:10px; margin:8px 0;">
          <div class="row">
            <div>
              <input class="tmName" placeholder="Name${m.you ? " (you)" : ""}" />
            </div>
            <button class="secondary tmDel" type="button" style="margin:0; width:48px; flex:0 0 auto;" aria-label="Remove">✕</button>
          </div>
          <input class="tmWallet" placeholder="Solana wallet (optional)" style="margin-top:8px" />
        </div>
      `);
      const nameI = rowEl.querySelector(".tmName");
      const walletI = rowEl.querySelector(".tmWallet");
      nameI.value = m.name || "";
      walletI.value = m.wallet || "";
      nameI.addEventListener("input", () => { newTripMembers[i].name = nameI.value; });
      walletI.addEventListener("input", () => { newTripMembers[i].wallet = walletI.value; });
      rowEl.querySelector(".tmDel").onclick = () => {
        newTripMembers.splice(i, 1);
        if (newTripMembers.length === 0) newTripMembers.push({ name: "", wallet: "" });
        renderNewMembers();
      };
      wrap.appendChild(rowEl);
    });
  }

  async function createTrip() {
    const name = (document.getElementById("tName").value || "").trim();
    const status = document.getElementById("tCreateStatus");
    const members = newTripMembers
      .map((m) => ({ name: (m.name || "").trim(), wallet: (m.wallet || "").trim() || undefined }))
      .filter((m) => m.name);
    if (!name) { status.textContent = "Give the trip a name."; return; }
    if (members.length === 0) { status.textContent = "Add at least one member."; return; }
    status.textContent = "Creating…";
    try {
      const trip = await api("/api/trips", { method: "POST", body: JSON.stringify({ name, members }) });
      newTripMembers = []; // reset staged members
      showDetail(trip);
    } catch (err) {
      status.textContent = err.message || "Couldn't create trip.";
    }
  }

  async function loadTripList() {
    const list = document.getElementById("tList");
    try {
      const trips = await api("/api/trips");
      if (!Array.isArray(trips) || trips.length === 0) {
        list.innerHTML = '<p class="muted">No trips yet. Start one above.</p>';
        return;
      }
      list.innerHTML = "";
      for (const t of trips) {
        const badge = t.settledUp ? '<span class="badge paid">Settled up ✓</span>' : "";
        const item = el(`
          <div class="hist-item">
            <div class="top"><span>${esc(t.name)}</span><span>${esc(t.totalFmt || "")}</span></div>
            <div class="sub muted">
              <span>${t.memberCount || 0} members · ${t.expenseCount || 0} expenses</span>
              <span>${badge}</span>
            </div>
          </div>
        `);
        item.onclick = () => openTrip(t.id);
        list.appendChild(item);
      }
    } catch (err) {
      list.innerHTML = '<p class="muted">Couldn\'t load trips.</p>';
    }
  }

  async function openTrip(idOrToken) {
    const c = root();
    c.innerHTML = '<p class="muted">Loading trip…</p>';
    try {
      const trip = await api("/api/trips/" + encodeURIComponent(idOrToken));
      showDetail(trip);
    } catch (err) {
      c.innerHTML = '<p class="muted">Couldn\'t load this trip.</p>' +
        '<button class="secondary" id="tBack">Back to trips</button>';
      const b = document.getElementById("tBack");
      if (b) b.onclick = showList;
    }
  }

  // ── view: DETAIL ─────────────────────────────────────────────────────────────
  function showDetail(trip) {
    const c = root();
    c.innerHTML = "";

    const meId = localStorage.getItem(meKey(trip.id)) || "";

    const view = el(`
      <div>
        <button class="toggle-link" id="tBackList" type="button">‹ All trips</button>

        <div class="summary" style="align-items:center; margin-top:4px">
          <h1 style="font-size:1.4rem; margin:0">${esc(trip.name)}</h1>
          <button id="tShare" class="chip" type="button" style="margin:0">Share</button>
        </div>
        <div id="tShareNote" class="muted" style="display:none">Link copied</div>
        <div class="summary muted"><span>${esc(trip.totalFmt || "")} total</span><span></span></div>

        <h1 style="font-size:1.05rem; margin-top:18px">Balances</h1>
        <label style="margin-top:4px">Who am I?</label>
        <select id="tMe"></select>
        <div id="tBalances"></div>

        <h1 style="font-size:1.05rem; margin-top:18px">Members</h1>
        <div id="tMemberList"></div>
        <div id="tAddMemberBox" style="border:1px solid #8884; border-radius:12px; padding:0 14px 14px; margin-top:10px;">
          <button id="tAddMemberToggle" class="toggle-link" type="button">＋ Add member ▾</button>
          <div id="tAddMemberForm" style="display:none">
            <label>Name</label>
            <input id="tNewMemberName" placeholder="Name" />
            <label>Wallet (optional)</label>
            <input id="tNewMemberWallet" placeholder="Solana wallet" />
            <button id="tNewMemberSave" class="secondary">Add member</button>
            <div id="tNewMemberStatus" class="muted"></div>
          </div>
        </div>

        <h1 style="font-size:1.05rem; margin-top:18px">Add an expense</h1>
        <label>What's it for?</label>
        <input id="tExpTitle" placeholder="e.g. Hotel" />

        <div class="row">
          <div>
            <label>Amount ($)</label>
            <input id="tExpTotal" type="number" step="0.01" placeholder="0.00" />
          </div>
          <div style="flex:0 0 110px">
            <label>Currency</label>
            <select id="tExpCur"></select>
          </div>
        </div>
        <button id="tExpConvert" class="secondary" type="button" style="display:none">Convert to USD</button>
        <div id="tExpFxStatus" class="muted"></div>

        <label>Paid by</label>
        <select id="tExpPaidBy"></select>

        <label>Split among</label>
        <div id="tExpParts" class="chips"></div>

        <button id="tExpAdd">Add expense</button>
        <div id="tExpStatus" class="muted"></div>

        <h1 style="font-size:1.05rem; margin-top:18px">Expenses</h1>
        <div id="tExpList"></div>

        <h1 style="font-size:1.05rem; margin-top:18px">Settle up</h1>
        <div id="tSettleArea"></div>
        <button id="tSettleBtn">Settle up</button>
      </div>
    `);
    c.appendChild(view);

    document.getElementById("tBackList").onclick = showList;

    // Share button: native share with clipboard fallback.
    document.getElementById("tShare").onclick = async () => {
      const url = location.origin + (trip.shareUrlPath || ("/t/" + trip.shareToken));
      try {
        if (navigator.share) {
          await navigator.share({ title: trip.name, url });
          return;
        }
      } catch (_) { /* user cancelled or share failed — fall through to copy */ }
      try {
        await navigator.clipboard.writeText(url);
      } catch (_) {
        // last-resort fallback
        const ta = document.createElement("textarea");
        ta.value = url; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(ta);
      }
      const note = document.getElementById("tShareNote");
      note.style.display = "block";
      setTimeout(() => { note.style.display = "none"; }, 2500);
    };

    // Currency select (mirrors existing converter).
    const curSel = document.getElementById("tExpCur");
    curSel.innerHTML = FX_CURRENCIES.map((c2) =>
      `<option value="${c2}"${c2 === "USD" ? " selected" : ""}>${c2}</option>`).join("");
    let pendingFx = null;
    const convertBtn = document.getElementById("tExpConvert");
    curSel.onchange = () => {
      convertBtn.style.display = curSel.value === "USD" ? "none" : "block";
      if (curSel.value === "USD") { pendingFx = null; document.getElementById("tExpFxStatus").textContent = ""; }
    };
    document.getElementById("tExpTotal").addEventListener("input", () => { pendingFx = null; });
    convertBtn.onclick = async () => {
      const cur = curSel.value;
      const amount = Number(document.getElementById("tExpTotal").value);
      const fxStatus = document.getElementById("tExpFxStatus");
      if (cur === "USD") { fxStatus.textContent = "Already in USD."; return; }
      if (!(amount > 0)) { fxStatus.textContent = "Enter an amount to convert."; return; }
      fxStatus.textContent = "Converting…";
      try {
        const data = await api("/api/fx/" + encodeURIComponent(cur) + "/" + encodeURIComponent(amount));
        document.getElementById("tExpTotal").value = (data.usdCents / 100).toFixed(2);
        pendingFx = {
          sourceCurrency: data.from, sourceAmount: data.amount,
          rate: data.rate, asOf: data.asOf, source: data.source,
        };
        fxStatus.textContent =
          data.amount + " " + data.from + " ≈ " + data.usdFmt +
          "  ·  1 " + data.from + " = $" + data.rate + ", as of " + data.asOf + " — rate locked.";
      } catch (err) {
        fxStatus.textContent = "Conversion failed — enter USD manually.";
      }
    };

    // Members and "paid by" / participants depend on the member set.
    renderMembersInDetail(trip);
    renderBalances(trip, meId);
    renderMeSelector(trip, meId);
    renderExpenseControls(trip);
    renderExpenseList(trip);
    renderSettle(trip);

    // Add member (server-side PATCH/POST).
    document.getElementById("tAddMemberToggle").onclick = () => {
      const f = document.getElementById("tAddMemberForm");
      const open = f.style.display === "none";
      f.style.display = open ? "block" : "none";
      document.getElementById("tAddMemberToggle").textContent = open ? "＋ Add member ▴" : "＋ Add member ▾";
    };
    document.getElementById("tNewMemberSave").onclick = async () => {
      const name = (document.getElementById("tNewMemberName").value || "").trim();
      const wallet = (document.getElementById("tNewMemberWallet").value || "").trim();
      const status = document.getElementById("tNewMemberStatus");
      if (!name) { status.textContent = "Enter a name."; return; }
      status.textContent = "Adding…";
      try {
        const body = { name };
        if (wallet) body.wallet = wallet;
        const updated = await api("/api/trips/" + trip.id + "/members",
          { method: "POST", body: JSON.stringify(body) });
        showDetail(updated);
      } catch (err) {
        status.textContent = err.message || "Couldn't add member.";
      }
    };

    // Add expense.
    document.getElementById("tExpAdd").onclick = async () => {
      const status = document.getElementById("tExpStatus");
      const title = (document.getElementById("tExpTitle").value || "").trim();
      const total = Number(document.getElementById("tExpTotal").value);
      const paidBy = document.getElementById("tExpPaidBy").value;
      const parts = Array.from(document.querySelectorAll("#tExpParts .chip.selected"))
        .map((chip) => chip.getAttribute("data-mid"));
      if (!title) { status.textContent = "What's the expense for?"; return; }
      if (!(total > 0)) { status.textContent = "Enter an amount."; return; }
      if (!paidBy) { status.textContent = "Who paid?"; return; }
      if (parts.length === 0) { status.textContent = "Pick at least one person to split among."; return; }
      status.textContent = "Adding…";
      try {
        const body = { title, total, paidBy, participants: parts };
        if (pendingFx) body.fx = pendingFx;
        const updated = await api("/api/trips/" + trip.id + "/expenses",
          { method: "POST", body: JSON.stringify(body) });
        showDetail(updated);
      } catch (err) {
        status.textContent = err.message || "Couldn't add expense.";
      }
    };

    // Settle up.
    document.getElementById("tSettleBtn").onclick = async () => {
      const area = document.getElementById("tSettleArea");
      area.innerHTML = '<p class="muted">Computing settle-up…</p>';
      try {
        const updated = await api("/api/trips/" + trip.id + "/settle", { method: "POST" });
        showDetail(updated);
      } catch (err) {
        area.innerHTML = '<p class="muted">' + esc(err.message || "Couldn't settle up.") + "</p>";
      }
    };
  }

  function renderMeSelector(trip, meId) {
    const sel = document.getElementById("tMe");
    sel.innerHTML = '<option value="">— not set —</option>' +
      trip.members.map((m) => `<option value="${esc(m.id)}"${m.id === meId ? " selected" : ""}>${esc(m.name)}</option>`).join("");
    sel.onchange = () => {
      if (sel.value) localStorage.setItem(meKey(trip.id), sel.value);
      else localStorage.removeItem(meKey(trip.id));
      renderBalances(trip, sel.value);
    };
  }

  function renderBalances(trip, meId) {
    const wrap = document.getElementById("tBalances");
    wrap.innerHTML = "";
    const balances = trip.balances || [];
    if (balances.length === 0) {
      wrap.innerHTML = '<p class="muted">No balances yet — add an expense.</p>';
      return;
    }
    for (const b of balances) {
      const mine = b.memberId === meId;
      let text, color;
      if (b.direction === "owed") {
        text = mine ? "You're owed " + b.fmt : esc(b.name) + " is owed " + b.fmt;
        color = "var(--green)";
      } else if (b.direction === "owes") {
        text = mine ? "You owe " + b.fmt : esc(b.name) + " owes " + b.fmt;
        color = "inherit";
      } else {
        text = (mine ? "You're" : esc(b.name) + " is") + " settled";
        color = "#888";
      }
      const row = el(`
        <div class="person" style="${mine ? "border-color:var(--green);" : ""}">
          <div class="meta"><div class="amt" style="color:${color}">${text}</div></div>
        </div>
      `);
      wrap.appendChild(row);
    }
  }

  function renderMembersInDetail(trip) {
    const wrap = document.getElementById("tMemberList");
    wrap.innerHTML = "";
    for (const m of trip.members) {
      const hasWallet = !!m.wallet;
      const row = el(`
        <div class="person" style="flex-wrap:wrap">
          <div class="meta">
            <div class="amt" style="font-size:1rem">${esc(m.name)}</div>
            <div class="muted tWalletShow">${hasWallet ? esc(m.wallet) : "No wallet set — needed to receive settle-up."}</div>
          </div>
          <button class="chip tWalletEdit" type="button" style="margin:0">${hasWallet ? "Edit wallet" : "Set wallet"}</button>
          <div class="tWalletForm" style="display:none; width:100%">
            <input class="tWalletInput" placeholder="Solana wallet" style="margin-top:8px" />
            <button class="secondary tWalletSave" type="button">Save wallet</button>
            <div class="muted tWalletStatus"></div>
          </div>
        </div>
      `);
      const form = row.querySelector(".tWalletForm");
      const input = row.querySelector(".tWalletInput");
      input.value = m.wallet || "";
      row.querySelector(".tWalletEdit").onclick = () => {
        form.style.display = form.style.display === "none" ? "block" : "none";
      };
      row.querySelector(".tWalletSave").onclick = async () => {
        const wallet = (input.value || "").trim();
        const status = row.querySelector(".tWalletStatus");
        status.textContent = "Saving…";
        try {
          const updated = await api("/api/trips/" + trip.id + "/members/" + m.id,
            { method: "PATCH", body: JSON.stringify({ wallet }) });
          showDetail(updated);
        } catch (err) {
          status.textContent = err.message || "Couldn't save wallet.";
        }
      };
      wrap.appendChild(row);
    }
  }

  function renderExpenseControls(trip) {
    const paidBy = document.getElementById("tExpPaidBy");
    paidBy.innerHTML = trip.members.map((m) =>
      `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("");

    const parts = document.getElementById("tExpParts");
    parts.innerHTML = "";
    for (const m of trip.members) {
      const chip = el(`<button type="button" class="chip selected" data-mid="${esc(m.id)}">${esc(m.name)}</button>`);
      chip.onclick = () => chip.classList.toggle("selected");
      parts.appendChild(chip);
    }
  }

  function renderExpenseList(trip) {
    const wrap = document.getElementById("tExpList");
    wrap.innerHTML = "";
    const expenses = trip.expenses || [];
    if (expenses.length === 0) {
      wrap.innerHTML = '<p class="muted">No expenses yet.</p>';
      return;
    }
    for (const e of expenses) {
      const names = (e.participantNames || []).map(esc).join(", ");
      const fxLine = e.fxNote ? `<div class="muted" style="margin-top:4px">${esc(e.fxNote)}</div>` : "";
      const row = el(`
        <div class="hist-item" style="cursor:default">
          <div class="top"><span>${esc(e.title)}</span><span>${esc(e.amountFmt)}</span></div>
          <div class="sub muted"><span>paid by ${esc(e.paidByName)}</span>
            <button class="chip tExpDel" type="button" style="margin:0" aria-label="Delete">✕</button></div>
          <div class="muted" style="margin-top:4px">split among ${names}</div>
          ${fxLine}
        </div>
      `);
      row.querySelector(".tExpDel").onclick = async () => {
        if (!confirm('Delete "' + e.title + '"?')) return;
        try {
          const updated = await api("/api/trips/" + trip.id + "/expenses/" + e.id, { method: "DELETE" });
          showDetail(updated);
        } catch (err) {
          alert(err.message || "Couldn't delete expense.");
        }
      };
      wrap.appendChild(row);
    }
  }

  function renderSettle(trip) {
    const area = document.getElementById("tSettleArea");
    const settleBtn = document.getElementById("tSettleBtn");
    const settle = trip.settle;
    if (!settle) {
      area.innerHTML = '<p class="muted">When you\'re ready, compute who pays whom — minimised transfers, in USDC.</p>';
      if (settleBtn) settleBtn.textContent = "Settle up";
      return;
    }

    if (settleBtn) settleBtn.textContent = "Re-compute settle-up";

    if (settle.allPaid) {
      area.innerHTML = '<div class="badge paid" style="font-size:.9rem; padding:8px 12px; display:inline-block">✓ Settled — everyone paid</div>';
      return;
    }

    area.innerHTML = "";
    const transfers = settle.transfers || [];
    if (transfers.length === 0) {
      area.innerHTML = '<p class="muted">Nothing to settle — balances are even.</p>';
      return;
    }

    for (const t of transfers) {
      let inner;
      if (t.needsWallet) {
        inner = `
          <div class="meta">
            <div class="amt">${esc(t.fromName)} → ${esc(t.toName)} ${esc(t.amountFmt)}</div>
            <div class="muted">needs ${esc(t.toName)}'s wallet — set it in Members above.</div>
          </div>
          <span class="badge">needs wallet</span>`;
      } else if (t.url) {
        inner = `
          <img src="${qrSrc(t.url)}" alt="QR" style="width:120px;height:120px;border-radius:6px" />
          <div class="meta">
            <div class="amt">${esc(t.fromName)} → ${esc(t.toName)} ${esc(t.amountFmt)}</div>
            <a href="${esc(t.url)}" target="_blank" rel="noopener">Open in wallet</a>
            ${t.reference ? `<div class="muted" style="word-break:break-all">ref ${esc(t.reference)}</div>` : ""}
          </div>
          <span class="badge ${t.paid ? "paid" : ""}">${t.paid ? "✓ paid" : "unpaid"}</span>`;
      } else {
        inner = `
          <div class="meta">
            <div class="amt">${esc(t.fromName)} → ${esc(t.toName)} ${esc(t.amountFmt)}</div>
          </div>
          <span class="badge ${t.paid ? "paid" : ""}">${t.paid ? "✓ paid" : "unpaid"}</span>`;
      }
      area.appendChild(el(`<div class="person">${inner}</div>`));
    }

    const checkBtn = el('<button class="secondary" type="button">Check settlement</button>');
    checkBtn.onclick = async () => {
      checkBtn.textContent = "Checking…";
      try {
        const updated = await api("/api/trips/" + trip.id + "/settle/verify", { method: "POST" });
        showDetail(updated);
      } catch (err) {
        checkBtn.textContent = "Check settlement";
        alert(err.message || "Couldn't verify settlement.");
      }
    };
    area.appendChild(checkBtn);
  }

  // ── public API ───────────────────────────────────────────────────────────────
  function showTripsSection() {
    const ids = ["form", "history", "result"];
    ids.forEach((id) => { const n = document.getElementById(id); if (n) n.style.display = "none"; });
    const t = root();
    if (t) t.style.display = "block";
  }

  function show() {
    showTripsSection();
    // Only (re)render the list if we're not already showing a trip detail.
    if (!root().querySelector("#tBackList")) showList();
  }

  function openShared(token) {
    showTripsSection();
    openTrip(token);
  }

  window.Trips = { show, openShared };

  // ── boot ─────────────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    if (!root()) return;
    const path = location.pathname || "";
    if (path.indexOf("/t/") === 0) {
      const token = decodeURIComponent(path.slice(3).replace(/\/+$/, ""));
      if (token) openShared(token);
    }
  });
})();
