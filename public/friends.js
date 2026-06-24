/* Divvy — Friends: see friends, add by @handle/wallet, start a group (Trip).
   Renders into #friends. Exposes window.Friends = { show }.

   All data requires a signed-in user (Auth.authFetch attaches the Bearer token).
   Backend API contract:
     GET    /api/friends
       -> { friends: [{ id, handle, displayName, primaryWallet }] }
     POST   /api/friends   { handle? , wallet? }
       -> { friend: {...} }   (404 if the person isn't a Divvy user yet)
     DELETE /api/friends/:friendUserId
       -> { ok: true }
     POST   /api/trips   { name, members:[{ name, wallet?, userId? }] }
       -> serialized trip (with id, shareUrlPath, shareToken)
*/
(function () {
  "use strict";

  const root = () => document.getElementById("friends");

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

  function shortWallet(w) {
    if (!w) return "";
    return w.length > 12 ? w.slice(0, 4) + "…" + w.slice(-4) : w;
  }

  // Best label for a friend: displayName, then @handle, then a shortened wallet.
  function friendLabel(f) {
    if (!f) return "friend";
    if (f.displayName) return f.displayName;
    if (f.handle) return "@" + f.handle;
    if (f.primaryWallet) return shortWallet(f.primaryWallet);
    return "friend";
  }

  // Name to send as the trip-member name for a friend.
  function friendMemberName(f) {
    return (f && (f.displayName || f.handle || (f.primaryWallet && shortWallet(f.primaryWallet)))) || "friend";
  }

  function myDisplayName() {
    const u = authUser();
    if (!u) return "You";
    return u.displayName || (u.handle ? "@" + u.handle : "You");
  }

  // JSON helper over Auth.authFetch. Throws Error(message).status on non-2xx,
  // carrying `.data` so callers can branch (e.g. 404 invite).
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

  // Local cache of the friends list (used by the "New group" selector).
  let friends = [];
  // Selected friend ids for the in-progress new group.
  const selectedIds = new Set();

  // ── signed-out state ─────────────────────────────────────────────────────────
  function renderSignedOut() {
    const c = root();
    if (!c) return;
    c.innerHTML = "";
    const box = el(`
      <div style="border:1px solid #8884; border-radius:12px; padding:16px; text-align:center">
        <p style="margin:0 0 4px; font-weight:600">Sign in to manage friends</p>
        <p class="muted" style="margin:0 0 12px">Connect a wallet to add friends and start a group trip together.</p>
        <button id="frSignIn" class="connect" type="button" style="margin:0">Connect wallet</button>
        <div id="frSignInMsg" class="muted" style="margin-top:8px"></div>
      </div>
    `);
    c.appendChild(box);
    const btn = box.querySelector("#frSignIn");
    const msg = box.querySelector("#frSignInMsg");
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
  function render() {
    const c = root();
    if (!c) return;

    if (!authUser()) { renderSignedOut(); return; }

    c.innerHTML = "";
    const view = el(`
      <div>
        <h1 style="font-size:1.4rem">Friends</h1>
        <p class="tag">Your crew on Divvy. Add friends, then start a group trip in a tap.</p>

        <div id="frAddWrap" style="border:1px solid #8884; border-radius:12px; padding:14px; margin-bottom:14px;">
          <label style="margin-top:0">Add a friend</label>
          <div id="frAddBy" class="chips"></div>
          <input id="frAddInput" placeholder="@handle" style="margin-top:8px" />
          <button id="frAddBtn">Add friend</button>
          <div id="frAddStatus" class="muted"></div>
        </div>

        <div id="frNewGroupWrap" style="border:1px solid #8884; border-radius:12px; padding:0 14px 14px; margin-bottom:14px;">
          <button id="frNewGroupToggle" class="toggle-link" type="button">＋ New group</button>
          <div id="frNewGroupForm" style="display:none">
            <label>Group name</label>
            <input id="frGroupName" placeholder="e.g. Bali 2026" />
            <label>Who's coming? (you're included)</label>
            <div id="frGroupPick" class="chips"></div>
            <button id="frGroupCreate">Create group</button>
            <div id="frGroupStatus" class="muted"></div>
          </div>
        </div>

        <h1 style="font-size:1.05rem; margin-top:18px">Your friends</h1>
        <div id="frList"><p class="muted">Loading…</p></div>
      </div>
    `);
    c.appendChild(view);

    // ── Add-friend "by" toggle (@handle vs wallet address) ──────────────────────
    let addBy = "handle";
    const byWrap = view.querySelector("#frAddBy");
    const addInput = view.querySelector("#frAddInput");
    function renderBy() {
      byWrap.innerHTML = "";
      const handleChip = el(`<button type="button" class="chip${addBy === "handle" ? " selected" : ""}">by @handle</button>`);
      const walletChip = el(`<button type="button" class="chip${addBy === "wallet" ? " selected" : ""}">by wallet address</button>`);
      handleChip.onclick = () => { addBy = "handle"; addInput.placeholder = "@handle"; renderBy(); };
      walletChip.onclick = () => { addBy = "wallet"; addInput.placeholder = "Solana wallet (base58)"; renderBy(); };
      byWrap.appendChild(handleChip);
      byWrap.appendChild(walletChip);
    }
    renderBy();

    view.querySelector("#frAddBtn").onclick = async () => {
      const status = view.querySelector("#frAddStatus");
      status.className = "muted";
      const raw = (addInput.value || "").trim();
      if (!raw) {
        status.textContent = addBy === "handle" ? "Enter a @handle." : "Enter a wallet address.";
        return;
      }
      const body = addBy === "handle"
        ? { handle: raw.replace(/^@+/, "") }
        : { wallet: raw };
      status.textContent = "Adding…";
      try {
        const data = await api("/api/friends", { method: "POST", body: JSON.stringify(body) });
        addInput.value = "";
        const added = (data && data.friend) || null;
        status.textContent = added
          ? "Added " + friendLabel(added) + " ✓"
          : "Friend added ✓";
        await loadFriends(); // refresh list + group picker
      } catch (err) {
        if (err && err.status === 401) { renderSignedOut(); return; }
        if (err && err.status === 404) {
          // Person isn't on Divvy yet — render a friendly invite message.
          const who = addBy === "handle" ? "@" + raw.replace(/^@+/, "") : shortWallet(raw);
          status.className = "muted";
          status.textContent = who + " isn't on Divvy yet — invite them to join, then add them.";
          return;
        }
        status.textContent = err.message || "Couldn't add that friend.";
      }
    };
    addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); view.querySelector("#frAddBtn").click(); }
    });

    // ── New group disclosure ────────────────────────────────────────────────────
    view.querySelector("#frNewGroupToggle").onclick = () => {
      const f = view.querySelector("#frNewGroupForm");
      const open = f.style.display === "none";
      f.style.display = open ? "block" : "none";
      view.querySelector("#frNewGroupToggle").textContent = open ? "＋ New group ▴" : "＋ New group";
    };

    view.querySelector("#frGroupCreate").onclick = createGroup;

    loadFriends();
  }

  // ── friends list + group picker ──────────────────────────────────────────────
  async function loadFriends() {
    const wrap = document.getElementById("frList");
    if (!wrap) return;
    let data;
    try {
      data = await api("/api/friends");
    } catch (err) {
      if (err && err.status === 401) { renderSignedOut(); return; }
      wrap.innerHTML = '<p class="muted">Couldn\'t load friends.</p>';
      return;
    }

    friends = (data && Array.isArray(data.friends)) ? data.friends : [];
    // Drop any selections for friends that no longer exist.
    const ids = new Set(friends.map((f) => f.id));
    for (const id of Array.from(selectedIds)) {
      if (!ids.has(id)) selectedIds.delete(id);
    }

    renderFriendList(wrap);
    renderGroupPicker();
  }

  function renderFriendList(wrap) {
    wrap.innerHTML = "";
    if (friends.length === 0) {
      wrap.innerHTML = '<p class="muted">No friends yet — add someone by @handle or wallet above.</p>';
      return;
    }
    for (const f of friends) {
      const sub = f.handle ? "@" + f.handle
        : (f.primaryWallet ? shortWallet(f.primaryWallet) : "");
      const row = el(`
        <div class="person" style="flex-wrap:wrap">
          <div class="meta">
            <div class="amt" style="font-size:1rem">${esc(friendLabel(f))}</div>
            ${sub ? `<div class="muted" style="word-break:break-all">${esc(sub)}</div>` : ""}
          </div>
          <button class="chip frRemove" type="button" style="margin:0" aria-label="Remove friend">✕</button>
        </div>
      `);
      row.querySelector(".frRemove").onclick = async () => {
        if (!confirm("Remove " + friendLabel(f) + " from your friends?")) return;
        try {
          await api("/api/friends/" + encodeURIComponent(f.id), { method: "DELETE" });
          selectedIds.delete(f.id);
          await loadFriends();
        } catch (err) {
          if (err && err.status === 401) { renderSignedOut(); return; }
          alert(err.message || "Couldn't remove friend.");
        }
      };
      wrap.appendChild(row);
    }
  }

  function renderGroupPicker() {
    const pick = document.getElementById("frGroupPick");
    if (!pick) return;
    pick.innerHTML = "";
    // You're always in the group — show a fixed, non-removable chip.
    pick.appendChild(el(`<span class="chip selected" style="cursor:default">${esc(myDisplayName())} (you)</span>`));
    if (friends.length === 0) {
      pick.appendChild(el('<span class="muted">Add a friend first to start a group.</span>'));
      return;
    }
    for (const f of friends) {
      const on = selectedIds.has(f.id);
      const chip = el(`<button type="button" class="chip${on ? " selected" : ""}">${esc(friendLabel(f))}</button>`);
      chip.onclick = () => {
        if (selectedIds.has(f.id)) selectedIds.delete(f.id);
        else selectedIds.add(f.id);
        chip.classList.toggle("selected");
      };
      pick.appendChild(chip);
    }
  }

  // ── create a group (Trip) from selected friends ──────────────────────────────
  async function createGroup() {
    const nameEl = document.getElementById("frGroupName");
    const status = document.getElementById("frGroupStatus");
    if (!nameEl || !status) return;
    const u = authUser();
    if (!u) { renderSignedOut(); return; }

    const name = (nameEl.value || "").trim();
    if (!name) { status.textContent = "Give the group a name."; return; }

    const chosen = friends.filter((f) => selectedIds.has(f.id));
    if (chosen.length === 0) {
      status.textContent = "Pick at least one friend for the group.";
      return;
    }

    // Members: you first, then each selected friend linked by userId + wallet so
    // the trip shows up in their account.
    const members = [{
      name: myDisplayName() || "You",
      wallet: u.primaryWallet || undefined,
      userId: u.id,
    }];
    for (const f of chosen) {
      members.push({
        name: friendMemberName(f),
        wallet: f.primaryWallet || undefined,
        userId: f.id,
      });
    }

    status.textContent = "Creating group…";
    try {
      const trip = await api("/api/trips", {
        method: "POST",
        body: JSON.stringify({ name, members }),
      });
      // Reset the in-progress selection so re-entry is clean.
      selectedIds.clear();
      // Deep-link to the new trip. Prefer Trips.openShared when available so we
      // stay in-app; otherwise navigate to the share path.
      const path = trip && trip.shareUrlPath;
      const token = trip && trip.shareToken;
      if (window.Trips && typeof window.Trips.openShared === "function" && token) {
        window.Trips.openShared(token);
      } else if (path) {
        location.href = path;
      } else if (token) {
        location.href = "/t/" + token;
      } else {
        status.textContent = "Group created ✓";
      }
    } catch (err) {
      if (err && err.status === 401) { renderSignedOut(); return; }
      status.textContent = err.message || "Couldn't create the group.";
    }
  }

  // ── public API ───────────────────────────────────────────────────────────────
  function show() {
    render();
  }

  window.Friends = { show };

  // Re-render the visible friends view when sign-in state changes.
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
