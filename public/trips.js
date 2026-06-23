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

  // Identity helpers — degrade gracefully when window.Auth is absent or signed out.
  function authUser() { return (window.Auth && window.Auth.user) || null; }
  // authFetch-aware request: uses Auth.authFetch when available (adds Bearer),
  // otherwise plain fetch. Anonymous calls keep working when signed out.
  function authFetchFn() {
    return (window.Auth && window.Auth.authFetch) ? window.Auth.authFetch : fetch;
  }
  // "My trips" toggle state (LIST view), only meaningful when signed in.
  let mineOnly = false;
  // Id of the trip currently shown in the DETAIL view (for live re-render on auth change).
  let currentTripId = null;
  // Capability proof for the trip currently shown in the DETAIL view: the full
  // trip's shareToken. Threaded into every MUTATING trip request as the
  // `X-Trip-Token` header so the backend authorizes writes even when the Bearer
  // session alone wouldn't. Reads/GETs never need it.
  let currentTripToken = null;

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

  // api(path, opts) — JSON helper. Pass opts.auth = true to attach the Bearer
  // token (via Auth.authFetch) for calls that benefit from identity; anonymous
  // requests still work when signed out.
  //
  // Trip MUTATIONS (POST/PATCH/DELETE under /api/trips/:id/...) require a
  // capability proof: the header `X-Trip-Token: <trip.shareToken>`. We attach it
  // automatically from `currentTripToken` (set when a trip detail is loaded) for
  // any non-GET request to a /api/trips/ subpath. Combined with Auth.authFetch
  // this sends both the Bearer token AND X-Trip-Token when available.
  async function api(path, opts) {
    opts = opts || {};
    const useAuth = opts.auth === true;
    const fetchFn = useAuth ? authFetchFn() : fetch;
    const reqOpts = Object.assign({ headers: { "content-type": "application/json" } }, opts);
    delete reqOpts.auth;
    // Attach the trip capability token on mutating trip requests.
    const method = (reqOpts.method || "GET").toUpperCase();
    const isMutation = method === "POST" || method === "PATCH" || method === "DELETE";
    const isTripPath = path.indexOf("/api/trips/") === 0;
    if (isMutation && isTripPath && currentTripToken) {
      reqOpts.headers = Object.assign({}, reqOpts.headers, { "X-Trip-Token": currentTripToken });
    }
    const res = await fetchFn(path, reqOpts);
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok) {
      const msg = (data && data.error) || ("Request failed (" + res.status + ")");
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // Irreversibility guard: before any action that sends USDC on-chain, make the
  // user explicitly acknowledge that payments are final. Returns true to proceed.
  function confirmIrreversible(amountFmt, toName) {
    const amt = amountFmt || "this amount";
    const to = toName || "the recipient";
    return window.confirm(
      "Payments are final — on-chain USDC has no refunds or chargebacks.\n\n" +
      "You're paying " + amt + " to " + to + ".\n\nContinue?");
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
    currentTripId = null;
    currentTripToken = null;

    // seed the first member ("you"): prefer the signed-in user's primary wallet
    // and display name; fall back to the saved collector wallet for signed-out.
    if (newTripMembers.length === 0) {
      const u = authUser();
      const saved = (localStorage.getItem(WALLET_KEY) || "").trim();
      const wallet = (u && u.primaryWallet) ? u.primaryWallet : saved;
      const name = u ? (u.displayName || (u.handle ? u.handle : "")) : "";
      newTripMembers = [{ name: name, wallet: wallet, you: true }];
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

        <div id="tMineWrap" class="chips" style="display:none; margin-bottom:10px"></div>
        <div id="tList"><p class="muted">Loading…</p></div>
      </div>
    `);
    c.appendChild(view);

    // "My trips" toggle — only meaningful when signed in.
    const mineWrap = document.getElementById("tMineWrap");
    if (authUser()) {
      mineWrap.style.display = "flex";
      const allChip = el(`<button type="button" class="chip${mineOnly ? "" : " selected"}">All trips</button>`);
      const mineChip = el(`<button type="button" class="chip${mineOnly ? " selected" : ""}">My trips</button>`);
      allChip.onclick = () => { if (mineOnly) { mineOnly = false; showList(); } };
      mineChip.onclick = () => { if (!mineOnly) { mineOnly = true; showList(); } };
      mineWrap.appendChild(allChip);
      mineWrap.appendChild(mineChip);
    } else {
      // signed out: "My trips" isn't available, so always show all.
      mineOnly = false;
    }

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
      const trip = await api("/api/trips", { method: "POST", auth: true, body: JSON.stringify({ name, members }) });
      newTripMembers = []; // reset staged members
      showDetail(trip);
    } catch (err) {
      status.textContent = err.message || "Couldn't create trip.";
    }
  }

  // Render the signed-out state for the trip list: a friendly prompt plus a
  // connect-wallet button that calls the existing Auth sign-in. On success the
  // Auth onChange listener re-renders the list with the user's trips.
  function renderSignedOutTrips() {
    const list = document.getElementById("tList");
    if (!list) return;
    list.innerHTML = "";
    const box = el(`
      <div style="border:1px solid #8884; border-radius:12px; padding:16px; text-align:center">
        <p style="margin:0 0 4px; font-weight:600">Sign in to see your trips</p>
        <p class="muted" style="margin:0 0 12px">Connect a wallet to view trips you own or have claimed a spot in.</p>
        <button id="tSignIn" class="connect" type="button" style="margin:0">Connect wallet</button>
        <div id="tSignInMsg" class="muted" style="margin-top:8px"></div>
      </div>
    `);
    list.appendChild(box);
    const btn = box.querySelector("#tSignIn");
    const msg = box.querySelector("#tSignInMsg");
    btn.onclick = async () => {
      if (!(window.Auth && typeof window.Auth.signInWithWallet === "function")) {
        msg.textContent = "Sign-in is unavailable right now.";
        return;
      }
      msg.textContent = "Connecting…";
      try {
        await window.Auth.signInWithWallet();
        // Auth.onChange -> onAuthChange re-renders the list once signed in.
      } catch (err) {
        msg.textContent = err.message || "Couldn't connect.";
      }
    };
  }

  async function loadTripList() {
    const list = document.getElementById("tList");
    // GET /api/trips now requires a signed-in user. When signed out, skip the
    // request and show the friendly connect-wallet state immediately.
    if (!authUser()) {
      renderSignedOutTrips();
      return;
    }
    try {
      // Signed in + "My trips" -> GET /api/trips?mine=1. Else all of the user's trips.
      const useMine = mineOnly && authUser();
      const trips = useMine
        ? await api("/api/trips?mine=1", { auth: true })
        : await api("/api/trips", { auth: true });
      if (!Array.isArray(trips) || trips.length === 0) {
        list.innerHTML = useMine
          ? '<p class="muted">None of your trips yet. Create one or claim your spot in a shared trip.</p>'
          : '<p class="muted">No trips yet. Start one above.</p>';
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
      // The session may have expired between paint and fetch -> 401. Fall back to
      // the signed-out connect prompt rather than a dead error.
      if (err && err.status === 401) {
        renderSignedOutTrips();
        return;
      }
      list.innerHTML = '<p class="muted">Couldn\'t load trips.</p>';
    }
  }

  async function openTrip(idOrToken) {
    const c = root();
    c.innerHTML = '<p class="muted">Loading trip…</p>';
    try {
      const trip = await api("/api/trips/" + encodeURIComponent(idOrToken), { auth: true });
      showDetail(trip);
    } catch (err) {
      c.innerHTML = '<p class="muted">Couldn\'t load this trip.</p>' +
        '<button class="secondary" id="tBack">Back to trips</button>';
      const b = document.getElementById("tBack");
      if (b) b.onclick = showList;
    }
  }

  // ── view: DETAIL ─────────────────────────────────────────────────────────────
  // Resolve "my member" for a trip: prefer real identity (member.userId matches
  // the signed-in user) over the localStorage "Who am I?" selector. Returns the
  // member id, or "" if unknown.
  function myMemberId(trip) {
    const u = authUser();
    if (u && Array.isArray(trip.members)) {
      const mine = trip.members.find((m) => m.userId && m.userId === u.id);
      if (mine) return mine.id;
    }
    return localStorage.getItem(meKey(trip.id)) || "";
  }

  function showDetail(trip) {
    const c = root();
    c.innerHTML = "";

    currentTripId = trip.id || null;
    // Capture the full trip's shareToken as the capability proof for mutations.
    currentTripToken = trip.shareToken || null;
    const meId = myMemberId(trip);

    const view = el(`
      <div>
        <button class="toggle-link" id="tBackList" type="button">‹ All trips</button>

        <div class="summary" style="align-items:center; margin-top:4px">
          <h1 style="font-size:1.4rem; margin:0">${esc(trip.name)}</h1>
          <button id="tRecap" class="chip" type="button" style="margin:0">Recap ✨</button>
          <button id="tShare" class="chip" type="button" style="margin:0">Share</button>
        </div>
        <div id="tShareNote" class="muted" style="display:none">Link copied</div>
        <div class="summary muted"><span>${esc(trip.totalFmt || "")} total</span><span></span></div>

        <h1 style="font-size:1.05rem; margin-top:18px">Balances</h1>
        <label style="margin-top:4px" id="tMeLabel">Who am I?</label>
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

    // Recap button: shareable settle-up recap card (recap.js).
    var tRecap = document.getElementById("tRecap");
    if (tRecap) tRecap.onclick = () => {
      if (window.Recap && typeof window.Recap.open === "function") window.Recap.open(currentTripId);
    };

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
    const label = document.getElementById("tMeLabel");
    // When signed in AND identity resolves a claimed member, real identity wins:
    // hide the manual selector. Keep it as a fallback for signed-out viewers (or
    // signed-in users who haven't claimed a spot yet).
    const u = authUser();
    const claimedMine = u && trip.members.some((m) => m.userId && m.userId === u.id);
    if (claimedMine) {
      if (label) label.style.display = "none";
      sel.style.display = "none";
      return;
    }
    if (label) label.style.display = "";
    sel.style.display = "";
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
    const u = authUser();
    // Has the signed-in user already claimed a spot in this trip? If so, we don't
    // offer "claim" on other members.
    const alreadyClaimedMine = u && trip.members.some((m) => m.userId && m.userId === u.id);
    for (const m of trip.members) {
      const hasWallet = !!m.wallet;
      // claimed indicator: a member linked to a user account.
      const claimed = !!(m.claimed || m.userId);
      const isMine = u && m.userId && m.userId === u.id;
      const claimBadge = claimed
        ? `<span class="badge paid" style="margin-left:8px">✓ ${isMine ? "you" : "linked"}</span>`
        : `<span class="badge" style="margin-left:8px">unclaimed</span>`;
      // Offer "This is me — claim" only when signed in, the member is unclaimed,
      // and the user hasn't already claimed another member here.
      const canClaim = u && !claimed && !alreadyClaimedMine;
      const claimBtn = canClaim
        ? `<button class="chip tClaim" type="button" style="margin:0">This is me — claim</button>`
        : "";
      const row = el(`
        <div class="person" style="flex-wrap:wrap${isMine ? "; border-color:var(--green)" : ""}">
          <div class="meta">
            <div class="amt" style="font-size:1rem">${esc(m.name)}${claimBadge}</div>
            <div class="muted tWalletShow">${hasWallet ? esc(m.wallet) : "No wallet set — needed to receive settle-up."}</div>
          </div>
          ${claimBtn}
          <button class="chip tWalletEdit" type="button" style="margin:0">${hasWallet ? "Edit wallet" : "Set wallet"}</button>
          <div class="tWalletForm" style="display:none; width:100%">
            <input class="tWalletInput" placeholder="Solana wallet" style="margin-top:8px" />
            <button class="secondary tWalletSave" type="button">Save wallet</button>
            <div class="muted tWalletStatus"></div>
          </div>
        </div>
      `);
      const claimEl = row.querySelector(".tClaim");
      if (claimEl) {
        claimEl.onclick = async () => {
          claimEl.textContent = "Claiming…";
          try {
            const updated = await api(
              "/api/trips/" + trip.id + "/members/" + m.id + "/claim",
              { method: "POST", auth: true });
            showDetail(updated);
          } catch (err) {
            claimEl.textContent = "This is me — claim";
            alert(err.message || "Couldn't claim this spot.");
          }
        };
      }
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

    // One-line reminder that on-chain USDC transfers can't be undone.
    area.appendChild(el(
      '<div class="muted" style="margin-bottom:8px">USDC payments are final — double-check the amount and recipient.</div>'));

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
      const rowEl = el(`<div class="person">${inner}</div>`);
      // Guard the "Open in wallet" link: sending USDC is irreversible, so require
      // an explicit confirm before navigating to the wallet/payment link.
      const openLink = rowEl.querySelector("a");
      if (openLink && t.url) {
        openLink.addEventListener("click", (ev) => {
          if (!confirmIrreversible(t.amountFmt, t.toName)) {
            ev.preventDefault();
          }
        });
      }
      area.appendChild(rowEl);
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

  // Re-render the visible trips view when sign-in state changes (so claim
  // buttons, "My trips", and identity-driven "me" update live).
  function onAuthChange() {
    const c = root();
    if (!c || c.style.display === "none") return; // not visible — nothing to redraw
    if (c.querySelector("#tBackList") && currentTripId) {
      // A trip detail is open — re-fetch so userId/claimed/identity reflect the
      // new sign-in state, keeping the user on the same trip.
      openTrip(currentTripId);
    } else if (c.querySelector("#tList")) {
      showList();
    }
  }

  // ── boot ─────────────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    if (!root()) return;
    if (window.Auth && typeof window.Auth.onChange === "function") {
      window.Auth.onChange(onAuthChange);
    }
    const path = location.pathname || "";
    if (path.indexOf("/t/") === 0) {
      const token = decodeURIComponent(path.slice(3).replace(/\/+$/, ""));
      if (token) openShared(token);
    }
  });
})();
