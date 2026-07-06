/* Divvy — Auth: progressive sign-in (Sign-In-With-Solana + gated Privy email).
   Exposes window.Auth. Everything is additive — signed-out flows keep working.

   Backend API contract:
     GET   /api/auth/config            -> { siws:true, privy:boolean }
     GET   /api/auth/nonce             -> { nonce, message }
     POST  /api/auth/siws/verify       { pubkey, signature(base64), message } -> { token, user }
     POST  /api/auth/privy/verify      { token, wallet? } -> { token, user } (501 if not configured)
     POST  /api/auth/handoff           (auth) -> { code }   single-use, 60s TTL
     POST  /api/auth/handoff/exchange  { code } -> { token, user } (401 unknown/expired/reused)
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
      // Any successful sign-in ends the explicit signed-out state, so the
      // silent local-wallet resume (init) is allowed again next boot.
      if (t) localStorage.removeItem(SIGNED_OUT_KEY);
    } catch (_) { /* storage may be unavailable; auth simply won't persist */ }
  }

  // Explicit sign-out marker: distinguishes "chose to log out" from "token
  // missing/expired". While set, init() must NOT silently re-sign-in with the
  // local burner wallet — otherwise tapping apple/google on the welcome screen
  // races a background wallet login and appears to "instantly make a wallet".
  const SIGNED_OUT_KEY = "divvy.signedOut";
  function explicitlySignedOut() {
    try { return localStorage.getItem(SIGNED_OUT_KEY) === "1"; } catch (_) { return false; }
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

  // onChange(cb) -> unsubscribe(). Returning an unsubscribe lets screens drop
  // their listener instead of leaking one per render.
  function onChange(cb) {
    if (typeof cb !== "function") return function () {};
    listeners.push(cb);
    return function unsubscribe() {
      var i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  // `ready` resolves once init() has determined the initial signed-in/out state,
  // so deep-links (which render before /api/me returns) can await it instead of
  // painting a wrong signed-out screen that never recovers.
  var settled = false;
  var resolveReady;
  var ready = new Promise(function (res) { resolveReady = res; });

  function fire() {
    if (!settled) { settled = true; resolveReady(Auth.user); }
    for (const cb of listeners.slice()) {
      try { cb(Auth.user); } catch (_) { /* a bad listener shouldn't break the rest */ }
    }
  }

  // ── init: load current user from a stored token ─────────────────────────────
  async function init() {
    if (!token()) {
      Auth.user = null;
      // Best-effort: a returning user with a local wallet but no session gets
      // silently re-signed-in — unless they explicitly logged out, in which
      // case the welcome screen must stay put so they can pick a real method.
      if (hasLocalWallet() && !explicitlySignedOut()) {
        try {
          await signInWithCreatedWallet(); // fires onChange on success
          return;
        } catch (_) { /* stay signed-out and fall through to fire() */ }
      }
      fire();
      return;
    }
    try {
      const data = await authJson("/api/me");
      Auth.user = (data && data.user) || null;
      // A stored-but-invalid token returns user:null — clear it so the UI resets.
      if (!Auth.user) setToken(null);
      cacheUser(Auth.user);
    } catch (err) {
      if (err.status === 401) {
        // 401 (expired/invalid token) — drop it and present as signed-out.
        setToken(null);
        Auth.user = null;
        cacheUser(null);
      } else {
        // Network hiccup (cold start in the iOS shell often races connectivity).
        // The token is still good — render the last-known identity instead of
        // bouncing a signed-in user to the welcome screen, and re-verify soon.
        Auth.user = cachedUser();
        scheduleReverify();
      }
    }
    fire();
  }

  // ── offline-tolerant identity cache ─────────────────────────────────────────
  // Last-known signed-in user, so a failed boot-time /api/me (no network yet)
  // doesn't present a signed-in user as signed-out. Cleared on sign-out/401.
  const USER_CACHE_KEY = "divvy.user.cache";
  function cacheUser(u) {
    try {
      if (u) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(u));
      else localStorage.removeItem(USER_CACHE_KEY);
    } catch (_) { /* non-persistent storage */ }
  }
  function cachedUser() {
    try { return JSON.parse(localStorage.getItem(USER_CACHE_KEY) || "null"); } catch (_) { return null; }
  }
  let reverifyTimer = null, reverifyAttempt = 0;
  function scheduleReverify() {
    if (reverifyTimer || !token()) return;
    const delay = Math.min(15000, 1000 * Math.pow(2, reverifyAttempt++));
    reverifyTimer = setTimeout(async () => {
      reverifyTimer = null;
      if (!token()) return;
      try {
        const data = await authJson("/api/me");
        const user = (data && data.user) || null;
        if (!user) setToken(null);
        Auth.user = user;
        cacheUser(user);
        reverifyAttempt = 0;
        fire();
      } catch (err) {
        if (err.status === 401) {
          setToken(null); Auth.user = null; cacheUser(null); fire();
        } else {
          scheduleReverify();
        }
      }
    }, delay);
  }
  // Re-verify as soon as connectivity returns.
  try {
    window.addEventListener("online", () => { reverifyAttempt = 0; scheduleReverify(); });
  } catch (_) { /* no window */ }

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

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ── base58 (Bitcoin alphabet) — Uint8Array -> string ────────────────────────
  // Used to encode a raw 32-byte Ed25519 public key as a Solana address.
  const B58_ALPHABET =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function base58Encode(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (arr.length === 0) return "";
    // Count leading zero bytes — each maps to a leading "1".
    let zeros = 0;
    while (zeros < arr.length && arr[zeros] === 0) zeros++;
    // Convert the big-endian byte array into base58 via repeated big-int math.
    const digits = [0];
    for (let i = zeros; i < arr.length; i++) {
      let carry = arr[i];
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    let out = "";
    for (let i = 0; i < zeros; i++) out += B58_ALPHABET[0];
    for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
    return out;
  }

  // ── Self-custodial in-browser wallet (Ed25519 via Web Crypto) ───────────────
  // SECURITY NOTE: the generated private key (pkcs8, base64) lives in the
  // browser's localStorage under "divvy.localWallet". This is suitable for
  // devnet / MVP only — anyone with access to the device's storage can recover
  // the key. For production, upgrade to a secure embedded wallet (e.g. a
  // passkey-bound or TEE-backed signer) rather than persisting raw key material.
  const LOCAL_WALLET_KEY = "divvy.localWallet";

  function readLocalWallet() {
    try {
      const raw = localStorage.getItem(LOCAL_WALLET_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (obj && obj.address && obj.pkcs8B64) return obj;
      return null;
    } catch (_) { return null; }
  }
  function writeLocalWallet(wallet) {
    try { localStorage.setItem(LOCAL_WALLET_KEY, JSON.stringify(wallet)); } catch (_) { /* non-persistent */ }
  }
  function hasLocalWallet() {
    return !!readLocalWallet();
  }

  // Generate a fresh Ed25519 keypair. Returns { address, pkcs8B64, privateKey }.
  // `address` is the base58-encoded raw 32-byte public key (the Solana address).
  async function genKeypair() {
    const kp = await crypto.subtle.generateKey(
      { name: "Ed25519" }, true, ["sign", "verify"]);
    const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
    return {
      address: base58Encode(rawPub),
      pkcs8B64: bytesToBase64(pkcs8),
      privateKey: kp.privateKey,
    };
  }

  // Import a persisted pkcs8 (base64) private key for signing.
  async function importPrivateKey(pkcs8B64) {
    return crypto.subtle.importKey(
      "pkcs8", base64ToBytes(pkcs8B64), { name: "Ed25519" }, false, ["sign"]);
  }

  // Run the nonce -> sign -> verify flow with a CryptoKey private key.
  // `address` is the base58 Solana address (raw pubkey). Returns Auth.user.
  async function siwsSignInWithKey(address, privateKey) {
    const { nonce, message } = await authJson("/api/auth/nonce");
    void nonce; // nonce is embedded in `message`; we sign the message verbatim.
    const messageBytes = new TextEncoder().encode(message);
    const sig = await crypto.subtle.sign("Ed25519", privateKey, messageBytes);
    const signature = bytesToBase64(new Uint8Array(sig));
    const data = await authJson("/api/auth/siws/verify", {
      method: "POST",
      body: JSON.stringify({ pubkey: address, signature, message }),
    });
    setToken(data.token);
    Auth.user = data.user || null;
    fire();
    return Auth.user;
  }

  // Create a brand-new browser wallet, persist it, and sign in.
  async function createWallet() {
    let kp;
    try {
      kp = await genKeypair();
    } catch (err) {
      throw new Error(
        "Your browser can't create a wallet here — connect Phantom or use email instead.");
    }
    writeLocalWallet({ address: kp.address, pkcs8B64: kp.pkcs8B64 });
    try {
      return await siwsSignInWithKey(kp.address, kp.privateKey);
    } catch (err) {
      // Wallet is persisted; surface the sign-in failure but keep the keypair so
      // the user can retry via signInWithCreatedWallet().
      throw err;
    }
  }

  // Sign in with an already-created browser wallet (returning users).
  async function signInWithCreatedWallet() {
    const wallet = readLocalWallet();
    if (!wallet) throw new Error("No wallet created on this device yet.");
    let privateKey;
    try {
      privateKey = await importPrivateKey(wallet.pkcs8B64);
    } catch (err) {
      throw new Error("Couldn't load your saved wallet on this device.");
    }
    return siwsSignInWithKey(wallet.address, privateKey);
  }

  // Return the persisted secret so a UI can let the user back it up.
  // SECURITY NOTE: this exposes raw key material that lives in browser storage
  // (devnet/MVP). Treat it like a seed phrase; do not log or transmit it. For
  // production, upgrade to a secure embedded wallet instead of exporting keys.
  function exportWalletSecret() {
    const wallet = readLocalWallet();
    if (!wallet) return null;
    return { address: wallet.address, pkcs8B64: wallet.pkcs8B64 };
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
    cacheUser(null);
    // Mark the sign-out as deliberate. The local burner wallet key stays in
    // storage (for wallet-created accounts it's the only way back in), but it
    // won't be used to silently re-sign-in until the user signs in again.
    try { localStorage.setItem(SIGNED_OUT_KEY, "1"); } catch (_) { /* non-persistent */ }
    fire();
  }

  // ── Native OAuth handoff (Capacitor iOS shell deep link) ────────────────────
  // Social sign-in runs in the SYSTEM browser (Google blocks OAuth inside the
  // shell's WKWebView), which deep-links back with a single-use code:
  //   divvy://auth?code=<code>  →  POST /api/auth/handoff/exchange → { token, user }
  // Plain web/PWA: window.Capacitor is absent and all of this is a no-op.
  // The link may also carry a `ret` path (e.g. the sign-in-methods flow returns
  // to /#/you) — sanitized to a SAME-ORIGIN path, mirroring web/src/safeReturn.ts.
  function parseHandoff(url) {
    var m = /^divvy:\/\/auth\/?\?(.*)$/i.exec(String(url || ""));
    if (!m) return null;
    try {
      var p = new URLSearchParams(m[1]);
      var ret = p.get("ret");
      if (!ret || !/^\/(?![/\\])/.test(ret)) ret = null;
      return { code: p.get("code"), ret: ret };
    } catch (_) { return null; }
  }

  var handledHandoffUrls = {};
  function handleAppUrl(url) {
    var parsed = parseHandoff(url);
    var code = parsed && parsed.code;
    if (!code) return;
    // getLaunchUrl (cold start) and appUrlOpen (warm) can both deliver the same
    // URL — exchange it once; the server rejects a replay anyway.
    if (handledHandoffUrls[url]) return;
    handledHandoffUrls[url] = true;
    authJson("/api/auth/handoff/exchange", {
      method: "POST",
      body: JSON.stringify({ code: code }),
    }).then(function (data) {
      setToken(data.token);
      Auth.user = (data && data.user) || null;
      cacheUser(Auth.user);
      fire();
      // Land on the signed-in entry via a full reload (re-runs init() with the
      // token present) — same destination the in-page /embedded flow uses,
      // unless the deep link asked for a specific screen (sign-in-methods
      // linking returns to /#/you instead of replaying onboarding).
      if (!(parsed && parsed.ret)) {
        try { sessionStorage.setItem("divvy.onboardVia", "privy"); } catch (_) {}
      }
      try { window.location.href = (parsed && parsed.ret) || "/#/welcome"; } catch (_) { /* keep current screen */ }
    }).catch(function () {
      // Expired/reused code (user lingered in Safari) — stay signed out; the
      // welcome screen still works and a fresh sign-in mints a fresh code.
    });
  }

  function initNativeHandoff() {
    try {
      var cap = window.Capacitor;
      if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
      var AppPlugin = cap.Plugins && cap.Plugins.App;
      if (!AppPlugin) return; // old binary without @capacitor/app — no-op
      AppPlugin.addListener("appUrlOpen", function (ev) {
        // Close the in-app Safari sheet the login opened, if any.
        try {
          if (cap.Plugins.Browser && cap.Plugins.Browser.close) {
            cap.Plugins.Browser.close().catch(function () {});
          }
        } catch (_) {}
        handleAppUrl(ev && ev.url);
      });
      // Cold start: the deep link may have LAUNCHED the app before the listener
      // above existed.
      if (AppPlugin.getLaunchUrl) {
        AppPlugin.getLaunchUrl().then(function (r) {
          if (r && r.url) handleAppUrl(r.url);
        }).catch(function () {});
      }
    } catch (_) { /* never let the native hook break web auth */ }
  }
  initNativeHandoff();

  const Auth = {
    user: null,
    token,
    authFetch,
    init,
    onChange,
    ready,
    signInWithWallet,
    signInWithPrivy,
    updateProfile,
    signOut,
    // Self-custodial in-browser wallet (Ed25519 / Web Crypto).
    createWallet,
    signInWithCreatedWallet,
    hasLocalWallet,
    exportWalletSecret,
  };
  window.Auth = Auth;

  document.addEventListener("DOMContentLoaded", () => { init(); });
})();
