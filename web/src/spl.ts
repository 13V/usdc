/**
 * spl.ts — Build the USDC transfer transaction in the browser.
 *
 * Mirrors src/liveDevnet.ts: a transferChecked from the friend's embedded wallet
 * to the collector, with the bill's `reference` pubkey attached to the
 * instruction keys so verify.ts can find the payment on-chain.
 */

import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";

const USDC_DECIMALS = 6;

export interface TransferArgs {
  connection: Connection;
  /** Embedded wallet address (the payer) — base58. */
  payer: string;
  /** Collector wallet — base58. */
  collector: string;
  /** USDC mint — base58. */
  mint: string;
  /** Unique reference pubkey for this share — base58. */
  reference: string;
  /** Amount owed, integer cents. */
  amountCents: number;
}

/** cents -> USDC base units (6 decimals): cents * 10^4. */
export function centsToBaseUnits(amountCents: number): bigint {
  return BigInt(amountCents) * 10000n;
}

/**
 * Build (but do not sign) the transfer transaction. feePayer + recentBlockhash
 * are set so Privy's sendTransaction can sign and submit it directly.
 */
export async function buildTransferTransaction(args: TransferArgs): Promise<Transaction> {
  const payer = new PublicKey(args.payer);
  const collector = new PublicKey(args.collector);
  const mint = new PublicKey(args.mint);
  const reference = new PublicKey(args.reference);

  const fromAta = await getAssociatedTokenAddress(mint, payer);
  const toAta = await getAssociatedTokenAddress(mint, collector);

  const tx = new Transaction();

  // Create the collector's token account if it doesn't exist yet (idempotent in
  // practice; the friend pays the tiny rent). Harmless if already present and we
  // checked first.
  const toInfo = await args.connection.getAccountInfo(toAta);
  if (!toInfo) {
    tx.add(createAssociatedTokenAccountInstruction(payer, toAta, collector, mint));
  }

  const ix = createTransferCheckedInstruction(
    fromAta,
    mint,
    toAta,
    payer,
    centsToBaseUnits(args.amountCents),
    USDC_DECIMALS
  );
  // THE KEY TRICK (same as liveDevnet): make the reference discoverable on-chain.
  ix.keys.push({ pubkey: reference, isSigner: false, isWritable: false });
  tx.add(ix);

  tx.feePayer = payer;
  const { blockhash } = await args.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  return tx;
}

/** Read the friend's USDC balance (in cents), or 0 if no token account yet. */
export async function readUsdcBalanceCents(
  connection: Connection,
  owner: string,
  mint: string
): Promise<number> {
  try {
    const ata = await getAssociatedTokenAddress(new PublicKey(mint), new PublicKey(owner));
    const bal = await connection.getTokenAccountBalance(ata);
    // amount is base units (string); cents = baseUnits / 10^4.
    return Math.floor(Number(BigInt(bal.value.amount) / 10000n));
  } catch {
    return 0;
  }
}
