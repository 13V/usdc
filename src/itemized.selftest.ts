/**
 * itemized.selftest.ts — Itemized GROUP expenses ("who had what" with tip &
 * tax proportional to what each member actually ordered). Run with `npm test`.
 *
 * GUARDRAILS under test:
 *  - pure math: items split evenly among who had them; extras (tip + tax +
 *    unassigned lines) distributed proportionally to item subtotals; a
 *    zero-item member is excluded from extras; integer cents summing EXACTLY
 *    to the receipt total (largest-remainder, zero-sum); single-member edge.
 *  - validation caps: ≤ 50 items, labels ≤ 60 chars, item cents 1..100000000,
 *    participants must be members, extras ≥ 0, at least one assignment.
 *  - authz: the route requires a signed-in trip member (member-only), and the
 *    ledger merge shows ONE logical expense whose breakdown sums to the total
 *    while balances stay zero-sum (HTTP, real app in-process).
 */

import type { AddressInfo } from "net";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { app } from "./server";
import {
  validateItemized,
  itemizedShares,
  canItemize,
  MAX_ITEMIZED_ITEMS,
  MAX_ITEMIZED_LABEL,
} from "./itemized";
import { mergeItemizedExpenses, TripExpense } from "./trips";
import { computeBalances } from "./ledger";

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

function sum(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

const M = ["a", "b", "c"];

// ---- pure math: itemizedShares ----------------------------------------------

// 1) Uneven items + proportional extras: a had $10, b had $30, $10 of tip+tax
//    → extras split 1:3 ($2.50 / $7.50).
{
  const s = itemizedShares(
    5000,
    [
      { label: "ramen", qty: 1, cents: 1000, memberIds: ["a"] },
      { label: "omakase", qty: 1, cents: 3000, memberIds: ["b"] },
    ],
    M
  );
  ok(
    "math: extras proportional to item subtotals",
    s.get("a") === 1250 && s.get("b") === 3750 && s.get("c") === 0 && sum(s) === 5000
  );
}

// 2) Zero-item member is excluded from extras entirely (owes exactly 0).
{
  const s = itemizedShares(
    2400,
    [{ label: "beer", qty: 2, cents: 2000, memberIds: ["a", "b"] }],
    M
  );
  ok(
    "math: zero-item member pays no tip/tax",
    s.get("c") === 0 && s.get("a") === 1200 && s.get("b") === 1200 && sum(s) === 2400
  );
}

// 3) Tip + tax combined into one extras bucket, penny-exact on ugly numbers:
//    $10.01 shared item between two + $3.33 extras — no penny lost/created.
{
  const s = itemizedShares(
    1334,
    [{ label: "gyoza", qty: 1, cents: 1001, memberIds: ["a", "b"] }],
    M
  );
  const a = s.get("a") as number;
  const b = s.get("b") as number;
  // a gets the item's odd penny (501 vs 500) AND, proportionally, the extras'
  // odd penny — so the gap is ≤ 2 cents, never a lost/created penny.
  ok(
    "math: penny-exact zero-sum on odd cents",
    sum(s) === 1334 && a + b === 1334 && a >= b && a - b <= 2 && s.get("c") === 0
  );
}

// 4) Unassigned item falls into extras (proportional), not evenly.
{
  const s = itemizedShares(
    4000,
    [
      { label: "sake", qty: 1, cents: 1000, memberIds: ["a"] },
      { label: "mystery line", qty: 1, cents: 3000, memberIds: [] },
    ],
    M
  );
  ok("math: unassigned line joins the extras bucket", s.get("a") === 4000 && sum(s) === 4000);
}

// 5) Single-member edge: one person had everything → they owe the whole total.
{
  const s = itemizedShares(
    9999,
    [{ label: "solo feast", qty: 1, cents: 8000, memberIds: ["a"] }],
    ["a"]
  );
  ok("math: single member owes the exact total", s.get("a") === 9999 && sum(s) === 9999);
}

// 6) No extras at all (total === item sum) still balances exactly.
{
  const s = itemizedShares(
    3000,
    [{ label: "taxi", qty: 1, cents: 3000, memberIds: ["a", "b", "c"] }],
    M
  );
  ok("math: zero extras is fine", sum(s) === 3000 && s.get("a") === 1000);
}

// 7) Fuzz: random items/assignments always sum exactly to the total.
{
  let exact = true;
  for (let t = 0; t < 200; t++) {
    const items = [];
    let itemSum = 0;
    const n = 1 + (t % 7);
    for (let i = 0; i < n; i++) {
      const cents = 1 + Math.floor(Math.random() * 5000);
      itemSum += cents;
      const ids = M.filter(() => Math.random() < 0.5);
      items.push({ label: "x", qty: 1, cents, memberIds: ids });
    }
    if (!items.some((it) => it.memberIds.length > 0)) items[0].memberIds = ["a"];
    const total = itemSum + Math.floor(Math.random() * 2000);
    const s = itemizedShares(total, items, M);
    if (sum(s) !== total) exact = false;
  }
  ok("math: 200-case fuzz stays penny-exact", exact);
}

// ---- validation caps ---------------------------------------------------------

{
  const many = Array.from({ length: MAX_ITEMIZED_ITEMS + 1 }, () => ({
    label: "x",
    cents: 100,
    memberIds: ["a"],
  }));
  ok("validate: > 50 items rejected", validateItemized(many, 100000, M).ok === false);
  ok(
    "validate: 50 items accepted",
    validateItemized(many.slice(0, MAX_ITEMIZED_ITEMS), 100000, M).ok === true
  );
}
ok(
  "validate: label over 60 chars rejected",
  validateItemized([{ label: "x".repeat(MAX_ITEMIZED_LABEL + 1), cents: 100, memberIds: ["a"] }], 200, M)
    .ok === false
);
ok(
  "validate: zero-cent item rejected",
  validateItemized([{ label: "x", cents: 0, memberIds: ["a"] }], 200, M).ok === false
);
ok(
  "validate: fractional cents rejected",
  validateItemized([{ label: "x", cents: 10.5, memberIds: ["a"] }], 200, M).ok === false
);
ok(
  "validate: item over $1M rejected",
  validateItemized([{ label: "x", cents: 100_000_001, memberIds: ["a"] }], 100_000_002, M).ok === false
);
ok(
  "validate: non-member assignment rejected",
  validateItemized([{ label: "x", cents: 100, memberIds: ["zz"] }], 200, M).ok === false
);
ok(
  "validate: extras must be ≥ 0 (items past the total rejected)",
  validateItemized([{ label: "x", cents: 300, memberIds: ["a"] }], 200, M).ok === false
);
ok(
  "validate: needs at least one assignment",
  validateItemized([{ label: "x", cents: 100, memberIds: [] }], 200, M).ok === false
);
ok(
  "validate: clean payload accepted (extras computed)",
  (() => {
    const v = validateItemized([{ label: " ramen ", qty: 2, cents: 100, memberIds: ["a", "a"] }], 150, M);
    return v.ok === true && v.extrasCents === 50 && v.items[0].label === "ramen" && v.items[0].memberIds.length === 1;
  })()
);

// ---- member-only authz (pure) -------------------------------------------------

ok("authz: anonymous can't itemize", canItemize({ userId: null, ownerUserId: "o", memberUserIds: [] }) === false);
ok("authz: owner can itemize", canItemize({ userId: "o", ownerUserId: "o", memberUserIds: [] }) === true);
ok("authz: claimed member can itemize", canItemize({ userId: "m", ownerUserId: "o", memberUserIds: ["m"] }) === true);
ok("authz: stranger can't itemize", canItemize({ userId: "x", ownerUserId: "o", memberUserIds: ["m"] }) === false);
ok("authz: keyless trip stays open to signed-in callers", canItemize({ userId: "x", ownerUserId: null, memberUserIds: [] }) === true);

// ---- merge: per-member rows → ONE logical expense (pure) ----------------------

{
  const rows: TripExpense[] = [
    { id: "e0", title: "gas", amountCents: 900, paidBy: "a", participants: ["a", "b", "c"], createdAt: "t0" },
    {
      id: "e1", title: "izakaya night 🏮", amountCents: 1250, paidBy: "a", participants: ["a"],
      createdAt: "t1", splitId: "S", splitMeta: { items: [{ label: "ramen", qty: 1, cents: 1000, memberIds: ["a"] }], extrasCents: 1000 },
    },
    { id: "e2", title: "izakaya night 🏮", amountCents: 3750, paidBy: "a", participants: ["b"], createdAt: "t1", splitId: "S" },
  ];
  const merged = mergeItemizedExpenses(rows);
  const it = merged.find((e) => e.id === "S");
  ok(
    "merge: one logical expense, exact breakdown summing to the receipt total",
    merged.length === 2 &&
      !!it &&
      it.amountCents === 5000 &&
      it.participants.join(",") === "a,b" &&
      it.itemized!.breakdown.reduce((s, b) => s + b.cents, 0) === 5000 &&
      it.itemized!.items.length === 1 &&
      it.itemized!.extrasCents === 1000
  );
  // The raw rows feed computeBalances untouched: payer +total−own share.
  const bal = computeBalances(["a", "b", "c"], rows.slice(1));
  ok(
    "merge: raw rows keep balances zero-sum and exact",
    bal.reduce((s, b) => s + b.cents, 0) === 0 &&
      bal.find((b) => b.memberId === "a")!.cents === 3750 &&
      bal.find((b) => b.memberId === "b")!.cents === -3750 &&
      bal.find((b) => b.memberId === "c")!.cents === 0
  );
}

// ---- HTTP: real app in-process (route authz + one-logical-expense ledger) -----

async function main(): Promise<void> {
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  const B = `http://127.0.0.1:${port}`;
  const H = (t: string) => ({ "content-type": "application/json", authorization: `Bearer ${t}` });

  async function mint(): Promise<string> {
    const kp = Keypair.generate();
    const n = await fetch(`${B}/api/auth/nonce`).then((r) => r.json());
    const sig = nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey);
    const v = await fetch(`${B}/api/auth/siws/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pubkey: kp.publicKey.toBase58(),
        signature: Buffer.from(sig).toString("base64"),
        message: n.message,
      }),
    }).then((r) => r.json());
    return v.token as string;
  }

  try {
    const owner = await mint();
    const trip = await fetch(`${B}/api/trips`, {
      method: "POST",
      headers: H(owner),
      body: JSON.stringify({ name: "Itemized Trip", members: [{ name: "Owner" }, { name: "Bob" }, { name: "Cay" }] }),
    }).then((r) => r.json());
    const tid = trip.id as string;
    const share = trip.shareToken as string;
    const idOf = (nm: string) => trip.members.find((m: { name: string; id: string }) => m.name === nm).id as string;
    const ownerMid = idOf("Owner");
    const bobId = idOf("Bob");
    const cayId = idOf("Cay");

    const itemizedBody = (over?: Record<string, unknown>) =>
      JSON.stringify({
        title: "izakaya night 🏮",
        totalCents: 5000,
        paidBy: ownerMid,
        items: [
          { label: "ramen", qty: 1, cents: 1000, memberIds: [ownerMid] },
          { label: "omakase", qty: 1, cents: 3000, memberIds: [bobId] },
        ],
        ...over,
      });

    // authz: no session → 401; share-token stranger (signed in, not a member) → 403.
    const unauth = await fetch(`${B}/api/trips/${tid}/expenses/itemized`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-trip-token": share },
      body: itemizedBody(),
    });
    ok("http: itemize requires auth (401)", unauth.status === 401);
    const attacker = await mint();
    const strangers = await fetch(`${B}/api/trips/${tid}/expenses/itemized`, {
      method: "POST",
      headers: { ...H(attacker), "x-trip-token": share },
      body: itemizedBody(),
    });
    ok("http: share-link stranger can't itemize (403)", strangers.status === 403);

    // owner (a claimed member) itemizes → 200 with ONE logical expense.
    const res = await fetch(`${B}/api/trips/${tid}/expenses/itemized`, {
      method: "POST",
      headers: H(owner),
      body: itemizedBody(),
    });
    const fresh = await res.json();
    ok("http: member can itemize (200)", res.status === 200);
    const exps = (fresh.expenses || []) as any[];
    const exp = exps.find((e) => e.itemized);
    ok("http: ledger shows ONE logical itemized expense", exps.length === 1 && !!exp);
    ok(
      "http: breakdown is exact and sums to the receipt total",
      !!exp &&
        exp.amountCents === 5000 &&
        exp.breakdown.reduce((s: number, b: any) => s + b.cents, 0) === 5000 &&
        exp.breakdown.find((b: any) => b.memberId === ownerMid).cents === 1250 &&
        exp.breakdown.find((b: any) => b.memberId === bobId).cents === 3750 &&
        !exp.breakdown.some((b: any) => b.memberId === cayId) &&
        exp.extrasCents === 1000 &&
        exp.items.length === 2
    );
    const balSum = (fresh.balances || []).reduce((s: number, b: any) => s + b.cents, 0);
    const bobBal = (fresh.balances || []).find((b: any) => b.memberId === bobId);
    ok(
      "http: balances stay zero-sum with bob owing his exact share",
      balSum === 0 && bobBal.cents === -3750
    );
    ok("http: group total equals the receipt total", fresh.totalCents === 5000);

    // validation over HTTP: items past the total → 400.
    const over = await fetch(`${B}/api/trips/${tid}/expenses/itemized`, {
      method: "POST",
      headers: H(owner),
      body: itemizedBody({ totalCents: 3999 }),
    });
    ok("http: extras < 0 rejected (400)", over.status === 400);

    // the merged expense can't be PATCHed, and DELETE voids the whole group.
    const patch = await fetch(`${B}/api/trips/${tid}/expenses/${exp.id}`, {
      method: "PATCH",
      headers: H(owner),
      body: JSON.stringify({ title: "rewritten" }),
    });
    ok("http: itemized expense can't be edited (403)", patch.status === 403);
    const del = await fetch(`${B}/api/trips/${tid}/expenses/${exp.id}`, {
      method: "DELETE",
      headers: H(owner),
    });
    const afterDel = await del.json();
    ok(
      "http: delete voids the whole logical expense, balances reset",
      del.status === 200 &&
        (afterDel.expenses || []).length === 0 &&
        (afterDel.balances || []).every((b: any) => b.cents === 0)
    );
  } finally {
    server.close();
  }

  console.log(`\nitemized.selftest: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("itemized.selftest crashed:", err);
  process.exit(1);
});
