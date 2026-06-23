import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { EmbeddedPay } from "./EmbeddedPay";

// Privy app id is injected at build time via VITE_PRIVY_APP_ID. Without it the
// page renders a clear "not configured" state instead of half-working.
const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

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
        loginMethods: ["email", "sms"],
        appearance: { walletChainType: "solana-only" },
      }}
    >
      <EmbeddedPay />
    </PrivyProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
