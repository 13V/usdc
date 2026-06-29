import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { EmbeddedPay } from "./EmbeddedPay";
import { SettlePay } from "./SettlePay";
import { Wallet } from "./Wallet";
import { Login } from "./Login";

// Privy app id is injected at build time via VITE_PRIVY_APP_ID. Without it the
// page renders a clear "not configured" state instead of half-working.
const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

// /embedded serves these flows off one bundle:
//   • ?bill=…&name=…    → pay a single bill share (EmbeddedPay)
//   • ?pay=settle&…     → pay a trip settle-up transfer (SettlePay)
//   • ?manage=wallet    → back up / set recovery on the embedded wallet (Wallet)
//   • otherwise         → onboarding: create a wallet + sign in (Login)
function ActiveFlow() {
  const p = new URLSearchParams(window.location.search);
  if (p.get("pay") === "settle" || p.get("pay") === "send") return <SettlePay />;
  if (p.get("manage") === "wallet") return <Wallet />;
  if (p.has("bill")) return <EmbeddedPay />;
  return <Login />;
}

function Root() {
  if (!PRIVY_APP_ID) {
    return (
      <div style={{ maxWidth: 480, margin: "40px auto", fontFamily: "system-ui", padding: 20 }}>
        <h1>Embedded wallet not configured</h1>
        <p>
          Set <code>VITE_PRIVY_APP_ID</code> in <code>.env</code> and rebuild
          (<code>npm run build:web</code>) to enable the no-wallet pay flow.
        </p>
        <p>
          Until then, friends can still pay from the main pay page using a wallet
          QR or the "Pay with card" buttons.
        </p>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Auto-provision a self-custodial Solana wallet for users who don't have
        // one — no seed phrase for the friend to manage.
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
        },
        loginMethods: ["email", "google", "apple", "sms"],
        appearance: { walletChainType: "solana-only" },
      }}
    >
      <ActiveFlow />
    </PrivyProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
