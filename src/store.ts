/**
 * store.ts — In-memory multi-bill store for the web app.
 *
 * This is intentionally trivial so the web app has no DB dependency. Swap this
 * out for SQLite/Postgres (see NEXT STEPS in the README) when you need bills to
 * survive a restart.
 */

import { Bill } from "./bill";

export class BillStore {
  private bills = new Map<string, Bill>();

  put(bill: Bill): Bill {
    this.bills.set(bill.id, bill);
    return bill;
  }

  get(id: string): Bill | undefined {
    return this.bills.get(id);
  }

  has(id: string): boolean {
    return this.bills.has(id);
  }

  all(): Bill[] {
    return Array.from(this.bills.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  delete(id: string): boolean {
    return this.bills.delete(id);
  }
}

/** Process-wide singleton used by the server. */
export const store = new BillStore();
