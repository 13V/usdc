import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { EmbeddedPay } from "./EmbeddedPay";
import { SettlePay } from "./SettlePay";
import { Wallet } from "./Wallet";
import { ManageLogins } from "./ManageLogins";
import { Login } from "./Login";

// Privy app id is injected at build time via VITE_PRIVY_APP_ID. Without it the
// page renders a clear "not configured" state instead of half-working.
const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

// /embedded serves these flows off one bundle:
//   • ?bill=…&name=…    → pay a single bill share (EmbeddedPay)
//   • ?pay=settle&…     → pay a trip settle-up transfer (SettlePay)
//   • ?manage=wallet    → back up / set recovery on the embedded wallet (Wallet)
//   • ?manage=logins    → link more sign-in methods to this account (ManageLogins)
//   • otherwise         → onboarding: create a wallet + sign in (Login)
function ActiveFlow() {
  const p = new URLSearchParams(window.location.search);
  if (p.get("pay") === "settle" || p.get("pay") === "send") return <SettlePay />;
  if (p.get("manage") === "logins") return <ManageLogins />;
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

  // Apple sign-in leads on iOS (native expectation); elsewhere Google leads.
  // Only the ORDER differs — the same four methods are always available.
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
    (window as any).Capacitor?.getPlatform?.() === "ios";
  type M = "apple" | "google" | "sms" | "email";
  const primary: [M, ...M[]] = isIOS
    ? ["apple", "google", "sms", "email"]
    : ["google", "apple", "sms", "email"];

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Auto-provision a self-custodial Solana wallet for users who don't have
        // one — no seed phrase for the friend to manage, no custody decision.
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
        },
        // Social + phone + email only. Deliberately NO "wallet" method, so the
        // modal never shows a MetaMask / external-wallet list on this flow.
        loginMethods: ["apple", "google", "sms", "email"],
        loginMethodsAndOrder: { primary },
        // Match the app: light journal sheet, Divvy blue accent, our mark.
        appearance: {
          walletChainType: "solana-only",
          // Belt-and-suspenders: an empty wallet list hides every external
          // wallet option even if a 'wallet' method ever slips into the config.
          walletList: [],
          theme: "light",
          accentColor: "#2775CA",
          logo: `${window.location.origin}/icons/icon-192.png`,
        },
      }}
    >
      <ActiveFlow />
    </PrivyProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
