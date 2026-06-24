/**
 * wallet.ts — self-custodial Solana wallet on device.
 *
 * The keypair is generated with @solana/web3.js and stored in the OS secure
 * enclave via expo-secure-store (Keychain on iOS / Keystore on Android) — a real
 * upgrade over the web app's localStorage key. Signing uses tweetnacl, producing
 * a standard Ed25519 signature the server's SIWS verify accepts.
 */
import * as SecureStore from "expo-secure-store";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { Buffer } from "buffer";

const SECRET_KEY = "divvy.wallet.secret"; // base58 of the 64-byte secret key

export interface LocalWallet {
  address: string;
  keypair: Keypair;
}

export async function hasWallet(): Promise<boolean> {
  return (await SecureStore.getItemAsync(SECRET_KEY)) != null;
}

export async function generateWallet(): Promise<LocalWallet> {
  const keypair = Keypair.generate();
  await SecureStore.setItemAsync(SECRET_KEY, bs58.encode(keypair.secretKey));
  return { address: keypair.publicKey.toBase58(), keypair };
}

export async function loadWallet(): Promise<LocalWallet | null> {
  const stored = await SecureStore.getItemAsync(SECRET_KEY);
  if (!stored) return null;
  try {
    const keypair = Keypair.fromSecretKey(bs58.decode(stored));
    return { address: keypair.publicKey.toBase58(), keypair };
  } catch {
    return null;
  }
}

/** Import an existing wallet from a base58 secret key (Phantom export). */
export async function importWallet(secretBase58: string): Promise<LocalWallet> {
  const keypair = Keypair.fromSecretKey(bs58.decode(secretBase58.trim()));
  await SecureStore.setItemAsync(SECRET_KEY, bs58.encode(keypair.secretKey));
  return { address: keypair.publicKey.toBase58(), keypair };
}

export async function clearWallet(): Promise<void> {
  await SecureStore.deleteItemAsync(SECRET_KEY);
}

/** Export the secret key (base58) so the user can back it up. */
export async function exportSecret(): Promise<string | null> {
  return SecureStore.getItemAsync(SECRET_KEY);
}

/** Sign a UTF-8 message; returns base64 (what /api/auth/siws/verify expects). */
export function signMessage(keypair: Keypair, message: string): string {
  const sig = nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey);
  return Buffer.from(sig).toString("base64");
}
