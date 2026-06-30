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
 * Dual-backed (SQLite / Supabase). FAIL-CLOSED: this is the ONLY guard that
 * stops one on-chain transfer from discharging several debts that share a
 * collector + amount across different bills/trips (per-context `excludeSignatures`
 * only dedups within a single settlement). So if the store is unavailable we must
 * NOT credit — we return false (treat as "can't prove it's unused") and fire a
 * high-severity alert. A transient blip just defers that share to the next verify
 * poll; a sustained outage freezes settlement loudly rather than silently opening
 * a double-credit window. The `CONSUMED_SIG_FAIL_OPEN=1` env var is a deliberate
 * operator escape hatch (availability over safety) for emergencies only.
 */

import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { alert } from "./alerts";

const FAIL_OPEN = process.env.CONSUMED_SIG_FAIL_OPEN === "1";

/** Store unreachable: page, then honor the (default-safe) fail-closed posture. */
function onStoreError(stage: string, message: string): boolean {
  alert("critical", "consumed_signatures_store_error", { stage, message, failOpen: FAIL_OPEN });
  return FAIL_OPEN; // false (don't credit) unless an operator opted into fail-open
}

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
        // Table missing / transient error → fail closed (don't credit) + page.
        return onStoreError("supabase.upsert", insErr.message);
      }
      const { data, error: selErr } = await supabase()
        .from("consumed_signatures")
        .select("owner")
        .eq("signature", signature)
        .maybeSingle();
      if (selErr) return onStoreError("supabase.select", selErr.message);
      // The upsert above succeeded, so a row MUST exist; a missing row means the
      // store is lying to us — do not credit.
      if (!data) return onStoreError("supabase.select", "row absent after upsert");
      return data.owner === owner;
    } catch (e) {
      return onStoreError("supabase.catch", (e as Error).message);
    }
  }

  try {
    db.prepare(
      "INSERT OR IGNORE INTO consumed_signatures (signature, owner, created_at) VALUES (?, ?, ?)"
    ).run(signature, owner, now);
    const row = db
      .prepare("SELECT owner FROM consumed_signatures WHERE signature = ?")
      .get(signature) as { owner: string } | undefined;
    if (!row) return onStoreError("sqlite.select", "row absent after insert");
    return row.owner === owner;
  } catch (e) {
    return onStoreError("sqlite.catch", (e as Error).message);
  }
}
