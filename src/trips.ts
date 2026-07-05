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
import { usingSupabase, supabase } from "./supabase";
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
  /** Household residency window (ISO date, day granularity). Metadata for
   *  proration only — never rewrites ledger history by itself. */
  movedInAt?: string;
  movedOutAt?: string;
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
  /**
   * NULL/undefined = ordinary spending. "transfer" = a confirmed settle-outside
   * payment recorded as paidBy → participants[0] so it feeds computeBalances
   * (clearing the debt) while journal/totals treat it as money MOVING, not
   * money SPENT. Transfers are immutable history (no edit/delete).
   */
  kind?: string;
  /** Optional "pay this back by" moment (ISO). Display + nudge metadata only. */
  dueAt?: string;
  /**
   * Itemized "who had what" grouping. An itemized group expense is stored as
   * per-member single-participant rows (exact cents — the subscriptions.ts /
   * household.ts pattern, since ledger.computeBalances only splits evenly)
   * sharing one splitId. Balances math sees the raw rows; serialization merges
   * them into ONE logical expense (mergeItemizedExpenses).
   */
  splitId?: string;
  /** Itemization metadata (items + extras), stored on ONE row of the group. */
  splitMeta?: ItemizedExpenseMeta;
}

export interface ItemizedExpenseMeta {
  items: { label: string; qty: number; cents: number; memberIds: string[] }[];
  /** Tip + tax + unassigned lines (total − item sum), ≥ 0. */
  extrasCents: number;
}

/** One logical expense for display: ordinary rows pass through; itemized row
 *  groups collapse into a single expense with an exact per-member breakdown. */
export interface DisplayExpense extends TripExpense {
  itemized?: {
    breakdown: { memberId: string; cents: number }[];
    items: ItemizedExpenseMeta["items"];
    extrasCents: number;
  };
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
  emoji?: string;
  archived?: boolean;
  /** Optional group "settle by" moment (ISO). Auto-nudges key off it. */
  dueAt?: string;
  /** NULL/undefined = ordinary group. "household" = roommates: the group
   *  detail screen gains the monthly bills hub (household.ts). */
  kind?: string;
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
// Settle-outside transfers: expenses gain a `kind` discriminator (additive;
// NULL = ordinary expense, 'transfer' = confirmed off-app settle payment).
if (!hasColumn("expenses", "kind")) {
  db.exec("ALTER TABLE expenses ADD COLUMN kind TEXT");
}
// Emoji + color avatar identity per member (additive; NULL → deterministic).
if (!hasColumn("trip_members", "emoji")) db.exec("ALTER TABLE trip_members ADD COLUMN emoji TEXT");
if (!hasColumn("trip_members", "color")) db.exec("ALTER TABLE trip_members ADD COLUMN color TEXT");
// Group quality-of-life: a chosen group emoji + archive flag (additive). NULL
// emoji → the client falls back to its name-derived emoji; archived defaults 0.
if (!hasColumn("trips", "emoji")) db.exec("ALTER TABLE trips ADD COLUMN emoji TEXT");
if (!hasColumn("trips", "archived")) db.exec("ALTER TABLE trips ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
// Due dates (additive; NULL = none): a group-level "settle by" moment and a
// per-expense "pay this back by" moment. Pure metadata — never affects math.
if (!hasColumn("trips", "due_at")) db.exec("ALTER TABLE trips ADD COLUMN due_at TEXT");
if (!hasColumn("expenses", "due_at")) db.exec("ALTER TABLE expenses ADD COLUMN due_at TEXT");
// Household hub (additive; NULL = ordinary group / lifelong resident):
// trips.kind marks a group as a "household"; members carry an optional
// move-in/move-out date so the month's recurring bills can prorate by
// days-in-residence. Pure metadata — the ledger itself never changes shape.
if (!hasColumn("trips", "kind")) db.exec("ALTER TABLE trips ADD COLUMN kind TEXT");
if (!hasColumn("trip_members", "moved_in_at")) db.exec("ALTER TABLE trip_members ADD COLUMN moved_in_at TEXT");
if (!hasColumn("trip_members", "moved_out_at")) db.exec("ALTER TABLE trip_members ADD COLUMN moved_out_at TEXT");
// Itemized "who had what" group expenses (additive; NULL = ordinary expense):
// split_id groups the per-member exact-share rows of one logical expense,
// split_meta (JSON, on one row of the group) carries the item breakdown.
if (!hasColumn("expenses", "split_id")) db.exec("ALTER TABLE expenses ADD COLUMN split_id TEXT");
if (!hasColumn("expenses", "split_meta")) db.exec("ALTER TABLE expenses ADD COLUMN split_meta TEXT");

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
    movedInAt: row.moved_in_at ?? undefined,
    movedOutAt: row.moved_out_at ?? undefined,
  };
}

// JSON columns are TEXT in SQLite (string → JSON.parse) but jsonb in Supabase
// (already-parsed object/array). Tolerate both.
function asJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  return typeof v === "string" ? (JSON.parse(v) as T) : (v as T);
}

function hydrateExpense(row: any): TripExpense {
  return {
    id: row.id,
    title: row.title,
    amountCents: Number(row.amount_cents),
    paidBy: row.paid_by,
    participants: asJson<string[]>(row.participants, []),
    fx: row.fx == null ? undefined : asJson<any>(row.fx, undefined),
    createdAt: row.created_at,
    kind: row.kind ?? undefined,
    dueAt: row.due_at ?? undefined,
    splitId: row.split_id ?? undefined,
    splitMeta:
      row.split_meta == null
        ? undefined
        : asJson<ItemizedExpenseMeta | undefined>(row.split_meta, undefined),
  };
}

/** Assemble a Trip from its own row plus already-hydrated members/expenses. */
function buildTrip(row: any, members: TripMember[], expenses: TripExpense[]): Trip {
  return {
    id: row.id,
    name: row.name,
    shareToken: row.share_token,
    cluster: row.cluster as Cluster,
    createdAt: row.created_at,
    members,
    expenses,
    ownerUserId: row.owner_user_id ?? undefined,
    emoji: row.emoji ?? undefined,
    archived: row.archived == null ? false : !!Number(row.archived),
    dueAt: row.due_at ?? undefined,
    kind: row.kind ?? undefined,
  };
}

async function hydrateTrip(row: any): Promise<Trip> {
  if (usingSupabase) {
    const sb = supabase();
    const [mRes, eRes] = await Promise.all([
      sb.from("trip_members").select("*").eq("trip_id", row.id).order("id", { ascending: true }),
      sb
        .from("expenses")
        .select("*")
        .eq("trip_id", row.id)
        .eq("voided", 0)
        .order("created_at", { ascending: true }),
    ]);
    if (mRes.error) throw new Error(`trips.hydrate.members: ${mRes.error.message}`);
    if (eRes.error) throw new Error(`trips.hydrate.expenses: ${eRes.error.message}`);
    return buildTrip(row, (mRes.data || []).map(hydrateMember), (eRes.data || []).map(hydrateExpense));
  }
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
  return buildTrip(row, members, expenses);
}

/**
 * Hydrate many trips without an N+1 storm: one members query + one expenses
 * query across all trip ids, grouped in memory. (SQLite path hydrates per-row —
 * its synchronous prepared statements are already cheap.)
 */
async function hydrateTrips(rows: any[]): Promise<Trip[]> {
  if (!usingSupabase) return Promise.all(rows.map(hydrateTrip));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const sb = supabase();
  const [mRes, eRes] = await Promise.all([
    sb.from("trip_members").select("*").in("trip_id", ids).order("id", { ascending: true }),
    sb
      .from("expenses")
      .select("*")
      .in("trip_id", ids)
      .eq("voided", 0)
      .order("created_at", { ascending: true }),
  ]);
  if (mRes.error) throw new Error(`trips.hydrate.members: ${mRes.error.message}`);
  if (eRes.error) throw new Error(`trips.hydrate.expenses: ${eRes.error.message}`);
  const byTrip = <T extends { trip_id: string }>(arr: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of arr) (m.get(x.trip_id) || m.set(x.trip_id, []).get(x.trip_id)!).push(x);
    return m;
  };
  const mMap = byTrip((mRes.data || []) as any[]);
  const eMap = byTrip((eRes.data || []) as any[]);
  return rows.map((row) =>
    buildTrip(row, (mMap.get(row.id) || []).map(hydrateMember), (eMap.get(row.id) || []).map(hydrateExpense))
  );
}

// ---- CRUD ------------------------------------------------------------------

export async function createTrip(
  name: string,
  cluster: Cluster,
  members: { name: string; wallet?: string; userId?: string }[],
  ownerUserId?: string
): Promise<Trip> {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new Error("createTrip: need a name");
  const cleanMembers = (members || [])
    .map((m) => ({ name: String(m.name || "").trim(), wallet: m.wallet, userId: m.userId }))
    .filter((m) => m.name);
  if (cleanMembers.length < 1) throw new Error("createTrip: need at least one member");

  const id = crypto.randomUUID();
  const shareToken = crypto.randomBytes(8).toString("hex");
  const createdAt = new Date().toISOString();

  if (usingSupabase) {
    const sb = supabase();
    const ins = await sb.from("trips").insert({
      id,
      name: trimmedName,
      share_token: shareToken,
      cluster,
      created_at: createdAt,
      owner_user_id: ownerUserId ?? null,
    });
    if (ins.error) throw new Error(`createTrip: ${ins.error.message}`);
    const memberRows = cleanMembers.map((m) => ({
      id: crypto.randomUUID(),
      trip_id: id,
      name: m.name,
      wallet: m.wallet ?? null,
      user_id: m.userId ?? null,
    }));
    const mins = await sb.from("trip_members").insert(memberRows);
    if (mins.error) throw new Error(`createTrip.members: ${mins.error.message}`);
    return (await getTrip(id)) as Trip;
  }

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

  return (await getTrip(id)) as Trip;
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
export async function claimMember(
  tripId: string,
  memberId: string,
  userId: string,
  wallet: string
): Promise<Trip> {
  const trip = await getTrip(tripId);
  if (!trip) throw new Error("claimMember: trip not found");
  const member = trip.members.find((m) => m.id === memberId);
  if (!member) throw new Error("claimMember: member not found");
  if (member.userId && member.userId !== userId) {
    throw new Error("claimMember: this member is already claimed");
  }
  // Atomic claim: only take the slot if it's still unclaimed (or already mine).
  // The read-check above races with a concurrent claim of the SAME unclaimed
  // slot; constraining the write to user_id IS NULL (or self) and checking a row
  // actually changed closes that window — the winner sets the member's settle-up
  // wallet, so a lost race would otherwise redirect that member's payout.
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("trip_members")
      .update({ user_id: userId, wallet })
      .eq("id", memberId)
      .eq("trip_id", tripId)
      .or(`user_id.is.null,user_id.eq.${userId}`)
      .select("id");
    if (error) throw new Error(`claimMember: ${error.message}`);
    if (!data || data.length === 0) throw new Error("claimMember: this member is already claimed");
  } else {
    const res = db.prepare(
      "UPDATE trip_members SET user_id = ?, wallet = ? WHERE id = ? AND trip_id = ? AND (user_id IS NULL OR user_id = ?)"
    ).run(userId, wallet, memberId, tripId, userId);
    if (res.changes === 0) throw new Error("claimMember: this member is already claimed");
  }
  return (await getTrip(tripId)) as Trip;
}

/** Trips a user owns OR has claimed a member slot in, most recent first. */
export async function listTripsForUser(userId: string): Promise<Trip[]> {
  if (usingSupabase) {
    const sb = supabase();
    // Two cheap lookups (owned + claimed-member trip ids), unioned, then a single
    // trips fetch — PostgREST has no JOIN, and this keeps it to a few round-trips.
    const [ownRes, memRes] = await Promise.all([
      sb.from("trips").select("*").eq("owner_user_id", userId),
      sb.from("trip_members").select("trip_id").eq("user_id", userId),
    ]);
    if (ownRes.error) throw new Error(`trips.listForUser.owned: ${ownRes.error.message}`);
    if (memRes.error) throw new Error(`trips.listForUser.member: ${memRes.error.message}`);
    const owned = (ownRes.data || []) as any[];
    const haveIds = new Set(owned.map((t) => t.id));
    const memberTripIds = Array.from(
      new Set((memRes.data || []).map((r: any) => r.trip_id))
    ).filter((id) => !haveIds.has(id));
    let extra: any[] = [];
    if (memberTripIds.length) {
      const exRes = await sb.from("trips").select("*").in("id", memberTripIds);
      if (exRes.error) throw new Error(`trips.listForUser.extra: ${exRes.error.message}`);
      extra = (exRes.data || []) as any[];
    }
    const all = [...owned, ...extra].sort((a, b) =>
      a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
    );
    return hydrateTrips(all);
  }
  const rows = db
    .prepare(
      `SELECT DISTINCT t.* FROM trips t
       LEFT JOIN trip_members m ON m.trip_id = t.id
       WHERE t.owner_user_id = ? OR m.user_id = ?
       ORDER BY t.created_at DESC, t.rowid DESC`
    )
    .all(userId, userId);
  return hydrateTrips(rows);
}

export async function listTrips(): Promise<Trip[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("trips")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`trips.listTrips: ${error.message}`);
    return hydrateTrips((data || []) as any[]);
  }
  const rows = db.prepare("SELECT * FROM trips ORDER BY created_at DESC, rowid DESC").all();
  return hydrateTrips(rows);
}

export async function getTrip(id: string): Promise<Trip | undefined> {
  if (usingSupabase) {
    const { data, error } = await supabase().from("trips").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`trips.getTrip: ${error.message}`);
    return data ? hydrateTrip(data) : undefined;
  }
  const row = db.prepare("SELECT * FROM trips WHERE id = ?").get(id);
  return row ? hydrateTrip(row) : undefined;
}

export async function getTripByToken(token: string): Promise<Trip | undefined> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("trips")
      .select("*")
      .eq("share_token", token)
      .maybeSingle();
    if (error) throw new Error(`trips.getTripByToken: ${error.message}`);
    return data ? hydrateTrip(data) : undefined;
  }
  const row = db.prepare("SELECT * FROM trips WHERE share_token = ?").get(token);
  return row ? hydrateTrip(row) : undefined;
}

export async function getTripByIdOrToken(x: string): Promise<Trip | undefined> {
  return (await getTrip(x)) || (await getTripByToken(x));
}

export async function addMember(
  tripId: string,
  member: { name: string; wallet?: string }
): Promise<Trip> {
  const trip = await getTrip(tripId);
  if (!trip) throw new Error("addMember: trip not found");
  const name = String(member.name || "").trim();
  if (!name) throw new Error("addMember: need a name");
  if (usingSupabase) {
    const { error } = await supabase().from("trip_members").insert({
      id: crypto.randomUUID(),
      trip_id: tripId,
      name,
      wallet: member.wallet ?? null,
    });
    if (error) throw new Error(`addMember: ${error.message}`);
  } else {
    db.prepare("INSERT INTO trip_members (id, trip_id, name, wallet) VALUES (?, ?, ?, ?)").run(
      crypto.randomUUID(),
      tripId,
      name,
      member.wallet ?? null
    );
  }
  return (await getTrip(tripId)) as Trip;
}

export async function updateMember(
  tripId: string,
  memberId: string,
  patch: { name?: string; wallet?: string }
): Promise<Trip> {
  const trip = await getTrip(tripId);
  if (!trip) throw new Error("updateMember: trip not found");
  const member = trip.members.find((m) => m.id === memberId);
  if (!member) throw new Error("updateMember: member not found");

  const name =
    patch.name !== undefined ? String(patch.name).trim() || member.name : member.name;
  const wallet =
    patch.wallet !== undefined ? (patch.wallet ? String(patch.wallet) : null) : member.wallet ?? null;

  if (usingSupabase) {
    const { error } = await supabase()
      .from("trip_members")
      .update({ name, wallet })
      .eq("id", memberId)
      .eq("trip_id", tripId);
    if (error) throw new Error(`updateMember: ${error.message}`);
  } else {
    db.prepare("UPDATE trip_members SET name = ?, wallet = ? WHERE id = ? AND trip_id = ?").run(
      name,
      wallet,
      memberId,
      tripId
    );
  }
  return (await getTrip(tripId)) as Trip;
}

/**
 * Update group-level fields: name, chosen emoji, or archived flag. Only the
 * provided fields change. Emoji is capped at 8 chars (same as member emoji);
 * an empty emoji clears it back to the name-derived fallback.
 */
export async function updateTrip(
  tripId: string,
  patch: {
    name?: string;
    emoji?: string | null;
    archived?: boolean;
    dueAt?: string | null;
    kind?: string | null;
  }
): Promise<Trip> {
  const trip = await getTrip(tripId);
  if (!trip) throw new Error("updateTrip: trip not found");

  const name =
    patch.name !== undefined ? String(patch.name).trim() || trip.name : trip.name;
  const emoji =
    patch.emoji !== undefined
      ? (patch.emoji ? String(patch.emoji).slice(0, 8) : null)
      : trip.emoji ?? null;
  const archived =
    patch.archived !== undefined ? (patch.archived ? 1 : 0) : trip.archived ? 1 : 0;
  // Callers validate the due date (server.ts uses autonudge.validateDueAt);
  // this layer just persists it. null clears, undefined keeps.
  const dueAt = patch.dueAt !== undefined ? patch.dueAt : trip.dueAt ?? null;
  // Group kind ("household" or null). Callers validate; null clears.
  const kind = patch.kind !== undefined ? patch.kind : trip.kind ?? null;

  if (usingSupabase) {
    const { error } = await supabase()
      .from("trips")
      .update({ name, emoji, archived, due_at: dueAt, kind })
      .eq("id", tripId);
    if (error) throw new Error(`updateTrip: ${error.message}`);
  } else {
    db.prepare(
      "UPDATE trips SET name = ?, emoji = ?, archived = ?, due_at = ?, kind = ? WHERE id = ?"
    ).run(name, emoji, archived, dueAt, kind, tripId);
  }
  return (await getTrip(tripId)) as Trip;
}

/**
 * Set a household member's residency window (move-in / move-out, ISO date at
 * day granularity). null clears, undefined keeps. Callers validate the dates
 * (household.validateMoveDate) — this layer just persists them.
 */
export async function setMemberResidency(
  tripId: string,
  memberId: string,
  patch: { movedInAt?: string | null; movedOutAt?: string | null }
): Promise<Trip> {
  const trip = await getTrip(tripId);
  if (!trip) throw new Error("setMemberResidency: trip not found");
  const member = trip.members.find((m) => m.id === memberId);
  if (!member) throw new Error("setMemberResidency: member not found");

  const movedInAt =
    patch.movedInAt !== undefined ? patch.movedInAt : member.movedInAt ?? null;
  const movedOutAt =
    patch.movedOutAt !== undefined ? patch.movedOutAt : member.movedOutAt ?? null;

  if (usingSupabase) {
    const { error } = await supabase()
      .from("trip_members")
      .update({ moved_in_at: movedInAt, moved_out_at: movedOutAt })
      .eq("id", memberId)
      .eq("trip_id", tripId);
    if (error) throw new Error(`setMemberResidency: ${error.message}`);
  } else {
    db.prepare(
      "UPDATE trip_members SET moved_in_at = ?, moved_out_at = ? WHERE id = ? AND trip_id = ?"
    ).run(movedInAt, movedOutAt, memberId, tripId);
  }
  return (await getTrip(tripId)) as Trip;
}

/**
 * Hard-remove a member slot. Callers MUST guard first that the member has a zero
 * balance and appears in no expense (paidBy/participants) — money history must
 * never dangle a reference to a deleted member.
 */
export async function removeMember(tripId: string, memberId: string): Promise<Trip> {
  const trip = await getTrip(tripId);
  if (!trip) throw new Error("removeMember: trip not found");
  if (usingSupabase) {
    const { error } = await supabase()
      .from("trip_members")
      .delete()
      .eq("id", memberId)
      .eq("trip_id", tripId);
    if (error) throw new Error(`removeMember: ${error.message}`);
  } else {
    db.prepare("DELETE FROM trip_members WHERE id = ? AND trip_id = ?").run(memberId, tripId);
  }
  return (await getTrip(tripId)) as Trip;
}

export async function addExpense(
  tripId: string,
  expense: {
    title: string;
    amountCents: number;
    paidBy: string;
    participants: string[];
    fx?: any;
    /** "transfer" = settle-outside payment record (see TripExpense.kind). */
    kind?: "transfer";
    /** Optional pre-validated "pay back by" moment (ISO). */
    dueAt?: string | null;
  }
): Promise<Trip> {
  const trip = await getTrip(tripId);
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

  if (usingSupabase) {
    const { error } = await supabase().from("expenses").insert({
      id: crypto.randomUUID(),
      trip_id: tripId,
      title,
      amount_cents: amountCents,
      paid_by: expense.paidBy,
      participants, // jsonb
      fx: expense.fx ?? null, // jsonb
      created_at: new Date().toISOString(),
      voided: 0,
      kind: expense.kind ?? null,
      due_at: expense.dueAt ?? null,
    });
    if (error) throw new Error(`addExpense: ${error.message}`);
  } else {
    db.prepare(
      "INSERT INTO expenses (id, trip_id, title, amount_cents, paid_by, participants, fx, created_at, kind, due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      crypto.randomUUID(),
      tripId,
      title,
      amountCents,
      expense.paidBy,
      JSON.stringify(participants),
      expense.fx ? JSON.stringify(expense.fx) : null,
      new Date().toISOString(),
      expense.kind ?? null,
      expense.dueAt ?? null
    );
  }
  return (await getTrip(tripId)) as Trip;
}

/**
 * Persist an itemized "who had what" expense: one row PER MEMBER with their
 * exact share (single-participant, so ledger.computeBalances charges it
 * exactly — the subscriptions.ts/household.ts pattern), all sharing one
 * splitId so reads can merge them back into ONE logical expense. The payer's
 * own share is stored too (paidBy === participant, balance-neutral) so the
 * merged amount equals the receipt total. Zero shares are skipped by callers.
 *
 * Rows are written atomically (SQLite transaction / one Supabase batch
 * insert) with an identical created_at.
 */
export async function addItemizedExpense(
  tripId: string,
  expense: {
    title: string;
    paidBy: string;
    /** Exact per-member cents; every entry must be a positive integer. */
    shares: { memberId: string; cents: number }[];
    meta: ItemizedExpenseMeta;
    /** FX provenance when the receipt was foreign-currency — stamped on EVERY
     *  row so any row (incl. the merge's first) carries it consistently. */
    fx?: any;
    /** Optional pre-validated "pay back by" moment (ISO). */
    dueAt?: string | null;
  }
): Promise<Trip> {
  const trip = await getTrip(tripId);
  if (!trip) throw new Error("addItemizedExpense: trip not found");

  const title = String(expense.title || "").trim() || "Expense";
  const memberIds = new Set(trip.members.map((m) => m.id));
  if (!memberIds.has(expense.paidBy)) {
    throw new Error("addItemizedExpense: paidBy must be a trip member");
  }
  const shares = expense.shares || [];
  if (shares.length === 0) throw new Error("addItemizedExpense: need at least one share");
  const seen = new Set<string>();
  for (const s of shares) {
    if (!memberIds.has(s.memberId)) {
      throw new Error(`addItemizedExpense: member ${s.memberId} is not a trip member`);
    }
    if (seen.has(s.memberId)) {
      throw new Error("addItemizedExpense: duplicate member share");
    }
    seen.add(s.memberId);
    if (!Number.isInteger(s.cents) || s.cents <= 0) {
      throw new Error("addItemizedExpense: each share must be a positive integer");
    }
  }

  const splitId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const rows = shares.map((s, i) => ({
    id: crypto.randomUUID(),
    trip_id: tripId,
    title,
    amount_cents: s.cents,
    paid_by: expense.paidBy,
    participants: [s.memberId],
    created_at: createdAt,
    split_id: splitId,
    // Meta lives on the FIRST row only; the group is always voided together,
    // so it can never orphan.
    split_meta: i === 0 ? expense.meta : null,
    due_at: expense.dueAt ?? null,
  }));

  if (usingSupabase) {
    const { error } = await supabase().from("expenses").insert(
      rows.map((r) => ({
        ...r,
        participants: r.participants, // jsonb
        split_meta: r.split_meta, // jsonb
        fx: expense.fx ?? null, // jsonb
        voided: 0,
        kind: null,
      }))
    );
    if (error) throw new Error(`addItemizedExpense: ${error.message}`);
  } else {
    const insert = db.prepare(
      "INSERT INTO expenses (id, trip_id, title, amount_cents, paid_by, participants, fx, created_at, kind, due_at, split_id, split_meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)"
    );
    const tx = db.transaction(() => {
      for (const r of rows) {
        insert.run(
          r.id,
          r.trip_id,
          r.title,
          r.amount_cents,
          r.paid_by,
          JSON.stringify(r.participants),
          expense.fx ? JSON.stringify(expense.fx) : null,
          r.created_at,
          r.due_at,
          r.split_id,
          r.split_meta ? JSON.stringify(r.split_meta) : null
        );
      }
    });
    tx();
  }
  return (await getTrip(tripId)) as Trip;
}

/**
 * Collapse per-member itemized rows (shared splitId) into ONE logical expense
 * for display: id = splitId, amount = sum of shares (the receipt total),
 * participants = the members with a share, plus an exact breakdown + the item
 * metadata. Ordinary expenses pass through untouched, in order. Pure.
 */
export function mergeItemizedExpenses(expenses: TripExpense[]): DisplayExpense[] {
  const out: DisplayExpense[] = [];
  const bySplit = new Map<string, DisplayExpense>();
  for (const e of expenses) {
    if (!e.splitId) {
      out.push(e);
      continue;
    }
    let merged = bySplit.get(e.splitId);
    if (!merged) {
      merged = {
        ...e,
        id: e.splitId,
        amountCents: 0,
        participants: [],
        splitMeta: undefined,
        itemized: { breakdown: [], items: [], extrasCents: 0 },
      };
      bySplit.set(e.splitId, merged);
      out.push(merged);
    }
    merged.amountCents += e.amountCents;
    const memberId = e.participants[0];
    if (memberId !== undefined) {
      merged.participants = merged.participants.concat([memberId]);
      merged.itemized!.breakdown.push({ memberId, cents: e.amountCents });
    }
    if (e.splitMeta) {
      merged.itemized!.items = e.splitMeta.items || [];
      merged.itemized!.extrasCents = e.splitMeta.extrasCents || 0;
    }
  }
  return out;
}

/**
 * Edit an existing (non-voided) expense. Only the provided fields change.
 * Validates + dedupes participants exactly like addExpense. Throws on a missing
 * trip/expense or invalid field.
 */
export async function editExpense(
  tripId: string,
  expenseId: string,
  patch: {
    title?: string;
    amountCents?: number;
    paidBy?: string;
    participants?: string[];
    /** Pre-validated ISO due moment; null clears, undefined keeps. */
    dueAt?: string | null;
    /** FX provenance; null clears (e.g. the USD amount was rewritten), undefined keeps. */
    fx?: any | null;
  }
): Promise<Trip> {
  const trip = await getTrip(tripId);
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

  const dueAt = patch.dueAt !== undefined ? patch.dueAt : existing.dueAt ?? null;
  const fx = patch.fx !== undefined ? patch.fx : existing.fx ?? null;

  if (usingSupabase) {
    const { error } = await supabase()
      .from("expenses")
      .update({ title, amount_cents: amountCents, paid_by: paidBy, participants, due_at: dueAt, fx })
      .eq("id", expenseId)
      .eq("trip_id", tripId)
      .eq("voided", 0);
    if (error) throw new Error(`editExpense: ${error.message}`);
  } else {
    db.prepare(
      "UPDATE expenses SET title = ?, amount_cents = ?, paid_by = ?, participants = ?, due_at = ?, fx = ? WHERE id = ? AND trip_id = ? AND COALESCE(voided, 0) = 0"
    ).run(title, amountCents, paidBy, JSON.stringify(participants), dueAt, fx ? JSON.stringify(fx) : null, expenseId, tripId);
  }
  return (await getTrip(tripId)) as Trip;
}

export async function deleteExpense(tripId: string, expenseId: string): Promise<Trip> {
  const trip = await getTrip(tripId);
  if (!trip) throw new Error("deleteExpense: trip not found");
  // Soft-delete: keep the row for audit, exclude it from reads/balances.
  if (usingSupabase) {
    const { error } = await supabase()
      .from("expenses")
      .update({ voided: 1 })
      .eq("id", expenseId)
      .eq("trip_id", tripId);
    if (error) throw new Error(`deleteExpense: ${error.message}`);
  } else {
    db.prepare("UPDATE expenses SET voided = 1 WHERE id = ? AND trip_id = ?").run(expenseId, tripId);
  }
  return (await getTrip(tripId)) as Trip;
}

export async function saveSettlement(
  tripId: string,
  signature: string,
  transfers: SettlementTransfer[]
): Promise<StoredSettlement> {
  const createdAt = new Date().toISOString();
  if (usingSupabase) {
    const { error } = await supabase()
      .from("settlements")
      .upsert(
        { trip_id: tripId, signature, transfers, created_at: createdAt },
        { onConflict: "trip_id" }
      );
    if (error) throw new Error(`saveSettlement: ${error.message}`);
  } else {
    db.prepare(
      `INSERT INTO settlements (trip_id, signature, transfers, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(trip_id) DO UPDATE SET
         signature = excluded.signature,
         transfers = excluded.transfers,
         created_at = excluded.created_at`
    ).run(tripId, signature, JSON.stringify(transfers), createdAt);
  }
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

function hydrateSettlement(row: any): StoredSettlement {
  return {
    tripId: row.trip_id,
    signature: row.signature,
    transfers: asJson<SettlementTransfer[]>(row.transfers, []),
    createdAt: row.created_at,
  };
}

/** Every stored settlement (used by receipt lookup). */
export async function listAllSettlements(): Promise<StoredSettlement[]> {
  if (usingSupabase) {
    const { data, error } = await supabase().from("settlements").select("*");
    if (error) throw new Error(`listAllSettlements: ${error.message}`);
    return (data || []).map(hydrateSettlement);
  }
  const rows = db.prepare("SELECT * FROM settlements").all() as any[];
  return rows.map(hydrateSettlement);
}

export async function getSettlement(tripId: string): Promise<StoredSettlement | undefined> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("settlements")
      .select("*")
      .eq("trip_id", tripId)
      .maybeSingle();
    if (error) throw new Error(`getSettlement: ${error.message}`);
    return data ? hydrateSettlement(data) : undefined;
  }
  const row: any = db.prepare("SELECT * FROM settlements WHERE trip_id = ?").get(tripId);
  if (!row) return undefined;
  return hydrateSettlement(row);
}
