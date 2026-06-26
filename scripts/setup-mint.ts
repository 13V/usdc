/**
 * setup-mint.ts — one-time: create the app's test-USDC SPL mint on devnet.
 *
 *   AUTHORITY_KEYPAIR=/path/to/authority.json npx ts-node scripts/setup-mint.ts
 *
 * The authority keypair must already hold a little devnet SOL (mint creation
 * costs ~0.0015 SOL rent). Prints the values to set in the deploy environment:
 *   TEST_USDC_MINT, MINT_AUTHORITY_SECRET.
 */
import "dotenv/config";
import * as fs from "fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, clusterApiUrl } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import { USDC_DECIMALS } from "../src/funding";

async function main() {
  const path = process.env.AUTHORITY_KEYPAIR;
  if (!path) throw new Error("set AUTHORITY_KEYPAIR=/path/to/authority.json");
  const auth = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
  const conn = new Connection(process.env.RPC_URL || clusterApiUrl("devnet"), "confirmed");

  const bal = await conn.getBalance(auth.publicKey);
  console.log("authority:", auth.publicKey.toBase58(), "balance:", bal / LAMPORTS_PER_SOL, "SOL");
  if (bal < 0.01 * LAMPORTS_PER_SOL) {
    throw new Error("authority needs devnet SOL first (fund it, then re-run)");
  }

  if (process.env.TEST_USDC_MINT) {
    console.log("TEST_USDC_MINT already set:", process.env.TEST_USDC_MINT, "— nothing to do.");
    return;
  }

  console.log("creating test-USDC mint (6 decimals)…");
  const mint = await createMint(conn, auth, auth.publicKey, auth.publicKey, USDC_DECIMALS);
  console.log("\n✓ mint created.\n");
  console.log("Set these in the deploy environment:");
  console.log("  TEST_USDC_MINT=" + mint.toBase58());
  console.log("  MINT_AUTHORITY_SECRET=" + JSON.stringify(Array.from(auth.secretKey)));
}

main().catch((e) => { console.error("setup failed:", e.message || e); process.exit(1); });
