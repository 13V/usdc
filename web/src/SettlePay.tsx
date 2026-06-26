import React, { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets, useSendTransaction } from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import { buildTransferTransaction, readUsdcBalanceCents } from "./spl";

// In-app trip settlement: pay a single settle-up transfer in USDC from the
// Privy embedded wallet. Params (from the main app's settle screen):
//   to    recipient wallet (base58)
//   amount  integer cents owed
//   ref   Solana Pay reference pubkey (so the server can verify on-chain)
//   mint  USDC mint (base58)
//   trip  trip id (for /settle/verify)
//   ret   app hash to return to (default /#/home)
const DIVVY_TOKEN_KEY = "divvy.token";

function fmt(cents: number) {
  return "$" + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const wrap: React.CSSProperties = {
  position: "relative", width: "100%", maxWidth: 430, margin: "0 auto", minHeight: "100vh",
  background: "#0B1622", color: "#F4F7FA", fontFamily: "'General Sans',sans-serif",
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  padding: "0 26px", textAlign: "center",
};
const card: React.CSSProperties = {
  background: "#13212E", border: "1px solid rgba(244,247,250,0.09)", borderRadius: 20,
  padding: 16, width: "100%", maxWidth: 320, margin: "14px 0",
};
const primary: React.CSSProperties = {
  appearance: "none", border: "none", cursor: "pointer", width: "100%", maxWidth: 320,
  minHeight: 58, borderRadius: 999, background: "linear-gradient(120deg,#3286db,#2775CA)",
  color: "#fff", fontFamily: "'Clash Display','General Sans',sans-serif", fontWeight: 600,
  fontSize: 17, boxShadow: "0 14px 34px rgba(39,117,202,0.45)",
};
const mono = "'Space Mono',monospace";

export function SettlePay() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const to = q.get("to") || "";
  const amountCents = parseInt(q.get("amount") || "0", 10);
  const reference = q.get("ref") || "";
  const mint = q.get("mint") || "";
  const tripId = q.get("trip") || "";
  const ret = q.get("ret") || "/#/home";

  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useSolanaWallets();
  const { sendTransaction } = useSendTransaction();
  const wallet = wallets[0];

  const conn = useMemo(() => new Connection("https://api.devnet.solana.com", "confirmed"), []);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);

  // open Privy login as soon as it's ready
  useEffect(() => {
    if (ready && !authenticated) login();
  }, [ready, authenticated, login]);

  const refreshBalance = async () => {
    if (!wallet || !mint) return;
    try { setBalanceCents(await readUsdcBalanceCents(conn, wallet.address, mint)); }
    catch { setBalanceCents(0); }
  };
  useEffect(() => { refreshBalance(); }, [wallet?.address, mint]);

  const token = () => { try { return localStorage.getItem(DIVVY_TOKEN_KEY); } catch { return null; } };

  async function fund() {
    setStatus("topping up your wallet…"); setError(null);
    try {
      const r = await fetch("/api/me/fund", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token() },
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error((d && d.error) || "couldn't add test funds");
      await refreshBalance();
      setStatus("");
    } catch (e) { setError((e as Error).message); setStatus(""); }
  }

  async function pay() {
    if (!wallet) return;
    setBusy(true); setError(null);
    try {
      // top up first if short on test-USDC (covers gas too)
      if (balanceCents != null && balanceCents < amountCents) {
        await fund();
        const b = await readUsdcBalanceCents(conn, wallet.address, mint).catch(() => 0);
        if (b < amountCents) throw new Error("wallet still short on funds — try again in a moment");
      }
      setStatus("building transaction…");
      const transaction = await buildTransferTransaction({
        connection: conn, payer: wallet.address, collector: to, mint, reference, amountCents,
      });
      setStatus("confirm in your wallet…");
      const receipt = await sendTransaction({ transaction, connection: conn });
      setStatus(`sent (${receipt.signature.slice(0, 8)}…) — confirming…`);
      // ask the server to re-check the chain and mark this transfer settled
      await fetch(`/api/trips/${tripId}/settle/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token() },
      }).catch(() => {});
      setPaid(true); setStatus("");
      setTimeout(() => { window.location.href = ret; }, 1500);
    } catch (e) {
      setError((e as Error).message || "payment failed");
      setStatus("");
    } finally { setBusy(false); }
  }

  if (!to || !amountCents || !reference || !mint) {
    return <div style={wrap}><p style={{ color: "#FF6B5E" }}>missing settle details</p></div>;
  }

  return (
    <div style={wrap}>
      <div data-act="home" onClick={() => (window.location.href = ret)}
        style={{ position: "absolute", top: 18, left: 16, width: 36, height: 36, borderRadius: "50%", background: "rgba(244,247,250,0.05)", border: "1px solid rgba(244,247,250,0.08)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        <span style={{ color: "rgba(244,247,250,0.6)", fontSize: 18 }}>‹</span>
      </div>

      <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, letterSpacing: 3, color: "#3DE8C7" }}>SETTLE UP</div>
      <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 52, letterSpacing: -1, margin: "10px 0 0" }}>{fmt(amountCents)}</div>
      <div style={{ fontFamily: mono, fontSize: 11, color: "rgba(244,247,250,0.45)", marginTop: 6 }}>to {to.slice(0, 4)}…{to.slice(-4)} · USDC on devnet</div>

      {paid ? (
        <div style={{ ...card, background: "linear-gradient(120deg,#2bccae,#3DE8C7)", color: "#04121a", fontWeight: 700 }}>✓ settled — thank you!</div>
      ) : !ready ? (
        <p style={{ color: "rgba(244,247,250,0.5)", marginTop: 24 }}>starting…</p>
      ) : !authenticated ? (
        <button style={{ ...primary, marginTop: 24 }} onClick={() => login()}>sign in to pay</button>
      ) : !wallet ? (
        <p style={{ color: "rgba(244,247,250,0.5)", marginTop: 24 }}>setting up your wallet…</p>
      ) : (
        <>
          <div style={card}>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1, color: "rgba(244,247,250,0.4)" }}>YOUR BALANCE</div>
            <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 20, marginTop: 4 }}>
              {balanceCents == null ? "…" : fmt(balanceCents) + " USDC"}
            </div>
          </div>
          <button style={{ ...primary, opacity: busy ? 0.7 : 1 }} onClick={pay} disabled={busy}>
            {busy ? "working…" : `pay ${fmt(amountCents)}`}
          </button>
          {status && <p style={{ fontFamily: mono, fontSize: 12.5, color: "rgba(244,247,250,0.55)", marginTop: 14 }}>{status}</p>}
          {error && <p style={{ fontSize: 13, color: "#FF6B5E", marginTop: 12, maxWidth: 320 }}>{error}</p>}
          <div style={{ fontFamily: mono, fontSize: 10, color: "rgba(244,247,250,0.3)", marginTop: 18 }}>devnet test funds · auto-added if needed</div>
        </>
      )}
    </div>
  );
}
