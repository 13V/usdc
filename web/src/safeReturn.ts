/**
 * safeReturnPath — sanitize an attacker-influenced "return to" URL so it can
 * only ever be a SAME-ORIGIN path, never a cross-origin redirect.
 *
 * The embedded app sets window.location.href to a `ret`/`return` query param
 * after a flow completes. Without this guard, values like "//attacker.com" or
 * "/\\attacker.com" (protocol-relative — browsers navigate them cross-origin)
 * or "https://attacker.com" would open-redirect the user off the app.
 *
 * Allowed: a path starting with a single "/" whose next char is NOT "/" or "\"
 * (so "/#/home", "/#/settle/abc", "/" pass; "//x", "/\\x", "https://x" fall back).
 */
export function safeReturnPath(raw: string | null | undefined, fallback: string): string {
  if (!raw || !/^\/(?![/\\])/.test(raw)) return fallback;
  return raw;
}
