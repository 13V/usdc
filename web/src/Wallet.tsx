import React, { useEffect, useMemo, useState } from "react";
import { usePrivy, useSetWalletRecovery } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { safeReturnPath } from "./safeReturn";

// Wallet & recovery manager (embedded). Lets a user back up (export the private
// key of) their Privy embedded wallet and add a self-controlled recovery
// password, so they aren't solely dependent on their login method. Reached from
// the main app's "you" screen at /embedded/?manage=wallet&ret=/#/you

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
const ghost: React.CSSProperties = {
  appearance: "none", cursor: "pointer", width: "100%", minHeight: 52, borderRadius: 999,
  background: "#FFFDF7", border: "2px solid #2B2118", color: "#2B2118",
  fontFamily: "'Clash Display','General Sans',sans-serif", fontWeight: 600, fontSize: 16,
  boxShadow: "3px 3px 0 rgba(43,33,24,0.35)", marginTop: 12,
};
const mono = "'Space Mono',monospace";

export function Wallet() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const ret = safeReturnPath(q.get("ret"), "/#/you");

  const { ready, authenticated, login } = usePrivy();
  const { wallets, exportWallet } = useSolanaWallets();
  const { setWalletRecovery } = useSetWalletRecovery();
  const wallet = wallets[0];

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Dismissing a Privy sheet ("User exited before…") is a choice, not a failure —
  // acknowledge it gently instead of flashing an error.
  function soften(e: unknown, fallback: string) {
    const raw = ((e as Error) && (e as Error).message) || "";
    if (/exited|closed|cancel/i.test(raw)) {
      setMsg("no worries — closed without changes 🐸");
      return;
    }
    setErr(raw || fallback);
  }

  useEffect(() => { if (ready && !authenticated) login(); }, [ready, authenticated, login]);

  // Privy scopes the embedded key to the authenticated user, so the export /
  // recovery modals only ever act on the signed-in user's own wallet.
  async function doExport() {
    if (!wallet) return;
    setBusy("export"); setErr(null); setMsg(null);
    try {
      await exportWallet({ address: wallet.address });
      setMsg("if you saved your key, keep it somewhere only you can reach.");
    } catch (e) {
      soften(e, "couldn't open export — your Privy app may have key export disabled.");
    } finally { setBusy(null); }
  }

  async function doRecovery() {
    setBusy("recovery"); setErr(null); setMsg(null);
    try {
      await setWalletRecovery();
      setMsg("recovery set — you can restore this wallet with your password.");
    } catch (e) {
      soften(e, "couldn't set recovery — try again in a moment.");
    } finally { setBusy(null); }
  }

  const short = wallet ? wallet.address.slice(0, 4) + "…" + wallet.address.slice(-4) : "";

  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, height: 60, flex: "none" }}>
        <div onClick={() => (window.location.href = ret)} title="back"
          style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(43,33,24,0.05)", border: "1px solid rgba(43,33,24,0.08)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <span style={{ color: "rgba(43,33,24,0.6)", fontSize: 18 }}>‹</span>
        </div>
        <span style={{ fontFamily: "'Clash Display','General Sans',sans-serif", fontWeight: 600, fontSize: 19 }}>wallet & recovery</span>
      </div>

      {!ready ? (
        <p style={{ color: "rgba(43,33,24,0.5)", marginTop: 24 }}>starting…</p>
      ) : !authenticated ? (
        <button style={primary} onClick={() => login()}>sign in to manage your wallet</button>
      ) : !wallet ? (
        <p style={{ color: "rgba(43,33,24,0.5)", marginTop: 24 }}>setting up your wallet…</p>
      ) : (
        <>
          <div style={card}>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1, color: "rgba(43,33,24,0.4)" }}>YOUR WALLET</div>
            <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 16, marginTop: 6 }}>{short}</div>
            <div style={{ fontFamily: "'General Sans',sans-serif", fontSize: 12.5, color: "rgba(43,33,24,0.5)", marginTop: 6 }}>
              self-custodial · created for you, controlled by you
            </div>
          </div>

          <div style={card}>
            <div style={{ fontFamily: "'Clash Display','General Sans',sans-serif", fontWeight: 600, fontSize: 16 }}>back up your wallet</div>
            <div style={{ fontFamily: "'General Sans',sans-serif", fontSize: 13.5, lineHeight: 1.5, color: "rgba(43,33,24,0.55)", marginTop: 6 }}>
              export your private key and store it somewhere safe. it's the only way to move this wallet outside divvy — never share it with anyone.
            </div>
            <button style={primary} onClick={doExport} disabled={busy != null}>
              {busy === "export" ? "opening…" : "export private key"}
            </button>
          </div>

          <div style={card}>
            <div style={{ fontFamily: "'Clash Display','General Sans',sans-serif", fontWeight: 600, fontSize: 16 }}>add a recovery password</div>
            <div style={{ fontFamily: "'General Sans',sans-serif", fontSize: 13.5, lineHeight: 1.5, color: "rgba(43,33,24,0.55)", marginTop: 6 }}>
              set a password only you know. then you can recover your wallet even if you lose access to your email or phone login.
            </div>
            <button style={ghost} onClick={doRecovery} disabled={busy != null}>
              {busy === "recovery" ? "opening…" : "set recovery password"}
            </button>
          </div>

          <div style={{ fontFamily: mono, fontSize: 10.5, lineHeight: 1.6, color: "rgba(43,33,24,0.4)", marginTop: 8 }}>
            lost access to your login? with a backup or recovery password you can always restore this wallet. without one, recovery depends on your login method — so set one up now.
          </div>

          {msg && <p style={{ fontSize: 13, color: "#17967f", marginTop: 14 }}>{msg}</p>}
          {err && <p style={{ fontSize: 13, color: "#FF6B5E", marginTop: 12 }}>{err}</p>}
          <div style={{ height: 30 }} />
        </>
      )}
    </div>
  );
}
