/**
 * nav.tsx — a tiny dependency-free navigator: bottom tabs + a simple stack for
 * pushed detail screens (group detail, chat). Keeps the scaffold lean; swap for
 * expo-router / react-navigation later without touching the screens' logic.
 */
import React, { createContext, useContext, useState, useCallback } from "react";

export type Route =
  | { name: "groups" }
  | { name: "friends" }
  | { name: "balances" }
  | { name: "group"; tripId: string }
  | { name: "chat"; tripId: string; shareToken: string };

export type TabName = "groups" | "friends" | "balances";

interface NavState {
  stack: Route[];
  current: Route;
  push: (r: Route) => void;
  pop: () => void;
  switchTab: (t: TabName) => void;
}

const Ctx = createContext<NavState | null>(null);

export function useNav(): NavState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNav must be used within <NavProvider>");
  return v;
}

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: "groups" }]);
  const current = stack[stack.length - 1];

  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  // Switching a tab resets the stack to that tab root.
  const switchTab = useCallback((t: TabName) => setStack([{ name: t }]), []);

  return <Ctx.Provider value={{ stack, current, push, pop, switchTab }}>{children}</Ctx.Provider>;
}

export function isTab(r: Route): r is { name: TabName } {
  return r.name === "groups" || r.name === "friends" || r.name === "balances";
}
