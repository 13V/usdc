/**
 * store.ts — bill store, dual-backed by SQLite (local) or Supabase (prod).
 *
 * Backend is chosen by DATA_BACKEND (see src/supabase.ts). Both paths share the
 * same async interface (put/get/has/all/delete). Bills are stored as a JSON
 * blob keyed by id, with created_at = bill.createdAt:
 *   • SQLite   → `data` TEXT  (JSON.stringify / JSON.parse)
 *   • Supabase → `data` jsonb (the client sends/returns parsed objects)
 */

import { db } from "./db";
import { Bill } from "./bill";
import { usingSupabase, supabase } from "./supabase";

export class BillStore {
  // Prepared statements for the SQLite path (unused when on Supabase).
  private putStmt = db.prepare(
    "INSERT OR REPLACE INTO bills (id, created_at, data) VALUES (?, ?, ?)"
  );
  private getStmt = db.prepare("SELECT data FROM bills WHERE id = ?");
  private hasStmt = db.prepare("SELECT 1 FROM bills WHERE id = ?");
  private delStmt = db.prepare("DELETE FROM bills WHERE id = ?");
  private allStmt = db.prepare("SELECT data FROM bills ORDER BY created_at DESC");

  async put(bill: Bill): Promise<void> {
    if (usingSupabase) {
      const { error } = await supabase()
        .from("bills")
        .upsert({ id: bill.id, created_at: bill.createdAt, data: bill });
      if (error) throw new Error(`bills.put: ${error.message}`);
      return;
    }
    this.putStmt.run(bill.id, bill.createdAt, JSON.stringify(bill));
  }

  async get(id: string): Promise<Bill | undefined> {
    if (usingSupabase) {
      const { data, error } = await supabase()
        .from("bills")
        .select("data")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`bills.get: ${error.message}`);
      return data ? (data.data as Bill) : undefined;
    }
    const row = this.getStmt.get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Bill) : undefined;
  }

  async has(id: string): Promise<boolean> {
    if (usingSupabase) {
      const { count, error } = await supabase()
        .from("bills")
        .select("id", { count: "exact", head: true })
        .eq("id", id);
      if (error) throw new Error(`bills.has: ${error.message}`);
      return (count || 0) > 0;
    }
    return this.hasStmt.get(id) !== undefined;
  }

  async delete(id: string): Promise<boolean> {
    if (usingSupabase) {
      const { error, count } = await supabase()
        .from("bills")
        .delete({ count: "exact" })
        .eq("id", id);
      if (error) throw new Error(`bills.delete: ${error.message}`);
      return (count || 0) > 0;
    }
    return this.delStmt.run(id).changes > 0;
  }

  async all(): Promise<Bill[]> {
    if (usingSupabase) {
      const { data, error } = await supabase()
        .from("bills")
        .select("data")
        .order("created_at", { ascending: false });
      if (error) throw new Error(`bills.all: ${error.message}`);
      return (data || []).map((r) => r.data as Bill);
    }
    const rows = this.allStmt.all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Bill);
  }
}

/** Process-wide singleton used by the server. */
export const store = new BillStore();
