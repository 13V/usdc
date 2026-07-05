/**
 * simplify.selftest.ts — Offline tests for debt simplification. No network.
 *
 * GUARDRAILS under test: integer cents; applying the simplified transfers
 * zeroes every balance exactly (no penny lost/created); never more than n-1
 * transfers; deterministic output; greedy is never worse than n-1 and never
 * better than the brute-force optimum. Run with `npm test`.
 */

import { Balance, LedgerExpense, Transfer, computeBalances } from "./ledger";
import { pairwiseDebts, simplifyDebts, simplifyPlan, simplifySummary } from "./simplify";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** Apply transfers to balances; return the residual per member. */
function residual(balances: Balance[], transfers: Transfer[]): Map<string, number> {
  const m = new Map(balances.map((b) => [b.memberId, b.cents]));
  for (const t of transfers) {
    m.set(t.from, (m.get(t.from) as number) + t.amountCents);
    m.set(t.to, (m.get(t.to) as number) - t.amountCents);
  }
  return m;
}

function norm(transfers: Transfer[]): string {
  return transfers.map((t) => `${t.from}->${t.to}:${t.amountCents}`).join(",");
}

/**
 * Brute-force MINIMUM possible transfer count for zero-sum balances:
 * (#nonzero) - (max number of disjoint zero-sum subsets of the nonzero
 * balances). Exponential — fine for the tiny fuzz sizes here (n <= 6).
 */
function optimalTransferCount(balances: Balance[]): number {
  const vals = balances.map((b) => b.cents).filter((c) => c !== 0);
  const n = vals.length;
  if (n === 0) return 0;
  const subsetSum: number[] = new Array(1 << n).fill(0);
  for (let mask = 1; mask < 1 << n; mask++) {
    const low = mask & -mask;
    subsetSum[mask] = subsetSum[mask ^ low] + vals[Math.log2(low)];
  }
  // best[mask] = max zero-sum groups partitioning exactly the members in mask
  const best: number[] = new Array(1 << n).fill(-1);
  best[0] = 0;
  for (let mask = 1; mask < 1 << n; mask++) {
    if (subsetSum[mask] !== 0) continue; // only zero-sum sets can be fully grouped
    // iterate zero-sum submasks containing the lowest set bit (canonical split)
    const low = mask & -mask;
    for (let sub = mask; sub > 0; sub = (sub - 1) & mask) {
      if (!(sub & low)) continue;
      if (subsetSum[sub] !== 0) continue;
      if (best[mask ^ sub] < 0) continue;
      best[mask] = Math.max(best[mask], best[mask ^ sub] + 1);
    }
  }
  const groups = best[(1 << n) - 1];
  return n - (groups < 0 ? 1 : groups);
}

/** Tiny seeded PRNG so fuzz failures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1) Chain collapses: A owes B $10, B owes C $10 -> single A->C $10.
{
  const ids = ["A", "B", "C"];
  const expenses: LedgerExpense[] = [
    { amountCents: 2000, paidBy: "B", participants: ["A", "B"] }, // A owes B 10
    { amountCents: 2000, paidBy: "C", participants: ["B", "C"] }, // B owes C 10
  ];
  const plan = simplifyPlan(ids, expenses);
  ok(
    "chain A->B->C collapses to A->C (1 payment instead of 2)",
    norm(plan.transfers) === "A->C:1000" &&
      norm(plan.pairwiseTransfers) === "A->B:1000,B->C:1000" &&
      plan.simplifiedCount === 1 &&
      plan.pairwiseCount === 2 &&
      plan.saved === 1,
    `simplified=${norm(plan.transfers)} pairwise=${norm(plan.pairwiseTransfers)}`
  );
}

// 2) Zero-sum invariant: applying the simplified transfers zeroes everyone.
{
  const ids = ["A", "B", "C", "D"];
  const balances = computeBalances(ids, [
    { amountCents: 12000, paidBy: "A", participants: ["A", "B", "C", "D"] },
    { amountCents: 3333, paidBy: "B", participants: ["A", "B", "C"] },
    { amountCents: 7777, paidBy: "D", participants: ["A", "B", "C", "D"] },
  ]);
  const transfers = simplifyDebts(balances);
  const res = residual(balances, transfers);
  ok(
    "simplified transfers zero every balance exactly (multi-expense)",
    [...res.values()].every((v) => v === 0) &&
      transfers.every((t) => Number.isInteger(t.amountCents) && t.amountCents > 0),
    `${norm(transfers)} -> ${JSON.stringify([...res.entries()])}`
  );
}

// 3) Rounding leftovers: awkward pennies (1001/3 etc.) still settle exactly,
//    because computeBalances uses the exact largest-remainder split.
{
  const ids = ["A", "B", "C"];
  const balances = computeBalances(ids, [
    { amountCents: 1001, paidBy: "A", participants: ["A", "B", "C"] },
    { amountCents: 707, paidBy: "B", participants: ["A", "B", "C"] },
  ]);
  const transfers = simplifyDebts(balances);
  const res = residual(balances, transfers);
  ok(
    "rounding leftovers: awkward pennies settle to exactly zero",
    sum(balances.map((b) => b.cents)) === 0 && [...res.values()].every((v) => v === 0),
    `balances=${JSON.stringify(balances)} transfers=${norm(transfers)}`
  );
}

// 4) Determinism: identical input -> identical output (twice), and ties break
//    stably by member order (A and B tie as creditors -> A wins first).
{
  const balances: Balance[] = [
    { memberId: "A", cents: 500 },
    { memberId: "B", cents: 500 },
    { memberId: "C", cents: -500 },
    { memberId: "D", cents: -500 },
  ];
  const t1 = norm(simplifyDebts(balances));
  const t2 = norm(simplifyDebts(balances));
  ok(
    "deterministic: same input twice -> same transfers; ties break by input order",
    t1 === t2 && t1 === "C->A:500,D->B:500",
    t1
  );
}

// 5) Never more than n-1 transfers, even in a fully-tangled group.
{
  const ids = ["A", "B", "C", "D", "E"];
  const expenses: LedgerExpense[] = [
    { amountCents: 5000, paidBy: "A", participants: ids },
    { amountCents: 4001, paidBy: "B", participants: ids },
    { amountCents: 3002, paidBy: "C", participants: ids },
    { amountCents: 2003, paidBy: "D", participants: ids },
    { amountCents: 1004, paidBy: "E", participants: ids },
  ];
  const plan = simplifyPlan(ids, expenses);
  ok(
    "tangled 5-member group: <= n-1 simplified transfers, fewer than pairwise",
    plan.simplifiedCount <= ids.length - 1 && plan.simplifiedCount <= plan.pairwiseCount,
    `simplified=${plan.simplifiedCount} pairwise=${plan.pairwiseCount}`
  );
}

// 6) Pairwise netting: A owes B 5 and B owes A 3 nets to A->B 2, stable order.
{
  const ids = ["A", "B"];
  const expenses: LedgerExpense[] = [
    { amountCents: 1000, paidBy: "B", participants: ["A", "B"] }, // A owes B 5
    { amountCents: 600, paidBy: "A", participants: ["A", "B"] }, // B owes A 3
  ];
  const pw = pairwiseDebts(ids, expenses);
  ok("pairwise nets opposite directions per pair (5 vs 3 -> A->B 2)", norm(pw) === "A->B:200", norm(pw));
}

// 7) Non-zero-sum input (defensive): the greedy settles the smaller side and
//    the residual stays put — never invented, never lost.
{
  const balances: Balance[] = [
    { memberId: "A", cents: 100 },
    { memberId: "B", cents: -40 },
  ];
  const transfers = simplifyDebts(balances);
  const res = residual(balances, transfers);
  ok(
    "non-zero-sum balances: partial settle, residual preserved",
    norm(transfers) === "B->A:40" && res.get("A") === 60 && res.get("B") === 0,
    norm(transfers)
  );
}

// 8) Summary copy: "N payments instead of M" only when it actually saves.
ok(
  "summary: '3 payments instead of 6' / '1 payment' / '' when square",
  simplifySummary({ simplifiedCount: 3, pairwiseCount: 6 }) === "3 payments instead of 6" &&
    simplifySummary({ simplifiedCount: 1, pairwiseCount: 1 }) === "1 payment" &&
    simplifySummary({ simplifiedCount: 0, pairwiseCount: 0 }) === ""
);

// 9) Fuzz vs brute force: random zero-sum balances (2..6 members). Greedy must
//    settle exactly, use <= (#nonzero - 1) transfers, and never beat the
//    brute-force optimum. Deterministic across repeated runs.
{
  const rnd = mulberry32(20260705);
  let allGood = true;
  let detail = "";
  for (let iter = 0; iter < 400 && allGood; iter++) {
    const n = 2 + Math.floor(rnd() * 5); // 2..6
    const balances: Balance[] = [];
    let total = 0;
    for (let i = 0; i < n - 1; i++) {
      const c = Math.floor(rnd() * 10001) - 5000; // -5000..5000
      balances.push({ memberId: `M${i}`, cents: c });
      total += c;
    }
    balances.push({ memberId: `M${n - 1}`, cents: -total });

    const transfers = simplifyDebts(balances);
    const again = simplifyDebts(balances);
    const res = residual(balances, transfers);
    const nonzero = balances.filter((b) => b.cents !== 0).length;
    const opt = optimalTransferCount(balances);

    const settled = [...res.values()].every((v) => v === 0);
    const positiveInts = transfers.every((t) => Number.isInteger(t.amountCents) && t.amountCents > 0);
    const bounded = transfers.length <= Math.max(nonzero - 1, 0);
    const notBelowOptimal = transfers.length >= opt;
    const deterministic = norm(transfers) === norm(again);
    if (!(settled && positiveInts && bounded && notBelowOptimal && deterministic)) {
      allGood = false;
      detail = `iter=${iter} balances=${JSON.stringify(balances)} transfers=${norm(transfers)} opt=${opt}`;
    }
  }
  ok("fuzz(400): settles exactly, <= nonzero-1, >= optimal, deterministic", allGood, detail);
}

// 10) Fuzz via expenses: random groups + expenses -> plan always settles the
//     computed balances exactly and simplified count never exceeds pairwise+n-1 bound.
{
  const rnd = mulberry32(424242);
  let allGood = true;
  let detail = "";
  for (let iter = 0; iter < 200 && allGood; iter++) {
    const n = 2 + Math.floor(rnd() * 4); // 2..5 members
    const ids = Array.from({ length: n }, (_, i) => `M${i}`);
    const nExp = 1 + Math.floor(rnd() * 6);
    const expenses: LedgerExpense[] = [];
    for (let e = 0; e < nExp; e++) {
      const paidBy = ids[Math.floor(rnd() * n)];
      const participants = ids.filter(() => rnd() < 0.7);
      if (participants.length === 0) participants.push(ids[Math.floor(rnd() * n)]);
      expenses.push({ amountCents: 1 + Math.floor(rnd() * 9999), paidBy, participants });
    }
    const plan = simplifyPlan(ids, expenses);
    const balances = computeBalances(ids, expenses);
    const res = residual(balances, plan.transfers);
    const settled = [...res.values()].every((v) => v === 0);
    const bounded = plan.simplifiedCount <= Math.max(n - 1, 0);
    const savedSane = plan.saved === Math.max(plan.pairwiseCount - plan.simplifiedCount, 0);
    if (!(settled && bounded && savedSane)) {
      allGood = false;
      detail = `iter=${iter} expenses=${JSON.stringify(expenses)} plan=${JSON.stringify(plan)}`;
    }
  }
  ok("fuzz(200) via expenses: plan settles balances exactly, bounds hold", allGood, detail);
}

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
