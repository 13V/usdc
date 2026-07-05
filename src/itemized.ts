/**
 * itemized.ts — Pure, offline-testable "who had what" math for GROUP expenses.
 *
 * An itemized group expense assigns each receipt line to the members who had
 * it; everything left over (tip + tax + any unassigned line) is the "extras"
 * bucket, distributed PROPORTIONALLY to each member's item subtotal — someone
 * who ordered nothing pays none of the tip. Mirrors the standalone bill math
 * in public/screens/new.js (computeItemized) exactly, so both flows agree.
 *
 * GUARDRAIL: money is ALWAYS integer cents; shares sum EXACTLY to the total
 * (largest-remainder — no penny lost or created).
 *
 * Storage note: trips.ts's expense model has no native per-participant
 * amounts (ledger.computeBalances splits evenly), so exact shares are posted
 * as per-member single-participant expenses — the established pattern from
 * subscriptions.ts/household.ts — grouped by a shared splitId and merged back
 * into ONE logical expense at serialization (trips.mergeItemizedExpenses).
 */

import { distributeEven, distributeWeighted } from "./split";

// ---- Caps (validated server-side; the client mirrors them) ------------------

export const MAX_ITEMIZED_ITEMS = 50;
export const MAX_ITEMIZED_LABEL = 60;
/** Per-item cap, same ceiling as the ledger's $1M expense cap. */
export const MAX_ITEMIZED_ITEM_CENTS = 100_000_000;

export interface ItemizedItem {
  label: string;
  /** Display-only quantity (cents is the LINE total). */
  qty: number;
  cents: number;
  /** Members who had this item. Empty = unassigned → falls into extras. */
  memberIds: string[];
}

export type ItemizedValidation =
  | { ok: true; items: ItemizedItem[]; extrasCents: number }
  | { ok: false; error: string };

/**
 * Validate a client-supplied items payload against the trip's member set and
 * the expense total. Returns cleaned items (trimmed labels, deduped member
 * ids) or a human-readable error. Pure — no DB, no HTTP.
 */
export function validateItemized(
  rawItems: unknown,
  totalCents: number,
  memberIds: string[]
): ItemizedValidation {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    return { ok: false, error: "need a positive integer totalCents" };
  }
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, error: "need at least one item" };
  }
  if (rawItems.length > MAX_ITEMIZED_ITEMS) {
    return { ok: false, error: `too many items (max ${MAX_ITEMIZED_ITEMS})` };
  }
  const memberSet = new Set(memberIds);
  const items: ItemizedItem[] = [];
  let itemSum = 0;
  let anyAssigned = false;
  for (const raw of rawItems as any[]) {
    const label = String((raw && raw.label) || "").trim() || "item";
    if (label.length > MAX_ITEMIZED_LABEL) {
      return { ok: false, error: `item labels must be at most ${MAX_ITEMIZED_LABEL} characters` };
    }
    const cents = raw && raw.cents;
    if (!Number.isInteger(cents) || cents < 1 || cents > MAX_ITEMIZED_ITEM_CENTS) {
      return { ok: false, error: "each item needs integer cents between 1 and 100000000" };
    }
    let qty = Number(raw && raw.qty);
    if (!Number.isInteger(qty) || qty < 1) qty = 1;
    qty = Math.min(qty, 99);
    const rawIds = raw && raw.memberIds;
    const ids = Array.from(new Set(Array.isArray(rawIds) ? rawIds.map((x: unknown) => String(x)) : []));
    for (const id of ids) {
      if (!memberSet.has(id)) return { ok: false, error: `item assigned to a non-member (${id})` };
    }
    if (ids.length > 0) anyAssigned = true;
    itemSum += cents;
    items.push({ label, qty, cents, memberIds: ids });
  }
  const extrasCents = totalCents - itemSum;
  if (extrasCents < 0) {
    return { ok: false, error: "items add up past the total — tip & tax can't be negative" };
  }
  if (!anyAssigned) {
    return { ok: false, error: "assign at least one item to someone" };
  }
  return { ok: true, items, extrasCents };
}

/**
 * Compute exact per-member shares for an itemized expense.
 *
 * Each item's cents is split EVENLY among its assigned members
 * (largest-remainder). Extras (total − item sum, i.e. tip + tax + unassigned
 * lines) are distributed PROPORTIONALLY to each member's item subtotal —
 * members with no items are excluded from extras and owe 0.
 *
 * Invariant: the returned shares sum EXACTLY to totalCents.
 * Inputs are assumed validated (validateItemized).
 */
export function itemizedShares(
  totalCents: number,
  items: ItemizedItem[],
  memberIds: string[]
): Map<string, number> {
  const shares = new Map<string, number>();
  for (const id of memberIds) shares.set(id, 0);

  let assignedTotal = 0;
  for (const item of items) {
    const ids = item.memberIds.filter((id) => shares.has(id));
    if (ids.length === 0) continue; // unassigned → extras bucket
    const parts = distributeEven(item.cents, ids.length);
    ids.forEach((id, k) => {
      shares.set(id, (shares.get(id) as number) + parts[k]);
      assignedTotal += parts[k];
    });
  }

  const withItems = memberIds.filter((id) => (shares.get(id) as number) > 0);
  if (withItems.length === 0) {
    throw new Error("itemizedShares: no item is assigned to a member");
  }
  const extras = totalCents - assignedTotal;
  if (extras < 0) {
    throw new Error("itemizedShares: items exceed the total");
  }
  const alloc = distributeWeighted(extras, withItems.map((id) => shares.get(id) as number));
  withItems.forEach((id, i) => shares.set(id, (shares.get(id) as number) + alloc[i]));

  // Invariant: never lose or create a penny.
  let check = 0;
  for (const v of shares.values()) check += v;
  if (check !== totalCents) {
    throw new Error(`itemizedShares: internal error, ${check} !== ${totalCents}`);
  }
  return shares;
}

/**
 * Member-only write gate for itemizing: the caller must be signed in AND be
 * the trip owner or a claimed member. Keyless (ownerless) trips stay open to
 * any signed-in caller who already passed the share-token check, matching the
 * collaborative expense model. Pure — offline-testable.
 */
export function canItemize(input: {
  userId?: string | null;
  ownerUserId?: string | null;
  memberUserIds: string[];
}): boolean {
  const { userId, ownerUserId, memberUserIds } = input;
  if (!userId) return false;
  if (!ownerUserId) return true; // keyless/anonymous trip — open collaboration
  if (ownerUserId === userId) return true;
  return memberUserIds.includes(userId);
}
