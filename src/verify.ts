/**
 * verify.ts — Detect payments on-chain.
 *
 * findPayment(connection, reference): look up signatures that touched the
 * reference pubkey. Because each payment request embeds a unique throwaway
 * reference in the transfer instruction's keys, a confirmed signature on that
 * reference means "someone paid this request".
 *
 * PRODUCTION NOTE: a confirmed signature is NOT proof of a correct payment. A
 * hardened flow must also validateTransfer — confirm the exact amount, the
 * recipient, and the token mint at the "finalized" commitment before marking a
 * participant PAID. validatePayment() below sketches that check; wire it in
 * once you're running against a real RPC.
 */

import {
  Connection,
  PublicKey,
  ParsedInstruction,
  PartiallyDecodedInstruction,
} from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

export interface FoundPayment {
  signature: string;
  slot: number;
  /** Block time (unix seconds), if the RPC provided it. */
  blockTime?: number | null;
}

/**
 * Find a confirmed payment that references `reference`. Returns the earliest
 * confirmed signature, or null if none yet.
 */
export async function findPayment(
  connection: Connection,
  reference: string
): Promise<FoundPayment | null> {
  const refKey = new PublicKey(reference);
  const sigs = await connection.getSignaturesForAddress(refKey, { limit: 10 }, "confirmed");
  if (sigs.length === 0) return null;

  // getSignaturesForAddress returns newest-first; take the oldest confirmed one
  // (the original payment) and skip anything that errored.
  const confirmed = sigs.filter((s) => s.err == null);
  if (confirmed.length === 0) return null;
  const oldest = confirmed[confirmed.length - 1];
  return {
    signature: oldest.signature,
    slot: oldest.slot,
    blockTime: oldest.blockTime,
  };
}

export interface ExpectedTransfer {
  reference: string;
  recipient: string;
  splToken: string;
  /** Expected amount, integer cents. */
  amountCents: number;
}

export interface ValidationResult {
  ok: boolean;
  signature?: string;
  reason?: string;
}

/**
 * Harden findPayment: confirm the referenced transaction actually moved the
 * expected USDC amount to the expected recipient, at "finalized" commitment.
 *
 * This is a best-effort parser over the parsed transaction. It looks for an
 * spl-token transfer/transferChecked instruction whose token, amount, AND
 * destination (the collector's associated token account) all match what we
 * asked for. Treat a `false` as "not yet verifiable", not necessarily "fraud" —
 * the tx may simply not be finalized yet (use isFinalizing()).
 */
export async function validatePayment(
  connection: Connection,
  expected: ExpectedTransfer
): Promise<ValidationResult> {
  const refKey = new PublicKey(expected.reference);
  const sigs = await connection.getSignaturesForAddress(refKey, { limit: 10 }, "finalized");
  const confirmed = sigs.filter((s) => s.err == null);
  if (confirmed.length === 0) return { ok: false, reason: "no finalized signature yet" };

  const signature = confirmed[confirmed.length - 1].signature;
  const tx = await connection.getParsedTransaction(signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) return { ok: false, signature, reason: "transaction not found at finalized" };
  if (tx.meta?.err) return { ok: false, signature, reason: "transaction failed" };

  // Expected raw amount: USDC has 6 decimals; cents -> base units = cents * 10^4.
  const expectedBaseUnits = BigInt(expected.amountCents) * 10000n;
  // The collector receives into their associated token account for this mint.
  const mintKey = new PublicKey(expected.splToken);
  const recipientKey = new PublicKey(expected.recipient);
  const expectedAta = (await getAssociatedTokenAddress(mintKey, recipientKey)).toBase58();

  const instructions = tx.transaction.message
    .instructions as (ParsedInstruction | PartiallyDecodedInstruction)[];

  for (const ix of instructions) {
    if (!("parsed" in ix)) continue; // not a parsed (decoded) instruction
    if (ix.program !== "spl-token") continue;
    const info = (ix.parsed as { type?: string; info?: Record<string, unknown> }) || {};
    const type = info.type;
    const d = (info.info || {}) as Record<string, unknown>;
    const destination = String(d.destination ?? "");

    if (type === "transferChecked") {
      const mint = String(d.mint ?? "");
      const tokenAmount = d.tokenAmount as { amount?: string } | undefined;
      const amount = BigInt(tokenAmount?.amount ?? "0");
      // Exact match: token mint, amount, AND destination = collector's ATA.
      if (mint === expected.splToken && amount === expectedBaseUnits && destination === expectedAta) {
        return { ok: true, signature };
      }
    } else if (type === "transfer") {
      // Plain `transfer` doesn't carry the mint; the destination ATA (derived
      // from mint+recipient) is what ties it to the right token and collector.
      const amount = BigInt(String(d.amount ?? "0"));
      if (amount === expectedBaseUnits && destination === expectedAta) {
        return { ok: true, signature };
      }
    }
  }

  return { ok: false, signature, reason: "no matching transfer to the collector found" };
}
