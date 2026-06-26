import React, { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";

// The main (vanilla) app reads its session token from this localStorage key.
// Because /embedded and the main app share an origin, writing it here and
// redirecting back signs the user in — no postMessage needed.
const DIVVY_TOKEN_KEY = "divvy.token";

/**
 * Onboarding handoff: log in with Privy (which auto-provisions a Solana embedded
 * wallet for users without one), exchange the Privy access token for a Divvy
 * session via /api/auth/privy/verify, stash it, and bounce back to the app.
 */
export function Login() {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const { wallets } = useSolanaWallets();
  const wallet = wallets[0];

  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const verifiedRef = useRef(false);
  const autoLoginRef = useRef(false);

  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("return") || "/";
  const method = params.get("method"); // optional hint (google/apple/email)

  // If we arrived via a provider button, open Privy's login immediately.
  useEffect(() => {
    if (!ready || authenticated || autoLoginRef.current) return;
    if (method) {
      autoLoginRef.current = true;
      login();
    }
  }, [ready, authenticated, method, login]);

  // Once authenticated, exchange for a Divvy session. Prefer doing it after the
  // embedded wallet is provisioned so settle-up can route to it; fall back after
  // a short wait if no wallet appears.
  useEffect(() => {
    if (!ready || !authenticated || verifiedRef.current) return;
    const run = async () => {
      if (verifiedRef.current) return;
      verifiedRef.current = true;
      try {
        setStatus("Setting up your wallet…");
        const token = await getAccessToken();
        if (!token) throw new Error("Couldn't get a Privy token — try again.");
        const body: { token: string; wallet?: string } = { token };
        if (wallet?.address) body.wallet = wallet.address;
        setStatus("Signing you in…");
        const res = await fetch("/api/auth/privy/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data && data.error) || "Sign-in failed");
        try { localStorage.setItem(DIVVY_TOKEN_KEY, data.token); } catch { /* private mode */ }
        // Land on the "wallet ready" celebration (created variant) rather than
        // dropping straight onto home. returnTo is kept for deep-link cases.
        try { sessionStorage.setItem("divvy.onboardVia", "privy"); } catch { /* ignore */ }
        window.location.href = returnTo && returnTo !== "/" ? returnTo : "/#/welcome";
      } catch (e) {
        verifiedRef.current = false;
        setError((e as Error).message);
        setStatus("");
      }
    };
    const delay = wallet?.address ? 0 : 4000;
    const t = setTimeout(run, delay);
    return () => clearTimeout(t);
  }, [ready, authenticated, wallet?.address, getAccessToken, returnTo]);

  return (
    <Shell>
      {!ready ? (
        <p style={{ color: "#888" }}>Starting…</p>
      ) : !authenticated ? (
        <div style={box}>
          <strong style={{ fontSize: "1.05rem" }}>Create your wallet</strong>
          <p style={{ color: "#888", fontSize: ".9rem" }}>
            Sign in with email or a social account and we'll create a secure
            Solana wallet for you — no seed phrase, no app to install.
          </p>
          <button style={primary} onClick={() => login()}>Continue</button>
          {error && <p style={{ color: "crimson", fontSize: ".85rem" }}>{error}</p>}
        </div>
      ) : (
        <div style={box}>
          <p>{status || "Signing you in…"}</p>
          {error && (
            <>
              <p style={{ color: "crimson", fontSize: ".85rem" }}>{error}</p>
              <button style={primary} onClick={() => window.location.reload()}>Try again</button>
            </>
          )}
        </div>
      )}
    </Shell>
  );
}

const box: React.CSSProperties = {
  border: "1px solid #8884", borderRadius: 14, padding: 18, margin: "16px 0",
};
const primary: React.CSSProperties = {
  display: "block", width: "100%", padding: 14, borderRadius: 12, border: 0,
  fontWeight: 600, fontSize: "1rem", margin: "8px 0", cursor: "pointer",
  background: "#2775ca", color: "#04121a", textAlign: "center",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "-apple-system, system-ui, sans-serif", maxWidth: 480, margin: "0 auto", padding: 24, lineHeight: 1.5 }}>
      <h1 style={{ fontSize: "1.25rem" }}>Divvy</h1>
      {children}
    </div>
  );
}
