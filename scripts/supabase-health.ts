/**
 * supabase-health.ts — verify the Supabase connection + schema.
 *
 *   npx ts-node scripts/supabase-health.ts
 *
 * Checks each expected table is reachable via PostgREST (service_role) and does
 * a round-trip insert/delete on `bills` to prove writes work. Exits non-zero if
 * anything is missing so it can gate a deploy.
 */

import "dotenv/config";
import { supabase } from "../src/supabase";

const TABLES = [
  "bills",
  "groups",
  "trips",
  "trip_members",
  "expenses",
  "settlements",
  "users",
  "identities",
  "user_wallets",
  "friendships",
  "ious",
  "recurring",
  "trip_messages",
  "trip_reactions",
  "consumed_signatures",
  "nudges",
];

async function main() {
  const sb = supabase();
  let missing = 0;

  for (const t of TABLES) {
    // A real data select (not a HEAD count) — HEAD can falsely succeed for a
    // table that exists but isn't exposed by PostgREST (no grant / stale cache).
    const { error } = await sb.from(t).select("*").limit(1);
    if (error) {
      console.log(`  ✗ ${t.padEnd(16)} ${error.message}`);
      missing++;
    } else {
      console.log(`  ✓ ${t}`);
    }
  }

  if (missing === 0) {
    // Write round-trip on bills.
    const id = "health-" + Date.now();
    const ins = await sb
      .from("bills")
      .insert({ id, created_at: new Date().toISOString(), data: { ok: true } });
    if (ins.error) throw new Error("insert failed: " + ins.error.message);
    await sb.from("bills").delete().eq("id", id);
    console.log("\n✓ Read/write round-trip OK — Supabase is ready.");
  } else {
    console.log(
      `\n✗ ${missing} table(s) missing. Apply supabase/schema.sql first ` +
        "(SQL Editor, or scripts/apply-schema.ts)."
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Health check error:", e.message || e);
  process.exit(1);
});
