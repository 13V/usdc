import React, { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { safeReturnPath } from "./safeReturn";
import "./onboarding.css";

// The main (vanilla) app reads its session token from this localStorage key.
// Because /embedded and the main app share an origin, writing it here and
// redirecting back signs the user in — no postMessage needed.
const DIVVY_TOKEN_KEY = "divvy.token";

const FRAME_OUTER =
  "position:relative; width:100%; max-width:430px; margin:0 auto; min-height:100vh; background:#F7F1E3; overflow:hidden; font-family:'General Sans',sans-serif; color:#2B2118; -webkit-font-smoothing:antialiased; display:flex; flex-direction:column;";

// ---- connecting frame (v6 design) -----------------------------------------
function connectingHtml(headline: string, status: string): string {
  return `<div style="${FRAME_OUTER} align-items:center; justify-content:center;">
    <div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 84% 4%, rgba(43,33,24,0.022) 0 1px, transparent 1px 9px); opacity:.6; pointer-events:none;"></div>
    <div style="position:absolute; left:50%; top:42%; width:480px; height:480px; transform:translateX(-50%); border-radius:50%; background:radial-gradient(circle, rgba(61,232,199,0.1) 0%, rgba(39,117,202,0.07) 40%, rgba(39,117,202,0) 66%); pointer-events:none;"></div>
    <div style="position:absolute; left:78px; bottom:200px; width:6px; height:6px; border-radius:50%; background:rgba(61,232,199,0.5); animation:cgRise 5s ease-in infinite; animation-delay:.2s;"></div>
    <div style="position:absolute; left:300px; bottom:180px; width:5px; height:5px; border-radius:50%; background:rgba(39,117,202,0.55); animation:cgRise 6.2s ease-in infinite; animation-delay:1.6s;"></div>
    <div style="position:absolute; left:200px; bottom:150px; width:5px; height:5px; border-radius:50%; background:rgba(255,198,92,0.45); animation:cgRise 5.6s ease-in infinite; animation-delay:3s;"></div>
    <div data-act="home" style="position:absolute; top:34px; left:16px; z-index:6;"><div style="width:36px; height:36px; border-radius:50%; background:rgba(43,33,24,0.05); border:1px solid rgba(43,33,24,0.08); display:flex; align-items:center; justify-content:center; cursor:pointer;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.5)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></div></div>
    <div style="position:relative; z-index:2; width:200px; height:200px; display:flex; align-items:center; justify-content:center;">
      <div style="position:absolute; left:50%; top:50%; width:220px; height:220px; border-radius:50%; background:radial-gradient(circle, rgba(61,232,199,0.28) 0%, rgba(61,232,199,0.08) 44%, rgba(61,232,199,0) 68%); animation:cgHalo 3s ease-in-out infinite;"></div>
      <svg width="184" height="184" viewBox="0 0 184 184" style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); overflow:visible;"><defs><linearGradient id="cgArc" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2775CA"></stop><stop offset="100%" stop-color="#3DE8C7"></stop></linearGradient></defs><circle cx="92" cy="92" r="88" fill="none" stroke="rgba(39,117,202,0.12)" stroke-width="5"></circle><circle cx="92" cy="92" r="88" fill="none" stroke="url(#cgArc)" stroke-width="5" stroke-linecap="round" stroke-dasharray="150 553" style="transform-box:fill-box; transform-origin:center; animation:cgSpin 1.4s linear infinite; filter:drop-shadow(0 0 5px rgba(61,232,199,0.55));"></circle></svg>
      <div style="position:relative; width:130px; height:130px; animation:cgFloat 3.4s ease-in-out infinite;">
        <div style="position:absolute; left:6px; top:60px; width:26px; height:50px; border-radius:999px; background:linear-gradient(165deg,#3f95e6,#1a5290); transform:rotate(13deg);"></div>
        <div style="position:absolute; right:6px; top:60px; width:26px; height:50px; border-radius:999px; background:linear-gradient(165deg,#3f95e6,#1a5290); transform:rotate(-13deg);"></div>
        <div style="position:absolute; left:42px; bottom:-6px; width:24px; height:38px; border-radius:999px; background:linear-gradient(165deg,#3a90e2,#16487f);"></div>
        <div style="position:absolute; right:42px; bottom:-6px; width:24px; height:38px; border-radius:999px; background:linear-gradient(165deg,#3a90e2,#16487f);"></div>
        <div style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:116px; height:116px; background:linear-gradient(155deg,#4aa0f0,#2775CA 60%,#1c5697); animation:cgSquish 5s ease-in-out infinite; box-shadow:0 16px 32px rgba(6,14,24,0.5), inset 0 6px 13px rgba(255,255,255,0.32), inset 0 -8px 16px rgba(13,40,72,0.5); display:flex; align-items:center; justify-content:center;">
          <div style="position:absolute; top:16px; left:22px; width:52px; height:34px; border-radius:50%; background:radial-gradient(closest-side, rgba(255,255,255,0.4), rgba(255,255,255,0)); pointer-events:none;"></div>
          <div style="display:flex; gap:18px; margin-top:-12px;"><div style="width:13px; height:18px; border-radius:50%; background:#F7F1E3; animation:cgBlink 4.5s infinite;"></div><div style="width:13px; height:18px; border-radius:50%; background:#F7F1E3; animation:cgBlink 4.5s infinite;"></div></div>
          <div style="position:absolute; bottom:38px; left:50%; transform:translateX(-50%); width:24px; height:12px; background:#F7F1E3; border-radius:5px 5px 12px 12px; overflow:hidden; display:flex; align-items:flex-end; justify-content:center;"><div style="width:13px; height:8px; background:#FF6B5E; border-radius:3px 3px 6px 6px; margin-bottom:-1px;"></div></div>
        </div>
      </div>
    </div>
    <div style="position:relative; z-index:2; font-family:'Space Mono',monospace; font-size:11px; font-weight:700; letter-spacing:3px; color:#3DE8C7; margin-top:38px;">ONE SEC</div>
    <h1 style="position:relative; z-index:2; font-family:'Clash Display','General Sans',sans-serif; font-weight:600; font-size:30px; letter-spacing:-0.8px; margin:12px 0 0; color:#2B2118; text-align:center; padding:0 30px;">${headline}</h1>
    <div style="position:relative; z-index:2; height:22px; margin-top:16px; display:flex; align-items:center; justify-content:center;"><div style="display:flex; align-items:center; gap:8px;"><span style="width:7px; height:7px; border-radius:50%; background:#3DE8C7; box-shadow:0 0 8px rgba(61,232,199,0.8);"></span><span style="font-family:'Space Mono',monospace; font-size:12.5px; letter-spacing:.2px; color:rgba(43,33,24,0.6);">${status}</span></div></div>
    <div style="position:absolute; bottom:64px; left:0; right:0; z-index:2; text-align:center;">
      <div style="font-family:'Space Mono',monospace; font-size:10.5px; letter-spacing:.5px; color:rgba(43,33,24,0.35);">this only happens once</div>
      <div data-act="restart" style="font-family:'Space Mono',monospace; font-size:10.5px; letter-spacing:.3px; color:rgba(43,33,24,0.4); margin-top:14px; cursor:pointer;">taking too long? <span style="color:rgba(39,117,202,0.6); text-decoration:underline;">start over</span></div>
    </div>
  </div>`;
}

// ---- error frame (v6 design) ----------------------------------------------
function errorHtml(refCode: string): string {
  return `<div style="${FRAME_OUTER}">
    <div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 84% 4%, rgba(43,33,24,0.022) 0 1px, transparent 1px 9px); opacity:.6; pointer-events:none;"></div>
    <div style="position:absolute; left:50%; top:40%; width:460px; height:460px; transform:translateX(-50%); border-radius:50%; background:radial-gradient(circle, rgba(255,107,94,0.12) 0%, rgba(255,107,94,0.05) 40%, rgba(255,107,94,0) 66%); pointer-events:none;"></div>
    <div data-act="home" style="position:relative; z-index:6; padding:34px 16px 2px; flex:none;"><div style="width:36px; height:36px; border-radius:50%; background:rgba(43,33,24,0.05); border:1px solid rgba(43,33,24,0.08); display:flex; align-items:center; justify-content:center; cursor:pointer;"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(43,33,24,0.6)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></div></div>
    <div style="position:relative; z-index:2; flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:0 30px; text-align:center;">
      <div style="position:relative; width:210px; height:200px; display:flex; align-items:center; justify-content:center; margin-bottom:8px;">
        <div style="position:absolute; left:50%; top:50%; width:225px; height:225px; border-radius:50%; background:radial-gradient(circle, rgba(255,107,94,0.22) 0%, rgba(255,107,94,0.07) 44%, rgba(255,107,94,0) 68%); animation:erHalo 3.4s ease-in-out infinite;"></div>
        <div style="position:absolute; right:6px; top:30px; z-index:4; animation:erSpark 2.4s ease-in-out infinite;"><div style="width:46px; height:46px; border-radius:14px; background:rgba(255,107,94,0.14); border:1px solid rgba(255,107,94,0.4); display:flex; align-items:center; justify-content:center; box-shadow:0 8px 18px rgba(255,107,94,0.25);"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FF6B5E" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 7H7a4 4 0 0 0 0 8h2.2"></path><path d="M14.5 17H17a4 4 0 0 0 0-8h-2.2"></path><path d="M3.5 3.5l17 17"></path></svg></div></div>
        <div style="position:absolute; right:54px; top:78px; width:5px; height:5px; border-radius:50%; background:rgba(255,107,94,0.7); animation:erSpark 1.8s ease-in-out infinite; animation-delay:.4s;"></div>
        <div style="position:absolute; right:38px; top:96px; width:4px; height:4px; border-radius:50%; background:rgba(255,107,94,0.5); animation:erSpark 2.2s ease-in-out infinite; animation-delay:.9s;"></div>
        <div style="position:relative; width:160px; height:150px; animation:erFloat 4.6s ease-in-out infinite;">
          <div style="position:absolute; left:10px; top:60px; width:26px; height:50px; border-radius:999px; background:linear-gradient(165deg,#3a90e2,#16487f); transform:rotate(15deg);"></div>
          <div style="position:absolute; right:10px; top:60px; width:26px; height:50px; border-radius:999px; background:linear-gradient(165deg,#3a90e2,#16487f); transform:rotate(-15deg);"></div>
          <div style="position:absolute; left:53px; bottom:-8px; width:26px; height:40px; border-radius:999px; background:linear-gradient(165deg,#3a90e2,#16487f);"></div>
          <div style="position:absolute; right:53px; bottom:-8px; width:26px; height:40px; border-radius:999px; background:linear-gradient(165deg,#3a90e2,#16487f);"></div>
          <div style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:132px; height:132px; background:linear-gradient(155deg,#4aa0f0,#2775CA 60%,#1c5697); animation:erSquish 5s ease-in-out infinite; box-shadow:0 18px 36px rgba(6,14,24,0.5), inset 0 6px 14px rgba(255,255,255,0.32), inset 0 -8px 18px rgba(13,40,72,0.5); display:flex; align-items:center; justify-content:center;">
            <div style="position:absolute; top:18px; left:26px; width:56px; height:36px; border-radius:50%; background:radial-gradient(closest-side, rgba(255,255,255,0.4), rgba(255,255,255,0)); pointer-events:none;"></div>
            <div style="position:absolute; top:38px; left:34px; width:18px; height:5px; border-radius:999px; background:#F7F1E3; transform:rotate(-15deg);"></div>
            <div style="position:absolute; top:38px; right:34px; width:18px; height:5px; border-radius:999px; background:#F7F1E3; transform:rotate(15deg);"></div>
            <div style="display:flex; gap:22px; margin-top:2px;"><div style="width:15px; height:18px; border-radius:50%; background:#F7F1E3; animation:erBlink 5s infinite;"></div><div style="width:15px; height:18px; border-radius:50%; background:#F7F1E3; animation:erBlink 5s infinite;"></div></div>
            <div style="position:absolute; bottom:40px; left:50%; transform:translateX(-58%);"><svg width="30" height="10" viewBox="0 0 30 10" fill="none" stroke="#2B2118" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6 H17 Q23 6 26 3"></path></svg></div>
            <div style="position:absolute; bottom:42px; left:26px; width:13px; height:7px; border-radius:50%; background:rgba(255,107,94,0.3);"></div>
            <div style="position:absolute; bottom:42px; right:26px; width:13px; height:7px; border-radius:50%; background:rgba(255,107,94,0.3);"></div>
          </div>
        </div>
      </div>
      <div style="font-family:'Space Mono',monospace; font-size:11px; font-weight:700; letter-spacing:3px; color:#FF6B5E; margin-top:18px;">HMM</div>
      <h1 style="font-family:'Clash Display','General Sans',sans-serif; font-weight:600; font-size:42px; letter-spacing:-1.2px; margin:8px 0 0; color:#2B2118;">that didn't take.</h1>
      <p style="font-family:'General Sans',sans-serif; font-weight:400; font-size:14.5px; line-height:1.55; color:rgba(43,33,24,0.55); max-width:310px; margin:14px 0 0; text-wrap:pretty;">something hiccuped on the way to your account — no harm done, nothing was charged. let's try again.</p>
    </div>
    <div style="position:relative; z-index:6; flex:none; padding:8px 26px calc(20px + env(safe-area-inset-bottom));">
      <button data-act="retry" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:58px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:0 14px 34px rgba(39,117,202,0.55), inset 0 1px 0 rgba(255,255,255,0.28);"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path></svg><span style="font-family:'Clash Display','General Sans',sans-serif; font-weight:600; font-size:17px; color:#fff;">try again</span></button>
      <div style="text-align:center; margin-top:14px;"><span data-act="email" style="font-family:'General Sans',sans-serif; font-weight:500; font-size:14px; color:rgba(43,33,24,0.5); cursor:pointer;">use email instead</span></div>
      <div style="text-align:center; margin-top:16px;"><span style="font-family:'Space Mono',monospace; font-size:10px; letter-spacing:.5px; color:rgba(43,33,24,0.22);">ref: ${refCode}</span></div>
    </div>
  </div>`;
}

function Connecting() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => x + 1), 1100);
    return () => clearInterval(t);
  }, []);
  const lines = ["setting up your account…", "no passwords, no seed phrase…", "almost there…"];
  const onClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest?.("[data-act]");
    const act = el?.getAttribute("data-act");
    if (act === "home") window.location.href = "/";
    else if (act === "restart") window.location.reload();
  };
  return (
    <div
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: connectingHtml("setting up your account", lines[i % lines.length]) }}
    />
  );
}

function ErrorScreen({ refCode, onRetry, onEmail }: { refCode: string; onRetry: () => void; onEmail: () => void }) {
  const onClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest?.("[data-act]");
    const act = el?.getAttribute("data-act");
    if (act === "home") window.location.href = "/";
    else if (act === "retry") onRetry();
    else if (act === "email") onEmail();
  };
  return <div onClick={onClick} dangerouslySetInnerHTML={{ __html: errorHtml(refCode) }} />;
}

/**
 * Onboarding handoff: log in with Privy (auto-provisions a Solana embedded
 * wallet), exchange the Privy access token for a Divvy session, stash it in the
 * shared-origin localStorage key, and bounce into the app's wallet-ready screen.
 * Renders the v6 connecting + error frames around the wait.
 */
export function Login() {
  const { ready, authenticated, login, getAccessToken, logout } = usePrivy();
  const { wallets } = useSolanaWallets();
  const wallet = wallets[0];

  const [error, setError] = useState<string | null>(null);
  const verifiedRef = useRef(false);
  const autoLoginRef = useRef(false);

  const params = new URLSearchParams(window.location.search);
  // Same-origin only — never let `return` open-redirect off the app.
  const returnTo = safeReturnPath(params.get("return"), "/");
  // Optional initial-screen hint from the welcome screen's secondary CTA.
  // "phone" → open straight to phone/email entry; anything else → full modal
  // (Apple leads on iOS via the provider config's loginMethodsAndOrder).
  const method = params.get("method");

  // Open Privy's login as soon as it's ready (the user already tapped a sign-in
  // button), with the connecting frame behind the modal.
  useEffect(() => {
    if (!ready || authenticated || autoLoginRef.current || error) return;
    autoLoginRef.current = true;
    if (method === "phone" || method === "email") {
      login({ loginMethods: ["sms", "email"] });
    } else {
      login();
    }
  }, [ready, authenticated, login, error, method]);

  // Once authenticated, exchange for a Divvy session (after the embedded wallet
  // provisions, with a short fallback) and hand off to the app.
  useEffect(() => {
    if (!ready || !authenticated || verifiedRef.current) return;
    const run = async () => {
      if (verifiedRef.current) return;
      verifiedRef.current = true;
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("no-token");
        const body: { token: string; wallet?: string } = { token };
        if (wallet?.address) body.wallet = wallet.address;
        const res = await fetch("/api/auth/privy/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data && data.error) || "verify-failed");
        try { localStorage.setItem(DIVVY_TOKEN_KEY, data.token); } catch { /* private mode */ }
        try { sessionStorage.setItem("divvy.onboardVia", "privy"); } catch { /* ignore */ }
        window.location.href = returnTo && returnTo !== "/" ? returnTo : "/#/welcome";
      } catch (e) {
        verifiedRef.current = false;
        setError((e as Error).message || "signin-failed");
      }
    };
    const delay = wallet?.address ? 0 : 4000;
    const t = setTimeout(run, delay);
    return () => clearTimeout(t);
  }, [ready, authenticated, wallet?.address, getAccessToken, returnTo]);

  if (error) {
    const refCode = /timeout/i.test(error) ? "auth-timeout" : error.slice(0, 24).replace(/\s+/g, "-") || "signin-failed";
    return (
      <ErrorScreen
        refCode={refCode}
        onRetry={() => { setError(null); verifiedRef.current = false; autoLoginRef.current = false; }}
        onEmail={() => { setError(null); verifiedRef.current = false; autoLoginRef.current = false; logout().finally(() => login()); }}
      />
    );
  }
  return <Connecting />;
}
