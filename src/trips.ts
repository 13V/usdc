/**
 * trips.ts — Shared multi-payer trip ledger: model + SQLite CRUD + settlement
 * persistence.
 *
 * A Trip has members and expenses. Anyone with the share link can add expenses.
 * Balances are derived on read (see ledger.ts); settlements are persisted so a
 * generated Solana Pay link / reference survives across reads and verify calls.
 *
 * GUARDRAIL: money is ALWAYS integer cents.
 */

import * as crypto from "crypto";
import { db } from "./db";
import { Cluster } from "./solanaPay";
import { Transfer } from "./ledger";

// ---- Types ----------------------------------------------------------------

export interface TripMember {
  id: string;
  name: string;
  wallet?: string;
  userId?: string;
  emoji?: string;
  color?: string;
}

// Deterministic emoji + color identity for a member who hasn't set their own,
// seeded from a stable string (member id or name) so it never changes.
const MEMBER_EMOJI = ["🦊", "🐸", "🐱", "🐼", "🐯", "🐨", "🦜", "🐢", "🌸", "🦁", "🐵", "🦝"];
const MEMBER_COLOR = ["#2775CA", "#3DE8C7", "#FF6B5E", "#FFC65C", "#8B5CF6", "#3a8fe0"];
function seededIdentity(seed: string): { emoji: string; color: string } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return { emoji: MEMBER_EMOJI[h % MEMBER_EMOJI.length], color: MEMBER_COLOR[h % MEMBER_COLOR.length] };
}

export interface TripExpense {
  id: string;
  title: string;
  amountCents: number;
  paidBy: string;
  participants: string[];
  fx?: any;
  createdAt: string;
}

export interface Trip {
  id: string;
  name: string;
  shareToken: string;
  cluster: Cluster;
  createdAt: string;
  members: TripMember[];
  expenses: TripExpense[];
  ownerUserId?: string;
}

/** A persisted settlement transfer (Transfer + payment-request fields). */
export interface SettlementTransfer extends Transfer {
  reference?: string | null;
  url?: string | null;
  paid?: boolean;
}

export interface StoredSettlement {
  tripId: string;
  signature: string;
  transfers: SettlementTransfer[];
  createdAt: string;
}

// ---- Schema ----------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    share_token TEXT NOT NULL UNIQUE,
    cluster TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trip_members (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL,
    name TEXT NOT NULL,
    wallet TEXT
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL,
    title TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    paid_by TEXT NOT NULL,
    participants TEXT NOT NULL,
    fx TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settlements (
    trip_id TEXT PRIMARY KEY,
    signature TEXT NOT NULL,
    transfers TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// ---- Idempotent identity migrations ---------------------------------------
// Progressive identity is ADDITIVE: existing trips simply have NULL here.

function hasColumn(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

if (!hasColumn("trip_members", "user_id")) {
  db.exec("ALTER TABLE trip_members ADD COLUMN user_id TEXT");
}
if (!hasColumn("trips", "owner_user_id")) {
  db.exec("ALTER TABLE trips ADD COLUMN owner_user_id TEXT");
}
// Soft-delete: expenses are marked voided instead of hard-deleted, so the row
// survives for audit but is excluded from balances/serialization.
if (!hasColumn("expenses", "voided")) {
  db.exec("ALTER TABLE expenses ADD COLUMN voided INTEGER NOT NULL DEFAULT 0");
}
// Emoji + color avatar identity per member (additive; NULL → deterministic).
if (!hasColumn("trip_members", "emoji")) db.exec("ALTER TABLE trip_members ADD COLUMN emoji TEXT");
if (!hasColumn("trip_members", "color")) db.exec("ALTER TABLE trip_members ADD COLUMN color TEXT");

// ---- Row hydration ---------------------------------------------------------

function hydrateMember(row: any): TripMember {
  const seeded = seededIdentity(row.id || row.name || "");
  return {
    id: row.id,
    name: row.name,
    wallet: row.wallet ?? undefined,
    userId: row.user_id ?? undefined,
    emoji: row.emoji ?? seeded.emoji,
    color: row.color ?? seeded.color,
  };
}

function hydrateExpense(row: any): TripExpense {
  return {
    id: row.id,
    title: row.title,
    amountCents: row.amount_cents,
    paidBy: row.paid_by,
    participants: JSON.parse(row.participants),
    fx: row.fx ? JSON.parse(row.fx) : undefined,
    createdAt: row.created_at,
  };
}

function hydrateTrip(row: any): Trip {
  const members = db
    .prepare("SELECT * FROM trip_members WHERE trip_id = ? ORDER BY rowid ASC")
    .all(row.id)
    .map(hydrateMember);
  const expenses = db
    .prepare(
      "SELECT * FROM expenses WHERE trip_id = ? AND COALESCE(voided, 0) = 0 ORDER BY created_at ASC, rowid ASC"
    )
    .all(row.id)
    .map(hydrateExpense);
  return {
    id: row.id,
    name: row.name,
    shareToken: row.share_token,
    cluster: row.cluster as Cluster,
    createdAt: row.created_at,
    members,
    expenses,
    ownerUserId: row.owner_user_id ?? undefined,
  };
}

// ---- CRUD ------------------------------------------------------------------

export function createTrip(
  name: string,
  cluster: Cluster,
  members: { name: string; wallet?: string; userId?: string }[],
  ownerUserId?: string
): Trip {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new Error("createTrip: need a name");
  const cleanMembers = (members || [])
    .map((m) => ({ name: String(m.name || "").trim(), wallet: m.wallet, userId: m.userId }))
    .filter((m) => m.name);
  if (cleanMembers.length < 1) throw new Error("createTrip: need at least one member");

  const id = crypto.randomUUID();
  const shareToken = crypto.randomBytes(8).toString("hex");
  const createdAt = new Date().toISOString();

  const insertTrip = db.prepare(
    "INSERT INTO trips (id, name, share_token, cluster, created_at, owner_user_id) VALUES (?, ?, ?, ?, ?, ?)"
  );
  // Members may link to an existing Divvy account (user_id) — e.g. a group
  // started from your friends — so the group shows up in each friend's trips
  // and settle-up routes to their wallet.
  const insertMember = db.prepare(
    "INSERT INTO trip_members (id, trip_id, name, wallet, user_id) VALUES (?, ?, ?, ?, ?)"
  );

  const tx = db.transaction(() => {
    insertTrip.run(id, trimmedName, shareToken, cluster, createdAt, ownerUserId ?? null);
    for (const m of cleanMembers) {
      insertMember.run(crypto.randomUUID(), id, m.name, m.wallet ?? null, m.userId ?? null);
    }
  });
  tx();

  return getTrip(id) as Trip;
}

/**
 * Claim an existing member slot for a signed-in user, routing settle-up to their
 * wallet. Sets that member's user_id and wallet. Throws if the member is absent.
 *
 * SECURITY: a slot already claimed by a DIFFERENT user may not be re-claimed —
 * otherwise any share-link holder could overwrite a creditor's wallet and
 * redirect their payout. Re-claiming your own slot (e.g. to refresh the wallet)
 * is allowed.
 */
export function claimMember(
  tripId: string,
  memberId: string,
  userId: string,
  wallet: string
): Trip {
  const trip = getTrip(tripId);
  if (!trip) throw new Error("claimMember: trip not found");
  const member = trip.members.find((m) => m.id === memberId);
  if (!member) throw new Error("claimMember: member not found");
  if (member.userId && member.userId !== userId) {
    throw new Error("claimMember: this member is already claimed");
  }
  db.prepare(
    "UPDATE trip_members SET user_id = ?, wallet = ? WHERE id = ? AND trip_id = ?"
  ).run(userId, wallet, memberId, tripId);
  return getTrip(tripId) as Trip;
}

/** Trips a user owns OR has claimed a member slot in, most recent first. */
export function listTripsForUser(userId: string): Trip[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT t.* FROM trips t
       LEFT JOIN trip_members m ON m.trip_id = t.id
       WHERE t.owner_user_id = ? OR m.user_id = ?
       ORDER BY t.created_at DESC, t.rowid DESC`
    )
    .all(userId, userId);
  return rows.map(hydrateTrip);
}

export function listTrips(): Trip[] {
  return db
    .prepare("SELECT * FROM trips ORDER BY created_at DESC, rowid DESC")
    .all()
    .map(hydrateTrip);
}

export function getTrip(id: string): Trip | undefined {
  const row = db.prepare("SELECT * FROM trips WHERE id = ?").get(id);
  return row ? hydrateTrip(row) : undefined;
}

export function getTripByToken(token: string): Trip | undefined {
  const row = db.prepare("SELECT * FROM trips WHERE share_token = ?").get(token);
  return row ? hydrateTrip(row) : undefined;
}

export function getTripByIdOrToken(x: string): Trip | undefined {
  return getTrip(x) || getTripByToken(x);
}

export function addMember(
  tripId: string,
  member: { name: string; wallet?: string }
): Trip {
  const trip = getTrip(tripId);
  if (!trip) throw new Error("addMember: trip not found");
  const name = String(member.name || "").trim();
  if (!name) throw new Error("addMember: need a name");
  db.prepare("INSERT INTO trip_members (id, trip_id, name, wallet) VALUES (?, ?, ?, ?)").run(
    crypto.randomUUID(),
    tripId,
    name,
    member.wallet ?? null
  );
  return getTrip(tripId) as Trip;
}

export function updateMember(
  tripId: string,
  memberId: string,
  patch: { name?: string; wallet?: string }
): Trip {
  const trip = getTrip(tripId);
  if (!trip) throw new Error("updateMember: trip not found");
  const member = trip.members.find((m) => m.id === memberId);
  if (!member) throw new Error("updateMember: member not found");

  const name =
    patch.name !== undefined ? String(patch.name).trim() || member.name : member.name;
  const wallet =
    patch.wallet !== undefined ? (patch.wallet ? String(patch.wallet) : null) : member.wallet ?? null;

  db.prepare("UPDATE trip_members SET name = ?, wallet = ? WHERE id = ? AND trip_id = ?").run(
    name,
    wallet,
    memberId,
    tripId
  );
  return getTrip(tripId) as Trip;
}

export function addExpense(
  tripId: string,
  expense: {
    title: string;
    amountCents: number;
    paidBy: string;
    participants: string[];
    fx?: any;
  }
): Trip {
  const trip = getTrip(tripId);
  if (!trip) throw new Error("addExpense: trip not found");

  const title = String(expense.title || "").trim() || "Expense";
  const amountCents = expense.amountCents;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("addExpense: amountCents must be a positive integer");
  }
  const memberIds = new Set(trip.members.map((m) => m.id));
  if (!memberIds.has(expense.paidBy)) {
    throw new Error("addExpense: paidBy must be a trip member");
  }
  // Dedupe participants — a repeated id would split the expense into too many
  // buckets and double-charge that member (balances silently wrong).
  const participants = Array.from(new Set(expense.participants || []));
  if (participants.length === 0) {
    throw new Error("addExpense: need at least one participant");
  }
  for (const p of participants) {
    if (!memberIds.has(p)) throw new Error(`addExpense: participant ${p} is not a trip member`);
  }

  db.prepare(
    "INSERT INTO expenses (id, trip_id, title, amount_cents, paid_by, participants, fx, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    crypto.randomUUID(),
    tripId,
    title,
    amountCents,
    expense.paidBy,
    JSON.stringify(participants),
    expense.fx ? JSON.stringify(expense.fx) : null,
    new Date().toISOString()
  );
  return getTrip(tripId) as Trip;
}

/**
 * Edit an existing (non-voided) expense. Only the provided fields change.
 * Validates + dedupes participants exactly like addExpense. Throws on a missing
 * trip/expense or invalid field.
 */
export function editExpense(
  tripId: string,
  expenseId: string,
  patch: {
    title?: string;
    amountCents?: number;
    paidBy?: string;
    participants?: string[];
  }
): Trip {
  const trip = getTrip(tripId);
  if (!trip) throw new Error("editExpense: trip not found");
  const existing = trip.expenses.find((e) => e.id === expenseId);
  if (!existing) throw new Error("editExpense: expense not found");

  const memberIds = new Set(trip.members.map((m) => m.id));

  const title =
    patch.title !== undefined
      ? String(patch.title || "").trim() || "Expense"
      : existing.title;

  let amountCents = existing.amountCents;
  if (patch.amountCents !== undefined) {
    amountCents = patch.amountCents;
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new Error("editExpense: amountCents must be a positive integer");
    }
  }

  let paidBy = existing.paidBy;
  if (patch.paidBy !== undefined) {
    paidBy = String(patch.paidBy || "");
    if (!memberIds.has(paidBy)) {
      throw new Error("editExpense: paidBy must be a trip member");
    }
  }

  let participants = existing.participants;
  if (patch.participants !== undefined) {
    // Dedupe — a repeated id would double-charge that member (balances wrong).
    participants = Array.from(new Set(patch.participants || []));
    if (participants.length === 0) {
      throw new Error("editExpense: need at least one participant");
    }
    for (const p of participants) {
      if (!memberIds.has(p)) throw new Error(`editExpense: participant ${p} is not a trip member`);
    }
  }

  db.prepare(
    "UPDATE expenses SET title = ?, amount_cents = ?, paid_by = ?, participants = ? WHERE id = ? AND trip_id = ? AND COALESCE(voided, 0) = 0"
  ).run(title, amountCents, paidBy, JSON.stringify(participants), expenseId, tripId);
  return getTrip(tripId) as Trip;
}

export function deleteExpense(tripId: string, expenseId: string): Trip {
  const trip = getTrip(tripId);
  if (!trip) throw new Error("deleteExpense: trip not found");
  // Soft-delete: keep the row for audit, exclude it from reads/balances.
  db.prepare("UPDATE expenses SET voided = 1 WHERE id = ? AND trip_id = ?").run(
    expenseId,
    tripId
  );
  return getTrip(tripId) as Trip;
}

export function saveSettlement(
  tripId: string,
  signature: string,
  transfers: SettlementTransfer[]
): StoredSettlement {
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO settlements (trip_id, signature, transfers, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(trip_id) DO UPDATE SET
       signature = excluded.signature,
       transfers = excluded.transfers,
       created_at = excluded.created_at`
  ).run(tripId, signature, JSON.stringify(transfers), createdAt);
  return { tripId, signature, transfers, createdAt };
}

/**
 * Pure authorization check for a trip (no DB / no HTTP). A request is authorized
 * if EITHER it carries the trip's share token, OR its session user is the trip
 * owner or a claimed member of the trip. Offline-testable.
 */
export function isTripAuthorized(input: {
  providedToken?: string | null;
  shareToken: string;
  userId?: string | null;
  ownerUserId?: string | null;
  memberUserIds: string[];
}): boolean {
  const { providedToken, shareToken, userId, ownerUserId, memberUserIds } = input;
  if (providedToken && shareToken && providedToken === shareToken) return true;
  if (userId) {
    if (ownerUserId && ownerUserId === userId) return true;
    if (memberUserIds.includes(userId)) return true;
  }
  return false;
}

/** Every stored settlement (used by receipt lookup). */
export function listAllSettlements(): StoredSettlement[] {
  const rows = db.prepare("SELECT * FROM settlements").all() as any[];
  return rows.map((row) => ({
    tripId: row.trip_id,
    signature: row.signature,
    transfers: JSON.parse(row.transfers),
    createdAt: row.created_at,
  }));
}

export function getSettlement(tripId: string): StoredSettlement | undefined {
  const row: any = db.prepare("SELECT * FROM settlements WHERE trip_id = ?").get(tripId);
  if (!row) return undefined;
  return {
    tripId: row.trip_id,
    signature: row.signature,
    transfers: JSON.parse(row.transfers),
    createdAt: row.created_at,
  };
}
