/**
 * tabs.selftest.ts — Offline tab balance-math tests. No network, no RPC.
 *
 * GUARDRAIL under test: a tab's net balance is integer cents, symmetric
 * between the two viewers, direction-correct regardless of who created each
 * entry, and paid entries never count. Partial payments: request resolution
 * is clamped to (0, net] and payer-only, a verified partial's "payment" row
 * arithmetically reduces the net, pending partials survive/supersede
 * correctly when the net moves, and a full settle after a partial covers
 * exactly the remainder. Run with `npm test`.
 */

import {
  signedCents,
  computeTabBalance,
  settlementParties,
  resolveSettleRequest,
  canReuseSettlement,
  paymentEntry,
  SettleTarget,
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

// ---- Partial payments ----------------------------------------------------------

const isTarget = (r: ReturnType<typeof resolveSettleRequest>): r is SettleTarget =>
  !("error" in r);

// 9) resolveSettleRequest: full settle targets the net; square tab rejects.
{
  const full = resolveSettleRequest(-4700, "me", "sam");
  ok(
    "resolve: bare request on a −$47 tab → I pay sam $47, not partial",
    isTarget(full) &&
      full.payer === "me" &&
      full.payee === "sam" &&
      full.amountCents === 4700 &&
      full.partial === false
  );
  const square = resolveSettleRequest(0, "me", "sam");
  ok("resolve: square tab → 400, nothing to settle", !isTarget(square) && square.status === 400);
}

// 10) Partial clamps/validation: integer cents in (0, net], payer-only.
{
  const bad = [0, -5, 1.5, 4701, NaN, "nope"].map((v) =>
    resolveSettleRequest(-4700, "me", "sam", v)
  );
  ok(
    "resolve: partial of 0 / negative / fraction / > net / junk all reject with 400",
    bad.every((r) => !isTarget(r) && r.status === 400)
  );
  const notPayer = resolveSettleRequest(4700, "me", "sam", 2000); // sam owes ME
  ok(
    "resolve: only the payer can part-pay — creditor asking gets 403",
    !isTarget(notPayer) && notPayer.status === 403
  );
  const p = resolveSettleRequest(-4700, "me", "sam", 2000);
  ok(
    "resolve: $20 of $47 → payer me, $20, partial",
    isTarget(p) && p.payer === "me" && p.amountCents === 2000 && p.partial === true
  );
  const exact = resolveSettleRequest(-4700, "me", "sam", 4700);
  ok(
    "resolve: partial of exactly the net is just a full settle",
    isTarget(exact) && exact.amountCents === 4700 && exact.partial === false
  );
}

// 11) Net reduction after a verified partial: the "payment" row counts, so a
//     $20 partial on a $47 tab leaves $27 — symmetrically for both viewers.
{
  const ledger: TabEntryLike[] = [
    entry("sam", "they_owe", 4700), // I owe sam $47
    paymentEntry("me", "sam", 2000, "s1", new Date().toISOString()),
  ];
  ok(
    "partial: after a verified $20 payment the $47 tab shows $27 owed",
    computeTabBalance(ledger, "me") === -2700 && computeTabBalance(ledger, "sam") === 2700
  );
  const pe = paymentEntry("me", "sam", 2000, "s1", "2026-07-05T00:00:00.000Z");
  ok(
    "partial: payment row is payer-created, they_owe, status 'payment', tied to its settlement",
    pe.created_by === "me" &&
      pe.direction === "they_owe" &&
      pe.status === "payment" &&
      pe.settlement_id === "s1" &&
      signedCents(pe, "me") === 2000
  );
  ok(
    "partial: a covered payment row ('payment_paid') is history — doesn't count",
    computeTabBalance([{ ...pe, status: "payment_paid" }], "me") === 0
  );
}

// 12) Full settle after a partial covers exactly the remainder; flipping the
//     covered entries AND the payment row leaves the tab square.
{
  const now = new Date().toISOString();
  const ledger: TabEntryLike[] = [
    entry("sam", "they_owe", 4700),
    paymentEntry("me", "sam", 2000, "s1", now),
  ];
  const rest = resolveSettleRequest(computeTabBalance(ledger, "me"), "me", "sam");
  ok(
    "partial: a later full settle targets exactly the $27 remainder",
    isTarget(rest) && rest.payer === "me" && rest.amountCents === 2700 && !rest.partial
  );
  // simulate what settlePairEntries does on verify: open→paid, payment→payment_paid
  const covered = ledger.map((e) => ({
    ...e,
    status: e.status === "payment" ? "payment_paid" : "paid",
  }));
  ok(
    "partial: after the covering settle flips everything the tab is square",
    computeTabBalance(covered, "me") === 0 && computeTabBalance(covered, "sam") === 0
  );
}

// 13) Supersede/reuse when entries land mid-partial. A pending partial keeps
//     its reference through bare rebuilds while it still fits inside the net;
//     an explicit ask for a different amount (or a moved payer) replaces it.
{
  const pendingPartial = { amount_cents: 2000, payer_user_id: "me", status: "open_partial" };
  const bareAt = (net: number) => resolveSettleRequest(-net, "me", "sam") as SettleTarget;
  ok(
    "supersede: entry lands mid-partial (net $47→$57) — bare settle keeps the pending $20",
    canReuseSettlement(pendingPartial, bareAt(5700), false) === true
  );
  ok(
    "supersede: net shrinks below the pending $20 — bare settle cancels + rebuilds",
    canReuseSettlement(pendingPartial, bareAt(1500), false) === false
  );
  ok(
    "supersede: asking again for the same $20 partial reuses it (same reference)",
    canReuseSettlement(
      pendingPartial,
      resolveSettleRequest(-4700, "me", "sam", 2000) as SettleTarget,
      true
    ) === true
  );
  ok(
    "supersede: asking for a different partial amount replaces the pending one",
    canReuseSettlement(
      pendingPartial,
      resolveSettleRequest(-4700, "me", "sam", 2500) as SettleTarget,
      true
    ) === false
  );
  ok(
    "supersede: explicitly asking for the full net replaces a pending partial",
    canReuseSettlement(
      pendingPartial,
      resolveSettleRequest(-4700, "me", "sam", 4700) as SettleTarget,
      true
    ) === false
  );
  const pendingFull = { amount_cents: 4700, payer_user_id: "me", status: "open" };
  ok(
    "supersede: full settlement reuses only while the net is unchanged",
    canReuseSettlement(pendingFull, bareAt(4700), false) === true &&
      canReuseSettlement(pendingFull, bareAt(5700), false) === false
  );
  ok(
    "supersede: net flips direction — payer mismatch always rebuilds",
    canReuseSettlement(
      pendingPartial,
      resolveSettleRequest(4700, "me", "sam") as SettleTarget,
      false
    ) === false
  );
}

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
