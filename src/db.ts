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
