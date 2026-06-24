/**
 * API base URL. On a phone, "localhost" is the phone itself, so point this at
 * your computer's LAN IP (e.g. http://192.168.1.50:3000) or a deployed server.
 * Override without editing code via the EXPO_PUBLIC_API_URL env var.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

// Brand palette, aligned to the marketing site (USDC blue accent on ink).
// `green` is kept as the accent key (now USDC blue #2775ca) so existing screens
// that reference COLORS.green pick up the new brand without per-call changes.
export const COLORS = {
  green: "#2775ca",
  ink: "#04121a",
  bg: "#04121a",
  card: "#081c28",
  border: "#123040",
  text: "#f6f1e7",
  muted: "#8a97a6",
  danger: "#e0a892",
};
