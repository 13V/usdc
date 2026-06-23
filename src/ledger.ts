/**
 * ledger.ts — Pure, offline-testable multi-payer ledger math.
 *
 * GUARDRAIL: ALL money is integer cents. Balances ALWAYS sum to 0 (no penny is
 * lost or created). Settlement transfers are positive integers and at most
 * (members - 1) of them.
 */

import { distributeEven } from "./split";

export interface LedgerExpense {
  amountCents: number;
  paidBy: string;
  participants: string[];
}

/** A member's net position. + = money is owed TO them; - = they OWE money. */
export interface Balance {
  memberId: string;
  cents: number;
}

export interface Transfer {
  from: string;
  to: string;
  amountCents: number;
}

/**
 * Compute net balances for every member (in input order).
 *
 * Each expense's amount is split across its participants with the fair
 * largest-remainder penny distribution (distributeEven). Each participant's
 * share is SUBTRACTED from their balance; the full amount is ADDED to the payer.
 *
 * Invariant: the returned balances sum to exactly 0.
 */
export function computeBalances(memberIds: string[], expenses: LedgerExpense[]): Balance[] {
  const net = new Map<string, number>();
  for (const id of memberIds) net.set(id, 0);

  for (const exp of expenses) {
    if (!Number.isInteger(exp.amountCents) || exp.amountCents <= 0) {
      throw new Error(`computeBalances: expense amount must be a positive integer, got ${exp.amountCents}`);
    }
    if (exp.participants.length === 0) {
      throw new Error("computeBalances: expense has no participants");
    }
    const shares = distributeEven(exp.amountCents, exp.participants.length);
    exp.participants.forEach((pid, i) => {
      if (!net.has(pid)) net.set(pid, 0);
      net.set(pid, (net.get(pid) as number) - shares[i]);
    });
    if (!net.has(exp.paidBy)) net.set(exp.paidBy, 0);
    net.set(exp.paidBy, (net.get(exp.paidBy) as number) + exp.amountCents);
  }

  return memberIds.map((id) => ({ memberId: id, cents: net.get(id) as number }));
}

/**
 * Greedy minimal-cash-flow settlement. Repeatedly take the largest creditor
 * (cents > 0) and largest debtor (cents < 0), transfer min(|debtor|, creditor)
 * from debtor -> creditor, until everyone is within 0.
 *
 * Integer cents only; every transfer amount is > 0; at most (members - 1)
 * transfers.
 */
export function minimalSettlement(balances: Balance[]): Transfer[] {
  // Work on a mutable copy so we never disturb the caller's data.
  const work = balances.map((b) => ({ memberId: b.memberId, cents: b.cents }));
  const transfers: Transfer[] = [];

  while (true) {
    let creditor = -1;
    let debtor = -1;
    for (let i = 0; i < work.length; i++) {
      if (creditor === -1 || work[i].cents > work[creditor].cents) creditor = i;
      if (debtor === -1 || work[i].cents < work[debtor].cents) debtor = i;
    }
    if (creditor === -1 || debtor === -1) break;
    if (work[creditor].cents <= 0 || work[debtor].cents >= 0) break;

    const amount = Math.min(work[creditor].cents, -work[debtor].cents);
    if (amount <= 0) break;

    transfers.push({
      from: work[debtor].memberId,
      to: work[creditor].memberId,
      amountCents: amount,
    });
    work[creditor].cents -= amount;
    work[debtor].cents += amount;
  }

  return transfers;
}
