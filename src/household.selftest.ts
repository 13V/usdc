/**
 * household.selftest.ts — Offline household-hub tests. No network, no RPC.
 *
 * GUARDRAILS under test: residency-day counting (inclusive move-in/move-out,
 * same-day = 1, month boundaries, leap February); proration by
 * days-in-residence is integer cents summing EXACTLY to the amount (zero-sum
 * — no penny lost or created), degrading to the ledger's even split when
 * everyone is resident all month; hub totals aggregation; move-date and
 * residency-window validation. Run with `npm test`.
 */

import {
  residentDays,
  prorateByDays,
  monthlyizeCents,
  validateMoveDate,
  residencyPairOk,
  hubTotals,
  findPosted,
} from "./household";
import { distributeEven } from "./split";

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

// ---- residentDays -----------------------------------------------------------

// 1) No dates = the whole month.
ok("days: no dates = full june (30)", residentDays(2026, 5) === 30);
ok("days: no dates = full july (31)", residentDays(2026, 6) === 31);

// 2) Mid-month move-in: june 16 → 15 days (16th..30th inclusive).
ok("days: move in jun 16 = 15", residentDays(2026, 5, "2026-06-16") === 15);

// 3) Mid-month move-out: june 10 → 10 days (1st..10th inclusive).
ok("days: move out jun 10 = 10", residentDays(2026, 5, null, "2026-06-10") === 10);

// 4) Same-day in+out = exactly 1 day.
ok("days: same-day in+out = 1", residentDays(2026, 5, "2026-06-10", "2026-06-10") === 1);

// 5) Month boundaries: in on the 1st / out on the last day = full month.
ok("days: in on the 1st = full", residentDays(2026, 5, "2026-06-01") === 30);
ok("days: out on the 30th = full", residentDays(2026, 5, null, "2026-06-30") === 30);

// 6) Window entirely outside the month = 0 (moved out before / in after).
ok("days: moved out in may = 0 in june", residentDays(2026, 5, null, "2026-05-20") === 0);
ok("days: moves in in july = 0 in june", residentDays(2026, 5, "2026-07-02") === 0);

// 7) Dates from earlier/later months clamp to the month edges.
ok("days: in last year, out next year = full", residentDays(2026, 5, "2025-01-01", "2027-01-01") === 30);

// 8) Leap February: 2024 has 29 days, 2026 has 28.
ok("days: feb 2024 (leap) = 29", residentDays(2024, 1) === 29);
ok("days: feb 2026 = 28", residentDays(2026, 1) === 28);
ok("days: move in feb 15 2024 = 15", residentDays(2024, 1, "2024-02-15") === 15);

// 9) Unparseable dates are ignored (treated as unset), never zeroing someone.
ok("days: garbage dates ignored", residentDays(2026, 5, "not-a-date", "???") === 30);

// 10) Full ISO timestamps work at day granularity.
ok(
  "days: full ISO timestamp = same day",
  residentDays(2026, 5, "2026-06-16T23:59:59.000Z") === 15
);

// ---- prorateByDays ----------------------------------------------------------

// 11) Everyone resident all month = the ledger's even split, exactly.
{
  const s = prorateByDays(120000, [
    { id: "a", days: 30 },
    { id: "b", days: 30 },
    { id: "c", days: 30 },
  ]);
  const even = distributeEven(120000, 3);
  ok(
    "prorate: equal days = even split, sums exactly",
    s.get("a") === even[0] && s.get("b") === even[1] && s.get("c") === even[2] && sum(s) === 120000
  );
}

// 12) Mid-month join: $1200 rent, a+b full june, c joins jun 16 (15 days).
//     Weights 30/30/15 → 480/480/240.
{
  const s = prorateByDays(120000, [
    { id: "a", days: 30 },
    { id: "b", days: 30 },
    { id: "c", days: 15 },
  ]);
  ok(
    "prorate: mid-month join 30/30/15 on $1200 = 480/480/240",
    s.get("a") === 48000 && s.get("b") === 48000 && s.get("c") === 24000 && sum(s) === 120000
  );
}

// 13) Mover-out with 0 days pays exactly 0 and the rest still sums exactly.
{
  const s = prorateByDays(100001, [
    { id: "a", days: 31 },
    { id: "b", days: 0 },
    { id: "c", days: 31 },
  ]);
  ok(
    "prorate: 0-day member pays 0, others split all of it",
    s.get("b") === 0 && (s.get("a") as number) + (s.get("c") as number) === 100001
  );
}

// 14) Penny-exactness / zero-sum across awkward day ratios and amounts.
{
  const cases: [number, number[]][] = [
    [100, [1, 1, 1]],
    [1549, [31, 17, 5]],
    [99999, [28, 3, 14, 9]],
    [1, [30, 15]],
    [77777, [29, 29, 1]],
  ];
  let allExact = true;
  for (const [amt, days] of cases) {
    const s = prorateByDays(amt, days.map((d, i) => ({ id: `m${i}`, days: d })));
    if (sum(s) !== amt) allExact = false;
    for (const v of s.values()) if (!Number.isInteger(v) || v < 0) allExact = false;
  }
  ok("prorate: always integer cents summing exactly (5 awkward cases)", allExact);
}

// 15) Same-day stay still carries weight; nobody-resident throws.
{
  const s = prorateByDays(3000, [
    { id: "a", days: 30 },
    { id: "b", days: 1 },
  ]);
  ok(
    "prorate: 1-day stay gets a small share, exact sum",
    (s.get("b") as number) > 0 && (s.get("b") as number) < (s.get("a") as number) && sum(s) === 3000
  );
  let threw = false;
  try {
    prorateByDays(3000, [{ id: "a", days: 0 }]);
  } catch {
    threw = true;
  }
  ok("prorate: throws when nobody is resident", threw);
}

// 16) Non-integer amount rejected (money is ALWAYS integer cents).
{
  let threw = false;
  try {
    prorateByDays(10.5 as unknown as number, [{ id: "a", days: 3 }]);
  } catch {
    threw = true;
  }
  ok("prorate: rejects non-integer cents", threw);
}

// ---- monthlyizeCents ---------------------------------------------------------

ok("monthlyize: monthly passthrough", monthlyizeCents(120000, "monthly") === 120000);
ok("monthlyize: yearly / 12", monthlyizeCents(12000, "yearly") === 1000);
ok("monthlyize: weekly * 52 / 12", monthlyizeCents(1200, "weekly") === 5200);
ok("monthlyize: 15d ≈ * 2", monthlyizeCents(500, "15d") === 1000);

// ---- hubTotals ----------------------------------------------------------------

// 17) Hub aggregation: month total sums every bill; "your month" sums only
//     the bills you're actually in (null share = not yours).
{
  const t = hubTotals([
    { monthlyCents: 120000, yourShareCents: 48000 }, // rent, prorated
    { monthlyCents: 8000, yourShareCents: 4000 }, // utilities
    { monthlyCents: 1549, yourShareCents: 388 }, // netflix
    { monthlyCents: 999, yourShareCents: null }, // a sub you're not on
  ]);
  ok(
    "hub totals: month + your-month sum correctly",
    t.monthCents === 130548 && t.yourMonthCents === 52388
  );
}
{
  const t = hubTotals([]);
  ok("hub totals: empty hub = $0 / $0", t.monthCents === 0 && t.yourMonthCents === 0);
}

// ---- findPosted ----------------------------------------------------------------

// 18) Posted matching: same title inside the month; "· prorated" replacements
//     count; transfers and other months don't.
{
  const exps = [
    { id: "1", title: "🏠 rent", createdAt: "2026-05-01T09:00:00.000Z", kind: null },
    { id: "2", title: "🏠 rent", createdAt: "2026-06-01T09:00:00.000Z", kind: null },
    { id: "3", title: "groceries", createdAt: "2026-06-02T09:00:00.000Z", kind: null },
    { id: "4", title: "wifi", createdAt: "2026-06-03T09:00:00.000Z", kind: "transfer" },
    { id: "5", title: "wifi · prorated", createdAt: "2026-06-04T09:00:00.000Z", kind: null },
  ];
  const rent = findPosted(exps, "🏠 rent", 2026, 5);
  const wifi = findPosted(exps, "wifi", 2026, 5);
  const gas = findPosted(exps, "gas", 2026, 5);
  const rentJuly = findPosted(exps, "🏠 rent", 2026, 6);
  ok("posted: exact title in month", !!rent && rent.id === "2");
  ok("posted: '· prorated' replacement matches; transfer doesn't", !!wifi && wifi.id === "5");
  ok("posted: absent bill = undefined", gas === undefined);
  ok("posted: other month = undefined", rentJuly === undefined);
}

// ---- validation -----------------------------------------------------------------

// 19) Move dates: clears, normalizes, rejects garbage and absurd years.
{
  const clear = validateMoveDate(null);
  const empty = validateMoveDate("");
  const good = validateMoveDate("2026-06-16");
  const iso = validateMoveDate("2026-06-16T14:30:00.000Z");
  const bad = validateMoveDate("not a date");
  const wild = validateMoveDate("0999-01-01");
  const far = validateMoveDate("3001-01-01");
  const arr = validateMoveDate(["2026-06-16"] as unknown);
  ok("validate: null/'' clear", clear.ok && clear.iso === null && empty.ok && empty.iso === null);
  ok("validate: YYYY-MM-DD normalizes", good.ok && good.iso === "2026-06-16");
  ok("validate: full ISO → day granularity", iso.ok && iso.iso === "2026-06-16");
  ok("validate: garbage rejected", !bad.ok);
  ok("validate: years outside 2000..2100 rejected", !wild.ok && !far.ok);
  ok("validate: non-string rejected", !arr.ok);
}

// 20) Residency pair: out before in is incoherent; open ends are fine.
ok("pair: in ≤ out ok", residencyPairOk("2026-06-01", "2026-06-30"));
ok("pair: same day ok", residencyPairOk("2026-06-10", "2026-06-10"));
ok("pair: out before in rejected", !residencyPairOk("2026-06-20", "2026-06-10"));
ok("pair: open ends ok", residencyPairOk(null, "2026-06-10") && residencyPairOk("2026-06-10", null));

// ---- summary --------------------------------------------------------------------

console.log(`\nhousehold selftest: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
