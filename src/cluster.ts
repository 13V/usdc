/**
 * cluster.ts — single source of truth for the validated CLUSTER env var.
 *
 * WHY THIS EXISTS: the whole codebase keys mainnet behavior on the literal
 * string "mainnet-beta" (USDC_MINT lookup, assertMainnetReadiness, the devnet
 * faucet gate, …). An almost-right value like CLUSTER=mainnet used to slip
 * straight through the `as Cluster` cast and silently bypass EVERY mainnet
 * guard while still building broken state (USDC_MINT["mainnet"] is undefined).
 *
 * Policy (B1):
 *   - "devnet" / "mainnet-beta" (exact) → accepted as-is.
 *   - unset / empty                     → "devnet" (safe default).
 *   - "mainnet" (any case)              → normalized to "mainnet-beta" with a
 *     LOUD warning; every mainnet guard then applies. Accept-and-normalize:
 *     a fat-fingered flip morning must not end up on the permissive path.
 *   - anything else                     → hard failure AT IMPORT TIME (boot).
 *
 * This module must be imported (directly or transitively) before any module
 * reads process.env.CLUSTER. It also writes the normalized value back into
 * process.env so stragglers that read the raw env still see a valid cluster.
 */

import type { Cluster } from "./solanaPay";

/** Validate + normalize a raw CLUSTER env value. Throws on garbage. */
export function resolveCluster(raw: unknown): Cluster {
  const v = String(raw ?? "").trim();
  if (v === "" || v === "devnet") return "devnet";
  if (v === "mainnet-beta") return "mainnet-beta";
  if (/^mainnet(-beta)?$/i.test(v)) {
    // "mainnet", "Mainnet-Beta", … — the operator clearly means real money.
    // Normalize so ALL mainnet guards engage, and yell so the env gets fixed.
    // eslint-disable-next-line no-console
    console.warn(
      `⚠⚠⚠  CLUSTER="${v}" is not a valid Solana cluster name — normalizing to "mainnet-beta". ` +
        `Set CLUSTER=mainnet-beta EXACTLY in the environment. All mainnet boot gates are active.`
    );
    return "mainnet-beta";
  }
  throw new Error(
    `Invalid CLUSTER "${v}" — must be exactly "devnet" or "mainnet-beta". ` +
      `Refusing to boot: an unrecognized cluster would bypass the mainnet safety gates. ` +
      `See docs/GO-LIVE.md.`
  );
}

/** The validated, normalized cluster for this process. */
export const CLUSTER: Cluster = resolveCluster(process.env.CLUSTER);

// Write the normalized value back so any code that still reads the raw env
// (or child tooling that inherits it) sees the validated cluster.
process.env.CLUSTER = CLUSTER;

/**
 * The user-facing refusal for a money row stamped on a different cluster than
 * the one this server settles on (B4/H1). Shared so bills, trips, tabs and
 * IOUs all say the same thing.
 */
export function clusterMismatchError(rowCluster: string | null | undefined): string {
  const rc = rowCluster || "devnet";
  return rc === "devnet"
    ? "this was created on the test network (devnet) — it's closed now that Divvy settles real money"
    : `this was created on ${rc} — it's closed on this server (${CLUSTER})`;
}
