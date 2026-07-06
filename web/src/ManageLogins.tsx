import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useLinkAccount } from "@privy-io/react-auth";
import { safeReturnPath } from "./safeReturn";
import { isNativeShell, openInSystemBrowser } from "./native";

// Sign-in methods manager (embedded). Lists the login methods linked to the
// signed-in user's Privy account (email / phone / apple / google) and lets them
// link the missing ones, so "sign in with apple" later resolves to THIS account
// instead of minting a fresh Privy user (and a second empty Divvy account).
// Reached from the main app's "you" screen at /embedded/?manage=logins&ret=/#/you
//
// Linking is Privy-side only: useLinkAccount always attaches to the CURRENTLY
// authenticated Privy user (Privy's own semantics), and the Divvy account is
// keyed by the Privy DID — which linking never changes — so no server work is
// needed and the same Divvy account keeps resolving afterwards.
//
// Capacitor shell: apple/google linking is OAuth, which the WKWebView can't
// complete (same "disallowed_useragent" restriction as login). Reuse the
// native-handoff pattern: divert to the system browser with
// ?handoff=native-link[&method=…]; the user signs into Privy THERE (with a
// method already on their account), the link runs in Safari, then a single-use
// code (POST /api/auth/handoff) deep-links back via divvy://auth?code=…&ret=…
// so the shell session refreshes. Email/phone link fine in-webview.

const DIVVY_TOKEN_KEY = "divvy.token";
// Per-tab flag so the Safari leg doesn't restart an OAuth link in a loop after
// the provider redirects back to this same URL (method= is still in the query).
const LINK_FLAG = "divvy.linkStarted.";

type Method = "email" | "phone" | "apple" | "google";
const OAUTH_METHODS: Method[] = ["apple", "google"];

// ---- journal styling (matches Wallet.tsx) -----------------------------------
const wrap: React.CSSProperties = {
  position: "relative", width: "100%", maxWidth: 430, margin: "0 auto", minHeight: "100vh",
  background: "#F7F1E3", color: "#2B2118", fontFamily: "'General Sans',sans-serif",
  display: "flex", flexDirection: "column", padding: "0 22px", boxSizing: "border-box",
};
const card: React.CSSProperties = {
  background: "#FFFDF7", border: "2px solid #2B2118", borderRadius: 18,
  boxShadow: "3px 4px 0 rgba(43,33,24,0.85)",
  padding: 18, width: "100%", margin: "11px 0", boxSizing: "border-box",
};
const primary: React.CSSProperties = {
  appearance: "none", cursor: "pointer", width: "100%", minHeight: 54,
  borderRadius: 999, background: "#2775CA", border: "2px solid #2B2118", color: "#fff",
  fontFamily: "'Clash Display','General Sans',sans-serif", fontWeight: 600, fontSize: 16,
  boxShadow: "3px 3px 0 rgba(43,33,24,0.9)", marginTop: 12,
};
const linkBtn: React.CSSProperties = {
  appearance: "none", cursor: "pointer", minHeight: 34, padding: "4px 16px",
  borderRadius: 999, background: "#FFFDF7", border: "2px solid #2B2118", color: "#2B2118",
  fontFamily: "'Clash Display','General Sans',sans-serif", fontWeight: 600, fontSize: 13,
  boxShadow: "2px 2px 0 rgba(43,33,24,0.35)", flex: "none",
};
const mono = "'Space Mono',monospace";

function trunc(s: string | null | undefined, max = 26): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function linkFlagSet(m: Method): boolean {
  try { return sessionStorage.getItem(LINK_FLAG + m) === "1"; } catch { return false; }
}
function setLinkFlag(m: Method, on: boolean): void {
  try {
    if (on) sessionStorage.setItem(LINK_FLAG + m, "1");
    else sessionStorage.removeItem(LINK_FLAG + m);
  } catch { /* non-persistent storage */ }
}

export function ManageLogins() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const ret = safeReturnPath(q.get("ret"), "/#/you");
  // Safari leg of the native link handoff: link here, then hand the session
  // back to the shell with a single-use code (never render the shell's chrome).
  const handoffLeg = q.get("handoff") === "native-link";
  const qMethod = q.get("method");
  const startMethod: Method | null = qMethod === "apple" || qMethod === "google" ? qMethod : null;

  const { ready, authenticated, user, login, getAccessToken } = usePrivy();

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Set once a handoff code is minted: renders the "hop back to the app" card.
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const autoStartRef = useRef(false);
  const returningRef = useRef(false);

  // GUARDRAIL: the link UI must never be reachable signed-out. Privy itself
  // only links to the CURRENTLY authenticated user, but we additionally require
  // a Divvy session (bearer token) before showing anything — mirroring Wallet.
  // The Safari handoff leg runs in a separate browser context that may not hold
  // the shell's token; there, Privy auth is the gate and a Divvy token is
  // minted via /api/auth/privy/verify before any handoff code is issued.
  const hasDivvyToken = (() => {
    try { return !!localStorage.getItem(DIVVY_TOKEN_KEY); } catch { return false; }
  })();

  // Dismissing a Privy sheet is a choice, not a failure (same as Wallet.tsx).
  function soften(e: unknown, fallback: string) {
    const raw = String((e as Error)?.message || e || "");
    if (/exited|closed|cancel/i.test(raw)) {
      setMsg("no worries — closed without changes 🐸");
      return;
    }
    setErr(raw || fallback);
  }

  const { linkEmail, linkPhone, linkGoogle, linkApple } = useLinkAccount({
    onSuccess: ({ linkMethod }) => {
      setBusy(null);
      (["email", "phone", "apple", "google"] as Method[]).forEach((m) => setLinkFlag(m, false));
      setErr(null);
      setMsg(`${linkMethod} linked — it now signs you into this same account ✨`);
      // Safari leg: flow straight back into the shell so the session refreshes.
      if (handoffLeg) void returnToApp();
    },
    onError: (error, details) => {
      setBusy(null);
      (["email", "phone", "apple", "google"] as Method[]).forEach((m) => setLinkFlag(m, false));
      void details;
      soften(new Error(String(error || "")), "couldn't link that method — try again in a moment.");
    },
  });

  // Kick off the actual Privy link flow (modal for email/phone, full-page OAuth
  // redirect for apple/google — the redirect returns to this same URL).
  function runLink(m: Method) {
    setErr(null); setMsg(null); setBusy(m);
    setLinkFlag(m, true);
    if (m === "email") linkEmail();
    else if (m === "phone") linkPhone();
    else if (m === "google") linkGoogle();
    else linkApple();
  }

  // User tapped "link" on a method. In the shell, OAuth methods divert to the
  // system browser (same restriction as login); everything else runs in place.
  function startLink(m: Method) {
    if (OAUTH_METHODS.includes(m) && isNativeShell() && !handoffLeg) {
      setErr(null); setMsg(null);
      const url = `${window.location.origin}/embedded/?manage=logins&handoff=native-link&method=${m}&ret=${encodeURIComponent(ret)}`;
      void openInSystemBrowser(url).then((opened) => {
        if (opened) {
          // Park the webview back on the main app: its auth.js holds the
          // divvy:// deep-link listener that redeems the returning handoff
          // code (this /embedded/ page doesn't load auth.js). Nothing breaks
          // if the user closes Safari early — they just land on `ret`.
          window.location.href = ret;
        } else {
          runLink(m); // old binary without the Browser plugin: try in place
        }
      });
      return;
    }
    runLink(m);
  }

  // Plain web: open Privy sign-in automatically, like Wallet.tsx. Never inside
  // the shell (diverting is the right move there) and never on the Safari leg
  // (an auto-opened modal invites "sign in with apple" — which would CREATE the
  // duplicate account this page exists to prevent; the interstitial explains
  // to sign in with an existing method first).
  useEffect(() => {
    if (!ready || authenticated || handoffLeg) return;
    if (isNativeShell()) return;
    if (!hasDivvyToken) return; // signed-out visitor: show the sign-in card instead
    login();
  }, [ready, authenticated, login, handoffLeg, hasDivvyToken]);

  // Safari leg with ?method=…: start that link automatically once signed in,
  // unless it's already linked or this page load IS the OAuth return trip.
  useEffect(() => {
    if (!handoffLeg || !ready || !authenticated || !startMethod) return;
    if (autoStartRef.current) return;
    if (user && user[startMethod]) return; // already linked — nothing to start
    if (linkFlagSet(startMethod)) return; // OAuth round-trip in progress
    autoStartRef.current = true;
    runLink(startMethod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffLeg, ready, authenticated, startMethod, user]);

  // Safari leg: exchange the Privy session for a Divvy token, mint a single-use
  // handoff code, and deep-link back into the shell (same contract as Login.tsx;
  // public/auth.js exchanges the code and lands on `ret`).
  async function returnToApp() {
    if (returningRef.current) return;
    returningRef.current = true;
    setBusy("return"); setErr(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("no-token");
      const vr = await fetch("/api/auth/privy/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const vd = await vr.json().catch(() => null);
      if (!vr.ok || !vd || typeof vd.token !== "string") throw new Error((vd && vd.error) || "verify-failed");
      try { localStorage.setItem(DIVVY_TOKEN_KEY, vd.token); } catch { /* private mode */ }
      const hr = await fetch("/api/auth/handoff", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${vd.token}` },
      });
      const hd = await hr.json().catch(() => null);
      if (!hr.ok || !hd || typeof hd.code !== "string") throw new Error("handoff-failed");
      const link = `divvy://auth?code=${encodeURIComponent(hd.code)}&ret=${encodeURIComponent(ret)}`;
      setDeepLink(link);
      // Best-effort auto-return; Safari may require the explicit tap the
      // rendered card provides (custom schemes can need a user gesture).
      window.location.href = link;
    } catch (e) {
      setErr((e as Error).message || "couldn't hand back to the app — try the button again.");
    } finally {
      setBusy(null);
      returningRef.current = false;
    }
  }

  const methods: Array<{ key: Method; icon: string; label: string; detail: string | null; linked: boolean }> = [
    { key: "email", icon: "✉️", label: "email", detail: trunc(user?.email?.address), linked: !!user?.email },
    { key: "phone", icon: "📱", label: "phone", detail: trunc(user?.phone?.number), linked: !!user?.phone },
    { key: "apple", icon: "🍎", label: "apple", detail: trunc(user?.apple?.email), linked: !!user?.apple },
    { key: "google", icon: "🔵", label: "google", detail: trunc(user?.google?.email), linked: !!user?.google },
  ];

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 12, height: 60, flex: "none" }}>
      {!handoffLeg && (
        <div onClick={() => (window.location.href = ret)} title="back"
          style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(43,33,24,0.05)", border: "1px solid rgba(43,33,24,0.08)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <span style={{ color: "rgba(43,33,24,0.6)", fontSize: 18 }}>‹</span>
        </div>
      )}
      <span style={{ fontFamily: "'Clash Display','General Sans',sans-serif", fontWeight: 600, fontSize: 19 }}>sign-in methods</span>
    </div>
  );

  // ---- render branches -------------------------------------------------------

  if (deepLink) {
    return (
      <div style={wrap}>
        {header}
        <div style={card}>
          <div style={{ fontFamily: "'Clash Display','General Sans',sans-serif", fontWeight: 600, fontSize: 18 }}>all set — hop back to the app</div>
          <div style={{ fontFamily: "'General Sans',sans-serif", fontSize: 13.5, lineHeight: 1.5, color: "rgba(43,33,24,0.55)", marginTop: 6 }}>
            your sign-in methods are saved. tap below to finish up in Divvy.
          </div>
          <a href={deepLink} style={{ ...primary, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            return to the divvy app
          </a>
          <div style={{ fontFamily: mono, fontSize: 10.5, color: "rgba(43,33,24,0.35)", marginTop: 12, textAlign: "center" }}>
            this link works for about a minute
          </div>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div style={wrap}>
        {header}
        <p style={{ color: "rgba(43,33,24,0.5)", marginTop: 24 }}>starting…</p>
      </div>
    );
  }

  // Signed-out visitor (no Divvy session) outside the handoff leg: no link UI.
  if (!handoffLeg && !hasDivvyToken) {
    return (
      <div style={wrap}>
        {header}
        <div style={card}>
          <div style={{ fontFamily: "'Clash Display','General Sans',sans-serif", fontWeight: 600, fontSize: 16 }}>sign in to divvy first</div>
          <div style={{ fontFamily: "'General Sans',sans-serif", fontSize: 13.5, lineHeight: 1.5, color: "rgba(43,33,24,0.55)", marginTop: 6 }}>
            managing sign-in methods needs a signed-in account.
          </div>
          <button style={primary} onClick={() => (window.location.href = `/embedded/?return=${encodeURIComponent(ret)}`)}>
            sign in
          </button>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    if (handoffLeg) {
      // Safari leg, not yet signed into Privy here. The user must sign in with
      // a method ALREADY on their account — signing in with the new one would
      // create the very duplicate account linking exists to prevent.
      return (
        <div style={wrap}>
          {header}
          <div style={card}>
            <div style={{ fontFamily: "'Clash Display','General Sans',sans-serif", fontWeight: 600, fontSize: 16 }}>first, sign in the way you usually do</div>
            <div style={{ fontFamily: "'General Sans',sans-serif", fontSize: 13.5, lineHeight: 1.5, color: "rgba(43,33,24,0.55)", marginTop: 6 }}>
              use a method that's <b>already on your divvy account</b> — like your email or phone.
              {startMethod ? ` then we'll add ${startMethod} to it automatically.` : " then you can add new ways to sign in."}
            </div>
            <button style={primary} onClick={() => login()}>sign in</button>
            <div style={{ fontFamily: mono, fontSize: 10.5, lineHeight: 1.6, color: "rgba(43,33,24,0.4)", marginTop: 12 }}>
              heads up: picking a brand-new method here would start a separate account instead of linking this one.
            </div>
          </div>
        </div>
      );
    }
    if (isNativeShell()) {
      // Shell webview without a Privy session (the user onboarded via the
      // Safari handoff, so Privy lives there): manage everything in Safari.
      return (
        <div style={wrap}>
          {header}
          <div style={card}>
            <div style={{ fontFamily: "'Clash Display','General Sans',sans-serif", fontWeight: 600, fontSize: 16 }}>manage your sign-in methods in Safari</div>
            <div style={{ fontFamily: "'General Sans',sans-serif", fontSize: 13.5, lineHeight: 1.5, color: "rgba(43,33,24,0.55)", marginTop: 6 }}>
              your sign-in lives in the browser you signed up with. we'll open it there and bring you right back.
            </div>
            <button style={primary} onClick={() => {
              setErr(null);
              const url = `${window.location.origin}/embedded/?manage=logins&handoff=native-link&ret=${encodeURIComponent(ret)}`;
              void openInSystemBrowser(url).then((opened) => {
                // Park the webview on the main app so its auth.js deep-link
                // listener can redeem the returning handoff code.
                if (opened) window.location.href = ret;
                else login(); // old binary fallback: in-webview modal (email/phone work)
              });
            }}>open in safari</button>
          </div>
        </div>
      );
    }
    return (
      <div style={wrap}>
        {header}
        <button style={primary} onClick={() => login()}>sign in to manage your logins</button>
      </div>
    );
  }

  return (
    <div style={wrap}>
      {header}

      <div style={card}>
        <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1, color: "rgba(43,33,24,0.4)" }}>WAYS TO SIGN IN</div>
        <div style={{ fontFamily: "'General Sans',sans-serif", fontSize: 12.5, color: "rgba(43,33,24,0.5)", marginTop: 6 }}>
          all of these open this same account — same wallet, same tabs, same friends.
        </div>
      </div>

      {methods.map((m) => (
        <div key={m.key} style={{ ...card, display: "flex", alignItems: "center", gap: 13 }}>
          <div style={{ width: 34, height: 34, borderRadius: 11, background: "rgba(39,117,202,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flex: "none" }}>{m.icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Clash Display','General Sans',sans-serif", fontWeight: 600, fontSize: 15 }}>{m.label}</div>
            <div style={{ fontFamily: mono, fontSize: 11, color: m.linked ? "#17967f" : "rgba(43,33,24,0.45)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {m.linked ? `${m.detail || "connected"} ✓` : "not linked"}
            </div>
          </div>
          {!m.linked && (
            <button style={linkBtn} onClick={() => startLink(m.key)} disabled={busy != null}>
              {busy === m.key ? "opening…" : "link"}
            </button>
          )}
        </div>
      ))}

      {handoffLeg && (
        <button style={primary} onClick={() => void returnToApp()} disabled={busy != null}>
          {busy === "return" ? "one sec…" : "back to the divvy app"}
        </button>
      )}

      <div style={{ fontFamily: mono, fontSize: 10.5, lineHeight: 1.6, color: "rgba(43,33,24,0.4)", marginTop: 8 }}>
        link apple or google now so a later "sign in with apple" opens this account instead of starting a new one. hide-my-email is fine — the link remembers it's you.
      </div>

      {msg && <p style={{ fontSize: 13, color: "#17967f", marginTop: 14 }}>{msg}</p>}
      {err && <p style={{ fontSize: 13, color: "#FF6B5E", marginTop: 12 }}>{err}</p>}
      <div style={{ height: 30 }} />
    </div>
  );
}
