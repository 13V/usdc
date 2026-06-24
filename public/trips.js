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

  // ── styleguide tokens + component classes (scoped to #trips) ─────────────────
  // The shared design tokens/classes from STYLEGUIDE.md are not present in the
  // host page's global stylesheet, so we provide them here scoped under #trips.
  // Nothing leaks out to other screens. Tokens use CSS variables only — no
  // hardcoded hex in rendered markup or inline styles elsewhere in this file.
  function injectStyles() {
    if (document.getElementById("tripsStyle")) return;
    const fontHref =
      "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap";
    if (!document.querySelector('link[data-trips-font]')) {
      const fl = document.createElement("link");
      fl.rel = "stylesheet";
      fl.href = fontHref;
      fl.setAttribute("data-trips-font", "1");
      document.head.appendChild(fl);
    }
    const s = document.createElement("style");
    s.id = "tripsStyle";
    s.textContent = `
#trips{
  --ink:#04121a; --surface:#0a1f2b; --surface-2:#0e2734;
  --line:rgba(246,241,231,0.10);
  --cream:#f6f1e7; --muted:rgba(246,241,231,0.58); --faint:rgba(246,241,231,0.38);
  --accent:#2775ca; --accent-ink:#04121a;
  --accent-soft:rgba(39,117,202,0.14); --accent-line:rgba(39,117,202,0.34);
  --terra:#e0a892; --terra-soft:rgba(224,168,146,0.13);
  --radius:16px; --radius-sm:12px;
  --mono:'JetBrains Mono',ui-monospace,monospace;
  --sans:'Space Grotesk',-apple-system,system-ui,sans-serif;
  background:var(--ink); color:var(--cream);
  font-family:var(--sans);
  border-radius:var(--radius); padding:4px 2px;
}
#trips h1,#trips h2,#trips h3,#trips label,#trips p{ color:var(--cream); }
#trips .mono{ font-family:var(--mono); font-variant-numeric:tabular-nums; }
#trips .eyebrow{ font-family:var(--mono); font-size:.68rem; letter-spacing:.12em;
  text-transform:uppercase; color:var(--muted); margin:0 0 6px; }
#trips .t-muted{ color:var(--muted); font-size:.82rem; }
#trips .t-faint{ color:var(--faint); }
#trips .t-sub{ color:var(--cream); }
#trips label{ font-family:var(--sans); font-weight:600; font-size:.8rem;
  color:var(--muted); margin:14px 0 6px; }

#trips .card{ background:var(--surface); border:1px solid var(--line);
  border-radius:var(--radius); padding:16px; margin:12px 0; }
#trips .receipt{ position:relative; background:var(--surface); border:1px solid var(--line);
  border-radius:var(--radius); padding:16px; margin:12px 0; }
#trips .receipt hr{ border:0; border-top:1px dashed var(--line); margin:14px 0; }
#trips .receipt::after{ content:""; position:absolute; left:0; right:0; bottom:-7px; height:14px;
  background:radial-gradient(circle at 7px 0, transparent 0 6px, var(--ink) 6px) repeat-x;
  background-size:14px 14px; }

#trips .input, #trips input, #trips select{
  width:100%; background:var(--surface-2); border:1px solid var(--line);
  border-radius:var(--radius-sm); padding:12px; color:var(--cream);
  font-size:1rem; font-family:var(--sans); }
#trips input::placeholder{ color:var(--faint); }
#trips select{ appearance:none; }

#trips .btn{ width:100%; display:inline-flex; align-items:center; justify-content:center;
  gap:8px; background:var(--accent); color:var(--accent-ink); border:0;
  border-radius:999px; padding:14px; font-weight:700; font-size:1rem;
  font-family:var(--sans); cursor:pointer; margin-top:16px;
  transition:transform .12s ease, filter .12s ease; }
#trips .btn:hover{ filter:brightness(1.06); }
#trips .btn:active{ transform:scale(.97); }
#trips .btn.ghost{ background:transparent; border:1px solid var(--line); color:var(--cream); }
#trips .btn.sm{ width:auto; padding:9px 14px; font-size:.9rem; margin-top:0; }
#trips .btn.full{ width:100%; }

#trips .pill{ display:inline-flex; align-items:center; gap:6px; width:auto; margin:0;
  border:1px solid var(--line); background:transparent; color:var(--cream);
  border-radius:999px; padding:7px 12px; font-size:.85rem; font-weight:600;
  font-family:var(--sans); cursor:pointer; }
#trips .pill:active{ transform:scale(.97); }
#trips .chip{ display:inline-flex; align-items:center; gap:8px; width:auto; margin:0;
  border:1px solid var(--line); background:transparent; color:var(--cream);
  border-radius:999px; padding:7px 12px; font-size:.85rem; font-weight:600;
  font-family:var(--sans); cursor:pointer; }
#trips .chip.selected{ background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
#trips .chips{ display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
#trips .toggle-link{ display:inline-flex; align-items:center; gap:6px; width:auto; margin:0;
  background:none; border:0; padding:0; cursor:pointer; color:var(--accent);
  font-weight:600; font-size:.9rem; font-family:var(--sans); }

#trips .row{ display:flex; gap:12px; align-items:center; padding:12px 0;
  border-bottom:1px solid var(--line); }
#trips .row.flush{ border-bottom:0; }
#trips .row > div{ flex:none; }
#trips .meta{ flex:1; min-width:0; }
#trips .meta .ttl{ font-weight:600; color:var(--cream); }

#trips .avatar{ width:38px; height:38px; flex:0 0 auto; border-radius:999px;
  background:var(--surface-2); color:var(--cream); display:flex; align-items:center;
  justify-content:center; font-family:var(--mono); font-size:.9rem; font-weight:600;
  border:1px solid var(--line); }
#trips .avatar-stack{ display:inline-flex; align-items:center; }
#trips .avatar-stack .avatar{ margin-left:-10px; box-shadow:0 0 0 2px var(--surface); }
#trips .avatar-stack .avatar:first-child{ margin-left:0; }

#trips .money{ font-family:var(--mono); font-variant-numeric:tabular-nums; font-weight:600; }
#trips .money.pos{ color:var(--accent); }
#trips .money.neg{ color:var(--terra); }
#trips .money.zero{ color:var(--muted); }

#trips .hero-amount{ font-family:var(--mono); font-size:2.6rem; font-weight:600; line-height:1.05;
  letter-spacing:-.01em; }
#trips .hero-amount.pos{ color:var(--accent); }
#trips .hero-amount.neg{ color:var(--terra); }

#trips .state-chip{ display:inline-flex; align-items:center; gap:7px; width:auto;
  border:1px solid var(--line); border-radius:999px; padding:5px 11px;
  font-family:var(--mono); font-size:.68rem; letter-spacing:.1em; text-transform:uppercase;
  font-weight:600; color:var(--muted); }
#trips .state-chip i{ width:7px; height:7px; border-radius:999px; background:currentColor;
  display:inline-block; }
#trips .state-chip.reading{ color:var(--muted); border-color:var(--line); }
#trips .state-chip.confirmed{ color:var(--accent); border-color:var(--accent-line); }
#trips .state-chip.finalized{ color:var(--accent); border-color:var(--accent-line); }
#trips .state-chip.settled{ background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }

#trips .empty{ text-align:center; padding:36px 16px; }
#trips .empty-glyph{ font-size:40px; opacity:.5; line-height:1; }
#trips .empty-title{ font-weight:600; margin:14px 0 4px; color:var(--cream); }
#trips .empty-hint{ color:var(--muted); font-size:.85rem; margin:0 0 4px; }

#trips .skeleton{ background:linear-gradient(90deg,
    var(--surface-2) 25%, rgba(246,241,231,0.08) 37%, var(--surface-2) 63%);
  background-size:400% 100%; border-radius:var(--radius-sm);
  animation:tripsShimmer 1.4s ease infinite; }

#trips .rise{ animation:tripsRise .16s ease both; }
@keyframes tripsShimmer{ 0%{background-position:100% 0} 100%{background-position:0 0} }
@keyframes tripsRise{ from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:none} }
@media (prefers-reduced-motion: reduce){
  #trips .rise{ animation:none; } #trips .skeleton{ animation:none; }
  #trips .btn:active, #trips .pill:active{ transform:none; }
}
`;
    document.head.appendChild(s);
  }

  // initials for an avatar from a member name
  function initials(name) {
    const n = String(name || "").trim();
    if (!n) return "?";
    const parts = n.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // deterministic accent tint for an avatar background, derived from a string
  function avatarTint(seed) {
    let h = 0;
    const str = String(seed || "");
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return "hsl(" + hue + ",42%,26%)";
  }

  // a small avatar element (cream initial on a tinted surface)
  function avatarHtml(member) {
    const name = (member && member.name) || "";
    const tint = avatarTint(member && (member.id || name));
    return '<span class="avatar" style="background:' + tint + '">' + esc(initials(name)) + "</span>";
  }

  // overlapping avatar stack for up to `max` members
  function avatarStackHtml(members, max) {
    const list = Array.isArray(members) ? members : [];
    const cap = max || 4;
    const shown = list.slice(0, cap).map(avatarHtml).join("");
    const extra = list.length > cap
      ? '<span class="avatar" style="background:var(--surface-2)">+' + (list.length - cap) + "</span>"
      : "";
    return '<span class="avatar-stack">' + shown + extra + "</span>";
  }

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
    injectStyles();
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
      <div class="rise">
        <p class="eyebrow">Shared ledger</p>
        <h1 style="font-size:1.5rem; margin:0 0 6px">Trips</h1>
        <p class="t-muted" style="margin:0 0 14px">A shared ledger for the whole crew. Anyone pays, everyone settles up in USDC.</p>

        <div id="tNewWrap" class="card" style="margin-bottom:14px;">
          <button id="tNewToggle" class="toggle-link" type="button">＋ New trip</button>
          <div id="tNewForm" style="display:none">
            <label>Trip name</label>
            <input class="input" id="tName" placeholder="e.g. Bali 2026" />

            <label>Members</label>
            <div id="tMembers"></div>
            <button id="tAddMember" class="pill" type="button" style="margin-top:10px">＋ Add member</button>

            <button id="tCreate" class="btn full">Create trip</button>
            <div id="tCreateStatus" class="t-muted" style="margin-top:8px"></div>
          </div>
        </div>

        <div id="tMineWrap" class="chips" style="display:none; margin-bottom:10px"></div>
        <div id="tList"></div>
      </div>
    `);
    c.appendChild(view);
    showListSkeleton();

    // "My trips" toggle — only meaningful when signed in.
    const mineWrap = document.getElementById("tMineWrap");
    if (authUser()) {
      mineWrap.style.display = "flex";
      const allChip = el(`<button type="button" class="chip${mineOnly ? "" : " selected"}">All trips</button>`);
      const mineChip = el(`<button type="button" class="chip${mineOnly ? " selected" : ""}">My trips</button>`);
      allChip.style.marginTop = "0"; mineChip.style.marginTop = "0";
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

  function showListSkeleton() {
    const list = document.getElementById("tList");
    if (!list) return;
    list.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      list.appendChild(el(`
        <div class="row">
          <span class="skeleton" style="width:38px; height:38px; border-radius:999px; flex:0 0 auto"></span>
          <div class="meta">
            <div class="skeleton" style="height:13px; width:46%; margin-bottom:8px"></div>
            <div class="skeleton" style="height:10px; width:30%"></div>
          </div>
          <div class="skeleton" style="height:14px; width:56px"></div>
        </div>
      `));
    }
  }

  function renderNewMembers() {
    const wrap = document.getElementById("tMembers");
    if (!wrap) return;
    wrap.innerHTML = "";
    newTripMembers.forEach((m, i) => {
      const rowEl = el(`
        <div class="card" style="padding:12px; margin:8px 0;">
          <div class="row flush" style="padding:0">
            <div style="flex:1">
              <input class="input tmName" placeholder="Name${m.you ? " (you)" : ""}" />
            </div>
            <button class="pill tmDel" type="button" style="flex:0 0 auto; padding:9px 13px;" aria-label="Remove">✕</button>
          </div>
          <input class="input tmWallet" placeholder="Solana wallet (optional)" style="margin-top:8px" />
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
      <div class="card empty rise">
        <div class="empty-glyph">🧾</div>
        <p class="empty-title">Sign in to see your trips</p>
        <p class="empty-hint" style="margin-bottom:14px">Connect a wallet to view trips you own or have claimed a spot in.</p>
        <button id="tSignIn" class="btn" type="button" style="margin:0 auto; width:auto; padding:12px 22px">Connect wallet</button>
        <div id="tSignInMsg" class="t-muted" style="margin-top:10px"></div>
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
        list.innerHTML = "";
        list.appendChild(el(`
          <div class="empty rise">
            <div class="empty-glyph">🌴</div>
            <p class="empty-title">${useMine ? "No trips of yours yet" : "No trips yet"}</p>
            <p class="empty-hint">${useMine
              ? "Create one, or claim your spot in a shared trip."
              : "Start one above and invite the crew."}</p>
            <button class="btn" id="tEmptyNew" type="button" style="margin:14px auto 0; width:auto; padding:12px 22px">＋ New trip</button>
          </div>
        `));
        const en = document.getElementById("tEmptyNew");
        if (en) en.onclick = () => {
          const tog = document.getElementById("tNewToggle");
          const f = document.getElementById("tNewForm");
          if (f && f.style.display === "none" && tog) tog.click();
          const nameI = document.getElementById("tName");
          if (nameI) { nameI.focus(); nameI.scrollIntoView({ behavior: "smooth", block: "center" }); }
        };
        return;
      }
      list.innerHTML = "";
      for (const t of trips) {
        // The list payload carries counts, not a member roster — synthesise
        // placeholder avatars from the member count for the stack.
        const count = t.memberCount || 0;
        const ph = [];
        for (let i = 0; i < count; i++) ph.push({ id: t.id + ":" + i, name: "" });
        const stack = avatarStackHtml(ph, 4);
        const sub = (t.memberCount || 0) + " member" + ((t.memberCount === 1) ? "" : "s") +
          " · " + (t.expenseCount || 0) + " expense" + ((t.expenseCount === 1) ? "" : "s");
        const right = t.settledUp
          ? '<span class="state-chip settled"><i></i>Settled</span>'
          : '<span class="money">' + esc(t.totalFmt || "") + "</span>";
        const item = el(`
          <div class="row rise" role="button" tabindex="0" style="cursor:pointer">
            ${stack}
            <div class="meta">
              <div class="ttl">${esc(t.name)}</div>
              <div class="mono t-muted" style="font-size:.74rem; margin-top:2px">${esc(sub)}</div>
            </div>
            <div style="flex:0 0 auto; text-align:right">${right}</div>
          </div>
        `);
        item.onclick = () => openTrip(t.id);
        item.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openTrip(t.id); }
        });
        list.appendChild(item);
      }
    } catch (err) {
      // The session may have expired between paint and fetch -> 401. Fall back to
      // the signed-out connect prompt rather than a dead error.
      if (err && err.status === 401) {
        renderSignedOutTrips();
        return;
      }
      list.innerHTML = '<p class="t-muted">Couldn\'t load trips.</p>';
    }
  }

  async function openTrip(idOrToken) {
    const c = root();
    injectStyles();
    c.innerHTML = `
      <div class="rise">
        <div class="skeleton" style="height:14px; width:30%; margin:6px 0 16px"></div>
        <div class="skeleton" style="height:26px; width:55%; margin-bottom:10px"></div>
        <div class="card"><div class="skeleton" style="height:64px; width:100%"></div></div>
        <div class="card"><div class="skeleton" style="height:120px; width:100%"></div></div>
      </div>`;
    try {
      const trip = await api("/api/trips/" + encodeURIComponent(idOrToken), { auth: true });
      showDetail(trip);
    } catch (err) {
      c.innerHTML = "";
      const box = el(`
        <div class="empty rise">
          <div class="empty-glyph">⚠️</div>
          <p class="empty-title">Couldn't load this trip</p>
          <button class="btn ghost" id="tBack" type="button" style="margin:14px auto 0; width:auto; padding:12px 22px">Back to trips</button>
        </div>`);
      c.appendChild(box);
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
    injectStyles();
    c.innerHTML = "";

    currentTripId = trip.id || null;
    // Capture the full trip's shareToken as the capability proof for mutations.
    currentTripToken = trip.shareToken || null;
    const meId = myMemberId(trip);

    const memberCount = Array.isArray(trip.members) ? trip.members.length : 0;
    const view = el(`
      <div class="rise">
        <button class="toggle-link" id="tBackList" type="button" style="margin-bottom:10px">‹ All trips</button>

        <div class="card" style="margin-top:0">
          <p class="eyebrow">Trip ledger</p>
          <div class="row flush" style="padding:0; align-items:flex-start">
            <div class="meta">
              <h1 style="font-size:1.5rem; margin:0 0 8px">${esc(trip.name)}</h1>
              <div class="row flush" style="padding:0; gap:10px">
                ${avatarStackHtml(trip.members, 5)}
                <span class="t-muted">${memberCount} member${memberCount === 1 ? "" : "s"}</span>
              </div>
            </div>
            <div style="flex:0 0 auto; text-align:right">
              <div class="eyebrow" style="margin:0">Total</div>
              <div class="money" style="font-size:1.15rem">${esc(trip.totalFmt || "")}</div>
            </div>
          </div>
          <div class="chips" style="margin-top:14px">
            <button id="tChat" class="pill" type="button">Chat 💬</button>
            <button id="tRecap" class="pill" type="button">Recap ✨</button>
            <button id="tShare" class="pill" type="button">Share</button>
          </div>
          <div id="tShareNote" class="t-muted" style="display:none; margin-top:8px; color:var(--accent)">Link copied ✓</div>
        </div>

        <div class="card">
          <p class="eyebrow">Balances</p>
          <label style="margin-top:0" id="tMeLabel">Who am I?</label>
          <select class="input" id="tMe"></select>
          <div id="tBalances" style="margin-top:10px"></div>
        </div>

        <div class="card">
          <p class="eyebrow">Members</p>
          <div id="tMemberList"></div>
          <div id="tAddMemberBox" style="margin-top:10px;">
            <button id="tAddMemberToggle" class="toggle-link" type="button">＋ Add member ▾</button>
            <div id="tAddMemberForm" style="display:none">
              <label>Name</label>
              <input class="input" id="tNewMemberName" placeholder="Name" />
              <label>Wallet (optional)</label>
              <input class="input" id="tNewMemberWallet" placeholder="Solana wallet" />
              <button id="tNewMemberSave" class="pill" style="margin-top:12px">Add member</button>
              <div id="tNewMemberStatus" class="t-muted" style="margin-top:8px"></div>
            </div>
          </div>
        </div>

        <div class="card">
          <p class="eyebrow">Add an expense</p>
          <label style="margin-top:0">What's it for?</label>
          <input class="input" id="tExpTitle" placeholder="e.g. Hotel" />

          <div class="row flush" style="padding:0; margin-top:0; align-items:flex-end; gap:10px">
            <div style="flex:1">
              <label>Amount ($)</label>
              <input class="input" id="tExpTotal" type="number" step="0.01" placeholder="0.00" />
            </div>
            <div style="flex:0 0 110px">
              <label>Currency</label>
              <select class="input" id="tExpCur"></select>
            </div>
          </div>
          <button id="tExpConvert" class="pill" type="button" style="display:none; margin-top:10px">Convert to USD</button>
          <div id="tExpFxStatus" class="t-muted" style="margin-top:6px"></div>

          <label>Paid by</label>
          <select class="input" id="tExpPaidBy"></select>

          <label>Split among</label>
          <div id="tExpParts" class="chips"></div>

          <button id="tExpAdd" class="btn full">Add expense</button>
          <div id="tExpStatus" class="t-muted" style="margin-top:8px"></div>
        </div>

        <div class="card">
          <p class="eyebrow">Expenses</p>
          <div id="tExpList"></div>
        </div>

        <div class="card">
          <p class="eyebrow">Settle up</p>
          <div id="tSettleArea"></div>
          <button id="tSettleBtn" class="btn full">Settle up</button>
        </div>
      </div>
    `);
    c.appendChild(view);

    document.getElementById("tBackList").onclick = showList;

    // Chat button: group chat + receipt feed (chat.js).
    var tChat = document.getElementById("tChat");
    if (tChat) tChat.onclick = () => {
      if (window.Chat && typeof window.Chat.open === "function") window.Chat.open(currentTripId, currentTripToken);
    };

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
      area.innerHTML = '<div class="skeleton" style="height:80px; width:100%"></div>';
      try {
        const updated = await api("/api/trips/" + trip.id + "/settle", { method: "POST" });
        showDetail(updated);
      } catch (err) {
        area.innerHTML = '<p class="t-muted">' + esc(err.message || "Couldn't settle up.") + "</p>";
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
      wrap.innerHTML = '<p class="t-muted">No balances yet — add an expense.</p>';
      return;
    }
    for (const b of balances) {
      const mine = b.memberId === meId;
      // Money rule: owed-to-you/positive = accent; you-owe/outstanding = terra;
      // settled = muted. The signed amount is shown in mono.
      let label, amt, moneyCls;
      if (b.direction === "owed") {
        label = mine ? "You're owed" : esc(b.name) + " is owed";
        amt = b.fmt; moneyCls = "pos";
      } else if (b.direction === "owes") {
        label = mine ? "You owe" : esc(b.name) + " owes";
        amt = b.fmt; moneyCls = "neg";
      } else {
        label = (mine ? "You're" : esc(b.name) + " is") + " settled";
        amt = ""; moneyCls = "zero";
      }
      const row = el(`
        <div class="row${mine ? "" : ""}">
          ${avatarHtml({ id: b.memberId, name: b.name })}
          <div class="meta">
            <div class="ttl" style="font-size:.95rem">${label}${mine ? '  <span class="state-chip" style="margin-left:6px"><i></i>You</span>' : ""}</div>
          </div>
          ${amt ? '<span class="money ' + moneyCls + '">' + esc(amt) + "</span>"
                : '<span class="money zero">✓</span>'}
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
        ? `<span class="state-chip confirmed" style="margin-left:8px"><i></i>${isMine ? "You" : "Linked"}</span>`
        : `<span class="state-chip" style="margin-left:8px"><i></i>Unclaimed</span>`;
      // Offer "This is me — claim" only when signed in, the member is unclaimed,
      // and the user hasn't already claimed another member here.
      const canClaim = u && !claimed && !alreadyClaimedMine;
      const claimBtn = canClaim
        ? `<button class="pill tClaim" type="button">This is me — claim</button>`
        : "";
      const walletLine = hasWallet
        ? '<span class="mono t-muted" style="font-size:.74rem; word-break:break-all">' + esc(m.wallet) + "</span>"
        : '<span class="t-muted" style="color:var(--terra)">No wallet set — needed to receive settle-up.</span>';
      const row = el(`
        <div class="row" style="flex-wrap:wrap; align-items:flex-start">
          ${avatarHtml(m)}
          <div class="meta">
            <div class="ttl" style="font-size:1rem; display:flex; align-items:center; flex-wrap:wrap">${esc(m.name)}${claimBadge}</div>
            <div class="tWalletShow" style="margin-top:3px">${walletLine}</div>
          </div>
          ${claimBtn}
          <button class="pill tWalletEdit" type="button">${hasWallet ? "Edit wallet" : "Set wallet"}</button>
          <div class="tWalletForm" style="display:none; width:100%">
            <input class="input tWalletInput" placeholder="Solana wallet" style="margin-top:8px" />
            <button class="pill tWalletSave" type="button" style="margin-top:10px">Save wallet</button>
            <div class="t-muted tWalletStatus" style="margin-top:6px"></div>
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
      wrap.innerHTML = `
        <div class="empty">
          <div class="empty-glyph">🧾</div>
          <p class="empty-title">No expenses yet</p>
          <p class="empty-hint">Add the first one above — hotel, dinner, that boat.</p>
        </div>`;
      return;
    }
    for (const e of expenses) {
      const names = (e.participantNames || []).map(esc).join(", ");
      const fxLine = e.fxNote ? `<div class="mono t-muted" style="margin-top:6px; font-size:.72rem">${esc(e.fxNote)}</div>` : "";
      const row = el(`
        <div class="receipt" style="margin:10px 0; padding:14px">
          <div class="row flush" style="padding:0; align-items:flex-start">
            <div class="meta">
              <div class="ttl">${esc(e.title)}</div>
              <div class="t-muted" style="margin-top:2px">paid by ${esc(e.paidByName)}</div>
            </div>
            <span class="money" style="font-size:1.05rem">${esc(e.amountFmt)}</span>
          </div>
          <hr>
          <div class="row flush" style="padding:0; align-items:flex-start">
            <div class="meta t-muted" style="font-size:.78rem">split among ${names}</div>
            <button class="pill tExpDel" type="button" style="padding:6px 11px; font-size:.8rem" aria-label="Delete">✕</button>
          </div>
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
      area.innerHTML = '<p class="t-muted" style="margin:0 0 4px">When you\'re ready, compute who pays whom — minimised transfers, in USDC.</p>';
      if (settleBtn) settleBtn.textContent = "Settle up";
      return;
    }

    if (settleBtn) settleBtn.textContent = "Re-compute settle-up";

    if (settle.allPaid) {
      area.innerHTML = `
        <div class="row flush" style="padding:0; gap:10px">
          <span class="state-chip settled"><i></i>Settled</span>
          <span class="t-sub" style="font-weight:600">You're all settled — everyone paid ✓</span>
        </div>`;
      return;
    }

    area.innerHTML = "";
    const transfers = settle.transfers || [];
    if (transfers.length === 0) {
      area.innerHTML = '<p class="t-muted" style="margin:0">Nothing to settle — balances are even.</p>';
      return;
    }

    // One-line reminder that on-chain USDC transfers can't be undone.
    area.appendChild(el(
      '<div class="t-muted" style="margin:0 0 10px; color:var(--terra)">USDC payments are final — double-check the amount and recipient.</div>'));

    for (const t of transfers) {
      // On-chain status as a state-chip: paid -> SETTLED; needs wallet -> READING;
      // ready-to-pay -> CONFIRMED.
      const stateChip = t.paid
        ? '<span class="state-chip settled"><i></i>Settled</span>'
        : t.needsWallet
          ? '<span class="state-chip reading"><i></i>Reading</span>'
          : '<span class="state-chip confirmed"><i></i>Confirmed</span>';
      const header = `
        <div class="row flush" style="padding:0; align-items:flex-start">
          <div class="meta">
            <div class="ttl">${esc(t.fromName)} → ${esc(t.toName)}</div>
            <div class="money" style="font-size:1.1rem; margin-top:2px">${esc(t.amountFmt)}</div>
          </div>
          ${stateChip}
        </div>`;
      let body;
      if (t.needsWallet) {
        body = `<div class="t-muted" style="margin-top:8px; color:var(--terra)">Needs ${esc(t.toName)}'s wallet — set it in Members above.</div>`;
      } else if (t.url) {
        body = `
          <hr>
          <div class="row flush" style="padding:0; gap:14px; align-items:center">
            <img src="${qrSrc(t.url)}" alt="QR" style="width:104px;height:104px;border-radius:var(--radius-sm);background:#fff;padding:5px;flex:0 0 auto" />
            <div class="meta">
              <a href="${esc(t.url)}" target="_blank" rel="noopener" style="color:var(--accent); font-weight:600; text-decoration:none">Open in wallet ›</a>
              ${t.reference ? `<div class="mono t-faint" style="word-break:break-all; font-size:.68rem; margin-top:6px">ref ${esc(t.reference)}</div>` : ""}
            </div>
          </div>`;
      } else {
        body = "";
      }
      const rowEl = el(`<div class="receipt" style="margin:10px 0; padding:14px">${header}${body}</div>`);
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

    const checkBtn = el('<button class="btn ghost full" type="button">Check settlement</button>');
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
