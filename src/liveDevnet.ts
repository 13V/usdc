/**
 * liveDevnet.ts — Real end-to-end on devnet.
 *
 * Flow:
 *   1. Get a payer (PAYER_SECRET_KEY from env, else generate + airdrop).
 *   2. Mint a USDC-style SPL token (6 decimals) we control on devnet.
 *   3. Create a fresh "collector" wallet; make its ATA.
 *   4. Send the EXACT share to the collector, with the payment's `reference`
 *      pubkey attached to the transfer instruction's keys.
 *   5. verify.findPayment() locates the tx by that reference -> PAID.
 *
 * KEY TRICK: Solana Pay clients add the reference to the instruction key list so
 * it's discoverable via getSignaturesForAddress. We replicate that here:
 *      ix.keys.push({ pubkey: reference, isSigner: false, isWritable: false });
 *
 * BLOCKED-BY-ENV: the public devnet faucet rate-limits airdrops (429). Provide a
 * funded keypair via PAYER_SECRET_KEY and a non-rate-limited RPC via RPC_URL
 * (Helius/QuickNode) to run this without relying on the faucet.
 */

import "dotenv/config";
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { newReference } from "./solanaPay";
import { findPayment, validatePayment } from "./verify";
import { computeSplit, fmt } from "./split";

const USDC_DECIMALS = 6;

function rpc(): string {
  return process.env.RPC_URL || clusterApiUrl("devnet");
}

function loadPayer(): Keypair | null {
  const raw = process.env.PAYER_SECRET_KEY;
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch {
    throw new Error("PAYER_SECRET_KEY must be a JSON array of 64 bytes");
  }
}

async function ensureFunded(connection: Connection, payer: Keypair): Promise<void> {
  const bal = await connection.getBalance(payer.publicKey);
  if (bal >= 0.5 * LAMPORTS_PER_SOL) {
    console.log(`Payer funded: ${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
    return;
  }
  console.log("Requesting devnet airdrop (public faucet may 429)…");
  const sig = await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
  console.log("Airdrop confirmed.");
}

async function main(): Promise<void> {
  const connection = new Connection(rpc(), "confirmed");
  console.log(`RPC: ${rpc()}`);

  let payer = loadPayer();
  if (!payer) {
    payer = Keypair.generate();
    console.log("No PAYER_SECRET_KEY; generated a fresh payer (will need an airdrop).");
  }
  console.log(`Payer: ${payer.publicKey.toBase58()}`);
  await ensureFunded(connection, payer);

  // 1) Mint a USDC-style token we control.
  console.log("Creating a USDC-style mint (6 decimals)…");
  const mint = await createMint(connection, payer, payer.publicKey, null, USDC_DECIMALS);
  console.log(`Mint: ${mint.toBase58()}`);

  // 2) Payer's token account + supply.
  const payerAta = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
  await mintTo(connection, payer, mint, payerAta.address, payer, 1_000_000_000); // 1000.000000 tokens
  console.log("Minted 1000 test-USDC to payer.");

  // 3) A fresh collector wallet + its ATA.
  const collector = Keypair.generate();
  const collectorAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    collector.publicKey
  );
  console.log(`Collector: ${collector.publicKey.toBase58()}`);

  // 4) Compute a split and pay ONE share with its reference attached.
  const split = computeSplit({ totalCents: 8740, names: ["Ava", "Ben", "Cy"], mode: "equal" });
  const target = split[0]; // Ava owes 29.14
  const reference = new PublicKey(newReference());
  console.log(`Paying ${target.name}'s share ${fmt(target.cents)}  ref=${reference.toBase58()}`);

  const baseUnits = BigInt(target.cents) * 10000n; // cents -> 6-decimal base units
  const ix = createTransferCheckedInstruction(
    payerAta.address,
    mint,
    collectorAta.address,
    payer.publicKey,
    baseUnits,
    USDC_DECIMALS
  );
  // THE KEY TRICK: make the reference discoverable on-chain.
  ix.keys.push({ pubkey: reference, isSigner: false, isWritable: false });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
  console.log(`Sent: ${sig}`);

  // 5) Verify by reference.
  const found = await findPayment(connection, reference.toBase58());
  if (!found) throw new Error("findPayment did not locate the payment");
  console.log(`✓ findPayment matched signature ${found.signature} at slot ${found.slot}`);

  // 6) Harden: validate exact amount + recipient + token at "finalized". This
  // is the production gate — poll until the tx finalizes (~15-30s on devnet).
  console.log("Validating exact amount + recipient + token at finalized (polling)…");
  const expected = {
    reference: reference.toBase58(),
    recipient: collector.publicKey.toBase58(),
    splToken: mint.toBase58(),
    amountCents: target.cents,
  };
  let valid = await validatePayment(connection, expected);
  for (let i = 0; i < 20 && !valid.ok; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    valid = await validatePayment(connection, expected);
  }
  if (valid.ok) {
    console.log(`✓ validatePayment OK — finalized, exact amount + collector ATA (sig ${valid.signature})`);
  } else {
    console.log(`✗ validatePayment failed: ${valid.reason}`);
    throw new Error("validatePayment did not confirm the transfer");
  }

  console.log("\nDONE — a real on-chain transfer was detected AND validated; payer is PAID.");
}

main().catch((err) => {
  console.error("live-devnet failed:", err.message || err);
  process.exit(1);
});
