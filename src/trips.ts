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

// ---- Row hydration ---------------------------------------------------------

function hydrateMember(row: any): TripMember {
  return {
    id: row.id,
    name: row.name,
    wallet: row.wallet ?? undefined,
    userId: row.user_id ?? undefined,
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
    .prepare("SELECT * FROM expenses WHERE trip_id = ? ORDER BY created_at ASC, rowid ASC")
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
  members: { name: string; wallet?: string }[],
  ownerUserId?: string
): Trip {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new Error("createTrip: need a name");
  const cleanMembers = (members || [])
    .map((m) => ({ name: String(m.name || "").trim(), wallet: m.wallet }))
    .filter((m) => m.name);
  if (cleanMembers.length < 1) throw new Error("createTrip: need at least one member");

  const id = crypto.randomUUID();
  const shareToken = crypto.randomBytes(8).toString("hex");
  const createdAt = new Date().toISOString();

  const insertTrip = db.prepare(
    "INSERT INTO trips (id, name, share_token, cluster, created_at, owner_user_id) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertMember = db.prepare(
    "INSERT INTO trip_members (id, trip_id, name, wallet) VALUES (?, ?, ?, ?)"
  );

  const tx = db.transaction(() => {
    insertTrip.run(id, trimmedName, shareToken, cluster, createdAt, ownerUserId ?? null);
    for (const m of cleanMembers) {
      insertMember.run(crypto.randomUUID(), id, m.name, m.wallet ?? null);
    }
  });
  tx();

  return getTrip(id) as Trip;
}

/**
 * Claim an existing member slot for a signed-in user, routing settle-up to their
 * wallet. Sets that member's user_id and wallet. Throws if the member is absent.
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
  const participants = expense.participants || [];
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

export function deleteExpense(tripId: string, expenseId: string): Trip {
  const trip = getTrip(tripId);
  if (!trip) throw new Error("deleteExpense: trip not found");
  db.prepare("DELETE FROM expenses WHERE id = ? AND trip_id = ?").run(expenseId, tripId);
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
