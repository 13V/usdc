/**
 * subscriptions.selftest.ts — Offline shared-subscription math tests. No
 * network, no RPC.
 *
 * GUARDRAILS under test: per-member shares are integer cents summing EXACTLY
 * to the subscription amount; the renewal date anchors to the renewal day
 * across short months (the 31st clamps to feb 28 then snaps BACK to mar 31,
 * never drifting like raw Date month arithmetic); the renewal-day nudge goes
 * to exactly the members who owe a share. Run with `npm test`.
 */

import {
  shareCents,
  advanceRenewal,
  firstRenewal,
  daysInMonth,
  nudgeTargets,
  SubMemberLike,
} from "./subscriptions";

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

// 1) Even split (empty shares map): penny-fair and exact. $15.49 netflix / 4.
{
  const s = shareCents(1549, ["a", "b", "c", "d"], {});
  ok(
    "shares: even $15.49/4 = 3.88/3.87/3.87/3.87, sums exactly",
    s.get("a") === 388 && s.get("b") === 387 && s.get("c") === 387 && s.get("d") === 387 && sum(s) === 1549
  );
}

// 2) Weighted shares: family plan where a takes 2 slots. Unlisted default to 1.
{
  const s = shareCents(1000, ["a", "b", "c"], { a: 2 });
  ok(
    "shares: weights {a:2,b:1,c:1} on $10 = 5.00/2.50/2.50",
    s.get("a") === 500 && s.get("b") === 250 && s.get("c") === 250 && sum(s) === 1000
  );
}

// 3) Weighted with leftover pennies still sums exactly.
{
  const s = shareCents(1001, ["a", "b", "c"], { a: 3, b: 2, c: 2 });
  ok("shares: weighted $10.01 by 3/2/2 sums exactly to total", sum(s) === 1001);
}

// 4) Stress: random amounts/weights — always integer cents, always exact.
{
  let exact = true;
  let integer = true;
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let trial = 0; trial < 200; trial++) {
    const n = 1 + Math.floor(rnd() * 8);
    const ids = Array.from({ length: n }, (_, i) => `m${i}`);
    const shares: Record<string, number> = {};
    for (const id of ids) if (rnd() < 0.5) shares[id] = 1 + Math.floor(rnd() * 9);
    const amount = 1 + Math.floor(rnd() * 999999);
    const s = shareCents(amount, ids, shares);
    if (sum(s) !== amount) exact = false;
    for (const v of s.values()) if (!Number.isInteger(v)) integer = false;
  }
  ok("shares: 200 random weighted splits — always integer, always exact", exact && integer);
}

// 5) daysInMonth knows short months and leap years.
ok(
  "dates: daysInMonth feb-2026=28, feb-2028=29, apr=30, jan=31",
  daysInMonth(2026, 1) === 28 && daysInMonth(2028, 1) === 29 && daysInMonth(2026, 3) === 30 && daysInMonth(2026, 0) === 31
);

// 6) Monthly on the 31st: clamps into feb, snaps BACK to the 31st in march —
//    the exact month-end anchor recurring.advanceDue can't hold (Date overflow
//    would give mar 3 and drift forever).
{
  const feb = advanceRenewal("2026-01-31T00:00:00.000Z", "monthly", 31);
  const mar = advanceRenewal(feb, "monthly", 31);
  const apr = advanceRenewal(mar, "monthly", 31);
  ok(
    "dates: 31st anchor jan 31 → feb 28 → mar 31 → apr 30",
    feb === "2026-02-28T00:00:00.000Z" &&
      mar === "2026-03-31T00:00:00.000Z" &&
      apr === "2026-04-30T00:00:00.000Z",
    `${feb} ${mar} ${apr}`
  );
}

// 7) Leap year: the 30th/31st anchor lands on feb 29 in 2028.
ok(
  "dates: 31st anchor jan 31 2028 → feb 29 (leap)",
  advanceRenewal("2028-01-31T00:00:00.000Z", "monthly", 31) === "2028-02-29T00:00:00.000Z"
);

// 8) Monthly across the year boundary, ordinary day.
ok(
  "dates: dec 15 → jan 15 (year rollover)",
  advanceRenewal("2026-12-15T00:00:00.000Z", "monthly", 15) === "2027-01-15T00:00:00.000Z"
);

// 9) Yearly: feb 29 renews feb 28 next (non-leap) year, day 30 anchor in a
//    30-day month stays put, and the time-of-day is preserved.
ok(
  "dates: yearly feb 29 2028 → feb 28 2029; time-of-day preserved",
  advanceRenewal("2028-02-29T00:00:00.000Z", "yearly", 29) === "2029-02-28T00:00:00.000Z" &&
    advanceRenewal("2026-06-12T09:30:00.000Z", "monthly", 12) === "2026-07-12T09:30:00.000Z"
);

// 10) advanceRenewal rejects bad input.
{
  let threw = 0;
  try { advanceRenewal("nope", "monthly", 12); } catch { threw++; }
  try { advanceRenewal("2026-01-01T00:00:00.000Z", "weekly" as never, 12); } catch { threw++; }
  try { advanceRenewal("2026-01-01T00:00:00.000Z", "monthly", 0); } catch { threw++; }
  try { advanceRenewal("2026-01-01T00:00:00.000Z", "monthly", 32); } catch { threw++; }
  ok("dates: advanceRenewal throws on bad date/interval/day", threw === 4);
}

// 11) firstRenewal: a still-ahead day stays this month; today's day is due
//     TODAY (so the first split + nudge land immediately); a passed day rolls
//     to next month; day 31 in february clamps to the 28th.
{
  const ahead = firstRenewal(new Date("2026-03-10T15:00:00.000Z"), 25);
  const today = firstRenewal(new Date("2026-03-10T15:00:00.000Z"), 10);
  const passedDay = firstRenewal(new Date("2026-03-10T15:00:00.000Z"), 5);
  const clamped = firstRenewal(new Date("2026-02-10T15:00:00.000Z"), 31);
  ok(
    "dates: firstRenewal ahead→this month, today→today, passed→next month, feb+31→feb 28",
    ahead === "2026-03-25T00:00:00.000Z" &&
      today === "2026-03-10T00:00:00.000Z" &&
      passedDay === "2026-04-05T00:00:00.000Z" &&
      clamped === "2026-02-28T00:00:00.000Z",
    `${ahead} ${today} ${passedDay} ${clamped}`
  );
}

// 12) firstRenewal across the december boundary.
ok(
  "dates: firstRenewal dec 20, day 5 → jan 5 next year",
  firstRenewal(new Date("2026-12-20T00:00:00.000Z"), 5) === "2027-01-05T00:00:00.000Z"
);

// 13) Nudge targeting: the payer never gets a "your share" nudge, unclaimed
//     member slots (no linked user) are skipped, and each target carries
//     their own share.
{
  const members: SubMemberLike[] = [
    { id: "m1", userId: "u-payer" }, // pays the provider
    { id: "m2", userId: "u-sam" },
    { id: "m3" }, // unclaimed slot — nowhere to push
    { id: "m4", userId: "u-ali" },
  ];
  const per = shareCents(1700, ["m1", "m2", "m3", "m4"], {});
  const targets = nudgeTargets(members, "m1", per);
  ok(
    "nudges: payer excluded, unclaimed skipped, shares attached",
    targets.length === 2 &&
      targets[0].userId === "u-sam" &&
      targets[0].shareCents === per.get("m2") &&
      targets[1].userId === "u-ali" &&
      targets[1].shareCents === per.get("m4")
  );
}

// 14) Nudge targeting dedupes a user claiming two member slots.
{
  const members: SubMemberLike[] = [
    { id: "m1", userId: "u-payer" },
    { id: "m2", userId: "u-sam" },
    { id: "m3", userId: "u-sam" }, // same human, second slot
  ];
  const per = shareCents(900, ["m1", "m2", "m3"], {});
  const targets = nudgeTargets(members, "m1", per);
  ok("nudges: one push per human even across two member slots", targets.length === 1 && targets[0].userId === "u-sam");
}

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
