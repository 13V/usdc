/**
 * funding.ts — devnet wallet funding for the MVP demo.
 *
 * A freshly created (Privy) wallet has no SOL for gas and no USDC to settle
 * with. To keep the demo self-contained we run an app-controlled treasury:
 *   - an authority keypair (MINT_AUTHORITY_SECRET) that holds devnet SOL and is
 *     the mint authority of a test-USDC SPL token (TEST_USDC_MINT),
 *   - fundWallet() drips a little gas SOL and mints test-USDC to a user's wallet.
 *
 * test-USDC is minted freely (no faucet), so the only external dependency is
 * seeding the authority with a bit of devnet SOL once. All amounts are devnet
 * test value — nothing here touches real money.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";

export const USDC_DECIMALS = 6;
const ONE_USDC = 1_000_000; // base units (6 decimals)

// Generous-enough-for-a-demo grants, with top-up thresholds so repeat calls
// don't drain the treasury.
const GAS_DRIP_LAMPORTS = Math.round(0.02 * LAMPORTS_PER_SOL);
const GAS_MIN_LAMPORTS = Math.round(0.012 * LAMPORTS_PER_SOL);
const USDC_GRANT = 25 * ONE_USDC;
const USDC_MIN = 5 * ONE_USDC;

function rpcUrl(): string {
  return process.env.RPC_URL || clusterApiUrl("devnet");
}
export function connection(): Connection {
  return new Connection(rpcUrl(), "confirmed");
}

/** True once the treasury authority + mint are configured. */
export function fundingConfigured(): boolean {
  return !!process.env.MINT_AUTHORITY_SECRET && !!process.env.TEST_USDC_MINT;
}

export function authorityKeypair(): Keypair {
  const raw = process.env.MINT_AUTHORITY_SECRET;
  if (!raw) throw new Error("MINT_AUTHORITY_SECRET not set");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

export function testMint(): PublicKey {
  const m = process.env.TEST_USDC_MINT;
  if (!m) throw new Error("TEST_USDC_MINT not set");
  return new PublicKey(m);
}

export interface FundResult {
  solDripped: boolean;
  usdcMinted: boolean;
  sol: number;
  usdc: number;
}

/**
 * Top up a wallet so it can settle: drip gas SOL if low, mint test-USDC if low.
 * Idempotent-ish via thresholds. Throws if the treasury isn't configured/funded.
 */
export async function fundWallet(address: string): Promise<FundResult> {
  if (!fundingConfigured()) throw new Error("funding not configured");
  const c = connection();
  const auth = authorityKeypair();
  const mint = testMint();
  const dest = new PublicKey(address);

  // 1) gas drip
  let solDripped = false;
  const solBal = await c.getBalance(dest);
  if (solBal < GAS_MIN_LAMPORTS) {
    const authBal = await c.getBalance(auth.publicKey);
    if (authBal < GAS_DRIP_LAMPORTS + 5000) {
      throw new Error("treasury out of SOL — top up the authority wallet");
    }
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: auth.publicKey,
        toPubkey: dest,
        lamports: GAS_DRIP_LAMPORTS,
      })
    );
    await sendAndConfirmTransaction(c, tx, [auth]);
    solDripped = true;
  }

  // 2) ensure the user's test-USDC ATA exists (authority pays rent) + mint if low
  const ata = await getOrCreateAssociatedTokenAccount(c, auth, mint, dest);
  let usdcMinted = false;
  const acct = await getAccount(c, ata.address);
  if (Number(acct.amount) < USDC_MIN) {
    await mintTo(c, auth, mint, ata.address, auth, USDC_GRANT);
    usdcMinted = true;
  }

  const sol = (await c.getBalance(dest)) / LAMPORTS_PER_SOL;
  const usdc = Number((await getAccount(c, ata.address)).amount) / ONE_USDC;
  return { solDripped, usdcMinted, sol, usdc };
}
