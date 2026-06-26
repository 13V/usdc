/* screens/welcome.js — "wallet ready" success interstitial.

   Shown once right after onboarding (Privy email/social → embedded Solana wallet,
   or Phantom connect). Recreates the "Wallet Ready" design frame with the user's
   real emoji/color identity + wallet address. Not a top-level tab, so the bottom
   tab bar is hidden. Copy adapts to how they arrived (created vs connected),
   signalled via sessionStorage("divvy.onboardVia"). */
(function () {
  "use strict";
  var Auth = window.Auth;

  // One-time keyframes for the celebrating mascot + confetti (survives re-renders).
  function ensureKeyframes() {
    if (document.getElementById("wr-keyframes")) return;
    var s = document.createElement("style");
    s.id = "wr-keyframes";
    s.textContent =
      "@keyframes wrSquish{0%,100%{border-radius:48% 52% 51% 49%/53% 49% 51% 47%}50%{border-radius:52% 48% 49% 51%/47% 51% 49% 53%}}" +
      "@keyframes wrBlink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.12)}}" +
      "@keyframes wrFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}" +
      "@keyframes wrCheer{0%,100%{transform:rotate(-30deg)}50%{transform:rotate(-52deg)}}" +
      "@keyframes wrCheerR{0%,100%{transform:rotate(30deg)}50%{transform:rotate(52deg)}}" +
      "@keyframes wrHalo{0%,100%{opacity:.55;transform:translate(-50%,-50%) scale(1)}50%{opacity:.9;transform:translate(-50%,-50%) scale(1.06)}}" +
      "@keyframes wrPop{0%{transform:scale(0)}60%{transform:scale(1.18)}100%{transform:scale(1)}}" +
      "@keyframes wrConf{0%{transform:translateY(0) rotate(0);opacity:0}12%{opacity:1}100%{transform:translateY(120px) rotate(220deg);opacity:0}}";
    document.head.appendChild(s);
  }

  function trunc(w) {
    w = String(w || "");
    return w.length > 10 ? w.slice(0, 4) + "…" + w.slice(-4) : (w || "—");
  }

  function mascotHtml() {
    return '' +
      '<div style="position:relative; width:200px; height:200px; display:flex; align-items:center; justify-content:center; margin-bottom:6px;">' +
        // mint halo
        '<div style="position:absolute; left:50%; top:50%; width:230px; height:230px; border-radius:50%; background:radial-gradient(circle, rgba(61,232,199,0.34) 0%, rgba(61,232,199,0.1) 42%, rgba(61,232,199,0) 68%); animation:wrHalo 3.2s ease-in-out infinite;"></div>' +
        // confetti
        '<div style="position:absolute; left:30px; top:24px; width:9px; height:9px; border-radius:2px; background:#3DE8C7; animation:wrConf 2.6s ease-in-out infinite; animation-delay:.1s;"></div>' +
        '<div style="position:absolute; left:158px; top:18px; width:8px; height:8px; border-radius:50%; background:#FFC65C; animation:wrConf 2.9s ease-in-out infinite; animation-delay:.5s;"></div>' +
        '<div style="position:absolute; left:8px; top:78px; width:7px; height:7px; border-radius:2px; background:#FF6B5E; animation:wrConf 3.1s ease-in-out infinite; animation-delay:.9s;"></div>' +
        '<div style="position:absolute; left:184px; top:88px; width:9px; height:9px; border-radius:50%; background:#5BA6F0; animation:wrConf 2.7s ease-in-out infinite; animation-delay:1.3s;"></div>' +
        '<div style="position:absolute; left:54px; top:6px; width:7px; height:7px; border-radius:2px; background:#FFC65C; animation:wrConf 3.3s ease-in-out infinite; animation-delay:1.7s;"></div>' +
        '<div style="position:absolute; left:132px; top:8px; width:8px; height:8px; border-radius:50%; background:#3DE8C7; animation:wrConf 2.8s ease-in-out infinite; animation-delay:2.1s;"></div>' +
        // mascot body
        '<div style="position:relative; width:148px; height:148px; animation:wrFloat 4.6s ease-in-out infinite;">' +
          '<div style="position:absolute; left:6px; top:30px; width:30px; height:62px; border-radius:999px; background:linear-gradient(165deg,#3f95e6,#1a5290); transform-origin:15px 56px; animation:wrCheer 1.6s ease-in-out infinite;"></div>' +
          '<div style="position:absolute; right:6px; top:30px; width:30px; height:62px; border-radius:999px; background:linear-gradient(165deg,#3f95e6,#1a5290); transform-origin:15px 56px; animation:wrCheerR 1.6s ease-in-out infinite;"></div>' +
          '<div style="position:absolute; left:46px; bottom:-10px; width:26px; height:42px; border-radius:999px; background:linear-gradient(165deg,#3a90e2,#16487f);"></div>' +
          '<div style="position:absolute; right:46px; bottom:-10px; width:26px; height:42px; border-radius:999px; background:linear-gradient(165deg,#3a90e2,#16487f);"></div>' +
          '<div style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:130px; height:130px; background:linear-gradient(155deg,#4aa0f0,#2775CA 60%,#1c5697); animation:wrSquish 5s ease-in-out infinite; box-shadow:0 18px 38px rgba(6,14,24,0.5), inset 0 6px 14px rgba(255,255,255,0.32), inset 0 -8px 18px rgba(13,40,72,0.5); display:flex; align-items:center; justify-content:center;">' +
            '<div style="position:absolute; top:18px; left:26px; width:58px; height:38px; border-radius:50%; background:radial-gradient(closest-side, rgba(255,255,255,0.4), rgba(255,255,255,0)); pointer-events:none;"></div>' +
            '<div style="display:flex; gap:20px; margin-top:-8px;">' +
              '<div style="width:15px; height:20px; border-radius:50%; background:#0B1622; animation:wrBlink 5.5s infinite;"></div>' +
              '<div style="width:15px; height:20px; border-radius:50%; background:#0B1622; animation:wrBlink 5.5s infinite;"></div>' +
            '</div>' +
            '<div style="position:absolute; bottom:42px; width:34px; height:17px; border:6px solid #0B1622; border-top:none; border-radius:0 0 22px 22px;"></div>' +
          '</div>' +
          // mint check badge
          '<div style="position:absolute; right:2px; bottom:8px; width:40px; height:40px; border-radius:50%; background:linear-gradient(150deg,#5ff0d4,#2bccae); border:3px solid #0B1622; display:flex; align-items:center; justify-content:center; box-shadow:0 6px 16px rgba(61,232,199,0.5); animation:wrPop .5s ease-out both; animation-delay:.35s;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0B1622" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>' +
        '</div>' +
      '</div>';
  }

  function paint(view, user) {
    ensureKeyframes();
    var emoji = (user && user.emoji) || "🦊";
    var color = (user && user.color) || "linear-gradient(150deg,#2775CA,#3DE8C7)";
    var wallet = (user && user.primaryWallet) || "";
    var via = "";
    try { via = sessionStorage.getItem("divvy.onboardVia") || ""; } catch (_) {}
    var connected = via === "phantom";

    var kicker = connected ? "WALLET CONNECTED" : "WALLET READY";
    var headline = connected ? "you're connected." : "you're in.";
    var sub = connected
      ? "your wallet's linked — you're in control. settle up straight from divvy."
      : "your solana wallet's ready — no seed phrase, no app. recover anytime with your email.";
    var reassure = connected ? "powered by phantom" : "secured by privy";

    view.innerHTML = '' +
      '<div style="position:relative; min-height:100%; display:flex; flex-direction:column; background:#0B1622; overflow:hidden;">' +
        // texture + ambient glow
        '<div style="position:absolute; inset:0; background-image:repeating-radial-gradient(circle at 84% 4%, rgba(244,247,250,0.022) 0 1px, transparent 1px 9px); opacity:.6; pointer-events:none;"></div>' +
        '<div style="position:absolute; left:50%; top:300px; width:520px; height:520px; transform:translateX(-50%); border-radius:50%; background:radial-gradient(circle, rgba(61,232,199,0.13) 0%, rgba(39,117,202,0.08) 38%, rgba(39,117,202,0) 66%); pointer-events:none;"></div>' +

        // close
        '<div style="position:relative; z-index:6; padding:8px 16px 2px; flex:none;">' +
          '<div id="wClose" style="width:36px; height:36px; border-radius:50%; background:rgba(244,247,250,0.05); border:1px solid rgba(244,247,250,0.08); display:flex; align-items:center; justify-content:center; cursor:pointer;"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.6)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></div>' +
        '</div>' +

        // main
        '<div style="position:relative; z-index:2; flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:0 26px 8px; text-align:center;">' +
          mascotHtml() +
          '<div style="font-family:\'Space Mono\',monospace; font-size:11px; font-weight:700; letter-spacing:3px; color:#3DE8C7; margin-top:16px;">' + kicker + '</div>' +
          '<h1 style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:46px; letter-spacing:-1.4px; margin:8px 0 0; color:#F4F7FA;">' + headline + '</h1>' +
          '<p style="font-family:\'General Sans\',sans-serif; font-weight:400; font-size:14.5px; line-height:1.5; color:rgba(244,247,250,0.55); max-width:300px; margin:12px 0 0; text-wrap:pretty;">' + sub + '</p>' +

          // wallet identity card
          '<div style="width:100%; max-width:320px; margin-top:26px;">' +
            '<div style="font-family:\'Space Mono\',monospace; font-size:10px; letter-spacing:1.5px; color:rgba(244,247,250,0.42); text-align:left; margin:0 4px 9px;">YOUR WALLET</div>' +
            '<div style="display:flex; align-items:center; gap:13px; background:#13212E; border:1px solid rgba(244,247,250,0.09); border-radius:20px; padding:14px 15px; box-shadow:0 14px 32px rgba(0,0,0,0.3);">' +
              '<div style="width:46px; height:46px; border-radius:15px; background:' + color + '; display:flex; align-items:center; justify-content:center; font-size:24px; flex:none; box-shadow:0 6px 16px rgba(39,117,202,0.4);">' + app.esc(emoji) + '</div>' +
              '<div style="flex:1; text-align:left; min-width:0;">' +
                '<div style="font-family:\'Space Mono\',monospace; font-size:9px; letter-spacing:1px; color:rgba(244,247,250,0.4);">SOLANA</div>' +
                '<div style="font-family:\'Space Mono\',monospace; font-weight:700; font-size:17px; letter-spacing:.5px; color:#F4F7FA; margin-top:3px;">' + app.esc(trunc(wallet)) + '</div>' +
              '</div>' +
              '<div id="wCopy" title="copy address" style="width:38px; height:38px; border-radius:11px; background:rgba(244,247,250,0.05); border:1px solid rgba(244,247,250,0.08); display:flex; align-items:center; justify-content:center; cursor:pointer; flex:none;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(244,247,250,0.55)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></div>' +
            '</div>' +
            '<div style="display:flex; align-items:center; justify-content:center; gap:7px; margin-top:12px;">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3DE8C7" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' +
              '<span style="font-family:\'Space Mono\',monospace; font-size:10.5px; letter-spacing:.3px; color:rgba(244,247,250,0.45);">' + reassure + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // sticky CTA
        '<div style="position:relative; z-index:6; flex:none; padding:8px 26px calc(20px + env(safe-area-inset-bottom));">' +
          '<button id="wStart" style="appearance:none; border:none; cursor:pointer; width:100%; min-height:58px; border-radius:999px; background:linear-gradient(120deg,#3286db,#2775CA); display:flex; align-items:center; justify-content:center; gap:9px; box-shadow:0 14px 34px rgba(39,117,202,0.55), inset 0 1px 0 rgba(255,255,255,0.28);">' +
            '<span style="font-family:\'Clash Display\',\'General Sans\',sans-serif; font-weight:600; font-size:17px; color:#fff;">start splitting</span><span style="font-size:15px;">✨</span>' +
          '</button>' +
          '<div style="text-align:center; margin-top:14px;"><span id="wView" style="font-family:\'General Sans\',sans-serif; font-weight:500; font-size:14px; color:rgba(244,247,250,0.5); cursor:pointer;">view my wallet</span></div>' +
        '</div>' +
      '</div>';

    // onboarding flag is consumed once
    try { sessionStorage.removeItem("divvy.onboardVia"); } catch (_) {}

    var close = document.getElementById("wClose"),
        start = document.getElementById("wStart"),
        viewW = document.getElementById("wView"),
        cp = document.getElementById("wCopy");
    if (close) close.onclick = function () { app.go("home"); };
    if (start) start.onclick = function () { app.go("home"); };
    if (viewW) viewW.onclick = function () { app.go("you"); };
    if (cp) cp.onclick = function () {
      if (wallet) { app.copy(wallet); app.toast("address copied"); }
    };
  }

  window.Screens = window.Screens || {};
  window.Screens.welcome = {
    title: "welcome",
    render: async function (view) {
      var user = Auth && Auth.user;
      // Arriving straight from the onboarding redirect, /api/me may still be in
      // flight — wait for auth to settle so we can show the real identity.
      if (!user && Auth && Auth.ready) {
        try { user = await Auth.ready; } catch (_) { user = Auth.user; }
      }
      if (!user) { app.go("home"); return; }
      paint(view, user);
    },
  };
})();
