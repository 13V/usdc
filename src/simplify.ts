/**
 * simplify.ts — Debt simplification: collapse a group's who-owes-who graph so
 * everyone settles with the fewest payments ("you pay 1 person instead of 3").
 *
 * Pure, offline-testable math — no DB, no HTTP. GUARDRAIL: ALL money is integer
 * cents; no penny is ever lost or created. The greedy matching itself lives in
 * ledger.ts (minimalSettlement) — it is THE plan /settle executes — so the
 * simplified transfers shown here are always leg-for-leg identical to what the
 * settle flow will actually build. This module adds the "before" picture (the
 * naive pairwise debt graph) and the plan/summary glue on top.
 */

import {
  Balance,
  LedgerExpense,
  Transfer,
  computeBalances,
  minimalSettlement,
} from "./ledger";
import { distributeEven } from "./split";

/** The full simplification story for a group: before, after, and the savings. */
export interface SimplifyPlan {
  /** Simplified transfers (greedy max-creditor/max-debtor). At most n-1. */
  transfers: Transfer[];
  /** The naive who-owes-who graph: per-expense debts netted per pair. */
  pairwiseTransfers: Transfer[];
  simplifiedCount: number;
  pairwiseCount: number;
  /** Payments saved by simplifying (>= 0; 0 when the graph is already minimal). */
  saved: number;
}

/**
 * Simplify per-member net balances (integer cents, summing to zero within
 * rounding) into a minimal-ish transfer list via the standard greedy
 * max-creditor/max-debtor matching.
 *
 * Deterministic: ties are broken by input order (first max wins), and the input
 * order is the trip's stable member order — so tests and UI never flicker.
 * Delegates the matching to ledger.minimalSettlement so this list is exactly
 * the plan POST /api/trips/:id/settle persists.
 *
 * Rounding leftovers: balances derived from computeBalances always sum to
 * EXACTLY zero (largest-remainder splits), so everything settles. If a caller
 * hands in balances that don't sum to zero, the greedy settles the smaller side
 * fully and the residual simply stays put (never invented, never lost).
 */
export function simplifyDebts(balances: Balance[]): Transfer[] {
  for (const b of balances) {
    if (!Number.isInteger(b.cents)) {
      throw new Error(`simplifyDebts: expected integer cents, got ${b.cents} for ${b.memberId}`);
    }
  }
  const transfers = minimalSettlement(balances);
  // Invariants (cheap, and they guard the money path): positive integer
  // amounts, and never more than (participants - 1) transfers.
  for (const t of transfers) {
    if (!Number.isInteger(t.amountCents) || t.amountCents <= 0) {
      throw new Error(`simplifyDebts: bad transfer amount ${t.amountCents}`);
    }
  }
  if (transfers.length > Math.max(balances.length - 1, 0)) {
    throw new Error(`simplifyDebts: ${transfers.length} transfers for ${balances.length} members`);
  }
  return transfers;
}

/**
 * The UN-simplified who-owes-who graph: for every expense, each non-payer
 * participant owes their share (same largest-remainder distributeEven split as
 * computeBalances) to the payer. Debts between the same pair are netted (A owes
 * B 5 and B owes A 3 -> A owes B 2), because that's how people actually count
 * "payments I'd have to make".
 *
 * Deterministic ordering: debtor then creditor, both in memberIds order.
 * Members appearing in expenses but not memberIds keep working (appended in
 * first-seen order), mirroring computeBalances' tolerance.
 */
export function pairwiseDebts(memberIds: string[], expenses: LedgerExpense[]): Transfer[] {
  // pair key debtor|creditor -> net cents owed (only one direction kept > 0)
  const owed = new Map<string, number>();
  const order = [...memberIds];
  const seen = new Set(order);
  const note = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  };

  for (const exp of expenses) {
    if (!Number.isInteger(exp.amountCents) || exp.amountCents <= 0) {
      throw new Error(`pairwiseDebts: expense amount must be a positive integer, got ${exp.amountCents}`);
    }
    if (exp.participants.length === 0) {
      throw new Error("pairwiseDebts: expense has no participants");
    }
    note(exp.paidBy);
    const shares = distributeEven(exp.amountCents, exp.participants.length);
    exp.participants.forEach((pid, i) => {
      note(pid);
      if (pid === exp.paidBy) return; // your own share of your own expense isn't a debt
      const fwd = `${pid}|${exp.paidBy}`; // pid owes the payer
      const rev = `${exp.paidBy}|${pid}`;
      // Net against the opposite direction first so each pair carries at most
      // one directed edge.
      const owedBack = owed.get(rev) || 0;
      const offset = Math.min(owedBack, shares[i]);
      if (offset > 0) owed.set(rev, owedBack - offset);
      const remainder = shares[i] - offset;
      if (remainder > 0) owed.set(fwd, (owed.get(fwd) || 0) + remainder);
    });
  }

  const index = new Map(order.map((id, i) => [id, i]));
  const out: Transfer[] = [];
  for (const [key, cents] of owed) {
    if (cents <= 0) continue;
    const [from, to] = key.split("|");
    out.push({ from, to, amountCents: cents });
  }
  out.sort(
    (a, b) =>
      (index.get(a.from)! - index.get(b.from)!) || (index.get(a.to)! - index.get(b.to)!)
  );
  return out;
}

/**
 * Glue: compute the whole simplification story for a group's expenses.
 * Balances come from the same computeBalances the rest of the app uses, so the
 * simplified plan always matches the group's displayed balances exactly.
 */
export function simplifyPlan(memberIds: string[], expenses: LedgerExpense[]): SimplifyPlan {
  const balances = computeBalances(memberIds, expenses);
  const transfers = simplifyDebts(balances);
  const pairwiseTransfers = pairwiseDebts(memberIds, expenses);
  return {
    transfers,
    pairwiseTransfers,
    simplifiedCount: transfers.length,
    pairwiseCount: pairwiseTransfers.length,
    saved: Math.max(pairwiseTransfers.length - transfers.length, 0),
  };
}

/** "3 payments instead of 6" — the badge line. Empty string when all square. */
export function simplifySummary(plan: Pick<SimplifyPlan, "simplifiedCount" | "pairwiseCount">): string {
  const n = plan.simplifiedCount;
  if (n === 0) return "";
  const noun = n === 1 ? "payment" : "payments";
  if (plan.pairwiseCount > n) return `${n} ${noun} instead of ${plan.pairwiseCount}`;
  return `${n} ${noun}`;
}
