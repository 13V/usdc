/**
 * groups.ts — saved groups (reusable member lists) backed by SQLite.
 *
 * A group is just a named list of member names that a host can reuse to spin
 * up a bill quickly. `members` is stored as a JSON string array.
 */

import { randomUUID } from "crypto";
import { db } from "./db";

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
  members: string;
  created_at: string;
  last_used_at: string;
}

function rowToGroup(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    members: JSON.parse(row.members) as string[],
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

const listStmt = db.prepare(
  "SELECT * FROM groups ORDER BY last_used_at DESC"
);
const getStmt = db.prepare("SELECT * FROM groups WHERE id = ?");
const insertStmt = db.prepare(
  "INSERT INTO groups (id, name, members, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)"
);
const deleteStmt = db.prepare("DELETE FROM groups WHERE id = ?");
const touchStmt = db.prepare(
  "UPDATE groups SET last_used_at = ? WHERE id = ?"
);

export function listGroups(): Group[] {
  return (listStmt.all() as GroupRow[]).map(rowToGroup);
}

export function getGroup(id: string): Group | undefined {
  const row = getStmt.get(id) as GroupRow | undefined;
  return row ? rowToGroup(row) : undefined;
}

export function createGroup(name: string, members: string[]): Group {
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
  insertStmt.run(
    group.id,
    group.name,
    JSON.stringify(group.members),
    group.createdAt,
    group.lastUsedAt
  );
  return group;
}

export function deleteGroup(id: string): boolean {
  return deleteStmt.run(id).changes > 0;
}

export function touchGroup(id: string): void {
  touchStmt.run(new Date().toISOString(), id);
}
