/**
 * solanaPay.ts — Build Solana Pay transfer-request URLs.
 *
 * Scheme:
 *   solana:<recipient>?amount=<dollars>&spl-token=<mint>&reference=<pubkey>&label=..&message=..
 *
 * - recipient is the collector's WALLET (not its token account / ATA). Wallets
 *   compute the ATA themselves.
 * - amount is in DECIMAL TOKEN UNITS (dollars for USDC), not cents and not raw
 *   base units. USDC has 6 decimals but the Solana Pay `amount` is human dollars.
 * - reference is a unique throwaway pubkey per request, used to find the payment
 *   on-chain later (it never holds funds; it's just a marker in the tx).
 */

import { PublicKey, Keypair } from "@solana/web3.js";
import { dollars } from "./split";

/**
 * USDC SPL token mints. The devnet mint is overridable via TEST_USDC_MINT so the
 * demo can settle in an app-controlled test-USDC token (minted on demand) rather
 * than Circle's devnet USDC (which needs an external faucet). Falls back to
 * Circle's devnet mint when unset.
 */
export const USDC_MINT = {
  "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: process.env.TEST_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
} as const;

export type Cluster = "mainnet-beta" | "devnet";

export interface PaymentRequest {
  /** Collector wallet (base58). */
  recipient: string;
  /** Amount owed, integer cents. */
  amountCents: number;
  /** SPL token mint (USDC). */
  splToken: string;
  /** Unique reference pubkey (base58) used to locate the payment on-chain. */
  reference: string;
  label?: string;
  message?: string;
}

/** Generate a fresh throwaway reference pubkey (base58). */
export function newReference(): string {
  return Keypair.generate().publicKey.toBase58();
}

/**
 * Format cents as a Solana Pay `amount` (decimal dollars). USDC has 6 decimals,
 * but cents only ever produce 2 decimal places, so this is exact.
 */
export function amountFromCents(amountCents: number): string {
  if (!Number.isInteger(amountCents)) throw new Error("amountFromCents: need integer cents");
  // dollars(2914) -> 29.14 ; toFixed(2) keeps it exact for cent amounts.
  return dollars(amountCents).toFixed(2);
}

/** Build a Solana Pay transfer-request URL from a PaymentRequest. */
export function buildSolanaPayUrl(req: PaymentRequest): string {
  // Validate base58 pubkeys up front (throws on bad input).
  // eslint-disable-next-line no-new
  new PublicKey(req.recipient);
  // eslint-disable-next-line no-new
  new PublicKey(req.reference);
  // eslint-disable-next-line no-new
  new PublicKey(req.splToken);

  const params = new URLSearchParams();
  params.set("amount", amountFromCents(req.amountCents));
  params.set("spl-token", req.splToken);
  params.set("reference", req.reference);
  if (req.label) params.set("label", req.label);
  if (req.message) params.set("message", req.message);

  // URLSearchParams encodes spaces as "+"; Solana Pay expects %20. Normalize.
  const query = params.toString().replace(/\+/g, "%20");
  return `solana:${req.recipient}?${query}`;
}
