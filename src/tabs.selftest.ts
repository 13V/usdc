/**
 * tabs.selftest.ts — Offline tab balance-math tests. No network, no RPC.
 *
 * GUARDRAIL under test: a tab's net balance is integer cents, symmetric
 * between the two viewers, direction-correct regardless of who created each
 * entry, and paid entries never count. Run with `npm test`.
 */

import {
  signedCents,
  computeTabBalance,
  settlementParties,
  TabEntryLike,
} from "./tabs";

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

function entry(
  created_by: string,
  direction: "they_owe" | "i_owe",
  amount_cents: number,
  status: "open" | "paid" = "open"
): TabEntryLike {
  return { created_by, direction, amount_cents, status };
}

// 1) Creator perspective: they_owe is +, i_owe is −.
ok(
  "signedCents: creator sees they_owe as +, i_owe as −",
  signedCents(entry("me", "they_owe", 700), "me") === 700 &&
    signedCents(entry("me", "i_owe", 300), "me") === -300
);

// 2) Viewer on the other side of the tab: signs flip.
ok(
  "signedCents: the other viewer sees the same entry with the sign flipped",
  signedCents(entry("sam", "they_owe", 700), "me") === -700 &&
    signedCents(entry("sam", "i_owe", 300), "me") === 300
);

// 3) Mixed ledger nets correctly: +$7 coffee, +$5 lunch, −$3 they covered a
//    snack, and sam logged +$4 from THEIR side (so I owe it) → net +$5.
{
  const ledger: TabEntryLike[] = [
    entry("me", "they_owe", 700), // +7 they owe me (coffee)
    entry("me", "they_owe", 500), // +5
    entry("me", "i_owe", 300), // −3
    entry("sam", "they_owe", 400), // sam says I owe them → −4 for me
  ];
  ok(
    "balance: mixed directions/creators net to +$5.00 for me",
    computeTabBalance(ledger, "me") === 500,
    String(computeTabBalance(ledger, "me"))
  );
  // 4) Symmetry: the same ledger viewed by sam is exactly the negation.
  ok(
    "balance: symmetric — sam's view is the exact negation of mine",
    computeTabBalance(ledger, "sam") === -500
  );
}

// 5) Paid entries never count toward the open balance.
{
  const ledger: TabEntryLike[] = [
    entry("me", "they_owe", 2300, "paid"),
    entry("me", "they_owe", 700),
    entry("sam", "i_owe", 900, "paid"),
  ];
  ok(
    "balance: paid entries are history, only open entries count",
    computeTabBalance(ledger, "me") === 700
  );
}

// 6) Empty tab is square.
ok("balance: empty ledger is 0", computeTabBalance([], "me") === 0);

// 7) Settlement direction: + = friend pays me, − = I pay friend, 0 = nothing.
{
  const owedMe = settlementParties(500, "me", "sam");
  const iOwe = settlementParties(-500, "me", "sam");
  const square = settlementParties(0, "me", "sam");
  ok(
    "settlementParties: +net → friend pays me; −net → I pay friend; 0 → null",
    !!owedMe &&
      owedMe.payer === "sam" &&
      owedMe.payee === "me" &&
      !!iOwe &&
      iOwe.payer === "me" &&
      iOwe.payee === "sam" &&
      square === null
  );
}

// 8) Stress: for random ledgers the two viewers ALWAYS sum to zero and the
//    balance is always an integer.
{
  let symmetric = true;
  let integer = true;
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let trial = 0; trial < 200; trial++) {
    const ledger: TabEntryLike[] = [];
    const n = 1 + Math.floor(rnd() * 12);
    for (let i = 0; i < n; i++) {
      ledger.push(
        entry(
          rnd() < 0.5 ? "me" : "sam",
          rnd() < 0.5 ? "they_owe" : "i_owe",
          1 + Math.floor(rnd() * 9999),
          rnd() < 0.3 ? "paid" : "open"
        )
      );
    }
    const mine = computeTabBalance(ledger, "me");
    const theirs = computeTabBalance(ledger, "sam");
    if (mine + theirs !== 0) symmetric = false;
    if (!Number.isInteger(mine)) integer = false;
  }
  ok("stress: 200 random ledgers — views always negate, always integer cents", symmetric && integer);
}

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
