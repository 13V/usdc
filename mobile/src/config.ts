/**
 * API base URL. On a phone, "localhost" is the phone itself, so point this at
 * your computer's LAN IP (e.g. http://192.168.1.50:3000) or a deployed server.
 * Override without editing code via the EXPO_PUBLIC_API_URL env var.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

export const COLORS = {
  green: "#14f195",
  ink: "#04121a",
  bg: "#0b0f14",
  card: "#121821",
  border: "#2a3340",
  text: "#e8eef5",
  muted: "#8a97a6",
  danger: "#ff5d6c",
};
