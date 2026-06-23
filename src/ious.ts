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
import { requireAuth } from "./auth";
import { getPrimaryWallet } from "./users";
import {
  buildSolanaPayUrl,
  newReference,
  USDC_MINT,
  Cluster,
} from "./solanaPay";
import { validatePayment } from "./verify";
import { fmt, toCents } from "./split";

// ---- Config ----------------------------------------------------------------

const cluster = (process.env.CLUSTER || "devnet") as Cluster;
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
    created_at TEXT NOT NULL
  );
`);

// ---- Types -----------------------------------------------------------------

type Direction = "i_owe" | "they_owe";

interface IouRow {
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
}

// ---- Serialization ---------------------------------------------------------

/** Rebuild the Solana Pay url from the stored reference + pay_wallet, if payable. */
function rebuildUrl(row: IouRow): string | null {
  if (!row.reference || !row.pay_wallet) return null;
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
  };
}

// ---- Helpers ---------------------------------------------------------------

function getOwnedIou(id: string, userId: string): IouRow | undefined {
  const row = db
    .prepare("SELECT * FROM ious WHERE id = ? AND owner_user_id = ?")
    .get(id, userId) as IouRow | undefined;
  return row;
}

// ---- Router ----------------------------------------------------------------

export const iouRouter = Router();

// NOTE: requireAuth is applied PER ROUTE below (not router-wide). This router is
// mounted with app.use(iouRouter) at "/", so a router-level use(requireAuth)
// would gate every request in the app — including the public sign-in routes.

/**
 * POST /api/ious — create a one-off IOU / money request.
 */
iouRouter.post("/api/ious", requireAuth, (req: Request, res: Response) => {
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
    amountCents > 100000000
  ) {
    return res
      .status(400)
      .json({ error: "amountCents must be an integer in 1..100000000" });
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
    payWallet = getPrimaryWallet(userId);
  }

  let reference: string | null = null;
  if (payWallet) {
    reference = newReference();
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO ious
       (id, owner_user_id, direction, counterparty_name, counterparty_wallet,
        amount_cents, note, status, reference, pay_wallet, signature, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    direction,
    counterpartyName,
    counterpartyWallet,
    amountCents,
    note,
    "open",
    reference,
    payWallet,
    null,
    createdAt
  );

  const row = getOwnedIou(id, userId) as IouRow;
  return res.status(201).json(serialize(row));
});

/**
 * GET /api/ious — list your IOUs, newest first.
 */
iouRouter.get("/api/ious", requireAuth, (req: Request, res: Response) => {
  const userId = req.userId as string;
  const rows = db
    .prepare(
      "SELECT * FROM ious WHERE owner_user_id = ? ORDER BY created_at DESC, rowid DESC"
    )
    .all(userId) as IouRow[];
  return res.json(rows.map(serialize));
});

/**
 * POST /api/ious/:id/settle/verify — check the chain for payment of this IOU.
 */
iouRouter.post(
  "/api/ious/:id/settle/verify",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.userId as string;
    const row = getOwnedIou(req.params.id, userId);
    if (!row) return res.status(404).json({ error: "not found" });

    if (!row.reference || !row.pay_wallet) {
      return res
        .status(400)
        .json({ error: "this IOU has no payable request to verify" });
    }

    const connection = new Connection(rpcUrl, "confirmed");
    const result = await validatePayment(connection, {
      reference: row.reference,
      recipient: row.pay_wallet,
      splToken: USDC_MINT[cluster],
      amountCents: row.amount_cents,
    });

    if (result.ok) {
      db.prepare(
        "UPDATE ious SET status = ?, signature = ? WHERE id = ? AND owner_user_id = ?"
      ).run("paid", result.signature ?? null, row.id, userId);
    }

    const updated = getOwnedIou(row.id, userId) as IouRow;
    return res.json({ ...serialize(updated), verified: result.ok, reason: result.reason });
  }
);

/**
 * DELETE /api/ious/:id — delete one of your IOUs.
 */
iouRouter.delete("/api/ious/:id", requireAuth, (req: Request, res: Response) => {
  const userId = req.userId as string;
  const info = db
    .prepare("DELETE FROM ious WHERE id = ? AND owner_user_id = ?")
    .run(req.params.id, userId);
  if (info.changes === 0) return res.status(404).json({ error: "not found" });
  return res.json({ ok: true });
});
