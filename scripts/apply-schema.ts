/**
 * apply-schema.ts — apply supabase/schema.sql to a Postgres database.
 *
 * The service_role key (PostgREST) cannot run DDL, so creating tables needs a
 * real Postgres connection. Two ways to use this:
 *
 *   1. Set SUPABASE_DB_URL in .env (Supabase → Project Settings → Database →
 *      Connection string → URI, includes the password), then:
 *        npx ts-node scripts/apply-schema.ts
 *
 *   2. Or just paste supabase/schema.sql into the Supabase SQL Editor and Run.
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  const sqlPath = path.resolve(process.cwd(), "supabase/schema.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  if (!dbUrl) {
    console.error(
      "SUPABASE_DB_URL is not set.\n\n" +
        "Either set it in .env (Supabase → Project Settings → Database → Connection\n" +
        "string → URI), or paste supabase/schema.sql into the Supabase SQL Editor.\n"
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected. Applying supabase/schema.sql …");
  await client.query(sql);
  await client.end();
  console.log("✓ Schema applied.");
}

main().catch((e) => {
  console.error("Schema apply failed:", e.message || e);
  process.exit(1);
});
