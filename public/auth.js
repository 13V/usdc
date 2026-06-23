/* Divvy — Auth: progressive sign-in (Sign-In-With-Solana + gated Privy email).
   Exposes window.Auth. Everything is additive — signed-out flows keep working.

   Backend API contract:
     GET   /api/auth/config            -> { siws:true, privy:boolean }
     GET   /api/auth/nonce             -> { nonce, message }
     POST  /api/auth/siws/verify       { pubkey, signature(base64), message } -> { token, user }
     POST  /api/auth/privy/verify      { token, wallet? } -> { token, user } (501 if not configured)
     GET   /api/me                     -> { user | null }
     PATCH /api/me                     { handle?, displayName? } -> { user } (409 if taken)
   Authenticated requests send `Authorization: Bearer <token>`.
*/
(function () {
  "use strict";

  const TOKEN_KEY = "divvy.token";
  const listeners = [];

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch (_) { return null; }
  }
  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (_) { /* storage may be unavailable; auth simply won't persist */ }
  }

  // authFetch — like fetch() but injects the Bearer header when signed in.
  function authFetch(url, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    const t = token();
    if (t) headers["Authorization"] = "Bearer " + t;
    return fetch(url, Object.assign({}, opts, { headers }));
  }

  // JSON helper built on authFetch. Throws Error(message) on non-2xx, with a
  // `.status` property so callers can branch (e.g. 409 handle-taken, 501 privy).
  async function authJson(url, opts) {
    const res = await authFetch(url, Object.assign(
      { headers: { "content-type": "application/json" } }, opts || {}));
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

  function onChange(cb) {
    if (typeof cb === "function") listeners.push(cb);
  }
  function fire() {
    for (const cb of listeners) {
      try { cb(Auth.user); } catch (_) { /* a bad listener shouldn't break the rest */ }
    }
  }

  // ── init: load current user from a stored token ─────────────────────────────
  async function init() {
    if (!token()) { Auth.user = null; fire(); return; }
    try {
      const data = await authJson("/api/me");
      Auth.user = (data && data.user) || null;
      // A stored-but-invalid token returns user:null — clear it so the UI resets.
      if (!Auth.user) setToken(null);
    } catch (err) {
      // 401 (expired/invalid token) — drop it and present as signed-out.
      if (err.status === 401) setToken(null);
      Auth.user = null;
    }
    fire();
  }

  // ── Sign-In-With-Solana (injected wallet) ───────────────────────────────────
  function getSolanaProvider() {
    if (window.phantom && window.phantom.solana) return window.phantom.solana;
    if (window.solana) return window.solana;
    return null;
  }

  function bytesToBase64(bytes) {
    let bin = "";
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  async function signInWithWallet() {
    const provider = getSolanaProvider();
    if (!provider) {
      throw new Error("No Solana wallet found. Install Phantom or use email.");
    }
    // Connect (prompts the user if not already connected).
    await provider.connect();

    const { nonce, message } = await authJson("/api/auth/nonce");
    void nonce; // nonce is embedded in `message`; we sign the message verbatim.

    const encoded = new TextEncoder().encode(message);
    const signed = await provider.signMessage(encoded, "utf8");
    // signMessage returns either a Uint8Array or { signature: Uint8Array }.
    const sigBytes = (signed && signed.signature) ? signed.signature : signed;
    const signature = bytesToBase64(sigBytes);

    const pubkey = provider.publicKey.toString();
    const data = await authJson("/api/auth/siws/verify", {
      method: "POST",
      body: JSON.stringify({ pubkey, signature, message }),
    });
    setToken(data.token);
    Auth.user = data.user || null;
    fire();
    return Auth.user;
  }

  // ── Privy email sign-in (gated) ─────────────────────────────────────────────
  async function signInWithPrivy() {
    const cfg = await authJson("/api/auth/config");
    if (!cfg || !cfg.privy) {
      throw new Error("Email sign-in isn't configured yet — connect a wallet instead.");
    }
    // TODO: acquire a real Privy access token here. The embedded React app at
    // /embedded handles the actual Privy login flow; once it hands back a token
    // (and optionally an embedded wallet address), POST it for verification.
    // Until that's wired, surface a clear message rather than a silent no-op.
    const privyToken = (typeof window.__divvyPrivyToken === "string")
      ? window.__divvyPrivyToken : null;
    if (!privyToken) {
      throw new Error("Open the email sign-in app to continue (/embedded).");
    }
    const body = { token: privyToken };
    if (typeof window.__divvyPrivyWallet === "string" && window.__divvyPrivyWallet) {
      body.wallet = window.__divvyPrivyWallet;
    }
    const data = await authJson("/api/auth/privy/verify", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setToken(data.token);
    Auth.user = data.user || null;
    fire();
    return Auth.user;
  }

  // ── update profile (handle / displayName) ───────────────────────────────────
  async function updateProfile(patch) {
    const data = await authJson("/api/me", {
      method: "PATCH",
      body: JSON.stringify(patch || {}),
    });
    Auth.user = (data && data.user) || Auth.user;
    fire();
    return Auth.user;
  }

  function signOut() {
    setToken(null);
    Auth.user = null;
    fire();
  }

  const Auth = {
    user: null,
    token,
    authFetch,
    init,
    onChange,
    signInWithWallet,
    signInWithPrivy,
    updateProfile,
    signOut,
  };
  window.Auth = Auth;

  document.addEventListener("DOMContentLoaded", () => { init(); });
})();
