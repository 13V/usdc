/**
 * groups.ts — saved groups (reusable member lists) backed by SQLite or Supabase.
 *
 * A group is just a named list of member names that a host can reuse to spin
 * up a bill quickly. In SQLite `members` is stored as a JSON string array; in
 * Supabase it's a jsonb column (passed/returned as a real array).
 */

import { randomUUID } from "crypto";
import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";

export interface Group {
  id: string;
  name: string;
  members: string[];
  createdAt: string;
  lastUsedAt: string;
}

interface GroupRow {
  id: string;
  name: string;
  // SQLite: JSON string. Supabase (jsonb): already-parsed array.
  members: string | string[];
  created_at: string;
  last_used_at: string;
}

function rowToGroup(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    members: (typeof row.members === "string"
      ? JSON.parse(row.members)
      : row.members) as string[],
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

// All saved-group access is scoped to the owning user — a group is that user's
// private reusable name list. Without this, any signed-in user could read or
// delete every other user's groups (there is no share model for groups).
const listStmt = db.prepare(
  "SELECT * FROM groups WHERE user_id = ? ORDER BY last_used_at DESC"
);
const getStmt = db.prepare("SELECT * FROM groups WHERE id = ? AND user_id = ?");
const insertStmt = db.prepare(
  "INSERT INTO groups (id, name, members, created_at, last_used_at, user_id) VALUES (?, ?, ?, ?, ?, ?)"
);
const deleteStmt = db.prepare("DELETE FROM groups WHERE id = ? AND user_id = ?");
const touchStmt = db.prepare(
  "UPDATE groups SET last_used_at = ? WHERE id = ? AND user_id = ?"
);

export async function listGroups(ownerUserId: string): Promise<Group[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("groups")
      .select("*")
      .eq("user_id", ownerUserId)
      .order("last_used_at", { ascending: false });
    if (error) throw new Error(`groups.listGroups: ${error.message}`);
    return (data as GroupRow[]).map(rowToGroup);
  }
  return (listStmt.all(ownerUserId) as GroupRow[]).map(rowToGroup);
}

export async function getGroup(id: string, ownerUserId: string): Promise<Group | undefined> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("groups")
      .select("*")
      .eq("id", id)
      .eq("user_id", ownerUserId)
      .maybeSingle();
    if (error) throw new Error(`groups.getGroup: ${error.message}`);
    return data ? rowToGroup(data as GroupRow) : undefined;
  }
  const row = getStmt.get(id, ownerUserId) as GroupRow | undefined;
  return row ? rowToGroup(row) : undefined;
}

export async function createGroup(
  name: string,
  members: string[],
  ownerUserId: string
): Promise<Group> {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new Error("group name is required");

  const cleanMembers = (members || [])
    .map((m) => String(m).trim())
    .filter(Boolean);
  if (cleanMembers.length === 0) throw new Error("group needs at least one member");

  const now = new Date().toISOString();
  const group: Group = {
    id: randomUUID(),
    name: trimmedName,
    members: cleanMembers,
    createdAt: now,
    lastUsedAt: now,
  };

  if (usingSupabase) {
    // members is jsonb → pass the array directly (no JSON.stringify).
    const { error } = await supabase().from("groups").insert({
      id: group.id,
      name: group.name,
      members: group.members,
      created_at: group.createdAt,
      last_used_at: group.lastUsedAt,
      user_id: ownerUserId,
    });
    if (error) throw new Error(`groups.createGroup: ${error.message}`);
    return group;
  }

  insertStmt.run(
    group.id,
    group.name,
    JSON.stringify(group.members),
    group.createdAt,
    group.lastUsedAt,
    ownerUserId
  );
  return group;
}

export async function deleteGroup(id: string, ownerUserId: string): Promise<boolean> {
  if (usingSupabase) {
    const { count, error } = await supabase()
      .from("groups")
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("user_id", ownerUserId);
    if (error) throw new Error(`groups.deleteGroup: ${error.message}`);
    return (count ?? 0) > 0;
  }
  return deleteStmt.run(id, ownerUserId).changes > 0;
}

export async function touchGroup(id: string, ownerUserId: string): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase()
      .from("groups")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", ownerUserId);
    if (error) throw new Error(`groups.touchGroup: ${error.message}`);
    return;
  }
  touchStmt.run(new Date().toISOString(), id, ownerUserId);
}
