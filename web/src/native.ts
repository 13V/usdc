/**
 * native.ts — Capacitor iOS shell detection + system-browser escape hatch.
 *
 * Google refuses OAuth inside an embedded WKWebView ("disallowed_useragent"),
 * and an OAuth session completed in the system browser lands in Safari's
 * storage, not the shell's. Flows that need OAuth (sign-in, account linking)
 * therefore divert to the system browser from inside the shell and hand the
 * result back via the divvy:// deep link + single-use handoff code.
 * Shared by Login.tsx (sign-in handoff) and ManageLogins.tsx (link handoff).
 */

export function isNativeShell(): boolean {
  try {
    return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

// Open a URL in the system browser from inside the shell. Prefers the
// @capacitor/browser plugin (SFSafariViewController — a real browser context
// Google accepts); falls back to the Cordova-style window.open target. Returns
// false if no out-of-webview route exists (old binary) so the caller can fall
// back to an in-webview flow.
export async function openInSystemBrowser(url: string): Promise<boolean> {
  const cap = (window as unknown as {
    Capacitor?: { Plugins?: { Browser?: { open: (o: { url: string }) => Promise<void> } } };
  }).Capacitor;
  const browser = cap?.Plugins?.Browser;
  if (browser?.open) {
    try {
      await browser.open({ url });
      return true;
    } catch {
      /* fall through */
    }
  }
  try {
    const w = window.open(url, "_system");
    return !!w;
  } catch {
    return false;
  }
}
