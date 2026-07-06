import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wrapper config. Divvy is a server-driven app (the SPA in public/,
 * the server-rendered /pay + /embedded routes, and the API all share one
 * origin), so the native shell loads that origin directly via `server.url`.
 * This gets a working iOS/Android build immediately — see docs/CAPACITOR.md.
 *
 * Set the production origin with CAP_SERVER_URL before `npx cap sync`
 * (defaults to the demo). Use HTTPS only.
 *
 * NOTE (Apple Guideline 4.2 — "minimum functionality"): a pure web wrapper can
 * be scrutinized. Before submitting, add native capabilities that elevate it
 * beyond a website — push notifications (@capacitor/push-notifications), native
 * share (@capacitor/share), haptics (@capacitor/haptics), and biometric unlock.
 * The runbook lists these as the pre-submit step.
 */
const SERVER_URL = process.env.CAP_SERVER_URL || "https://usdc-production-ecba.up.railway.app";

const config: CapacitorConfig = {
  appId: "com.divvysol.app",
  appName: "Divvy",
  // Required even when loading a remote URL: `cap copy` stages this dir. It holds
  // the app shell / offline fallback.
  webDir: "public",
  backgroundColor: "#F7F1E3",
  server: {
    url: SERVER_URL,
    // Never allow plaintext HTTP — money app.
    cleartext: false,
    androidScheme: "https",
    iosScheme: "https",
  },
  ios: {
    backgroundColor: "#F7F1E3",
    // The SPA handles safe areas itself (env() insets) and the document never
    // scrolls (#view scrolls internally) — no automatic content insets, and
    // disable the WKWebView scroll view so the whole app can't be dragged /
    // rubber-banded. Takes effect on the next native build.
    contentInset: "never",
    scrollEnabled: false,
  },
  android: {
    backgroundColor: "#F7F1E3",
  },
};

export default config;
