/**
 * ious.ts — One-off IOUs / request-money.
 *
 * A simple 1:1 debt between you and a friend, settled in USDC on Solana. No
 * trip/bill needed. Either:
 *   - "i_owe":    you owe the counterparty; you pay THEM (payWallet = their wallet).
 *   - "they_owe": they owe you; this is a money REQUEST, they pay YOUR primary
 *                 wallet (payWallet = your primary wallet).
 *
 * GUARDRAIL: ALL money is integer cents.
 *
 * Mount (integrator):
 *   import { iouRouter } from "./ious";
 *   app.use(iouRouter);
 */

import * as crypto from "crypto";
import { Router, Request, Response } from "express";
import { Connection, clusterApiUrl, PublicKey } from "@solana/web3.js";

import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { requireAuth } from "./auth";
import { getPrimaryWallet } from "./users";
import {
  buildSolanaPayUrl,
  newReference,
  USDC_MINT,
  Cluster,
} from "./solanaPay";
import { CLUSTER, clusterMismatchError } from "./cluster";
import { LEDGER_MAX_CENTS } from "./limits";
import { validatePayment } from "./verify";
import { claimSignature } from "./consumedSignatures";
import { alert } from "./alerts";
import { fmt, toCents } from "./split";
import { moneyRateLimit, writeRateLimit } from "./ratelimit";

// ---- Config ----------------------------------------------------------------

const cluster: Cluster = CLUSTER;
const rpcUrl = process.env.RPC_URL || clusterApiUrl(cluster);

// ---- Schema (idempotent) ---------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS ious (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    counterparty_name TEXT NOT NULL,
    counterparty_wallet TEXT,
    amount_cents INTEGER NOT NULL,
    note TEXT,
    status TEXT NOT NULL,
    reference TEXT,
    pay_wallet TEXT,
    signature TEXT,
    created_at TEXT NOT NULL,
    cluster TEXT
  );
`);

// Additive migration (B4): stamp each IOU with the cluster it was created on,
// so a devnet-era open IOU never rebuilds into a real mainnet payment request.
// Existing rows all predate mainnet — backfill 'devnet'. Mirrored in
// supabase/schema.sql.
{
  const cols = db.prepare("PRAGMA table_info(ious)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "cluster")) {
    db.exec("ALTER TABLE ious ADD COLUMN cluster TEXT");
  }
  db.exec("UPDATE ious SET cluster = 'devnet' WHERE cluster IS NULL");
}

/** The cluster an IOU row was created on (NULL = pre-migration = devnet-era).
 *  Exported for the public settle-link routes (settleLink.ts), which must
 *  apply the exact same B4/H1 guard. */
export function rowCluster(row: { cluster?: string | null }): string {
  return row.cluster || "devnet";
}

// ---- Types -----------------------------------------------------------------

type Direction = "i_owe" | "they_owe";

export interface IouRow {
  id: string;
  owner_user_id: string;
  direction: string;
  counterparty_name: string;
  counterparty_wallet: string | null;
  amount_cents: number;
  note: string | null;
  status: string;
  reference: string | null;
  pay_wallet: string | null;
  signature: string | null;
  created_at: string;
  // Cluster stamped at creation (B4). NULL only on pre-migration (devnet) rows.
  cluster: string | null;
}

// ---- Serialization ---------------------------------------------------------

/**
 * Rebuild the Solana Pay url from the stored reference + pay_wallet, if payable.
 * B4: rebuilding uses the CURRENT cluster's mint, so a row stamped on a
 * different cluster must never produce a URL — a devnet-era open IOU would
 * otherwise become a real mainnet payment request after the flip.
 */
export function rebuildUrl(row: IouRow): string | null {
  if (!row.reference || !row.pay_wallet) return null;
  if (rowCluster(row) !== cluster) return null;
  return buildSolanaPayUrl({
    recipient: row.pay_wallet,
    amountCents: row.amount_cents,
    splToken: USDC_MINT[cluster],
    reference: row.reference,
    label: "Divvy IOU",
    message: row.note || "",
  });
}

function serialize(row: IouRow) {
  // Cross-cluster (B4): surfaced as a closed request — no url, an honest note.
  const crossCluster = rowCluster(row) !== cluster;
  return {
    id: row.id,
    direction: row.direction,
    counterpartyName: row.counterparty_name,
    counterpartyWallet: row.counterparty_wallet,
    amountCents: row.amount_cents,
    amountFmt: fmt(row.amount_cents),
    note: row.note,
    status: row.status,
    url: rebuildUrl(row),
    reference: row.reference,
    signature: row.signature,
    createdAt: row.created_at,
    crossCluster,
    ...(crossCluster ? { crossClusterNote: clusterMismatchError(row.cluster) } : {}),
  };
}

// ---- Helpers ---------------------------------------------------------------

async function getOwnedIou(
  id: string,
  userId: string
): Promise<IouRow | undefined> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("ious")
      .select("*")
      .eq("id", id)
      .eq("owner_user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`ious.getOwnedIou: ${error.message}`);
    return (data as IouRow | null) ?? undefined;
  }
  const row = db
    .prepare("SELECT * FROM ious WHERE id = ? AND owner_user_id = ?")
    .get(id, userId) as IouRow | undefined;
  return row;
}

/**
 * Look up an IOU by its throwaway reference pubkey (any status). The reference
 * is an unguessable capability token, so this backs the public no-login settle
 * page (settleLink.ts) the same way a /pay link backs a bill.
 */
export async function getIouByReference(reference: string): Promise<IouRow | undefined> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("ious")
      .select("*")
      .eq("reference", reference)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`ious.getIouByReference: ${error.message}`);
    return (data as IouRow | null) ?? undefined;
  }
  return db
    .prepare(
      "SELECT * FROM ious WHERE reference = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
    )
    .get(reference) as IouRow | undefined;
}

/**
 * The public /s/<reference> settle-link reference for an open money REQUEST
 * ("they_owe") this owner has out at `counterpartyWallet`, if it's payable on
 * THIS cluster. Used by nudges.ts so a payment reminder can deep-link straight
 * to the no-login pay page. Read-only.
 */
export async function pendingIouLinkReference(
  ownerUserId: string,
  counterpartyWallet: string
): Promise<string | null> {
  let row: IouRow | undefined;
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("ious")
      .select("*")
      .eq("owner_user_id", ownerUserId)
      .eq("direction", "they_owe")
      .eq("status", "open")
      .eq("counterparty_wallet", counterpartyWallet)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`ious.pendingIouLinkReference: ${error.message}`);
    row = (data as IouRow | null) ?? undefined;
  } else {
    row = db
      .prepare(
        `SELECT * FROM ious
         WHERE owner_user_id = ? AND direction = 'they_owe' AND status = 'open'
           AND counterparty_wallet = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`
      )
      .get(ownerUserId, counterpartyWallet) as IouRow | undefined;
  }
  if (!row || rowCluster(row) !== cluster || !row.reference || !row.pay_wallet) return null;
  return row.reference;
}

/** Insert a new IOU row. */
async function insertIou(row: IouRow): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase().from("ious").insert({
      id: row.id,
      owner_user_id: row.owner_user_id,
      direction: row.direction,
      counterparty_name: row.counterparty_name,
      counterparty_wallet: row.counterparty_wallet,
      amount_cents: row.amount_cents,
      note: row.note,
      status: row.status,
      reference: row.reference,
      pay_wallet: row.pay_wallet,
      signature: row.signature,
      created_at: row.created_at,
      cluster: row.cluster,
    });
    if (error) throw new Error(`ious.insertIou: ${error.message}`);
    return;
  }
  db.prepare(
    `INSERT INTO ious
       (id, owner_user_id, direction, counterparty_name, counterparty_wallet,
        amount_cents, note, status, reference, pay_wallet, signature, created_at,
        cluster)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.owner_user_id,
    row.direction,
    row.counterparty_name,
    row.counterparty_wallet,
    row.amount_cents,
    row.note,
    row.status,
    row.reference,
    row.pay_wallet,
    row.signature,
    row.created_at,
    row.cluster
  );
}

/** List a user's IOUs, newest first. */
async function listIous(userId: string): Promise<IouRow[]> {
  if (usingSupabase) {
    const { data, error } = await supabase()
      .from("ious")
      .select("*")
      .eq("owner_user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`ious.listIous: ${error.message}`);
    return (data as IouRow[]) ?? [];
  }
  return db
    .prepare(
      "SELECT * FROM ious WHERE owner_user_id = ? ORDER BY created_at DESC, rowid DESC"
    )
    .all(userId) as IouRow[];
}

/** Mark an IOU paid with the settling signature. */
async function markIouPaid(
  id: string,
  userId: string,
  signature: string | null
): Promise<void> {
  if (usingSupabase) {
    const { error } = await supabase()
      .from("ious")
      .update({ status: "paid", signature })
      .eq("id", id)
      .eq("owner_user_id", userId);
    if (error) throw new Error(`ious.markIouPaid: ${error.message}`);
    return;
  }
  db.prepare(
    "UPDATE ious SET status = ?, signature = ? WHERE id = ? AND owner_user_id = ?"
  ).run("paid", signature, id, userId);
}

/** Delete a user's IOU; returns true if a row was removed. */
async function deleteIou(id: string, userId: string): Promise<boolean> {
  if (usingSupabase) {
    const { count, error } = await supabase()
      .from("ious")
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("owner_user_id", userId);
    if (error) throw new Error(`ious.deleteIou: ${error.message}`);
    return (count ?? 0) > 0;
  }
  const info = db
    .prepare("DELETE FROM ious WHERE id = ? AND owner_user_id = ?")
    .run(id, userId);
  return info.changes > 0;
}

// ---- Shared verify core (authed route + public /s/ settle link) --------------

export interface IouVerifyOutcome {
  verified: boolean;
  /** The settling signature when verified; null otherwise. */
  signature: string | null;
  reason?: string;
}

/**
 * Check the chain for payment of an OPEN IOU and mark it paid exactly once.
 * The single implementation shared by the authed POST /api/ious/:id/settle/verify
 * and the public no-login POST /api/s/:reference/verify (settleLink.ts), so the
 * atomic signature dedupe (claimSignature) lives in exactly one place.
 *
 * PRECONDITIONS (each caller enforces with its own status codes): row status
 * is open, row cluster matches THIS server (B4/H1), and reference + pay_wallet
 * are present.
 */
export async function iouVerifyCore(row: IouRow): Promise<IouVerifyOutcome> {
  const connection = new Connection(rpcUrl, "confirmed");
  const result = await validatePayment(connection, {
    reference: row.reference as string,
    recipient: row.pay_wallet as string,
    splToken: USDC_MINT[cluster],
    amountCents: row.amount_cents,
  });

  let verified = result.ok;
  if (result.ok && result.signature) {
    // Global guard: one on-chain signature settles at most ONE debt across the
    // whole system (bills, trips, AND ious). Without this an IOU could be
    // discharged by a signature already spent on a bill/trip to the same
    // wallet+amount, shorting the creditor. Mark paid only after we claim it.
    const claimed = await claimSignature(result.signature, `iou:${row.id}`);
    if (!claimed) {
      alert("high", "signature_reuse_blocked", { context: "iou", iouId: row.id, signature: result.signature });
      verified = false; // already consumed elsewhere — do not double-discharge
    } else {
      await markIouPaid(row.id, row.owner_user_id, result.signature);
    }
  }

  return {
    verified,
    signature: verified ? result.signature || null : null,
    reason: verified
      ? result.reason
      : result.ok
        ? "payment already used to settle another debt"
        : result.reason,
  };
}

// ---- Router ----------------------------------------------------------------

export const iouRouter = Router();

// NOTE: requireAuth is applied PER ROUTE below (not router-wide). This router is
// mounted with app.use(iouRouter) at "/", so a router-level use(requireAuth)
// would gate every request in the app — including the public sign-in routes.

/**
 * POST /api/ious — create a one-off IOU / money request.
 */
iouRouter.post("/api/ious", writeRateLimit, requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const body = (req.body || {}) as Record<string, unknown>;

  const direction = body.direction;
  if (direction !== "i_owe" && direction !== "they_owe") {
    return res.status(400).json({ error: 'direction must be "i_owe" or "they_owe"' });
  }

  const counterpartyName = String(body.counterpartyName ?? "").trim();
  if (counterpartyName.length < 1 || counterpartyName.length > 80) {
    return res.status(400).json({ error: "counterpartyName must be 1..80 chars" });
  }

  // Amount: prefer explicit integer cents, else parse dollars total.
  let amountCents: number;
  try {
    amountCents =
      body.amountCents != null
        ? Number(body.amountCents)
        : toCents(body.total as number | string);
  } catch {
    return res.status(400).json({ error: "invalid amount" });
  }
  if (
    !Number.isInteger(amountCents) ||
    amountCents < 1 ||
    amountCents > LEDGER_MAX_CENTS
  ) {
    return res
      .status(400)
      .json({ error: `amountCents must be an integer in 1..${LEDGER_MAX_CENTS}` });
  }

  // Validate counterparty wallet, if provided.
  let counterpartyWallet: string | null = null;
  if (body.counterpartyWallet != null && String(body.counterpartyWallet).trim() !== "") {
    const w = String(body.counterpartyWallet).trim();
    try {
      // eslint-disable-next-line no-new
      new PublicKey(w);
    } catch {
      return res.status(400).json({ error: "invalid counterpartyWallet" });
    }
    counterpartyWallet = w;
  }

  const note =
    body.note != null && String(body.note).trim() !== ""
      ? String(body.note)
      : null;

  // Determine who gets paid.
  //  - i_owe:    I pay the counterparty -> their wallet.
  //  - they_owe: they pay me (a request) -> my primary wallet.
  let payWallet: string | null;
  if (direction === "i_owe") {
    payWallet = counterpartyWallet;
  } else {
    payWallet = await getPrimaryWallet(userId);
  }

  let reference: string | null = null;
  if (payWallet) {
    reference = newReference();
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await insertIou({
    id,
    owner_user_id: userId,
    direction,
    counterparty_name: counterpartyName,
    counterparty_wallet: counterpartyWallet,
    amount_cents: amountCents,
    note,
    status: "open",
    reference,
    pay_wallet: payWallet,
    signature: null,
    created_at: createdAt,
    cluster, // stamped at creation (B4) — this request pays on THIS chain only
  });

  const row = (await getOwnedIou(id, userId)) as IouRow;
  return res.status(201).json(serialize(row));
});

/**
 * GET /api/ious — list your IOUs, newest first.
 */
iouRouter.get("/api/ious", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const rows = await listIous(userId);
  return res.json(rows.map(serialize));
});

/**
 * POST /api/ious/:id/settle/verify — check the chain for payment of this IOU.
 */
iouRouter.post(
  "/api/ious/:id/settle/verify",
  moneyRateLimit,
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.userId as string;
    const row = await getOwnedIou(req.params.id, userId);
    if (!row) return res.status(404).json({ error: "not found" });

    // B4/H1: never verify an IOU stamped on a different cluster — the
    // connection below is THIS server's chain.
    if (rowCluster(row) !== cluster) {
      return res.status(409).json({
        error: clusterMismatchError(row.cluster),
        crossCluster: true,
      });
    }
    if (!row.reference || !row.pay_wallet) {
      return res
        .status(400)
        .json({ error: "this IOU has no payable request to verify" });
    }

    // The chain check + paid flip live in iouVerifyCore — shared with the
    // public no-login /api/s/:reference/verify (settleLink.ts).
    const out = await iouVerifyCore(row);

    const updated = (await getOwnedIou(row.id, userId)) as IouRow;
    return res.json({ ...serialize(updated), verified: out.verified, reason: out.reason });
  }
);

/**
 * DELETE /api/ious/:id — delete one of your IOUs.
 */
iouRouter.delete("/api/ious/:id", writeRateLimit, requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const removed = await deleteIou(req.params.id, userId);
  if (!removed) return res.status(404).json({ error: "not found" });
  return res.json({ ok: true });
});
