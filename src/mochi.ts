/**
 * mochi.ts — "Ask Mochi": natural-language expense entry + queries over the
 * caller's OWN Divvy data, powered by Claude tool use.
 *
 * Provider pattern mirrors scan.ts exactly: the Anthropic API when
 * ANTHROPIC_API_KEY is set, and a graceful "mochi is napping 🐸💤" response
 * when it isn't — the app (and the tests) must work fully without the key.
 *
 * ARCHITECTURE — TOOL USE, never freeform writes. The model gets a small set
 * of server-side tools:
 *   READ tools (list_balances, list_tabs, list_subscriptions, list_trips,
 *   trip_summary, resolve_friend) execute here, against the same
 *   privacy-scoped queries the real routes use (listTripsForUser +
 *   read-only mirrors of the tabs/subscriptions/friendships tables — the
 *   nudges.ts/tabs.ts "derive without importing internals" pattern).
 *   WRITE tools (add_tab_entry, add_trip_expense) NEVER touch storage: they
 *   validate + resolve, then return a structured PENDING ACTION the client
 *   renders as a confirm card. Only an explicit Confirm tap calls the
 *   EXISTING real API route (POST /api/tabs/:id/entries,
 *   POST /api/trips/:id/expenses) with the user's own session — and that
 *   route re-validates everything again. Mochi proposes, the user disposes.
 *
 * GUARDRAIL: money stays integer cents. The model speaks decimal dollars; we
 * convert once with toCents() and enforce 1..MAX_AMOUNT_CENTS, same cap as
 * the routes the pending actions target.
 *
 * Mount (integrator):
 *   import { mochiRouter } from "./mochi";
 *   app.use(mochiRouter);
 */

import Anthropic from "@anthropic-ai/sdk";
import { Router, Request, Response } from "express";

import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { requireAuth } from "./auth";
import { rateLimit } from "./ratelimit";
import { listTripsForUser, Trip } from "./trips";
import { computeBalances, minimalSettlement } from "./ledger";
import { computeTabBalance, TabEntryLike } from "./tabs";
import { getUser, serializeUser } from "./users";
import { fmt, toCents, distributeWeighted } from "./split";

// ---- Config / limits ---------------------------------------------------------

const MODEL = "claude-opus-4-8"; // same provider + model as scan.ts

export const MAX_MESSAGE = 500; // input cap for the ask itself
const MAX_HISTORY = 12; // prior turns we replay for context
const MAX_HISTORY_TEXT = 1000;
const MAX_ROUNDS = 5; // hard cap on the tool loop
const MAX_ACTIONS = 3; // pending confirm cards per ask

export const MAX_AMOUNT_CENTS = 100000000; // mirror ious/tabs/trips routes
const MAX_NOTE = 140; // mirror tabs.ts MAX_NOTE
const MAX_TITLE = 140; // mirror server.ts MAX_EXPENSE_TITLE

export const NAPPING_TEXT =
  "mochi is napping 🐸💤 (no brain hooked up on this server) — but everything still works the classic way!";

/** Same check scan.ts does before constructing a client. */
export function mochiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** The whole degraded-mode response body (key absent). Client shows deep links. */
export function makeNappingResponse(): { napping: true; text: string; actions: [] } {
  return { napping: true, text: NAPPING_TEXT, actions: [] };
}

// ---- Input parsing (pure, tested in mochi.selftest.ts) ------------------------

export interface AskTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ParsedAsk {
  message: string;
  history: AskTurn[];
}

/**
 * Validate the POST /api/mochi body: a message (1..MAX_MESSAGE chars) plus an
 * optional short history of prior turns ({role:'user'|'mochi'|'assistant',
 * text}). Junk history entries are dropped, text is capped, and leading
 * assistant turns are trimmed so the replayed conversation starts with a user
 * message (API requirement).
 */
export function parseAskBody(body: unknown): ParsedAsk | { error: string } {
  const b = (body || {}) as Record<string, unknown>;
  if (typeof b.message !== "string") return { error: "message required" };
  const message = b.message.trim();
  if (!message) return { error: "message required" };
  if (message.length > MAX_MESSAGE) {
    return { error: `message must be at most ${MAX_MESSAGE} chars` };
  }

  const history: AskTurn[] = [];
  if (Array.isArray(b.history)) {
    for (const raw of b.history.slice(-MAX_HISTORY)) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as Record<string, unknown>;
      const role = e.role === "user" ? "user" : e.role === "mochi" || e.role === "assistant" ? "assistant" : null;
      if (!role || typeof e.text !== "string") continue;
      const text = e.text.trim().slice(0, MAX_HISTORY_TEXT);
      if (!text) continue;
      history.push({ role, text });
    }
  }
  // The first replayed turn must be a user turn.
  while (history.length && history[0].role !== "user") history.shift();
  return { message, history };
}

// ---- Fuzzy name matching (pure, tested) ---------------------------------------

export interface NameCandidate {
  id: string;
  name: string;
}

export interface NameMatch extends NameCandidate {
  score: number;
}

function norm(s: string): string {
  return String(s || "").trim().toLowerCase();
}

/**
 * Fuzzy-match a spoken name ("sam") against candidates ("Sam Smith").
 * Deterministic scoring: exact > whole-token > prefix > token-prefix >
 * substring. Returns matches sorted by score (desc), then name, score > 0.
 */
export function fuzzyMatch(query: string, candidates: NameCandidate[]): NameMatch[] {
  const q = norm(query);
  if (!q) return [];
  const out: NameMatch[] = [];
  for (const c of candidates) {
    const name = norm(c.name);
    if (!name) continue;
    const tokens = name.split(/\s+/);
    let score = 0;
    if (name === q) score = 100;
    else if (tokens.some((t) => t === q)) score = 80;
    else if (name.startsWith(q)) score = 70;
    else if (tokens.some((t) => t.startsWith(q))) score = 60;
    else if (name.includes(q)) score = 40;
    if (score > 0) out.push({ id: c.id, name: c.name, score });
  }
  out.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

// ---- Pending actions (pure builders, tested) -----------------------------------
// A pending action is Mochi's PROPOSAL: the exact call the client will make —
// against a real, already-hardened route — if (and only if) the user taps
// Confirm. Never executed server-side.

export interface PendingAction {
  kind: "add_tab_entry" | "add_trip_expense";
  /** Human line for the confirm card, e.g. `add $7.00 "coffee" — sam owes you`. */
  summary: string;
  method: "POST";
  path: string;
  body: Record<string, unknown>;
}

/** Ids are crypto.randomUUID()s — enforce the shape defensively (tabs.ts). */
function isSafeId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v);
}

function checkAmountCents(amountCents: number): void {
  if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > MAX_AMOUNT_CENTS) {
    throw new Error(`amount must be an integer between 1 and ${MAX_AMOUNT_CENTS} cents`);
  }
}

/** Build the confirm-card action for one tab entry (targets POST /api/tabs/:id/entries). */
export function buildTabEntryAction(
  friend: NameCandidate,
  direction: "they_owe" | "i_owe",
  amountCents: number,
  note?: string
): PendingAction {
  if (!isSafeId(friend.id)) throw new Error("invalid friend id");
  if (direction !== "they_owe" && direction !== "i_owe") {
    throw new Error('direction must be "they_owe" or "i_owe"');
  }
  checkAmountCents(amountCents);
  let cleanNote: string | undefined;
  if (note != null && String(note).trim()) {
    cleanNote = String(note).trim();
    if (cleanNote.length > MAX_NOTE) throw new Error(`note must be at most ${MAX_NOTE} chars`);
  }
  const what = fmt(amountCents) + (cleanNote ? ` "${cleanNote}"` : "");
  return {
    kind: "add_tab_entry",
    summary:
      direction === "they_owe"
        ? `add ${what} to your tab — ${friend.name} owes you`
        : `add ${what} to your tab — you owe ${friend.name}`,
    method: "POST",
    path: `/api/tabs/${encodeURIComponent(friend.id)}/entries`,
    body: { direction, amountCents, ...(cleanNote ? { note: cleanNote } : {}) },
  };
}

/** Build the confirm-card action for one trip expense (targets POST /api/trips/:id/expenses). */
export function buildTripExpenseAction(
  trip: NameCandidate,
  title: string,
  amountCents: number,
  paidByMemberId: string,
  participants: { id: string; name: string }[]
): PendingAction {
  if (!isSafeId(trip.id)) throw new Error("invalid trip id");
  checkAmountCents(amountCents);
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) throw new Error("title required");
  if (cleanTitle.length > MAX_TITLE) throw new Error(`title must be at most ${MAX_TITLE} chars`);
  if (!isSafeId(paidByMemberId)) throw new Error("invalid paidBy member id");
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new Error("need at least one participant");
  }
  for (const p of participants) {
    if (!p || !isSafeId(p.id)) throw new Error("invalid participant id");
  }
  const names = participants.map((p) => p.name).join(" + ");
  return {
    kind: "add_trip_expense",
    summary: `add ${fmt(amountCents)} "${cleanTitle}" to ${trip.name}, split with ${names}`,
    method: "POST",
    path: `/api/trips/${encodeURIComponent(trip.id)}/expenses`,
    body: {
      title: cleanTitle,
      amountCents,
      paidBy: paidByMemberId,
      participants: participants.map((p) => p.id),
    },
  };
}

/** Model speaks decimal dollars (scan.ts pattern) — convert ONCE, validate hard. */
export function dollarsToCents(v: unknown): number {
  let cents: number;
  try {
    cents = typeof v === "number" || typeof v === "string" ? toCents(v) : NaN;
  } catch {
    cents = NaN;
  }
  checkAmountCents(cents);
  return cents;
}

// ---- Read-only data mirrors (privacy-scoped to the caller) ---------------------

interface TabEntryRowLite extends TabEntryLike {
  friend_user_id: string;
}

/** ALL tab entries involving `meId` (read-only mirror of tabs.listMyEntries). */
async function listMyTabEntries(meId: string): Promise<TabEntryRowLite[]> {
  if (!isSafeId(meId)) return [];
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("tab_entries")
      .select("created_by, friend_user_id, direction, amount_cents, status")
      .or(`created_by.eq.${meId},friend_user_id.eq.${meId}`);
    if (error) throw new Error(`mochi.listMyTabEntries: ${error.message}`);
    return (data as TabEntryRowLite[]) ?? [];
  }
  return db
    .prepare(
      `SELECT created_by, friend_user_id, direction, amount_cents, status
       FROM tab_entries WHERE created_by = ? OR friend_user_id = ?`
    )
    .all(meId, meId) as TabEntryRowLite[];
}

/** Mutual friend ids of `meId` (read-only mirror of friends.ts edges). */
async function mutualFriendIds(meId: string): Promise<string[]> {
  if (usingSupabase) {
    const [{ data: out, error: e1 }, { data: inc, error: e2 }] = await Promise.all([
      supabase().from("friendships").select("friend_user_id").eq("user_id", meId),
      supabase().from("friendships").select("user_id").eq("friend_user_id", meId),
    ]);
    if (e1) throw new Error(`mochi.mutualFriendIds: ${e1.message}`);
    if (e2) throw new Error(`mochi.mutualFriendIds: ${e2.message}`);
    const incSet = new Set((inc || []).map((r: { user_id: string }) => r.user_id));
    return (out || [])
      .map((r: { friend_user_id: string }) => r.friend_user_id)
      .filter((id: string) => incSet.has(id));
  }
  const out = (db.prepare("SELECT friend_user_id FROM friendships WHERE user_id = ?").all(meId) as {
    friend_user_id: string;
  }[]).map((r) => r.friend_user_id);
  const incSet = new Set(
    (db.prepare("SELECT user_id FROM friendships WHERE friend_user_id = ?").all(meId) as {
      user_id: string;
    }[]).map((r) => r.user_id)
  );
  return out.filter((id) => incSet.has(id));
}

/** Friends as {id, name} for fuzzy matching (name = displayName || handle). */
async function friendCandidates(meId: string): Promise<NameCandidate[]> {
  const ids = (await mutualFriendIds(meId)).slice(0, 100);
  const out: NameCandidate[] = [];
  for (const id of ids) {
    const u = await getUser(id);
    if (!u) continue;
    const su = await serializeUser(u);
    out.push({ id, name: su.displayName || su.handle || "friend" });
  }
  return out;
}

interface SubRowLite {
  id: string;
  owner_user_id: string;
  trip_id: string;
  name: string;
  icon: string | null;
  amount_cents: number;
  interval: string;
  next_renewal: string;
  members: unknown;
  shares: unknown;
}

/** Active subscriptions visible to the viewer (mirror of listActiveForViewer). */
async function listMySubscriptions(meId: string, tripIds: string[]): Promise<SubRowLite[]> {
  if (usingSupabase) {
    const byId = new Map<string, SubRowLite>();
    const { data: own, error } = await supabase()
      .from("subscriptions")
      .select("id, owner_user_id, trip_id, name, icon, amount_cents, interval, next_renewal, members, shares")
      .eq("active", 1)
      .eq("owner_user_id", meId);
    if (error) throw new Error(`mochi.listMySubscriptions: ${error.message}`);
    for (const r of (own as SubRowLite[]) ?? []) byId.set(r.id, r);
    if (tripIds.length) {
      const { data: shared, error: e2 } = await supabase()
        .from("subscriptions")
        .select("id, owner_user_id, trip_id, name, icon, amount_cents, interval, next_renewal, members, shares")
        .eq("active", 1)
        .in("trip_id", tripIds);
      if (e2) throw new Error(`mochi.listMySubscriptions: ${e2.message}`);
      for (const r of (shared as SubRowLite[]) ?? []) byId.set(r.id, r);
    }
    return Array.from(byId.values());
  }
  const placeholders = tripIds.map(() => "?").join(", ");
  const rows = (
    tripIds.length
      ? db
          .prepare(
            `SELECT id, owner_user_id, trip_id, name, icon, amount_cents, interval, next_renewal, members, shares
             FROM subscriptions WHERE active = 1 AND (owner_user_id = ? OR trip_id IN (${placeholders}))`
          )
          .all(meId, ...tripIds)
      : db
          .prepare(
            `SELECT id, owner_user_id, trip_id, name, icon, amount_cents, interval, next_renewal, members, shares
             FROM subscriptions WHERE active = 1 AND owner_user_id = ?`
          )
          .all(meId)
  ) as SubRowLite[];
  return rows;
}

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

// ---- Read-tool data assembly ----------------------------------------------------

function tripNet(trip: Trip, meId: string): number {
  const me = trip.members.find((m) => m.userId === meId);
  if (!me) return 0;
  const balances = computeBalances(
    trip.members.map((m) => m.id),
    trip.expenses.map((e) => ({ amountCents: e.amountCents, paidBy: e.paidBy, participants: e.participants }))
  );
  const mine = balances.find((b) => b.memberId === me.id);
  return mine ? mine.cents : 0;
}

/** Cross-trip totals + per-person exposure (compact mirror of GET /api/me/balances). */
async function readBalances(meId: string): Promise<Record<string, unknown>> {
  const trips = await listTripsForUser(meId);
  let owedCents = 0;
  let owesCents = 0;
  const people = new Map<string, { name: string; cents: number }>();
  const tripNets: { name: string; netCents: number }[] = [];

  for (const trip of trips) {
    if (trip.archived) continue;
    const me = trip.members.find((m) => m.userId === meId);
    const balances = computeBalances(
      trip.members.map((m) => m.id),
      trip.expenses.map((e) => ({ amountCents: e.amountCents, paidBy: e.paidBy, participants: e.participants }))
    );
    const net = me ? balances.find((b) => b.memberId === me.id)?.cents || 0 : 0;
    if (net > 0) owedCents += net;
    else if (net < 0) owesCents += -net;
    if (net !== 0) tripNets.push({ name: trip.name, netCents: net });
    if (!me) continue;
    const byId = new Map(trip.members.map((m) => [m.id, m]));
    for (const t of minimalSettlement(balances)) {
      let otherId: string | null = null;
      let sign = 0;
      if (t.from === me.id) {
        otherId = t.to;
        sign = -t.amountCents;
      } else if (t.to === me.id) {
        otherId = t.from;
        sign = t.amountCents;
      } else continue;
      const other = byId.get(otherId);
      if (!other) continue;
      const key = other.userId ? `uid:${other.userId}` : `local:${other.name}@${trip.id}`;
      const acc = people.get(key);
      if (acc) acc.cents += sign;
      else people.set(key, { name: other.name, cents: sign });
    }
  }

  // Tabs count toward "who owes me the most" too — merge tab balances in.
  const tabEntries = await listMyTabEntries(meId);
  const byFriend = new Map<string, TabEntryLike[]>();
  for (const e of tabEntries) {
    const otherId = e.created_by === meId ? e.friend_user_id : e.created_by;
    const list = byFriend.get(otherId) || [];
    list.push(e);
    byFriend.set(otherId, list);
  }
  for (const [friendId, list] of byFriend) {
    const bal = computeTabBalance(list, meId);
    if (bal === 0) continue;
    if (bal > 0) owedCents += bal;
    else owesCents += -bal;
    const u = await getUser(friendId);
    const su = u ? await serializeUser(u) : null;
    const name = (su && (su.displayName || su.handle)) || "friend";
    const key = `uid:${friendId}`;
    const acc = people.get(key);
    if (acc) acc.cents += bal;
    else people.set(key, { name, cents: bal });
  }

  const peopleList = Array.from(people.values())
    .filter((p) => p.cents !== 0)
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))
    .slice(0, 20)
    .map((p) => ({ name: p.name, cents: p.cents, note: p.cents > 0 ? "owes you" : "you owe them" }));

  return {
    totals: { owedToYouCents: owedCents, youOweCents: owesCents, netCents: owedCents - owesCents },
    people: peopleList,
    groups: tripNets.slice(0, 20),
  };
}

/** One row per friend tab, net from the caller's perspective. */
async function readTabs(meId: string): Promise<Record<string, unknown>> {
  const entries = await listMyTabEntries(meId);
  const byFriend = new Map<string, TabEntryLike[]>();
  for (const e of entries) {
    const otherId = e.created_by === meId ? e.friend_user_id : e.created_by;
    const list = byFriend.get(otherId) || [];
    list.push(e);
    byFriend.set(otherId, list);
  }
  const tabs = [];
  for (const [friendId, list] of Array.from(byFriend.entries()).slice(0, 25)) {
    const u = await getUser(friendId);
    if (!u) continue;
    const su = await serializeUser(u);
    const bal = computeTabBalance(list, meId);
    tabs.push({
      friend: su.displayName || su.handle || "friend",
      friendId,
      balanceCents: bal,
      note: bal > 0 ? "they owe you" : bal < 0 ? "you owe them" : "square",
      openEntries: list.filter((e) => e.status === "open").length,
    });
  }
  return { tabs };
}

/** Subscriptions + what they cost (mirror of GET /api/subscriptions totals). */
async function readSubscriptions(meId: string): Promise<Record<string, unknown>> {
  const trips = await listTripsForUser(meId);
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const rows = await listMySubscriptions(meId, trips.map((t) => t.id));

  let monthlyCents = 0;
  let yourMonthlyCents = 0;
  const subs = [];
  for (const row of rows.slice(0, 30)) {
    const monthly = row.interval === "yearly" ? Math.round(row.amount_cents / 12) : row.amount_cents;
    monthlyCents += monthly;
    const trip = tripById.get(row.trip_id);
    let yourShareCents: number | null = null;
    if (trip) {
      const tripMemberIds = new Set(trip.members.map((m) => m.id));
      const memberIds = jsonVal<string[]>(row.members, []).filter((id) => tripMemberIds.has(id));
      const shares = jsonVal<Record<string, number>>(row.shares, {});
      if (memberIds.length) {
        const weights = memberIds.map((id) => {
          const w = shares[id];
          return Number.isInteger(w) && w > 0 ? w : 1;
        });
        const parts = distributeWeighted(row.amount_cents, weights);
        const mine = trip.members.find((m) => m.userId === meId);
        const idx = mine ? memberIds.indexOf(mine.id) : -1;
        if (idx >= 0) {
          yourShareCents = parts[idx];
          yourMonthlyCents += row.interval === "yearly" ? Math.round(parts[idx] / 12) : parts[idx];
        }
      }
    }
    subs.push({
      name: `${row.icon ? row.icon + " " : ""}${row.name}`,
      amountCents: row.amount_cents,
      interval: row.interval,
      monthlyCents: monthly,
      yourShareCents,
      nextRenewal: row.next_renewal,
      group: trip ? trip.name : null,
    });
  }
  return { subscriptions: subs, totals: { monthlyCents, yourMonthlyCents } };
}

/** All the caller's groups/trips, with their net position in each. */
async function readTrips(meId: string): Promise<Record<string, unknown>> {
  const trips = await listTripsForUser(meId);
  return {
    trips: trips
      .filter((t) => !t.archived)
      .slice(0, 30)
      .map((t) => ({
        id: t.id,
        name: t.name,
        members: t.members.length,
        expenses: t.expenses.length,
        totalSpentCents: t.expenses.reduce((a, e) => a + e.amountCents, 0),
        yourNetCents: tripNet(t, meId),
      })),
  };
}

/** Resolve a trip by id or fuzzy name among the CALLER's trips only. */
async function resolveTrip(
  meId: string,
  query: string
): Promise<{ trip: Trip } | { error: string; candidates?: string[] }> {
  const trips = await listTripsForUser(meId);
  const q = String(query || "").trim().slice(0, 120);
  const byId = trips.find((t) => t.id === q);
  if (byId) return { trip: byId };
  const matches = fuzzyMatch(q, trips.map((t) => ({ id: t.id, name: t.name })));
  if (!matches.length) {
    return { error: `no group matching "${q}"`, candidates: trips.slice(0, 10).map((t) => t.name) };
  }
  if (matches.length > 1 && matches[0].score === matches[1].score) {
    return { error: `"${q}" is ambiguous`, candidates: matches.slice(0, 5).map((m) => m.name) };
  }
  const trip = trips.find((t) => t.id === matches[0].id) as Trip;
  return { trip };
}

/** Full picture of one trip: members, totals, your net + your share, recent expenses. */
async function readTripSummary(meId: string, query: string): Promise<Record<string, unknown>> {
  const resolved = await resolveTrip(meId, query);
  if ("error" in resolved) return resolved;
  const trip = resolved.trip;
  const me = trip.members.find((m) => m.userId === meId);
  let yourShareCents = 0;
  for (const e of trip.expenses) {
    if (!me) break;
    const idx = e.participants.indexOf(me.id);
    if (idx < 0) continue;
    const parts = distributeWeighted(e.amountCents, e.participants.map(() => 1));
    yourShareCents += parts[idx];
  }
  const memberName = new Map(trip.members.map((m) => [m.id, m.name]));
  return {
    id: trip.id,
    name: trip.name,
    members: trip.members.map((m) => m.name),
    totalSpentCents: trip.expenses.reduce((a, e) => a + e.amountCents, 0),
    yourShareCents: me ? yourShareCents : null,
    yourNetCents: tripNet(trip, meId),
    recentExpenses: trip.expenses
      .slice(-10)
      .reverse()
      .map((e) => ({
        title: e.title,
        amountCents: e.amountCents,
        paidBy: memberName.get(e.paidBy) || "?",
        at: e.createdAt,
      })),
  };
}

// ---- Tool definitions ------------------------------------------------------------

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_balances",
    description:
      "The user's money overview: totals owed to them / they owe, per-person exposure (largest first, across groups AND friend tabs), and per-group nets. Use for 'who owes me', 'how much do I owe', 'am I square'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_tabs",
    description:
      "The user's running 1:1 friend tabs with net balances (positive = the friend owes them). Use for tab questions and before add_tab_entry when unsure of the friend.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_subscriptions",
    description:
      "The user's shared subscriptions (netflix & co) with amounts, renewal dates, monthly totals and the user's own share. Use for 'what do my subscriptions cost'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_trips",
    description: "The user's groups/trips with member counts, total spent, and the user's net in each.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "trip_summary",
    description:
      "Detail for ONE group/trip (by name or id): members, total spent, the user's own share of the spending, their net, and recent expenses. Use for 'how much did the tokyo trip cost me'.",
    input_schema: {
      type: "object",
      properties: { trip: { type: "string", description: "group/trip name or id" } },
      required: ["trip"],
    },
  },
  {
    name: "resolve_friend",
    description: "Fuzzy-match a name like 'sam' against the user's friends. Returns candidates with ids.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "the name to match" } },
      required: ["name"],
    },
  },
  {
    name: "add_tab_entry",
    description:
      "PROPOSE adding one entry to a 1:1 friend tab. Nothing is saved — the user gets a confirm card. amount is decimal dollars and is what ONE side owes the other (if the user paid $40 for two people split evenly, the friend owes 20.00). direction 'they_owe' = the friend owes the user.",
    input_schema: {
      type: "object",
      properties: {
        friend: { type: "string", description: "friend's name (fuzzy-matched)" },
        direction: { type: "string", enum: ["they_owe", "i_owe"] },
        amount: { type: "number", description: "decimal dollars, e.g. 12.50" },
        note: { type: "string", description: "short note, e.g. 'sushi' (optional)" },
      },
      required: ["friend", "direction", "amount"],
    },
  },
  {
    name: "add_trip_expense",
    description:
      "PROPOSE adding an expense to a group/trip. Nothing is saved — the user gets a confirm card. amount is the FULL decimal-dollar amount paid; it gets split evenly across the participants. participants/paid_by are member names ('me' = the user); omit participants to split with everyone.",
    input_schema: {
      type: "object",
      properties: {
        trip: { type: "string", description: "group/trip name or id" },
        title: { type: "string", description: "what it was, e.g. 'sushi'" },
        amount: { type: "number", description: "full decimal-dollar amount, e.g. 40" },
        participants: { type: "array", items: { type: "string" }, description: "member names splitting it (optional)" },
        paid_by: { type: "string", description: "member name who paid (optional, default: the user)" },
      },
      required: ["trip", "title", "amount"],
    },
  },
];

// ---- Tool execution ----------------------------------------------------------------

interface ToolOutcome {
  /** JSON payload handed back to the model as the tool_result. */
  result: Record<string, unknown>;
  /** Set only by write tools: the confirm card for the client. */
  pending?: PendingAction;
}

async function execAddTabEntry(meId: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  const nameQ = String(input.friend || "").slice(0, 64);
  const direction = input.direction === "i_owe" ? "i_owe" : input.direction === "they_owe" ? "they_owe" : null;
  if (!direction) return { result: { error: 'direction must be "they_owe" or "i_owe"' } };
  let amountCents: number;
  try {
    amountCents = dollarsToCents(input.amount);
  } catch (e) {
    return { result: { error: (e as Error).message } };
  }
  const friends = await friendCandidates(meId);
  const matches = fuzzyMatch(nameQ, friends);
  if (!matches.length) {
    return {
      result: {
        error: `no friend matching "${nameQ}"`,
        friends: friends.slice(0, 10).map((f) => f.name),
        hint: "tabs need a mutual friend — they can add each other on the friends screen",
      },
    };
  }
  if (matches.length > 1 && matches[0].score === matches[1].score) {
    return { result: { error: `"${nameQ}" is ambiguous — ask the user which one`, candidates: matches.slice(0, 5).map((m) => m.name) } };
  }
  try {
    const pending = buildTabEntryAction(matches[0], direction, amountCents, input.note != null ? String(input.note).slice(0, MAX_NOTE) : undefined);
    return { result: { status: "pending_confirmation", summary: pending.summary }, pending };
  } catch (e) {
    return { result: { error: (e as Error).message } };
  }
}

async function execAddTripExpense(meId: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  const resolved = await resolveTrip(meId, String(input.trip || ""));
  if ("error" in resolved) return { result: resolved as unknown as Record<string, unknown> };
  const trip = resolved.trip;
  let amountCents: number;
  try {
    amountCents = dollarsToCents(input.amount);
  } catch (e) {
    return { result: { error: (e as Error).message } };
  }

  const members = trip.members.map((m) => ({ id: m.id, name: m.name }));
  const mine = trip.members.find((m) => m.userId === meId);

  function resolveMember(nameQ: string): { id: string; name: string } | { error: string } {
    const q = String(nameQ || "").trim().slice(0, 80);
    if (mine && /^(me|i|myself)$/i.test(q)) return { id: mine.id, name: mine.name };
    const ms = fuzzyMatch(q, members);
    if (!ms.length) return { error: `no member matching "${q}" in ${trip.name} (members: ${members.map((m) => m.name).join(", ")})` };
    if (ms.length > 1 && ms[0].score === ms[1].score) {
      return { error: `"${q}" is ambiguous in ${trip.name} — ask the user which member` };
    }
    return { id: ms[0].id, name: ms[0].name };
  }

  // paid_by: default = the caller's claimed member slot.
  let paidBy: { id: string; name: string };
  if (input.paid_by != null && String(input.paid_by).trim()) {
    const r = resolveMember(String(input.paid_by));
    if ("error" in r) return { result: r };
    paidBy = r;
  } else if (mine) {
    paidBy = { id: mine.id, name: mine.name };
  } else {
    return {
      result: {
        error: `the user hasn't claimed a member slot in ${trip.name} — ask which member paid`,
        members: members.map((m) => m.name),
      },
    };
  }

  // participants: named members (+ always includes the user when they said "with X"),
  // default = everyone in the trip.
  let participants: { id: string; name: string }[];
  if (Array.isArray(input.participants) && input.participants.length) {
    const seen = new Set<string>();
    participants = [];
    for (const raw of input.participants.slice(0, 24)) {
      const r = resolveMember(String(raw));
      if ("error" in r) return { result: r };
      if (!seen.has(r.id)) {
        seen.add(r.id);
        participants.push(r);
      }
    }
    // "split $40 with sam and alex" includes the speaker unless they said otherwise.
    if (mine && !seen.has(mine.id)) participants.unshift({ id: mine.id, name: mine.name });
  } else {
    participants = members;
  }

  try {
    const pending = buildTripExpenseAction(
      { id: trip.id, name: trip.name },
      String(input.title || "").slice(0, MAX_TITLE),
      amountCents,
      paidBy.id,
      participants
    );
    return { result: { status: "pending_confirmation", summary: pending.summary }, pending };
  } catch (e) {
    return { result: { error: (e as Error).message } };
  }
}

async function execTool(meId: string, name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  switch (name) {
    case "list_balances":
      return { result: await readBalances(meId) };
    case "list_tabs":
      return { result: await readTabs(meId) };
    case "list_subscriptions":
      return { result: await readSubscriptions(meId) };
    case "list_trips":
      return { result: await readTrips(meId) };
    case "trip_summary":
      return { result: await readTripSummary(meId, String(input.trip || "")) };
    case "resolve_friend": {
      const friends = await friendCandidates(meId);
      const matches = fuzzyMatch(String(input.name || "").slice(0, 64), friends);
      return { result: { matches: matches.slice(0, 5) } };
    }
    case "add_tab_entry":
      return execAddTabEntry(meId, input);
    case "add_trip_expense":
      return execAddTripExpense(meId, input);
    default:
      return { result: { error: `unknown tool ${name}` } };
  }
}

// ---- The ask loop -------------------------------------------------------------------

const SYSTEM = `You are Mochi, Divvy's little frog mascot. Divvy is a bill-splitting app (groups/trips, 1:1 friend tabs, shared subscriptions, settle up in USDC).

Voice: warm, lowercase, brief — one or two short sentences, like a friend texting. At most one frog touch (🐸 / "ribbit") per reply, often none.

Rules:
- Use the tools for ANY question about the user's balances, tabs, groups, subscriptions or friends. Never invent numbers or names. Tool amounts are integer cents — always write them back as dollars (1250 → $12.50).
- To log money, call add_tab_entry (1:1 with a friend) or add_trip_expense (in a group). These only QUEUE a confirm card — nothing is saved until the user taps confirm, so after a successful call, briefly tell them to check the card. Never claim something was added.
- "add $X with <one friend>" and no group mentioned → a tab entry for the friend's share. A named group or several people → a trip expense.
- If a tool says a name is ambiguous or missing, ask the user a short follow-up instead of guessing.
- Off-topic questions: answer in one friendly sentence and nudge back to bills.`;

async function runAsk(meId: string, parsed: ParsedAsk): Promise<{ text: string; actions: PendingAction[] }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const messages: Anthropic.MessageParam[] = [
    ...parsed.history.map((h) => ({ role: h.role, content: h.text })),
    { role: "user" as const, content: parsed.message },
  ];

  const actions: PendingAction[] = [];
  let text = "";

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });

    const textBlocks = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    if (textBlocks.length) text = textBlocks.map((b) => b.text).join("\n").trim();

    const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (msg.stop_reason !== "tool_use" || !toolUses.length) break;

    // Replay the assistant turn (text + tool_use blocks) then answer each tool.
    messages.push({
      role: "assistant",
      content: msg.content.map((b) =>
        b.type === "tool_use"
          ? { type: "tool_use" as const, id: b.id, name: b.name, input: b.input }
          : { type: "text" as const, text: b.type === "text" ? b.text : "" }
      ),
    });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      let outcome: ToolOutcome;
      try {
        outcome = await execTool(meId, tu.name, (tu.input || {}) as Record<string, unknown>);
      } catch (e) {
        outcome = { result: { error: `tool failed: ${(e as Error).message}` } };
      }
      if (outcome.pending) {
        if (actions.length < MAX_ACTIONS) actions.push(outcome.pending);
        else outcome.result = { error: "too many pending actions for one ask — tell the user to confirm the cards first" };
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(outcome.result) });
    }
    messages.push({ role: "user", content: results });
  }

  if (!text) text = "ribbit — that one hopped away from me 🐸 try asking a smaller question?";
  return { text, actions };
}

// ---- Router --------------------------------------------------------------------------

// Scan-tier rate limit (the endpoint burns model tokens per call).
const mochiRateLimit = rateLimit(10, 60_000); // ~10 asks/min per IP

export const mochiRouter = Router();

// Per-route requireAuth ONLY — this router is mounted path-lessly (see tabs.ts).

mochiRouter.post("/api/mochi", mochiRateLimit, requireAuth, async (req: Request, res: Response) => {
  const parsed = parseAskBody(req.body);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  // No key configured: friendly degraded mode (scan.ts's NoScanProvider path).
  if (!mochiConfigured()) {
    res.json(makeNappingResponse());
    return;
  }

  try {
    const out = await runAsk(req.userId as string, parsed);
    res.json({ text: out.text, actions: out.actions });
  } catch (err) {
    res.status(502).json({ error: `mochi couldn't think: ${(err as Error).message}` });
  }
});
