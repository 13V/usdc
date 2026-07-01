/**
 * db.ts — shared better-sqlite3 database handle.
 *
 * Opens (or creates) the Divvy SQLite database, enables WAL mode for better
 * concurrency, and ensures the schema exists. The opened `db` instance is
 * shared by store.ts (bills) and groups.ts (saved groups).
 */

import * as path from "path";
import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), "divvy.db");

export const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    members TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  );
`);

// Owner scoping for saved groups (additive; legacy rows have NULL owner and are
// simply no longer listed/deletable, which is fine for reusable name lists).
{
  const cols = db.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "user_id")) {
    db.exec("ALTER TABLE groups ADD COLUMN user_id TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS groups_user_idx ON groups (user_id)");
  }
}
