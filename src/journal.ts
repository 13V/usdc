/**
 * journal.ts — "Spending journal": a warm monthly digest of the caller's OWN
 * spending ("you spent $214 going out this month, mostly with the tokyo crew").
 * Insight without being a budgeting app: no budgets, no targets, zero guilt —
 * just what happened, told like a diary entry.
 *
 * ARCHITECTURE — read-only, privacy-scoped aggregation (the mochi.ts pattern):
 * the digest is computed from the SAME queries the real routes use —
 * trips.listTripsForUser plus read-only mirrors of the tabs / subscriptions
 * tables — always scoped to the caller, never anyone else's data.
 *
 * WHAT COUNTS AS "SPENT" (your share, integer cents):
 *   - trip expenses: your even-split share of every expense you participated
 *     in (largest-remainder at your index — the exact math ledger.ts uses).
 *   - tab entries: entries where you owe the friend (their fronts for you).
 *   - subscription renewals are NOT added again: renewals materialize into the
 *     trip ledger (subscriptions.renewOnce → trips.addExpense), so their share
 *     is already inside the trip component. They surface as a separate
 *     `subscriptionsCents` stat line instead — counting them twice would
 *     double-bill the digest.
 * "FRONTED" is what you covered for others: the rest of expenses you paid,
 * plus tab entries where the friend owes you.
 *
 * GUARDRAIL: ALL money is integer cents.
 *
 * Mount (integrator):
 *   import { journalRouter } from "./journal";
 *   app.use(journalRouter);
 */

import { Router, Request, Response } from "express";

import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { requireAuth } from "./auth";
import { rateLimit } from "./ratelimit";
import { listTripsForUser } from "./trips";
import { signedCents } from "./tabs";
import { shareCents } from "./subscriptions";
import { getUser, serializeUser } from "./users";
import { fmt, distributeEven } from "./split";

// ---- Month param (pure, tested in journal.selftest.ts) ------------------------

/** Strict yyyy-mm: exactly "2026-07". Rejects "2026-7", dates, junk, injection. */
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonth(s: unknown): s is string {
  if (typeof s !== "string" || !MONTH_RE.test(s)) return false;
  const y = Number(s.slice(0, 4));
  return y >= 2000 && y <= 2100; // sane range — no year-9999 probe storms
}

/** UTC millisecond bounds of a month: [startMs, endMs). */
export function monthBoundsUtc(month: string): { startMs: number; endMs: number } {
  if (!isValidMonth(month)) throw new Error(`monthBoundsUtc: invalid month ${month}`);
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return { startMs: Date.UTC(y, m - 1, 1), endMs: Date.UTC(y, m, 1) };
}

/** True iff `iso` falls inside `month` (UTC month bucketing, inclusive-exclusive). */
export function inMonth(iso: string, month: string): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const b = monthBoundsUtc(month);
  return t >= b.startMs && t < b.endMs;
}

/** "2026-01" → "2025-12". */
export function prevMonthOf(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "2026-07" → "july 2026" (lowercase, journal voice). */
export function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

// ---- Category buckets (pure, tested) -------------------------------------------
// Heuristic keyword/emoji map over expense titles — same spirit as home.js's
// groupEmoji. First matching rule wins; anything unmatched is "other".

export type BucketKey = "food" | "drinks" | "travel" | "home" | "fun" | "other";

export const BUCKET_META: Record<BucketKey, { emoji: string; label: string }> = {
  food: { emoji: "🍜", label: "food" },
  drinks: { emoji: "🍻", label: "drinks" },
  travel: { emoji: "✈️", label: "travel" },
  home: { emoji: "🏠", label: "home" },
  fun: { emoji: "🎟️", label: "fun" },
  other: { emoji: "✨", label: "other" },
};

const BUCKET_RULES: [BucketKey, RegExp][] = [
  ["drinks", /🍺|🍻|🍷|🍸|🥂|🧋|🍹|☕|\b(coffee|cafe|latte|matcha|boba|beer|beers|wine|bar|drinks?|cocktails?|brewery|pub)\b/],
  ["food", /🍜|🍕|🍔|🌮|🍣|🍩|🥐|🍟|🍦|🧁|🍰|🥪|🍱|\b(food|dinner|lunch|breakfast|brunch|snacks?|sushi|pizza|burgers?|tacos?|ramen|noodles?|groceries|grocery|restaurant|takeout|kebab|curry|bbq|eats?)\b/],
  ["travel", /✈️|🚕|🚆|🚄|⛽|🏨|🗼|🏝️|🚗|🛫|🚌|\b(flights?|plane|train|uber|lyft|taxi|cab|gas|fuel|hotel|airbnb|hostel|travel|bus|metro|parking|tolls?|rental car)\b/],
  ["home", /🏠|🧻|💡|🛋️|🧼|🪑|\b(rent|house|home|apartment|flat|utilities|electric(ity)?|wifi|internet|cleaning|furniture|ikea|laundry|toilet paper)\b/],
  ["fun", /🎬|🎮|🎟️|🎳|🎤|🍿|🎶|🎧|⛳|🎉|🎫|\b(movies?|cinema|concerts?|games?|gig|tickets?|museum|party|club|golf|bowling|karaoke|netflix|spotify|hulu|disney|arcade|festival)\b/],
];

/** Bucket a title heuristically. Case-insensitive; emoji count as keywords. */
export function bucketOf(title: string): BucketKey {
  const t = String(title || "").toLowerCase();
  for (const [key, re] of BUCKET_RULES) {
    if (re.test(t)) return key;
  }
  return "other";
}

// ---- Your-share math (pure, tested) ---------------------------------------------

/**
 * Your even-split share of one trip expense: the largest-remainder split at
 * your participant index (identical penny placement to ledger.computeBalances).
 * Returns 0 when you weren't on it.
 */
export function yourEvenShare(amountCents: number, participants: string[], memberId: string): number {
  const idx = participants.indexOf(memberId);
  if (idx < 0 || participants.length === 0) return 0;
  return distributeEven(amountCents, participants.length)[idx];
}

/**
 * Your weighted share of a subscription renewal (subscriptions.shareCents,
 * unlisted members default to weight 1). Returns 0 when you're not a member.
 */
export function yourWeightedShare(
  amountCents: number,
  memberIds: string[],
  shares: Record<string, number>,
  myMemberId: string
): number {
  if (!memberIds.includes(myMemberId)) return 0;
  return shareCents(amountCents, memberIds, shares).get(myMemberId) ?? 0;
}

// ---- Digest (pure, tested) ---------------------------------------------------------

/** One normalized spend line, from any source, already from MY perspective. */
export interface JournalItem {
  title: string;
  /** YOUR share, integer cents >= 0. */
  cents: number;
  /** What you covered for others, integer cents >= 0. */
  frontedCents: number;
  createdAt: string;
  source: "trip" | "tab" | "subscription";
  group?: string | null;
  groupEmoji?: string | null;
  /** The other people on it (display names). */
  friends?: string[];
}

export interface MonthDigest {
  month: string;
  label: string;
  spentCents: number;
  spentFmt: string;
  frontedCents: number;
  frontedFmt: string;
  /** Your share of subscription renewals this month — a SUBSET of spent (see header). */
  subscriptionsCents: number;
  subscriptionsFmt: string;
  itemCount: number;
  buckets: { key: BucketKey; label: string; emoji: string; cents: number; fmt: string; count: number; pct: number }[];
  topGroup: { name: string; emoji: string | null; cents: number; fmt: string } | null;
  topFriend: { name: string; count: number } | null;
  biggest: { title: string; cents: number; fmt: string; where: string; at: string } | null;
  prevSpentCents: number;
  /** spent − last month's spent (negative = a quieter month). */
  deltaCents: number;
}

/**
 * Fold normalized items into one month's digest. Subscription-source items feed
 * ONLY `subscriptionsCents` (their money already lives in the trip items —
 * never double-counted); everything else feeds totals, buckets, superlatives.
 */
export function computeDigest(items: JournalItem[], month: string): MonthDigest {
  const prevMonth = prevMonthOf(month);
  let spent = 0;
  let fronted = 0;
  let subsCents = 0;
  let prevSpent = 0;
  let itemCount = 0;

  const buckets = new Map<BucketKey, { cents: number; count: number }>();
  const groups = new Map<string, { emoji: string | null; cents: number }>();
  const friendCounts = new Map<string, number>();
  let biggest: { title: string; cents: number; where: string; at: string } | null = null;

  for (const it of items) {
    const inThis = inMonth(it.createdAt, month);
    if (!inThis && it.source !== "subscription" && inMonth(it.createdAt, prevMonth)) {
      prevSpent += it.cents;
      continue;
    }
    if (!inThis) continue;

    if (it.source === "subscription") {
      subsCents += it.cents;
      continue; // informational only — already inside the trip items
    }

    spent += it.cents;
    fronted += it.frontedCents;
    itemCount += 1;

    if (it.cents > 0) {
      const key = bucketOf(it.title);
      const b = buckets.get(key) || { cents: 0, count: 0 };
      b.cents += it.cents;
      b.count += 1;
      buckets.set(key, b);

      if (it.group) {
        const g = groups.get(it.group) || { emoji: it.groupEmoji ?? null, cents: 0 };
        g.cents += it.cents;
        groups.set(it.group, g);
      }
      if (!biggest || it.cents > biggest.cents) {
        const where = it.group
          ? `in ${it.group}`
          : it.friends && it.friends.length
            ? `with ${it.friends[0]}`
            : "";
        biggest = { title: it.title, cents: it.cents, where, at: it.createdAt };
      }
    }
    for (const f of new Set(it.friends || [])) {
      friendCounts.set(f, (friendCounts.get(f) || 0) + 1);
    }
  }

  const bucketList = Array.from(buckets.entries())
    .map(([key, b]) => ({
      key,
      label: BUCKET_META[key].label,
      emoji: BUCKET_META[key].emoji,
      cents: b.cents,
      fmt: fmt(b.cents),
      count: b.count,
      pct: spent > 0 ? Math.round((b.cents / spent) * 100) : 0,
    }))
    .sort((a, b) => b.cents - a.cents || (a.key < b.key ? -1 : 1));

  let topGroup: MonthDigest["topGroup"] = null;
  for (const [name, g] of groups) {
    if (!topGroup || g.cents > topGroup.cents) {
      topGroup = { name, emoji: g.emoji, cents: g.cents, fmt: fmt(g.cents) };
    }
  }

  let topFriend: MonthDigest["topFriend"] = null;
  for (const [name, count] of friendCounts) {
    if (!topFriend || count > topFriend.count || (count === topFriend.count && name < topFriend.name)) {
      topFriend = { name, count };
    }
  }

  return {
    month,
    label: monthLabel(month),
    spentCents: spent,
    spentFmt: fmt(spent),
    frontedCents: fronted,
    frontedFmt: fmt(fronted),
    subscriptionsCents: subsCents,
    subscriptionsFmt: fmt(subsCents),
    itemCount,
    buckets: bucketList,
    topGroup,
    topFriend,
    biggest: biggest
      ? { title: biggest.title, cents: biggest.cents, fmt: fmt(biggest.cents), where: biggest.where, at: biggest.at }
      : null,
    prevSpentCents: prevSpent,
    deltaCents: spent - prevSpent,
  };
}

// ---- Read-only data mirrors (privacy-scoped to the caller) ------------------------
// Same "derive without importing internals" pattern as mochi.ts / nudges.ts.

/** Ids are crypto.randomUUID()s — enforce the shape before .or() embedding (tabs.ts). */
function isSafeId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v);
}

interface TabEntryRowLite {
  created_by: string;
  friend_user_id: string;
  direction: string;
  amount_cents: number;
  note: string | null;
  status: string;
  created_at: string;
}

/** ALL tab entries involving `meId` (read-only mirror of tabs.listMyEntries). */
async function listMyTabEntries(meId: string): Promise<TabEntryRowLite[]> {
  if (!isSafeId(meId)) return [];
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("tab_entries")
      .select("created_by, friend_user_id, direction, amount_cents, note, status, created_at")
      .or(`created_by.eq.${meId},friend_user_id.eq.${meId}`);
    if (error) throw new Error(`journal.listMyTabEntries: ${error.message}`);
    return (data as TabEntryRowLite[]) ?? [];
  }
  return db
    .prepare(
      `SELECT created_by, friend_user_id, direction, amount_cents, note, status, created_at
       FROM tab_entries WHERE created_by = ? OR friend_user_id = ?`
    )
    .all(meId, meId) as TabEntryRowLite[];
}

interface SubRowLite {
  id: string;
  trip_id: string;
  name: string;
  icon: string | null;
  members: unknown;
  shares: unknown;
}

/** Subscriptions attached to MY trips (mirror of listActiveForViewer, trips-only). */
async function listSubsForTrips(tripIds: string[]): Promise<SubRowLite[]> {
  if (!tripIds.length) return [];
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("subscriptions")
      .select("id, trip_id, name, icon, members, shares")
      .in("trip_id", tripIds);
    if (error) throw new Error(`journal.listSubsForTrips: ${error.message}`);
    return (data as SubRowLite[]) ?? [];
  }
  const placeholders = tripIds.map(() => "?").join(", ");
  return db
    .prepare(`SELECT id, trip_id, name, icon, members, shares FROM subscriptions WHERE trip_id IN (${placeholders})`)
    .all(...tripIds) as SubRowLite[];
}

interface RenewalRowLite {
  subscription_id: string;
  amount_cents: number;
  period: string;
}

/** Renewal history rows for a set of subscription ids. */
async function listRenewalsForSubs(subIds: string[]): Promise<RenewalRowLite[]> {
  if (!subIds.length) return [];
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("subscription_renewals")
      .select("subscription_id, amount_cents, period")
      .in("subscription_id", subIds);
    if (error) throw new Error(`journal.listRenewalsForSubs: ${error.message}`);
    return (data as RenewalRowLite[]) ?? [];
  }
  const placeholders = subIds.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT subscription_id, amount_cents, period FROM subscription_renewals
       WHERE subscription_id IN (${placeholders})`
    )
    .all(...subIds) as RenewalRowLite[];
}

/** Paid tab settlements involving `meId` inside the month (cheap "settled" count). */
async function countSettledInMonth(meId: string, month: string): Promise<number> {
  if (!isSafeId(meId)) return 0;
  const b = monthBoundsUtc(month);
  const startIso = new Date(b.startMs).toISOString();
  const endIso = new Date(b.endMs).toISOString();
  if (usingSupabase) {
    const { count, error } = await supabase()
      .from("tab_settlements")
      .select("id", { count: "exact", head: true })
      .eq("status", "paid")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .or(`payer_user_id.eq.${meId},payee_user_id.eq.${meId}`);
    if (error) throw new Error(`journal.countSettledInMonth: ${error.message}`);
    return count ?? 0;
  }
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tab_settlements
       WHERE status = 'paid' AND created_at >= ? AND created_at < ?
         AND (payer_user_id = ? OR payee_user_id = ?)`
    )
    .get(startIso, endIso, meId, meId) as { n: number };
  return Number(row.n) || 0;
}

/** JSON columns are TEXT in SQLite, jsonb in Supabase — tolerate both (trips.asJson). */
function jsonVal<T>(v: unknown, fallback: T): T {
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return (v as T) ?? fallback;
}

// ---- Item assembly -------------------------------------------------------------------

/** Display name for a user (displayName || handle), cached per call. */
async function nameOf(userId: string, cache: Map<string, string>): Promise<string> {
  const hit = cache.get(userId);
  if (hit) return hit;
  let name = "a friend";
  try {
    const u = await getUser(userId);
    if (u) {
      const su = await serializeUser(u);
      name = su.displayName || su.handle || name;
    }
  } catch {
    /* keep the generic label */
  }
  cache.set(userId, name);
  return name;
}

/**
 * Everything the caller spent/fronted, normalized to JournalItems, across
 * trips + tabs + subscription renewals. All-time (the digest month-filters);
 * these are small, per-user datasets.
 */
async function collectItems(meId: string): Promise<JournalItem[]> {
  const items: JournalItem[] = [];

  // Trip expenses: my even share + what I fronted, per expense.
  const trips = await listTripsForUser(meId);
  for (const trip of trips) {
    const me = trip.members.find((m) => m.userId === meId);
    if (!me) continue;
    const nameById = new Map(trip.members.map((m) => [m.id, m.name]));
    for (const e of trip.expenses) {
      const mine = yourEvenShare(e.amountCents, e.participants, me.id);
      const frontedCents = e.paidBy === me.id ? e.amountCents - mine : 0;
      if (mine === 0 && frontedCents === 0) continue;
      items.push({
        title: e.title,
        cents: mine,
        frontedCents,
        createdAt: e.createdAt,
        source: "trip",
        group: trip.name,
        groupEmoji: trip.emoji ?? null,
        friends: e.participants.filter((p) => p !== me.id).map((p) => nameById.get(p) || "someone"),
      });
    }
  }

  // Tab entries: I-owe = my spending (they fronted it); they-owe = I fronted it.
  const entries = await listMyTabEntries(meId);
  const nameCache = new Map<string, string>();
  for (const e of entries) {
    // Partial-settlement payment rows are money moving, not spending — skip.
    if (e.status === "payment" || e.status === "payment_paid") continue;
    const signed = signedCents(e, meId);
    if (signed === 0) continue;
    const otherId = e.created_by === meId ? e.friend_user_id : e.created_by;
    const friendName = await nameOf(otherId, nameCache);
    items.push({
      title: e.note || "tab entry",
      cents: signed < 0 ? -signed : 0,
      frontedCents: signed > 0 ? signed : 0,
      createdAt: e.created_at,
      source: "tab",
      group: null,
      friends: [friendName],
    });
  }

  // Subscription renewals: my weighted share, informational only (see header).
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const subs = await listSubsForTrips(trips.map((t) => t.id));
  const subById = new Map(subs.map((s) => [s.id, s]));
  const renewals = await listRenewalsForSubs(subs.map((s) => s.id));
  for (const r of renewals) {
    const sub = subById.get(r.subscription_id);
    const trip = sub ? tripById.get(sub.trip_id) : undefined;
    if (!sub || !trip) continue;
    const mine = trip.members.find((m) => m.userId === meId);
    if (!mine) continue;
    const tripMemberIds = new Set(trip.members.map((m) => m.id));
    const memberIds = jsonVal<string[]>(sub.members, []).filter((id) => tripMemberIds.has(id));
    if (!memberIds.length) continue;
    const share = yourWeightedShare(r.amount_cents, memberIds, jsonVal<Record<string, number>>(sub.shares, {}), mine.id);
    if (share === 0) continue;
    items.push({
      title: `${sub.icon ? sub.icon + " " : ""}${sub.name}`,
      cents: share,
      frontedCents: 0,
      createdAt: r.period,
      source: "subscription",
      group: trip.name,
    });
  }

  return items;
}

// ---- Router ---------------------------------------------------------------------------

// Read tier: aggregation over the caller's own rows — generous but bounded.
const journalReadLimit = rateLimit(60, 60_000); // ~60 reads/min per IP

export const journalRouter = Router();

// Per-route requireAuth ONLY — this router is mounted path-lessly (see tabs.ts).

/**
 * GET /api/journal/:month — the caller's spending digest for one month.
 * `:month` must be strict yyyy-mm ("2026-07"); anything else is a 400.
 */
journalRouter.get("/api/journal/:month", journalReadLimit, requireAuth, async (req: Request, res: Response) => {
  const month = req.params.month;
  if (!isValidMonth(month)) {
    res.status(400).json({ error: "month must look like 2026-07" });
    return;
  }
  const meId = req.userId as string;
  const items = await collectItems(meId);
  const digest = computeDigest(items, month);
  const settledCount = await countSettledInMonth(meId, month);
  res.json({ ...digest, settledCount });
});
