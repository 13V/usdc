import React, { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets, useSendTransaction } from "@privy-io/react-auth/solana";
import { Connection, clusterApiUrl } from "@solana/web3.js";
import { buildTransferTransaction, readUsdcBalanceCents, centsToBaseUnits } from "./spl";

interface Participant {
  name: string;
  amountCents: number;
  amountFmt: string;
  reference: string;
  paid: boolean;
}
interface Bill {
  id: string;
  title: string;
  cluster: "devnet" | "mainnet-beta";
  collector: string;
  splToken: string;
  participants: Participant[];
}

function useQuery() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

function rpcFor(cluster: Bill["cluster"]): string {
  const fromEnv = import.meta.env.VITE_RPC_URL as string | undefined;
  return fromEnv || clusterApiUrl(cluster === "mainnet-beta" ? "mainnet-beta" : "devnet");
}

const box: React.CSSProperties = {
  border: "1px solid #8884",
  borderRadius: 14,
  padding: 18,
  margin: "16px 0",
};
const btn: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: 14,
  borderRadius: 12,
  border: "1px solid #8884",
  fontWeight: 600,
  fontSize: "1rem",
  margin: "8px 0",
  cursor: "pointer",
  textAlign: "center",
  textDecoration: "none",
  color: "inherit",
  background: "transparent",
};
const primary: React.CSSProperties = { ...btn, background: "#14f195", color: "#04121a", border: 0 };

export function EmbeddedPay() {
  const q = useQuery();
  const billId = q.get("bill") || "";
  const name = q.get("name") || "";

  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useSolanaWallets();
  const { sendTransaction } = useSendTransaction();

  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [cards, setCards] = useState<{ moonpay: string; coinbase: string } | null>(null);
  const [status, setStatus] = useState<string>("");
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);

  const wallet = wallets[0];
  const participant = bill?.participants.find((p) => p.name === name) || null;

  // Load the bill.
  useEffect(() => {
    if (!billId) {
      setError("Missing ?bill= in the URL");
      return;
    }
    fetch(`/api/bills/${billId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Bill not found"))))
      .then((b: Bill) => {
        setBill(b);
        const p = b.participants.find((x) => x.name === name);
        if (p?.paid) setPaid(true);
      })
      .catch((e) => setError(e.message));
  }, [billId, name]);

  // Once the wallet exists, read its USDC balance + fetch card-funding links.
  useEffect(() => {
    if (!bill || !wallet || !participant) return;
    const connection = new Connection(rpcFor(bill.cluster), "confirmed");
    readUsdcBalanceCents(connection, wallet.address, bill.splToken).then(setBalanceCents);
    fetch(`/api/onramp/${wallet.address}/${participant.amountCents}`)
      .then((r) => r.json())
      .then(setCards)
      .catch(() => setCards(null));
  }, [bill, wallet, participant]);

  async function pay() {
    if (!bill || !wallet || !participant) return;
    setPaying(true);
    setError(null);
    setStatus("Building transaction…");
    try {
      const connection = new Connection(rpcFor(bill.cluster), "confirmed");
      const transaction = await buildTransferTransaction({
        connection,
        payer: wallet.address,
        collector: bill.collector,
        mint: bill.splToken,
        reference: participant.reference,
        amountCents: participant.amountCents,
      });
      setStatus("Confirm in the wallet popup…");
      const receipt = await sendTransaction({ transaction, connection });
      setStatus(`Sent: ${receipt.signature}. Confirming…`);
      // Tell the server to re-check the chain and flip this share to PAID.
      await fetch(`/api/bills/${bill.id}/verify`, { method: "POST" }).catch(() => {});
      setPaid(true);
      setStatus("");
    } catch (e) {
      setError((e as Error).message || "Payment failed");
      setStatus("");
    } finally {
      setPaying(false);
    }
  }

  if (error && !bill) {
    return <Shell><p style={{ color: "crimson" }}>{error}</p></Shell>;
  }
  if (!bill || !participant) {
    return <Shell><p>Loading…</p></Shell>;
  }

  const insufficient = balanceCents != null && balanceCents < participant.amountCents;

  return (
    <Shell>
      <div style={{ color: "#888", fontSize: ".9rem" }}>
        {bill.title} · {name}'s share · USDC on {bill.cluster}
      </div>
      <div style={{ fontSize: "2.25rem", fontWeight: 700, margin: "10px 0" }}>
        {participant.amountFmt}
      </div>

      {paid ? (
        <div style={{ ...box, background: "#14f195", color: "#04121a", fontWeight: 700, textAlign: "center" }}>
          ✓ Paid — thank you!
        </div>
      ) : !ready ? (
        <p>Starting…</p>
      ) : !authenticated ? (
        <div style={box}>
          <strong>No crypto wallet? No problem.</strong>
          <p style={{ color: "#888", fontSize: ".9rem" }}>
            Sign in with your email or phone and we'll create a secure wallet for
            you — no seed phrase, no app to install.
          </p>
          <button style={primary} onClick={login}>Create a wallet & pay</button>
        </div>
      ) : !wallet ? (
        <p>Setting up your wallet…</p>
      ) : (
        <>
          <div style={box}>
            <div style={{ fontSize: ".8rem", color: "#888" }}>Your wallet</div>
            <code style={{ wordBreak: "break-all", fontSize: ".75rem" }}>{wallet.address}</code>
            <div style={{ marginTop: 8 }}>
              Balance:{" "}
              {balanceCents == null ? "…" : `$${(balanceCents / 100).toFixed(2)} USDC`}
            </div>
          </div>

          {insufficient && (
            <div style={box}>
              <strong>Add funds first</strong>
              <p style={{ color: "#888", fontSize: ".9rem" }}>
                Your wallet needs at least {participant.amountFmt} in USDC. Top up
                with a card:
              </p>
              {cards ? (
                <>
                  <a style={btn} href={cards.moonpay} target="_blank" rel="noopener">Add funds · MoonPay</a>
                  <a style={btn} href={cards.coinbase} target="_blank" rel="noopener">Add funds · Coinbase</a>
                </>
              ) : (
                <p style={{ color: "#888", fontSize: ".8rem" }}>Funding links unavailable.</p>
              )}
            </div>
          )}

          <button style={primary} onClick={pay} disabled={paying || insufficient}>
            {paying ? "Working…" : `Pay ${participant.amountFmt} in USDC`}
          </button>
          {status && <p style={{ color: "#888", fontSize: ".85rem" }}>{status}</p>}
          {error && <p style={{ color: "crimson", fontSize: ".85rem" }}>{error}</p>}

          <button style={btn} onClick={logout}>Sign out</button>
        </>
      )}
      <p style={{ color: "#888", fontSize: ".75rem" }}>
        Settles in USDC to <code>{bill.collector}</code>
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "-apple-system, system-ui, sans-serif",
        maxWidth: 480,
        margin: "0 auto",
        padding: 24,
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ fontSize: "1.25rem" }}>Divvy</h1>
      {children}
    </div>
  );
}

// centsToBaseUnits is re-exported for tests/consumers that import from here.
export { centsToBaseUnits };
