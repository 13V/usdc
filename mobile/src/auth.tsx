/**
 * auth.tsx — auth context. Sign in by creating a wallet (or importing one),
 * which signs a SIWS nonce to get a session token. Token persists in SecureStore.
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import { api, User } from "./api";
import {
  generateWallet,
  loadWallet,
  importWallet,
  hasWallet,
  clearWallet,
  signMessage,
  LocalWallet,
} from "./wallet";

const TOKEN_KEY = "divvy.token";

interface AuthState {
  ready: boolean;
  user: User | null;
  token: string | null;
  address: string | null;
  createWallet: () => Promise<void>;
  importExisting: (secretBase58: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  setHandle: (handle: string) => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within <AuthProvider>");
  return v;
}

/** Run the SIWS handshake with a wallet and return a session token. */
async function siws(wallet: LocalWallet): Promise<string> {
  const { message } = await api<{ message: string }>("/api/auth/nonce");
  const signature = signMessage(wallet.keypair, message);
  const { token } = await api<{ token: string }>("/api/auth/siws/verify", {
    method: "POST",
    body: { pubkey: wallet.address, signature, message },
  });
  return token;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  const applyToken = useCallback(async (t: string, addr: string | null) => {
    await SecureStore.setItemAsync(TOKEN_KEY, t);
    setToken(t);
    if (addr) setAddress(addr);
    const me = await api<{ user: User | null }>("/api/me", { token: t });
    setUser(me.user);
  }, []);

  const createWallet = useCallback(async () => {
    const wallet = await generateWallet();
    const t = await siws(wallet);
    await applyToken(t, wallet.address);
  }, [applyToken]);

  const importExisting = useCallback(async (secretBase58: string) => {
    const wallet = await importWallet(secretBase58);
    const t = await siws(wallet);
    await applyToken(t, wallet.address);
  }, [applyToken]);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setToken(null);
    setUser(null);
    // Keep the wallet on device so the user can sign back in; clearWallet() is
    // available if they want to fully remove it.
  }, []);

  const refreshMe = useCallback(async () => {
    if (!token) return;
    const me = await api<{ user: User | null }>("/api/me", { token });
    setUser(me.user);
  }, [token]);

  const setHandle = useCallback(
    async (handle: string) => {
      const me = await api<{ user: User }>("/api/me", {
        method: "PATCH",
        body: { handle },
        token,
      });
      setUser(me.user);
    },
    [token]
  );

  // On launch: reuse a stored token, else silently re-sign-in with the stored
  // wallet if one exists.
  useEffect(() => {
    (async () => {
      try {
        const existing = await SecureStore.getItemAsync(TOKEN_KEY);
        if (existing) {
          try {
            const me = await api<{ user: User | null }>("/api/me", { token: existing });
            if (me.user) {
              setToken(existing);
              setUser(me.user);
              const w = await loadWallet();
              if (w) setAddress(w.address);
              return;
            }
          } catch {
            /* token invalid/expired — fall through */
          }
        }
        if (await hasWallet()) {
          const w = await loadWallet();
          if (w) {
            try {
              const t = await siws(w);
              await applyToken(t, w.address);
            } catch {
              /* server unreachable — stay signed out */
            }
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, [applyToken]);

  return (
    <Ctx.Provider
      value={{ ready, user, token, address, createWallet, importExisting, signOut, refreshMe, setHandle }}
    >
      {children}
    </Ctx.Provider>
  );
}

export { clearWallet };
