/**
 * store.ts — SQLite-backed bill store.
 *
 * Keeps the same synchronous interface as before (put/get/has/all/delete) so
 * the rest of the app can stay unchanged. Bills are stored as JSON in the
 * `bills` table, keyed by id, with created_at = bill.createdAt.
 */

import { db } from "./db";
import { Bill } from "./bill";

export class BillStore {
  private putStmt = db.prepare(
    "INSERT OR REPLACE INTO bills (id, created_at, data) VALUES (?, ?, ?)"
  );
  private getStmt = db.prepare("SELECT data FROM bills WHERE id = ?");
  private hasStmt = db.prepare("SELECT 1 FROM bills WHERE id = ?");
  private delStmt = db.prepare("DELETE FROM bills WHERE id = ?");
  private allStmt = db.prepare("SELECT data FROM bills ORDER BY created_at DESC");

  put(bill: Bill): void {
    this.putStmt.run(bill.id, bill.createdAt, JSON.stringify(bill));
  }

  get(id: string): Bill | undefined {
    const row = this.getStmt.get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Bill) : undefined;
  }

  has(id: string): boolean {
    return this.hasStmt.get(id) !== undefined;
  }

  delete(id: string): boolean {
    return this.delStmt.run(id).changes > 0;
  }

  all(): Bill[] {
    const rows = this.allStmt.all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Bill);
  }
}

/** Process-wide singleton used by the server. */
export const store = new BillStore();
