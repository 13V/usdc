/**
 * journal.selftest.ts — Offline tests for the Spending journal's pure core.
 * NO HTTP, no network: month-param validation, UTC month bucketing (incl.
 * boundaries), the category keyword map, your-share math (even trip splits +
 * weighted subscription shares), and the digest fold (totals, fronted,
 * buckets, top group/friend, biggest splurge, month-over-month delta, and the
 * subscriptions-never-double-counted rule). Run with `npm test`.
 *
 * GUARDRAILS under test:
 *  - money stays integer cents and shares sum exactly (no lost pennies)
 *  - the :month param accepts ONLY strict yyyy-mm (no injection shapes)
 *  - subscription renewals feed subscriptionsCents ONLY — their money already
 *    lives in the trip items, so counting them again would double-bill
 */

import {
  isValidMonth,
  monthBoundsUtc,
  inMonth,
  prevMonthOf,
  monthLabel,
  bucketOf,
  yourEvenShare,
  yourWeightedShare,
  computeDigest,
  JournalItem,
} from "./journal";

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

// ---- month param validation ---------------------------------------------------

{
  ok("month: 2026-07 accepted", isValidMonth("2026-07"));
  ok("month: 2026-01 and 2026-12 accepted", isValidMonth("2026-01") && isValidMonth("2026-12"));
  ok("month: 2026-13 rejected", !isValidMonth("2026-13"));
  ok("month: 2026-00 rejected", !isValidMonth("2026-00"));
  ok("month: un-padded 2026-7 rejected", !isValidMonth("2026-7"));
  ok("month: full date 2026-07-01 rejected", !isValidMonth("2026-07-01"));
  ok("month: no separator 202607 rejected", !isValidMonth("202607"));
  ok("month: junk / injection shapes rejected",
    !isValidMonth("abcd-ef") && !isValidMonth("2026-07'; DROP TABLE--") && !isValidMonth("../2026-07"));
  ok("month: non-strings rejected", !isValidMonth(202607 as unknown) && !isValidMonth(null) && !isValidMonth(undefined));
  ok("month: absurd years rejected", !isValidMonth("1999-07") && !isValidMonth("9999-01"));
  ok("month: label reads like a diary", monthLabel("2026-07") === "july 2026");
}

// ---- month bucketing + boundaries ----------------------------------------------

{
  const b = monthBoundsUtc("2026-07");
  ok("bounds: july starts jul 1 00:00 UTC", b.startMs === Date.UTC(2026, 6, 1));
  ok("bounds: july ends before aug 1 00:00 UTC", b.endMs === Date.UTC(2026, 7, 1));

  ok("inMonth: first instant of the month counts", inMonth("2026-07-01T00:00:00.000Z", "2026-07"));
  ok("inMonth: last instant of the month counts", inMonth("2026-07-31T23:59:59.999Z", "2026-07"));
  ok("inMonth: the instant before the month does NOT", !inMonth("2026-06-30T23:59:59.999Z", "2026-07"));
  ok("inMonth: the first instant of the NEXT month does NOT", !inMonth("2026-08-01T00:00:00.000Z", "2026-07"));
  ok("inMonth: garbage timestamps never match", !inMonth("not-a-date", "2026-07") && !inMonth("", "2026-07"));

  ok("prevMonth: mid-year", prevMonthOf("2026-07") === "2026-06");
  ok("prevMonth: january wraps to december of the prior year", prevMonthOf("2026-01") === "2025-12");
  ok("prevMonth: stays zero-padded", prevMonthOf("2026-10") === "2026-09");
}

// ---- category buckets ------------------------------------------------------------

{
  ok("bucket: coffee → drinks (checked before food)", bucketOf("coffee run") === "drinks");
  ok("bucket: emoji beer → drinks", bucketOf("🍻 round two") === "drinks");
  ok("bucket: sushi dinner → food", bucketOf("Sushi Dinner") === "food");
  ok("bucket: emoji ramen → food", bucketOf("🍜") === "food");
  ok("bucket: groceries → food", bucketOf("groceries") === "food");
  ok("bucket: flight → travel", bucketOf("flight to tokyo") === "travel");
  ok("bucket: uber → travel", bucketOf("late night uber") === "travel");
  ok("bucket: rent → home", bucketOf("rent") === "home");
  ok("bucket: wifi → home", bucketOf("wifi bill") === "home");
  ok("bucket: karaoke → fun", bucketOf("KARAOKE!!") === "fun");
  ok("bucket: netflix → fun", bucketOf("🍿 netflix") === "fun");
  ok("bucket: unknown → other", bucketOf("misc thing") === "other");
  ok("bucket: empty/null-ish → other", bucketOf("") === "other" && bucketOf(undefined as unknown as string) === "other");
  ok("bucket: 'barometer' does not leak into drinks (word boundary)", bucketOf("barometer") === "other");
}

// ---- your-share math ---------------------------------------------------------------

{
  // Even 3-way split of $10.00: penny goes to the first participant.
  ok("even: index 0 of 1000/3 gets the extra penny", yourEvenShare(1000, ["a", "b", "c"], "a") === 334);
  ok("even: later indices get the base share", yourEvenShare(1000, ["a", "b", "c"], "c") === 333);
  ok(
    "even: shares sum exactly to the total (no lost pennies)",
    ["a", "b", "c"].reduce((s, id) => s + yourEvenShare(1000, ["a", "b", "c"], id), 0) === 1000
  );
  ok("even: non-participant pays nothing", yourEvenShare(1000, ["a", "b"], "z") === 0);
  ok("even: solo expense is all yours", yourEvenShare(777, ["a"], "a") === 777);

  // Weighted: {a:2, b:1, c:1} of $10.00 → a=500, b=250, c=250.
  const shares = { a: 2, b: 1, c: 1 };
  ok("weighted: 2x weight pays half", yourWeightedShare(1000, ["a", "b", "c"], shares, "a") === 500);
  ok("weighted: 1x weights split the rest", yourWeightedShare(1000, ["a", "b", "c"], shares, "b") === 250);
  ok(
    "weighted: unlisted member defaults to weight 1",
    yourWeightedShare(300, ["a", "b", "c"], { a: 1 }, "c") === 100
  );
  ok("weighted: non-member pays nothing", yourWeightedShare(1000, ["a", "b"], shares, "z") === 0);
  ok(
    "weighted: shares sum exactly to the total",
    ["a", "b", "c"].reduce((s, id) => s + yourWeightedShare(1001, ["a", "b", "c"], shares, id), 0) === 1001
  );
}

// ---- digest fold ---------------------------------------------------------------------

function item(over: Partial<JournalItem>): JournalItem {
  return {
    title: "thing",
    cents: 0,
    frontedCents: 0,
    createdAt: "2026-07-10T12:00:00.000Z",
    source: "trip",
    group: null,
    friends: [],
    ...over,
  };
}

{
  const items: JournalItem[] = [
    // july, tokyo crew
    item({ title: "🍜 ramen", cents: 1200, frontedCents: 2400, group: "tokyo crew", groupEmoji: "🗼", friends: ["sam", "alex"] }),
    item({ title: "karaoke", cents: 3000, group: "tokyo crew", groupEmoji: "🗼", friends: ["sam"] }),
    item({ title: "flight", cents: 9000, group: "tokyo crew", groupEmoji: "🗼", friends: ["sam", "alex"], createdAt: "2026-07-01T00:00:00.000Z" }),
    // july, a smaller group + a tab
    item({ title: "coffee", cents: 700, group: "roomies", friends: ["riley"] }),
    item({ title: "coffee", cents: 0, frontedCents: 500, source: "tab", friends: ["riley"] }),
    // july subscription renewal — informational ONLY (already in trip items)
    item({ title: "🍿 netflix", cents: 425, source: "subscription", group: "roomies", createdAt: "2026-07-05T00:00:00.000Z" }),
    // june (previous month)
    item({ title: "dinner", cents: 5000, createdAt: "2026-06-15T12:00:00.000Z", group: "roomies" }),
    item({ title: "🍿 netflix", cents: 425, source: "subscription", createdAt: "2026-06-05T00:00:00.000Z" }),
    // boundary checks: last instant of june / first instant of august
    item({ title: "late june", cents: 100, createdAt: "2026-06-30T23:59:59.999Z" }),
    item({ title: "early august", cents: 9999, createdAt: "2026-08-01T00:00:00.000Z" }),
  ];

  const d = computeDigest(items, "2026-07");
  ok("digest: month + label", d.month === "2026-07" && d.label === "july 2026");
  ok("digest: spent = sum of july trip+tab shares only", d.spentCents === 1200 + 3000 + 9000 + 700, `got ${d.spentCents}`);
  ok("digest: fronted totals what you covered for others", d.frontedCents === 2400 + 500);
  ok("digest: subscriptions counted ONCE, in their own stat", d.subscriptionsCents === 425 && d.spentCents === 13900);
  ok("digest: itemCount excludes subscription info-lines", d.itemCount === 5);

  ok("digest: buckets sorted by spend, travel first", d.buckets[0].key === "travel" && d.buckets[0].cents === 9000);
  const byKey = new Map(d.buckets.map((b) => [b.key, b]));
  ok("digest: food bucket = ramen share", byKey.get("food")?.cents === 1200);
  ok("digest: fun bucket = karaoke", byKey.get("fun")?.cents === 3000);
  ok("digest: drinks bucket = coffee (share-only tab entry excluded at 0¢)", byKey.get("drinks")?.cents === 700 && byKey.get("drinks")?.count === 1);
  ok("digest: bucket pcts derive from spent", d.buckets[0].pct === Math.round((9000 / 13900) * 100));
  ok(
    "digest: bucket cents sum back to spent exactly",
    d.buckets.reduce((s, b) => s + b.cents, 0) === d.spentCents
  );

  ok("digest: top group is the tokyo crew with its emoji", !!d.topGroup && d.topGroup.name === "tokyo crew" && d.topGroup.emoji === "🗼" && d.topGroup.cents === 13200);
  ok("digest: top friend by shared count", !!d.topFriend && d.topFriend.name === "sam" && d.topFriend.count === 3);
  ok(
    "digest: biggest splurge is the flight, located in its group",
    !!d.biggest && d.biggest.title === "flight" && d.biggest.cents === 9000 && d.biggest.where === "in tokyo crew"
  );

  ok("digest: prev-month spend excludes prev-month subscriptions too", d.prevSpentCents === 5000 + 100);
  ok("digest: month-over-month delta = spent − prev", d.deltaCents === 13900 - 5100);
  ok("digest: august item never leaks into july", d.spentCents < 9999 + 13900);
}

// empty month + delta sign
{
  const items = [item({ title: "dinner", cents: 4000, createdAt: "2026-06-10T00:00:00.000Z" })];
  const d = computeDigest(items, "2026-07");
  ok(
    "digest: empty month is all zeros with no superlatives",
    d.spentCents === 0 && d.frontedCents === 0 && d.itemCount === 0 &&
      d.buckets.length === 0 && d.topGroup === null && d.topFriend === null && d.biggest === null
  );
  ok("digest: quieter month yields a negative delta", d.prevSpentCents === 4000 && d.deltaCents === -4000);

  const dEmptyAll = computeDigest([], "2026-07");
  ok("digest: no data at all is safe", dEmptyAll.spentCents === 0 && dEmptyAll.deltaCents === 0);

  // a tab where a friend fronted for me still counts as MY spending
  const dTab = computeDigest(
    [item({ title: "🍻 beers", cents: 900, source: "tab", friends: ["sam"] })],
    "2026-07"
  );
  ok(
    "digest: tab i-owe entries count as spending, biggest says who with",
    dTab.spentCents === 900 && !!dTab.biggest && dTab.biggest.where === "with sam"
  );
}

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
