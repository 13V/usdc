/* Divvy — Home: Balances dashboard + one-off IOUs.
   Renders into #home. Exposes window.Home = { show }.

   All data requires a signed-in user (Auth.authFetch attaches the Bearer token).
   Backend API contract:
     GET    /api/me/balances
       -> { totals:{owedCents,owesCents,netCents,owedFmt,owesFmt,netFmt},
            trips:[{tripId,tripName,netCents,fmt,direction:"owed"|"owes"|"settled",shareUrlPath}],
            counterparties:[{name,cents,fmt,direction:"owed"|"owes",wallet}] }
     GET    /api/ious
       -> [{ id,direction:"i_owe"|"they_owe",counterpartyName,counterpartyWallet,
             amountCents,amountFmt,note,status:"open"|"paid",url,reference,createdAt }]
     POST   /api/ious                  { direction, counterpartyName, counterpartyWallet?, amount, note? }
     POST   /api/ious/:id/settle/verify
     DELETE /api/ious/:id
*/
(function () {
  "use strict";

  const root = () => document.getElementById("home");

  // ── design tokens + component classes ────────────────────────────────────────
  // The shared styleguide names tokens/classes that are meant to live in the app
  // shell. They are not yet present in index.html, so we inject them once here,
  // scoped to #home, so this screen matches the design contract without touching
  // other files or affecting other screens. (Uses styleguide values verbatim.)
  function ensureStyles() {
    if (document.getElementById("homeStyleguide")) return;

    if (!document.getElementById("homeFonts")) {
      const f = document.createElement("link");
      f.id = "homeFonts";
      f.rel = "stylesheet";
      f.href = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap";
      document.head.appendChild(f);
    }

    const s = document.createElement("style");
    s.id = "homeStyleguide";
    s.textContent = `
#home{
  --ink:#04121a; --surface:#0a1f2b; --surface-2:#0e2734;
  --line:rgba(246,241,231,0.10); --cream:#f6f1e7;
  --muted:rgba(246,241,231,0.58); --faint:rgba(246,241,231,0.38);
  --accent:#2775ca; --accent-ink:#04121a;
  --accent-soft:rgba(39,117,202,0.14); --accent-line:rgba(39,117,202,0.34);
  --terra:#e0a892; --terra-soft:rgba(224,168,146,0.13);
  --radius:16px; --radius-sm:12px;
  --mono:'JetBrains Mono',ui-monospace,monospace;
  --sans:'Space Grotesk',-apple-system,system-ui,sans-serif;
  font-family:var(--sans); color:var(--cream);
}
#home .mono{ font-family:var(--mono); }
#home .eyebrow{ font-family:var(--mono); font-size:.68rem; letter-spacing:.12em;
  text-transform:uppercase; color:var(--muted); }
#home .h-muted{ color:var(--muted); }
#home .h-faint{ color:var(--faint); }
#home .card{ background:var(--surface); border:1px solid var(--line);
  border-radius:var(--radius); padding:16px; margin:12px 0; }
#home .btn{ display:block; width:100%; border:0; border-radius:999px; padding:14px;
  background:var(--accent); color:var(--accent-ink); font-family:var(--sans);
  font-weight:700; font-size:1rem; cursor:pointer; text-align:center;
  text-decoration:none; transition:transform .12s ease, opacity .12s ease; }
#home .btn:active{ transform:scale(.97); }
#home .btn.ghost{ background:transparent; border:1px solid var(--line); color:var(--cream); }
#home .btn.sm{ width:auto; padding:9px 14px; font-size:.9rem; }
#home .pill{ display:inline-flex; align-items:center; gap:6px; width:auto;
  border:1px solid var(--line); border-radius:999px; padding:8px 14px;
  background:transparent; color:var(--cream); font-family:var(--sans);
  font-weight:600; font-size:.85rem; cursor:pointer; transition:transform .12s ease; }
#home .pill:active{ transform:scale(.97); }
#home .chip{ border:1px solid var(--line); border-radius:999px; padding:7px 12px;
  font-size:.85rem; background:transparent; color:var(--cream); cursor:pointer;
  width:auto; margin:0; font-weight:600; font-family:var(--sans);
  display:inline-flex; align-items:center; gap:8px; }
#home .chip.selected{ background:var(--accent); color:var(--accent-ink); border-color:var(--accent); }
#home .input{ width:100%; background:var(--surface-2); border:1px solid var(--line);
  border-radius:var(--radius-sm); padding:12px; color:var(--cream); font-size:1rem;
  font-family:var(--sans); }
#home .input::placeholder{ color:var(--faint); }
#home label{ display:block; font-weight:600; font-size:.8rem; color:var(--muted);
  margin:14px 0 5px; }
#home .hero-amount{ font-family:var(--mono); font-size:2.6rem; font-weight:600;
  line-height:1.05; color:var(--cream); letter-spacing:-.01em; }
#home .hero-amount.pos{ color:var(--accent); }
#home .hero-amount.neg{ color:var(--terra); }
#home .row{ display:flex; gap:12px; align-items:center; padding:12px 0;
  border-bottom:1px solid var(--line); }
#home .row:last-child{ border-bottom:0; }
#home .row .meta{ flex:1; min-width:0; }
#home .row .meta .title{ font-weight:600; }
#home .row .meta .sub{ font-size:.8rem; color:var(--muted); margin-top:2px;
  word-break:break-all; }
#home .row .amount{ font-family:var(--mono); font-weight:600; white-space:nowrap; }
#home .pos{ color:var(--accent); }
#home .neg{ color:var(--terra); }
#home .avatar{ flex:0 0 auto; width:38px; height:38px; border-radius:999px;
  background:var(--surface-2); display:flex; align-items:center; justify-content:center;
  font-family:var(--mono); font-size:.95rem; font-weight:600; color:var(--cream); }
#home .badge{ font-family:var(--mono); font-size:.66rem; letter-spacing:.04em;
  padding:3px 8px; border-radius:999px; background:var(--surface-2);
  color:var(--muted); }
#home .badge.paid{ background:var(--accent-soft); color:var(--accent);
  border:1px solid var(--accent-line); }
#home .state-chip{ display:inline-flex; align-items:center; gap:6px;
  font-family:var(--mono); font-size:.66rem; letter-spacing:.06em;
  padding:3px 9px; border-radius:999px; border:1px solid var(--line);
  color:var(--muted); }
#home .state-chip i{ width:6px; height:6px; border-radius:999px;
  background:currentColor; display:inline-block; }
#home .state-chip.confirmed, #home .state-chip.finalized{ color:var(--accent);
  border-color:var(--accent-line); }
#home .state-chip.settled{ background:var(--accent); color:var(--accent-ink);
  border-color:var(--accent); }
#home .empty{ text-align:center; padding:36px 16px; }
#home .empty-glyph{ font-size:40px; opacity:.5; line-height:1; }
#home .empty-title{ font-weight:600; margin:12px 0 4px; }
#home .empty-hint{ color:var(--muted); font-size:.9rem; margin:0 0 16px; }
#home .skeleton{ background:linear-gradient(90deg,
  var(--surface-2) 25%, rgba(246,241,231,0.08) 37%, var(--surface-2) 63%);
  background-size:400% 100%; border-radius:var(--radius-sm);
  animation:homeShimmer 1.4s ease infinite; }
@keyframes homeShimmer{ 0%{background-position:100% 0} 100%{background-position:-100% 0} }
#home .fade-rise{ animation:homeRise .16s ease both; }
@keyframes homeRise{ from{opacity:0; transform:translateY(4px)} to{opacity:1; transform:none} }
#home a{ color:var(--accent); }
@media (prefers-reduced-motion: reduce){
  #home .skeleton{ animation:none; }
  #home .fade-rise{ animation:none; }
  #home .btn:active, #home .pill:active{ transform:none; }
}`;
    document.head.appendChild(s);
  }

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

  function qrSrc(url) {
    return "https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=" + encodeURIComponent(url);
  }

  // First letter of a name for the avatar circle (falls back to "?").
  function initial(name) {
    const s = String(name == null ? "" : name).trim();
    return esc(s ? s[0].toUpperCase() : "?");
  }

  // ── nudges / share-sheet reminders ───────────────────────────────────────────
  // Share a friendly reminder via the native share sheet, falling back to copying
  // the text to the clipboard. `noteEl` (optional) shows a transient confirmation.
  async function shareReminder(text, noteEl) {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Divvy", text: text });
        return;
      } catch (_) { /* user cancelled or share failed — fall through to copy */ }
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
    }
    if (noteEl) {
      noteEl.textContent = "Reminder copied";
      noteEl.style.display = "block";
      setTimeout(() => { noteEl.style.display = "none"; }, 2500);
    }
  }

  // Build the reminder message for a counterparty/IOU who owes the current user.
  function reminderText(name, amountFmt, link) {
    let msg = "Hey " + (name || "there") + " — friendly reminder that you owe me " +
      (amountFmt || "") + " on Divvy.";
    if (link) msg += " Pay here: " + link;
    return msg.trim();
  }

  // ── app badge ────────────────────────────────────────────────────────────────
  // Track the latest "you owe" counts from the two data sources so we can combine
  // them on each load and reflect the total in the app badge + a muted banner.
  const openCounts = { balances: 0, ious: 0 };

  function updateBadge() {
    const total = (openCounts.balances || 0) + (openCounts.ious || 0);
    try {
      if (total > 0) {
        if (navigator.setAppBadge) navigator.setAppBadge(total);
      } else if (navigator.clearAppBadge) {
        navigator.clearAppBadge();
      }
    } catch (_) { /* badge API may reject — ignore */ }
    const banner = document.getElementById("hOpenBanner");
    if (banner) {
      if (total > 0) {
        const label = total + " open debt" + (total === 1 ? "" : "s");
        // Keep the leading state-chip dot (<i>) intact when present.
        if (banner.querySelector("i")) {
          banner.innerHTML = '<i></i>' + esc(label);
        } else {
          banner.textContent = label;
        }
        banner.style.display = "inline-flex";
      } else {
        banner.style.display = "none";
      }
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
    ensureStyles();
    c.innerHTML = "";
    const box = el(`
      <div class="card empty fade-rise">
        <div class="empty-glyph">◎</div>
        <div class="empty-title">Sign in to see your balances</div>
        <p class="empty-hint">Connect a wallet to see who owes you, what you owe, and your IOUs.</p>
        <button id="hSignIn" class="btn" type="button">Connect wallet</button>
        <div id="hSignInMsg" class="h-muted" style="margin-top:10px; font-size:.85rem"></div>
      </div>
    `);
    c.appendChild(box);
    const btn = box.querySelector("#hSignIn");
    const msg = box.querySelector("#hSignInMsg");
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

    ensureStyles();
    c.innerHTML = "";
    const view = el(`
      <div class="fade-rise">
        <div class="eyebrow">Your balances</div>
        <div id="hBalances">
          <div class="card">
            <div class="skeleton" style="height:14px; width:40%; margin-bottom:14px"></div>
            <div class="skeleton" style="height:42px; width:70%; margin-bottom:10px"></div>
            <div class="skeleton" style="height:14px; width:55%"></div>
          </div>
          <div class="skeleton" style="height:48px; margin:10px 0"></div>
          <div class="skeleton" style="height:48px; margin:10px 0"></div>
        </div>

        <div class="eyebrow" style="margin-top:26px">One-off IOUs</div>
        <p class="h-muted" style="margin:4px 0 10px; font-size:.9rem">A quick 1:1 debt — no trip needed.</p>
        <div id="hNewIouWrap" class="card" style="padding:14px;">
          <button id="hNewIouToggle" class="pill" type="button">＋ New IOU</button>
          <div id="hNewIouForm" style="display:none">
            <label>Who's it between?</label>
            <div id="hIouDir" class="chips" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:2px"></div>

            <label>Counterparty name</label>
            <input id="hIouName" class="input" placeholder="e.g. Ava" />

            <label>Counterparty wallet (optional)</label>
            <input id="hIouWallet" class="input" placeholder="Solana wallet (base58)" />

            <label>Amount ($)</label>
            <input id="hIouAmount" class="input" type="number" step="0.01" placeholder="0.00" />

            <label>Note (optional)</label>
            <input id="hIouNote" class="input" placeholder="e.g. Concert tickets" />

            <button id="hIouSave" class="btn" style="margin-top:16px">Add IOU</button>
            <div id="hIouStatus" class="h-muted" style="margin-top:8px; font-size:.85rem"></div>
          </div>
        </div>
        <div id="hIous">
          <div class="skeleton" style="height:60px; margin:10px 0"></div>
          <div class="skeleton" style="height:60px; margin:10px 0"></div>
        </div>
      </div>
    `);
    c.appendChild(view);

    // Open-debt banner lives just above the balances block (preserved id/handler).
    const banner = el('<div id="hOpenBanner" class="state-chip" style="display:none; margin:8px 0 0"><i></i></div>');
    view.insertBefore(banner, view.querySelector("#hBalances"));

    // Direction toggle for the new-IOU form.
    let iouDirection = "i_owe";
    const dirWrap = view.querySelector("#hIouDir");
    function renderDir() {
      dirWrap.innerHTML = "";
      const owe = el(`<button type="button" class="chip${iouDirection === "i_owe" ? " selected" : ""}">I owe</button>`);
      const owed = el(`<button type="button" class="chip${iouDirection === "they_owe" ? " selected" : ""}">They owe me</button>`);
      owe.onclick = () => { iouDirection = "i_owe"; renderDir(); };
      owed.onclick = () => { iouDirection = "they_owe"; renderDir(); };
      dirWrap.appendChild(owe);
      dirWrap.appendChild(owed);
    }
    renderDir();

    view.querySelector("#hNewIouToggle").onclick = () => {
      const f = view.querySelector("#hNewIouForm");
      const open = f.style.display === "none";
      f.style.display = open ? "block" : "none";
      view.querySelector("#hNewIouToggle").textContent = open ? "＋ New IOU ▴" : "＋ New IOU";
    };

    view.querySelector("#hIouSave").onclick = async () => {
      const status = view.querySelector("#hIouStatus");
      const counterpartyName = (view.querySelector("#hIouName").value || "").trim();
      const counterpartyWallet = (view.querySelector("#hIouWallet").value || "").trim();
      const amount = Number(view.querySelector("#hIouAmount").value);
      const note = (view.querySelector("#hIouNote").value || "").trim();
      if (!counterpartyName) { status.textContent = "Enter who it's with."; return; }
      if (!(amount > 0)) { status.textContent = "Enter an amount."; return; }
      status.textContent = "Saving…";
      try {
        const body = { direction: iouDirection, counterpartyName, amount };
        if (counterpartyWallet) body.counterpartyWallet = counterpartyWallet;
        if (note) body.note = note;
        await api("/api/ious", { method: "POST", body: JSON.stringify(body) });
        render(); // re-render on success
      } catch (err) {
        status.textContent = err.message || "Couldn't add IOU.";
      }
    };

    await Promise.all([loadBalances(), loadIous()]);
  }

  // ── balances ───────────────────────────────────────────────────────────────
  async function loadBalances() {
    const wrap = document.getElementById("hBalances");
    if (!wrap) return;
    let data;
    try {
      data = await api("/api/me/balances");
    } catch (err) {
      if (err && err.status === 401) { renderSignedOut(); return; }
      wrap.innerHTML = '<p class="h-muted" style="font-size:.9rem">Couldn\'t load balances.</p>';
      return;
    }

    const totals = data.totals || {};
    const netCents = totals.netCents || 0;
    const netOwed = netCents > 0;   // net positive -> you're owed
    const netOwes = netCents < 0;   // net negative -> you owe
    wrap.innerHTML = "";

    // Hero: net position is the emotional centerpiece.
    const heroClass = netOwed ? " pos" : (netOwes ? " neg" : "");
    let summaryLine;
    if (netOwed) {
      summaryLine = "you're up overall · you owe " + esc(totals.owesFmt || "$0.00") + " elsewhere";
    } else if (netOwes) {
      summaryLine = "you owe " + esc(totals.netFmt || "$0.00") + " net · you're owed " + esc(totals.owedFmt || "$0.00");
    } else {
      summaryLine = "You're all settled ✓";
    }
    const heroEyebrow = netOwed ? "Net — you're owed" : (netOwes ? "Net — you owe" : "Net balance");
    const header = el(`
      <div class="card fade-rise">
        <div class="eyebrow">${esc(heroEyebrow)}</div>
        <div class="hero-amount${heroClass}" style="margin:8px 0 6px">${esc(totals.netFmt || "$0.00")}</div>
        <div class="h-muted" style="font-size:.9rem">${summaryLine}</div>
        <div style="display:flex; gap:12px; margin-top:14px">
          <span class="mono pos" style="font-size:.85rem">+${esc(totals.owedFmt || "$0.00")} owed</span>
          <span class="mono neg" style="font-size:.85rem">−${esc(totals.owesFmt || "$0.00")} owe</span>
        </div>
      </div>
    `);
    wrap.appendChild(header);

    // Primary action: settle up when you owe, otherwise nudge those who owe you.
    const counterpartiesAll = Array.isArray(data.counterparties) ? data.counterparties : [];
    const anyOwes = counterpartiesAll.some((cp) => cp.direction === "owes");
    const anyOwed = counterpartiesAll.some((cp) => cp.direction === "owed");
    if (anyOwes || anyOwed) {
      const action = el(`<button class="btn" type="button">${anyOwes ? "Settle up" : "Request"}</button>`);
      action.onclick = () => {
        // Scroll to the first relevant balance row so the action is meaningful.
        const target = wrap.querySelector(anyOwes ? ".row .neg" : ".row .pos");
        if (target) target.closest(".row").scrollIntoView({ behavior: "smooth", block: "center" });
      };
      wrap.appendChild(action);
    }

    // Build a quick lookup of trip link by name so a person's reminder can carry a
    // trip link when one is available (counterparties don't include a link of
    // their own).
    const trips = Array.isArray(data.trips) ? data.trips : [];
    const tripLinkByName = {};
    for (const t of trips) {
      if (t.tripName && t.shareUrlPath) tripLinkByName[t.tripName] = location.origin + t.shareUrlPath;
    }

    // Per-counterparty list.
    const counterparties = counterpartiesAll;
    if (counterparties.length) {
      wrap.appendChild(el('<div class="eyebrow" style="margin-top:22px; margin-bottom:2px">By person</div>'));
      const list = el('<div class="card fade-rise" style="padding:4px 16px"></div>');
      for (const cp of counterparties) {
        const owed = cp.direction === "owed";
        const sub = owed ? "owes you" : "you owe";
        const row = el(`
          <div class="row">
            <div class="avatar">${initial(cp.name)}</div>
            <div class="meta">
              <div class="title">${esc(cp.name)}</div>
              <div class="sub">${sub}${cp.wallet ? " · " + esc(cp.wallet) : ""}</div>
            </div>
            <div class="amount ${owed ? "pos" : "neg"}">${owed ? "" : "−"}${esc(cp.fmt)}</div>
          </div>
        `);
        // Someone owes you -> offer a one-tap reminder via the share sheet.
        if (owed) {
          const meta = row.querySelector(".meta");
          const remindBtn = el('<button class="chip" type="button" style="margin-top:8px">Remind</button>');
          const note = el('<div class="h-muted" style="font-size:.8rem; display:none; margin-top:6px">Reminder copied</div>');
          remindBtn.onclick = () => {
            const link = tripLinkByName[cp.name] || null; // best-effort trip link by shared name
            shareReminder(reminderText(cp.name, cp.fmt, link), note);
          };
          meta.appendChild(remindBtn);
          meta.appendChild(note);
        }
        list.appendChild(row);
      }
      wrap.appendChild(list);
    }

    // Tally how many counterparties the user owes (for the badge/banner).
    openCounts.balances = counterparties.filter((cp) => cp.direction === "owes").length;
    updateBadge();

    // Per-trip list — each links to its share page.
    if (trips.length) {
      wrap.appendChild(el('<div class="eyebrow" style="margin-top:22px; margin-bottom:2px">By trip</div>'));
      const list = el('<div class="card fade-rise" style="padding:4px 16px"></div>');
      for (const t of trips) {
        let amountClass, sub, sign;
        if (t.direction === "owed") {
          amountClass = "pos"; sub = "you're owed"; sign = "";
        } else if (t.direction === "owes") {
          amountClass = "neg"; sub = "you owe"; sign = "−";
        } else {
          amountClass = "h-faint"; sub = "settled"; sign = "";
        }
        const href = t.shareUrlPath || "#";
        const amountText = t.direction === "settled" ? "settled" : (sign + esc(t.fmt || ""));
        const row = el(`
          <a class="row" href="${esc(href)}" style="text-decoration:none; color:inherit">
            <div class="avatar">${initial(t.tripName)}</div>
            <div class="meta">
              <div class="title">${esc(t.tripName)}</div>
              <div class="sub">${sub}</div>
            </div>
            <div class="amount ${amountClass}">${amountText}</div>
          </a>
        `);
        list.appendChild(row);
      }
      wrap.appendChild(list);
    }

    if (!counterparties.length && !trips.length) {
      wrap.appendChild(el(`
        <div class="card empty fade-rise">
          <div class="empty-glyph">✦</div>
          <div class="empty-title">You're all settled ✓</div>
          <p class="empty-hint">No balances yet — start a trip or add an IOU to track who owes who.</p>
        </div>
      `));
    }
  }

  // ── IOUs ───────────────────────────────────────────────────────────────────
  async function loadIous() {
    const wrap = document.getElementById("hIous");
    if (!wrap) return;
    let ious;
    try {
      ious = await api("/api/ious");
    } catch (err) {
      if (err && err.status === 401) { renderSignedOut(); return; }
      wrap.innerHTML = '<p class="h-muted" style="font-size:.9rem">Couldn\'t load IOUs.</p>';
      return;
    }
    if (!Array.isArray(ious) || ious.length === 0) {
      openCounts.ious = 0;
      updateBadge();
      wrap.innerHTML = `
        <div class="card empty fade-rise">
          <div class="empty-glyph">✎</div>
          <div class="empty-title">No IOUs yet</div>
          <p class="empty-hint">Track a quick 1:1 debt with a friend — no trip needed.</p>
        </div>`;
      return;
    }
    // Count open IOUs the user owes (status open + direction i_owe) for the badge.
    openCounts.ious = ious.filter(
      (iou) => iou.direction === "i_owe" && iou.status === "open").length;
    updateBadge();
    wrap.innerHTML = "";
    const list = el('<div class="card fade-rise"></div>');
    for (const iou of ious) {
      list.appendChild(renderIou(iou));
    }
    wrap.appendChild(list);
  }

  function renderIou(iou) {
    const iOwe = iou.direction === "i_owe";
    const name = esc(iou.counterpartyName);
    const amt = esc(iou.amountFmt);
    const sub = iOwe ? "you owe" : "owes you";
    const paid = iou.status === "paid";
    const badge = paid
      ? '<span class="state-chip settled"><i></i>PAID</span>'
      : '<span class="badge">OPEN</span>';
    // Money color rule: they owe you = accent (pos); you owe = terra (neg).
    const amountClass = paid ? "h-faint" : (iOwe ? "neg" : "pos");

    const row = el(`
      <div class="row" style="flex-wrap:wrap">
        <div class="avatar">${initial(iou.counterpartyName)}</div>
        <div class="meta">
          <div class="title">${name} ${badge}</div>
          <div class="sub">${sub}</div>
          ${iou.note ? `<div class="sub">${esc(iou.note)}</div>` : ""}
          ${iou.counterpartyWallet ? `<div class="sub">${esc(iou.counterpartyWallet)}</div>` : ""}
          ${iou.reference ? `<div class="sub">ref ${esc(iou.reference)}</div>` : ""}
        </div>
        <div class="amount ${amountClass}">${iOwe ? "−" : ""}${amt}</div>
        <button class="pill hIouDel" type="button" style="margin:0; width:auto; padding:8px 11px" aria-label="Delete">✕</button>
      </div>
    `);
    const meta = row.querySelector(".meta");

    // They owe you and it's still open -> offer a one-tap reminder (share sheet,
    // clipboard fallback). Include the Solana Pay link when the IOU carries one.
    if (!iOwe && !paid) {
      const remindBtn = el('<button class="chip hIouRemind" type="button" style="margin-top:8px">Remind</button>');
      const note = el('<div class="h-muted" style="font-size:.8rem; display:none; margin-top:6px">Reminder copied</div>');
      remindBtn.onclick = () => {
        shareReminder(reminderText(iou.counterpartyName, iou.amountFmt, iou.url || null), note);
      };
      meta.appendChild(remindBtn);
      meta.appendChild(note);
    }

    // For an open IOU the current user owes, and which has a payment url: show a
    // QR + open-in-wallet link + a "Check payment" button.
    if (!paid && iou.url) {
      const payBox = el(`
        <div style="width:100%; display:flex; gap:12px; align-items:center; margin-top:12px">
          <img src="${qrSrc(iou.url)}" alt="QR" style="width:120px;height:120px;border-radius:var(--radius-sm); background:#fff; padding:6px" />
          <div class="meta">
            <a href="${esc(iou.url)}" target="_blank" rel="noopener">Open in wallet</a>
            <div class="h-muted" style="font-size:.8rem; margin-top:6px">USDC payments are final.</div>
          </div>
        </div>
      `);
      meta.appendChild(payBox);

      const checkBtn = el('<button class="btn ghost hIouCheck" type="button" style="width:100%; margin-top:12px">Check payment</button>');
      checkBtn.onclick = async () => {
        checkBtn.textContent = "Checking…";
        try {
          await api("/api/ious/" + encodeURIComponent(iou.id) + "/settle/verify", { method: "POST" });
          render(); // re-render; shows paid badge on success
        } catch (err) {
          checkBtn.textContent = "Check payment";
          alert(err.message || "Couldn't verify payment.");
        }
      };
      meta.appendChild(checkBtn);
    }

    row.querySelector(".hIouDel").onclick = async () => {
      if (!confirm("Delete this IOU?")) return;
      try {
        await api("/api/ious/" + encodeURIComponent(iou.id), { method: "DELETE" });
        render();
      } catch (err) {
        alert(err.message || "Couldn't delete IOU.");
      }
    };

    return row;
  }

  // ── public API ───────────────────────────────────────────────────────────────
  function show() {
    render();
  }

  window.Home = { show };

  // Re-render the visible dashboard when sign-in state changes.
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
