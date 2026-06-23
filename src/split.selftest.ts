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
import { usdCentsFromForeignCents, usdCentsFromForeignMajor } from "./fx";
import { computeBalances, minimalSettlement } from "./ledger";
import { signSession, verifySession, verifySignature } from "./auth";
import { isTripAuthorized } from "./trips";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";

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

// 9) FX money math — convert foreign MINOR units to USD cents, rounding once.
//    2450.00 THB in minor units = 245000; at ~$0.0304/THB -> $74.48.
ok(
  "fx: usdCentsFromForeignCents(245000, 0.0304) rounds once to 7448",
  usdCentsFromForeignCents(245000, 0.0304) === 7448,
  String(usdCentsFromForeignCents(245000, 0.0304))
);

// 10) USD passthrough: rate 1, no value lost converting major dollars.
ok(
  "fx: usdCentsFromForeignMajor(87.40, 1) === 8740 (USD passthrough)",
  usdCentsFromForeignMajor(87.4, 1) === 8740
);

// 11) Convert-then-split sums EXACTLY: foreign total -> USD cents -> split N ways.
{
  const usdCents = usdCentsFromForeignCents(245000, 0.0304); // 7448
  const parts = distributeEven(usdCents, 4);
  ok(
    "fx: converted total splits 4 ways and sums to the converted total exactly",
    sum(parts) === usdCents && parts.every((p) => Number.isInteger(p)),
    `${JSON.stringify(parts)} sum=${sum(parts)} total=${usdCents}`
  );
}

// 12) Ledger: balances sum to 0 for a 3-member, multi-expense scenario.
{
  const ids = ["A", "B", "C"];
  const balances = computeBalances(ids, [
    { amountCents: 9000, paidBy: "A", participants: ["A", "B", "C"] }, // A fronts $90
    { amountCents: 4500, paidBy: "B", participants: ["B", "C"] }, // B fronts $45 for B,C
    { amountCents: 1001, paidBy: "C", participants: ["A", "B", "C"] }, // awkward pennies
  ]);
  ok(
    "ledger: balances sum to 0 (3 members, multi-expense)",
    sum(balances.map((b) => b.cents)) === 0,
    JSON.stringify(balances)
  );
}

// 13) Ledger: minimalSettlement zeroes all balances when applied; amounts are
//     positive integers and at most (members - 1) transfers.
{
  const ids = ["A", "B", "C", "D"];
  const balances = computeBalances(ids, [
    { amountCents: 12000, paidBy: "A", participants: ["A", "B", "C", "D"] },
    { amountCents: 3333, paidBy: "B", participants: ["A", "B", "C"] },
    { amountCents: 7777, paidBy: "D", participants: ["A", "B", "C", "D"] },
  ]);
  const transfers = minimalSettlement(balances);
  const copy = new Map(balances.map((b) => [b.memberId, b.cents]));
  for (const t of transfers) {
    copy.set(t.from, (copy.get(t.from) as number) + t.amountCents);
    copy.set(t.to, (copy.get(t.to) as number) - t.amountCents);
  }
  const allZero = [...copy.values()].every((v) => v === 0);
  const goodAmounts = transfers.every(
    (t) => Number.isInteger(t.amountCents) && t.amountCents > 0
  );
  ok(
    "ledger: minimalSettlement zeroes all balances, positive integer amounts, <= members-1 transfers",
    allZero && goodAmounts && transfers.length <= ids.length - 1,
    `${JSON.stringify(transfers)} -> ${JSON.stringify([...copy.entries()])}`
  );
}

// 14) Ledger: known scenario. A pays $90 split A,B,C -> B and C each owe $30 to
//     A; settlement = B->A 30, C->A 30 (2 transfers). Exact.
{
  const balances = computeBalances(["A", "B", "C"], [
    { amountCents: 9000, paidBy: "A", participants: ["A", "B", "C"] },
  ]);
  const transfers = minimalSettlement(balances);
  const norm = transfers
    .map((t) => `${t.from}->${t.to}:${t.amountCents}`)
    .sort()
    .join(",");
  ok(
    "ledger: A pays $90/3 -> B->A 30, C->A 30 (2 transfers exact)",
    JSON.stringify(balances) ===
      JSON.stringify([
        { memberId: "A", cents: 6000 },
        { memberId: "B", cents: -3000 },
        { memberId: "C", cents: -3000 },
      ]) &&
      transfers.length === 2 &&
      norm === "B->A:3000,C->A:3000",
    norm
  );
}

// 15) Session token round-trips; a tampered token fails verification.
{
  const token = signSession("user-abc");
  const ok1 = verifySession(token) === "user-abc";
  // Flip a character in the payload to simulate tampering.
  const tampered = (token[0] === "A" ? "B" : "A") + token.slice(1);
  const ok2 = verifySession(tampered) === null;
  // Garbage / wrong-shape tokens are rejected too.
  const ok3 = verifySession("not-a-token") === null && verifySession("") === null;
  ok("auth: session sign/verify round-trips, tampered + garbage tokens rejected", ok1 && ok2 && ok3);
}

// 16) SIWS signature: a real ed25519 signature verifies; wrong key/message fails.
{
  const kp = Keypair.generate();
  const pubkey = kp.publicKey.toBase58();
  const message =
    "Divvy — sign in to prove you own this wallet.\nNonce: deadbeef\nIssued At: 2026-01-01T00:00:00.000Z";
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);

  const good = verifySignature(message, sig, pubkey);
  const wrongKey = verifySignature(message, sig, Keypair.generate().publicKey.toBase58());
  const wrongMsg = verifySignature(message + "tampered", sig, pubkey);
  ok(
    "auth: SIWS ed25519 verifies for signer, fails for wrong pubkey/message",
    good && !wrongKey && !wrongMsg
  );
}

// 17) Trip authz: matching share token authorizes; wrong token + non-member
//     session does NOT.
{
  const base = {
    shareToken: "abc123",
    ownerUserId: "owner-1",
    memberUserIds: ["member-1", "member-2"],
  };
  const tokenMatch = isTripAuthorized({ ...base, providedToken: "abc123", userId: null });
  const tokenWrongAndStranger = isTripAuthorized({
    ...base,
    providedToken: "nope",
    userId: "stranger-9",
  });
  const noTokenNoUser = isTripAuthorized({ ...base, providedToken: null, userId: null });
  ok(
    "authz: token match authorizes; wrong token + non-member session -> false",
    tokenMatch === true && tokenWrongAndStranger === false && noTokenNoUser === false
  );
}

// 18) Trip authz: owner session and claimed-member session authorize (no token).
{
  const base = {
    shareToken: "abc123",
    ownerUserId: "owner-1",
    memberUserIds: ["member-1", "member-2"],
  };
  const owner = isTripAuthorized({ ...base, providedToken: null, userId: "owner-1" });
  const claimedMember = isTripAuthorized({ ...base, providedToken: null, userId: "member-2" });
  ok(
    "authz: owner session and claimed-member session authorize",
    owner === true && claimedMember === true
  );
}

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
