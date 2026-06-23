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
        <p style="margin:0 0 4px; font-weight:600">Sign in to see your balances</p>
        <p class="muted" style="margin:0 0 12px">Connect a wallet to see who owes you, what you owe, and your IOUs.</p>
        <button id="hSignIn" class="connect" type="button" style="margin:0">Connect wallet</button>
        <div id="hSignInMsg" class="muted" style="margin-top:8px"></div>
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

    c.innerHTML = "";
    const view = el(`
      <div>
        <h1 style="font-size:1.4rem">Balances</h1>
        <p class="tag">Who owes you, what you owe — across every trip and one-off IOU.</p>
        <div id="hBalances"><p class="muted">Loading…</p></div>

        <h1 style="font-size:1.05rem; margin-top:22px">IOUs</h1>
        <p class="muted" style="margin-top:0">A quick 1:1 debt — no trip needed.</p>
        <div id="hNewIouWrap" style="border:1px solid #8884; border-radius:12px; padding:0 14px 14px; margin-bottom:14px;">
          <button id="hNewIouToggle" class="toggle-link" type="button">＋ New IOU</button>
          <div id="hNewIouForm" style="display:none">
            <label>Who's it between?</label>
            <div id="hIouDir" class="chips"></div>

            <label>Counterparty name</label>
            <input id="hIouName" placeholder="e.g. Ava" />

            <label>Counterparty wallet (optional)</label>
            <input id="hIouWallet" placeholder="Solana wallet (base58)" />

            <label>Amount ($)</label>
            <input id="hIouAmount" type="number" step="0.01" placeholder="0.00" />

            <label>Note (optional)</label>
            <input id="hIouNote" placeholder="e.g. Concert tickets" />

            <button id="hIouSave">Add IOU</button>
            <div id="hIouStatus" class="muted"></div>
          </div>
        </div>
        <div id="hIous"><p class="muted">Loading…</p></div>
      </div>
    `);
    c.appendChild(view);

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
      wrap.innerHTML = '<p class="muted">Couldn\'t load balances.</p>';
      return;
    }

    const totals = data.totals || {};
    const netOwed = (totals.netCents || 0) > 0;
    wrap.innerHTML = "";

    // Big header: net position.
    const header = el(`
      <div style="border:1px solid #8884; border-radius:12px; padding:16px; margin-bottom:14px">
        <div class="summary" style="margin:0">
          <span class="muted">You're owed</span>
          <span style="font-weight:700; color:var(--green)">${esc(totals.owedFmt || "$0.00")}</span>
        </div>
        <div class="summary" style="margin:6px 0 0">
          <span class="muted">You owe</span>
          <span style="font-weight:700">${esc(totals.owesFmt || "$0.00")}</span>
        </div>
        <div class="summary" style="margin:10px 0 0; padding-top:10px; border-top:1px solid #8884">
          <span style="font-weight:700">Net</span>
          <span style="font-weight:800; font-size:1.2rem; color:${netOwed ? "var(--green)" : "inherit"}">${esc(totals.netFmt || "$0.00")}</span>
        </div>
      </div>
    `);
    wrap.appendChild(header);

    // Per-counterparty list.
    const counterparties = Array.isArray(data.counterparties) ? data.counterparties : [];
    if (counterparties.length) {
      wrap.appendChild(el('<h1 style="font-size:1rem; margin-top:18px">By person</h1>'));
      for (const cp of counterparties) {
        const owed = cp.direction === "owed";
        const text = owed
          ? esc(cp.name) + " — you're owed " + esc(cp.fmt)
          : esc(cp.name) + " — you owe " + esc(cp.fmt);
        const row = el(`
          <div class="person">
            <div class="meta">
              <div class="amt" style="font-size:1rem; color:${owed ? "var(--green)" : "inherit"}">${text}</div>
              ${cp.wallet ? `<div class="muted" style="word-break:break-all">${esc(cp.wallet)}</div>` : ""}
            </div>
          </div>
        `);
        wrap.appendChild(row);
      }
    }

    // Per-trip list — each links to its share page.
    const trips = Array.isArray(data.trips) ? data.trips : [];
    if (trips.length) {
      wrap.appendChild(el('<h1 style="font-size:1rem; margin-top:18px">By trip</h1>'));
      for (const t of trips) {
        let text, color;
        if (t.direction === "owed") {
          text = esc(t.tripName) + " — you're owed " + esc(t.fmt);
          color = "var(--green)";
        } else if (t.direction === "owes") {
          text = esc(t.tripName) + " — you owe " + esc(t.fmt);
          color = "inherit";
        } else {
          text = esc(t.tripName) + " — settled";
          color = "#888";
        }
        const href = t.shareUrlPath || "#";
        const row = el(`
          <a class="hist-item" href="${esc(href)}" style="display:block; text-decoration:none; color:inherit">
            <div class="top"><span>${esc(t.tripName)}</span><span style="color:${color}">${esc(t.fmt || "")}</span></div>
            <div class="sub muted"><span>${t.direction === "owed" ? "you're owed" : (t.direction === "owes" ? "you owe" : "settled")}</span><span></span></div>
          </a>
        `);
        wrap.appendChild(row);
      }
    }

    if (!counterparties.length && !trips.length) {
      wrap.appendChild(el('<p class="muted">No balances yet — start a trip or add an IOU.</p>'));
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
      wrap.innerHTML = '<p class="muted">Couldn\'t load IOUs.</p>';
      return;
    }
    if (!Array.isArray(ious) || ious.length === 0) {
      wrap.innerHTML = '<p class="muted">No IOUs yet.</p>';
      return;
    }
    wrap.innerHTML = "";
    for (const iou of ious) {
      wrap.appendChild(renderIou(iou));
    }
  }

  function renderIou(iou) {
    const iOwe = iou.direction === "i_owe";
    const name = esc(iou.counterpartyName);
    const amt = esc(iou.amountFmt);
    const headline = iOwe
      ? "You owe " + name + " " + amt
      : name + " owes you " + amt;
    const paid = iou.status === "paid";
    const badge = paid
      ? '<span class="badge paid">✓ paid</span>'
      : '<span class="badge">open</span>';

    const row = el(`
      <div class="person" style="flex-wrap:wrap">
        <div class="meta">
          <div class="amt" style="font-size:1rem; color:${iOwe ? "inherit" : "var(--green)"}">${headline} ${badge}</div>
          ${iou.note ? `<div class="muted">${esc(iou.note)}</div>` : ""}
          ${iou.counterpartyWallet ? `<div class="muted" style="word-break:break-all">${esc(iou.counterpartyWallet)}</div>` : ""}
          ${iou.reference ? `<div class="muted" style="word-break:break-all">ref ${esc(iou.reference)}</div>` : ""}
        </div>
        <button class="chip hIouDel" type="button" style="margin:0" aria-label="Delete">✕</button>
      </div>
    `);

    // For an open IOU the current user owes, and which has a payment url: show a
    // QR + open-in-wallet link + a "Check payment" button.
    if (!paid && iou.url) {
      const payBox = el(`
        <div style="width:100%; display:flex; gap:12px; align-items:center; margin-top:8px">
          <img src="${qrSrc(iou.url)}" alt="QR" style="width:120px;height:120px;border-radius:6px" />
          <div class="meta">
            <a href="${esc(iou.url)}" target="_blank" rel="noopener">Open in wallet</a>
            <div class="muted" style="margin-top:6px">USDC payments are final.</div>
          </div>
        </div>
      `);
      row.appendChild(payBox);

      const checkBtn = el('<button class="secondary hIouCheck" type="button" style="width:100%">Check payment</button>');
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
      row.appendChild(checkBtn);
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
