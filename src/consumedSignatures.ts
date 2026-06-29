/**
 * consumedSignatures.ts — global "one on-chain payment settles one share" guard.
 *
 * Per-context dedup (within a single bill or trip's verify loop) stops one
 * transaction from settling two shares OF THE SAME bill/trip. But the same
 * crafted transaction — one transfer carrying several references — could still
 * be claimed across DIFFERENT bills/trips that share a collector, discharging
 * multiple debts with one payment and shorting the creditor.
 *
 * This module records which on-chain `signature` has settled which `owner`
 * (a stable per-share id). A signature can be claimed by exactly one owner
 * system-wide; a second, different owner trying to claim it is rejected, so the
 * verify loops won't mark that share paid.
 *
 * Re-verification is idempotent: the SAME owner re-claiming its own signature
 * succeeds. Legitimate flows are never harmed — each real share is paid by its
 * own distinct transaction, so two honest shares never share a signature.
 *
 * Dual-backed (SQLite / Supabase). FAIL-OPEN: if the store is unavailable
 * (e.g. the Supabase table hasn't been created yet) we allow the credit and
 * fall back to per-context dedup — availability over a belt-and-suspenders
 * check — so a missing migration can never freeze settlement.
 */

import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";

// SQLite: create the table locally (Supabase is provisioned via schema.sql).
db.exec(`
  CREATE TABLE IF NOT EXISTS consumed_signatures (
    signature TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

/**
 * Claim `signature` for `owner`. Returns true if `owner` holds it afterwards
 * (freshly claimed OR already theirs), false if another owner already holds it.
 */
export async function claimSignature(signature: string, owner: string): Promise<boolean> {
  const now = new Date().toISOString();

  if (usingSupabase) {
    try {
      // Insert-if-absent (PK on signature). ignoreDuplicates keeps the first
      // claimant; we then read back whoever actually holds it.
      const { error: insErr } = await supabase()
        .from("consumed_signatures")
        .upsert([{ signature, owner, created_at: now }], {
          onConflict: "signature",
          ignoreDuplicates: true,
        });
      if (insErr) {
        // Table missing / transient error → fail open (allow credit).
        console.warn(`consumedSignatures.claim: ${insErr.message} (failing open)`);
        return true;
      }
      const { data, error: selErr } = await supabase()
        .from("consumed_signatures")
        .select("owner")
        .eq("signature", signature)
        .maybeSingle();
      if (selErr || !data) return true; // fail open
      return data.owner === owner;
    } catch (e) {
      console.warn(`consumedSignatures.claim: ${(e as Error).message} (failing open)`);
      return true;
    }
  }

  try {
    db.prepare(
      "INSERT OR IGNORE INTO consumed_signatures (signature, owner, created_at) VALUES (?, ?, ?)"
    ).run(signature, owner, now);
    const row = db
      .prepare("SELECT owner FROM consumed_signatures WHERE signature = ?")
      .get(signature) as { owner: string } | undefined;
    return !!row && row.owner === owner;
  } catch (e) {
    console.warn(`consumedSignatures.claim: ${(e as Error).message} (failing open)`);
    return true;
  }
}
