/**
 * split.selftest.ts — Offline money-math + URL tests. No network, no RPC.
 *
 * GUARDRAIL under test: money is integer cents, and every split sums to the
 * total EXACTLY. Run with `npm test`.
 */

import {
  computeSplit,
  distributeEven,
  distributeWeighted,
  toCents,
  fmt,
  withTip,
} from "./split";
import { buildSolanaPayUrl, amountFromCents, USDC_MINT } from "./solanaPay";

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

// 1) toCents / fmt round-trip, no float dust.
ok(
  "toCents handles float dust (74.07 -> 7407, fmt back)",
  toCents(74.07) === 7407 && fmt(7407) === "$74.07" && toCents("0.1") + toCents("0.2") === 30
);

// 2) Equal split of an indivisible total sums exactly, pennies fair.
{
  const parts = distributeEven(8740, 3); // 87.40 / 3
  ok(
    "equal split 87.40/3 = 29.14/29.13/29.13 and sums to total",
    JSON.stringify(parts) === JSON.stringify([2914, 2913, 2913]) && sum(parts) === 8740
  );
}

// 3) The headline demo: $74.07 + 18% tip = $87.40, split 3 ways.
{
  const total = withTip(toCents(74.07), 18); // 7407 + 1333 = 8740
  const shares = computeSplit({ totalCents: total, names: ["A", "B", "C"], mode: "equal" });
  ok(
    "demo: 74.07 + 18% = 87.40 -> 29.14/29.13/29.13",
    total === 8740 &&
      shares.map((s) => s.cents).join(",") === "2914,2913,2913" &&
      sum(shares.map((s) => s.cents)) === total
  );
}

// 4) Weighted split (2:1:1) of 87.40 sums exactly and respects ratio order.
{
  const parts = distributeWeighted(8740, [2, 1, 1]);
  ok(
    "weighted 2:1:1 of 87.40 sums to total, biggest weight pays most",
    sum(parts) === 8740 && parts[0] > parts[1] && parts[0] > parts[2],
    JSON.stringify(parts)
  );
}

// 5) Custom split must sum to total or throw.
{
  let threw = false;
  try {
    computeSplit({ totalCents: 1000, names: ["A", "B"], mode: "custom", customCents: [600, 300] });
  } catch {
    threw = true;
  }
  const good = computeSplit({
    totalCents: 1000,
    names: ["A", "B"],
    mode: "custom",
    customCents: [600, 400],
  });
  ok("custom split rejects bad sum, accepts exact sum", threw && sum(good.map((s) => s.cents)) === 1000);
}

// 6) Stress: many awkward totals/counts ALWAYS sum exactly (equal + weighted).
{
  let allExact = true;
  for (let total = 1; total <= 1234; total += 7) {
    for (let n = 1; n <= 9; n++) {
      if (sum(distributeEven(total, n)) !== total) allExact = false;
      const weights = Array.from({ length: n }, (_, i) => i + 1);
      if (sum(distributeWeighted(total, weights)) !== total) allExact = false;
    }
  }
  ok("stress: every equal/weighted split sums to total exactly", allExact);
}

// 7) amountFromCents formats USDC dollars exactly (2 dp).
ok(
  "amountFromCents 2914 -> '29.14', 5 -> '0.05', 100000 -> '1000.00'",
  amountFromCents(2914) === "29.14" && amountFromCents(5) === "0.05" && amountFromCents(100000) === "1000.00"
);

// 8) Solana Pay URL is well-formed (scheme, recipient, amount, spl-token, reference, %20).
{
  const recipient = "11111111111111111111111111111111";
  const reference = "So11111111111111111111111111111111111111112";
  const url = buildSolanaPayUrl({
    recipient,
    amountCents: 2914,
    splToken: USDC_MINT.devnet,
    reference,
    label: "Dinner Time",
    message: "Ava's share",
  });
  ok(
    "buildSolanaPayUrl shape: solana:<recipient>?amount&spl-token&reference, spaces as %20",
    url.startsWith(`solana:${recipient}?`) &&
      url.includes("amount=29.14") &&
      url.includes(`spl-token=${USDC_MINT.devnet}`) &&
      url.includes(`reference=${reference}`) &&
      url.includes("label=Dinner%20Time") &&
      !url.includes("+"),
    url
  );
}

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
