/**
 * server.ts — Express web app.
 *
 * API:
 *   POST /api/bills            create a bill (returns the bill with per-person URLs)
 *   GET  /api/bills            list bills
 *   GET  /api/bills/:id        fetch one bill
 *   POST /api/bills/:id/verify check the chain for payments, flip PAID
 *
 * Pages:
 *   GET  /                     mobile-first UI (public/index.html)
 *   GET  /pay/:id/:name        shareable server-rendered pay page (wallet QR +
 *                              "Pay with card" buttons) for one participant
 */

import "dotenv/config";
import * as path from "path";
import express, { Request, Response } from "express";
import { Connection, clusterApiUrl, PublicKey } from "@solana/web3.js";
import { createBill, Bill, BillFx, collectedCents, outstandingCents } from "./bill";
import { store } from "./store";
import {
  listGroups,
  createGroup,
  deleteGroup,
  getGroup,
  touchGroup,
} from "./groups";
import { validatePayment } from "./verify";
import { qrToDataUrl } from "./qr";
import { cardOptions } from "./onramp";
import { fmt, toCents, withTip, SplitMode } from "./split";
import { Cluster, buildSolanaPayUrl, newReference, USDC_MINT } from "./solanaPay";
import { computeBalances, minimalSettlement } from "./ledger";
import {
  Trip,
  SettlementTransfer,
  createTrip,
  getTrip,
  getTripByIdOrToken,
  addMember,
  updateMember,
  addExpense,
  deleteExpense,
  saveSettlement,
  getSettlement,
  claimMember,
  listTripsForUser,
  isTripAuthorized,
} from "./trips";
import {
  authOptional,
  requireAuth,
  issueNonce,
  verifySiws,
  privyConfigured,
  verifyPrivyToken,
  signSession,
} from "./auth";
import {
  upsertUserByWallet,
  upsertUserByIdentity,
  getUser,
  getPrimaryWallet,
  setHandle,
  setDisplayName,
  setIdentity,
  serializeUser,
} from "./users";
import { scanReceipt, parseDataUrl, NoScanProvider } from "./scan";
import {
  convertForeignCentsToUsd,
  convertMajorToUsd,
  formatForeign,
  isSupported,
} from "./fx";
import { dashboardRouter } from "./dashboard";
import { iouRouter } from "./ious";
import { activityRouter } from "./activity";
import { recurringRouter } from "./recurring";
import { friendsRouter } from "./friends";
import { chatRouter } from "./chat";

const PORT = Number(process.env.PORT || 3000);
const CLUSTER = (process.env.CLUSTER as Cluster) || "devnet";
const COLLECTOR =
  process.env.COLLECTOR_WALLET || "11111111111111111111111111111111"; // system program as a harmless default

function rpcUrl(cluster: Cluster): string {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  return clusterApiUrl(cluster);
}

const app = express();
// Receipt images arrive as base64 in the JSON body, so allow a larger payload.
app.use(express.json({ limit: "12mb" }));
// Optional auth: populates req.userId from a Bearer session token when present.
// NEVER blocks — anonymous/capability-link flows stay fully usable.
app.use(authOptional);
app.use(express.static(path.resolve(process.cwd(), "public")));

// Hub feature routers (cross-trip balances, one-off IOUs, activity feed).
// Each defines absolute /api paths and guards its own routes with requireAuth.
app.use(dashboardRouter);
app.use(iouRouter);
app.use(activityRouter);
app.use(recurringRouter);
app.use(friendsRouter);
app.use(chatRouter);

// ---- Auth & identity (progressive, optional) ------------------------------

app.get("/api/auth/config", (_req: Request, res: Response) => {
  res.json({ siws: true, privy: privyConfigured() });
});

app.get("/api/auth/nonce", (_req: Request, res: Response) => {
  res.json(issueNonce());
});

app.post("/api/auth/siws/verify", (req: Request, res: Response) => {
  try {
    const body = req.body as { pubkey?: string; signature?: string; message?: string };
    const pubkey = String(body.pubkey || "");
    const signatureB64 = String(body.signature || "");
    const message = String(body.message || "");
    if (!verifySiws({ pubkey, signatureB64, message })) {
      return res.status(401).json({ error: "invalid signature or nonce" });
    }
    const user = upsertUserByWallet(pubkey);
    res.json({ token: signSession(user.id), user: serializeUser(user) });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
});

app.post("/api/auth/privy/verify", async (req: Request, res: Response) => {
  if (!privyConfigured()) {
    return res.status(501).json({ error: "privy not configured" });
  }
  try {
    const body = req.body as { token?: string; wallet?: string };
    const verified = await verifyPrivyToken(String(body.token || ""));
    if (!verified) return res.status(401).json({ error: "invalid token" });
    const user = upsertUserByIdentity("privy", verified.subject, { wallet: body.wallet });
    res.json({ token: signSession(user.id), user: serializeUser(user) });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
});

app.get("/api/me", (req: Request, res: Response) => {
  if (!req.userId) return res.json({ user: null });
  const user = getUser(req.userId);
  res.json({ user: user ? serializeUser(user) : null });
});

app.patch("/api/me", requireAuth, (req: Request, res: Response) => {
  const userId = req.userId as string;
  const body = req.body as { handle?: string; displayName?: string; emoji?: string; color?: string };
  try {
    let user = getUser(userId);
    if (!user) return res.status(404).json({ error: "not found" });
    if (body.handle !== undefined) user = setHandle(userId, body.handle);
    if (body.displayName !== undefined) user = setDisplayName(userId, body.displayName);
    if (body.emoji !== undefined || body.color !== undefined) {
      user = setIdentity(userId, { emoji: body.emoji, color: body.color });
    }
    res.json({ user: serializeUser(user) });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "handle taken") return res.status(409).json({ error: msg });
    res.status(400).json({ error: msg });
  }
});

// ---- API ------------------------------------------------------------------

interface CreateBillBody {
  title?: string;
  total?: number | string; // dollars
  tipPercent?: number;
  names?: string[];
  mode?: SplitMode;
  weights?: number[];
  customCents?: number[];
  collector?: string;
  cluster?: Cluster;
  groupId?: string;
  count?: number;
  saveGroupName?: string;
  fx?: BillFx;
}

app.post("/api/bills", (req: Request, res: Response) => {
  try {
    const body = req.body as CreateBillBody;

    // Resolve participant names. Precedence: groupId > explicit names > count.
    let names = (body.names || []).map((n) => String(n).trim()).filter(Boolean);

    if (body.groupId) {
      const group = getGroup(body.groupId);
      if (!group) return res.status(404).json({ error: "group not found" });
      names = group.members.map((m) => String(m).trim()).filter(Boolean);
      touchGroup(body.groupId);
    } else if (names.length === 0 && Number.isInteger(body.count) && (body.count as number) > 0) {
      names = Array.from({ length: body.count as number }, (_v, i) => `Person ${i + 1}`);
    }

    if (names.length === 0) return res.status(400).json({ error: "need at least one name" });
    if (body.total == null) return res.status(400).json({ error: "need a total" });

    // Best-effort: persist this set of names as a reusable group. Never let a
    // group-save failure block bill creation.
    const saveGroupName = body.saveGroupName && String(body.saveGroupName).trim();
    if (saveGroupName) {
      try {
        createGroup(saveGroupName, names);
      } catch {
        /* ignore — saving a group is a convenience, not a requirement */
      }
    }

    let totalCents = toCents(body.total);
    if (body.tipPercent) totalCents = withTip(totalCents, body.tipPercent);

    const bill = createBill({
      title: body.title || "Dinner",
      cluster: body.cluster || CLUSTER,
      collector: body.collector || COLLECTOR,
      totalCents,
      names,
      mode: body.mode || "equal",
      weights: body.weights,
      customCents: body.customCents,
      fx: body.fx,
    });
    store.put(bill);
    res.json(serializeBill(bill));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/api/bills", (_req: Request, res: Response) => {
  res.json(store.all().map(serializeBill));
});

app.get("/api/bills/:id", (req: Request, res: Response) => {
  const bill = store.get(req.params.id);
  if (!bill) return res.status(404).json({ error: "not found" });
  res.json(serializeBill(bill));
});

app.post("/api/bills/:id/verify", async (req: Request, res: Response) => {
  const bill = store.get(req.params.id);
  if (!bill) return res.status(404).json({ error: "not found" });
  try {
    const connection = new Connection(rpcUrl(bill.cluster), "confirmed");
    const updated: string[] = [];
    for (const p of bill.participants) {
      if (p.paid) continue;
      // Production gate: only mark PAID once the transfer is validated at
      // "finalized" with the exact amount, token, and collector ATA.
      const valid = await validatePayment(connection, {
        reference: p.reference,
        recipient: bill.collector,
        splToken: bill.splToken,
        amountCents: p.amountCents,
      });
      if (valid.ok) {
        p.paid = true;
        p.signature = valid.signature;
        updated.push(p.name);
      }
    }
    store.put(bill);
    res.json({ ...serializeBill(bill), updated });
  } catch (err) {
    res.status(502).json({ error: `verify failed: ${(err as Error).message}` });
  }
});

// ---- Saved groups ---------------------------------------------------------

app.get("/api/groups", (_req: Request, res: Response) => {
  res.json(listGroups());
});

app.post("/api/groups", (req: Request, res: Response) => {
  const body = req.body as { name?: string; members?: string[] };
  try {
    const group = createGroup(body.name || "", body.members || []);
    res.json(group);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete("/api/groups/:id", (req: Request, res: Response) => {
  if (deleteGroup(req.params.id)) return res.json({ ok: true });
  res.status(404).json({ error: "not found" });
});

// Scan a receipt photo -> detected total (so the host can skip typing it).
// Body: { image: "data:image/jpeg;base64,..." | "<base64>" }
app.post("/api/scan", async (req: Request, res: Response) => {
  const image = (req.body as { image?: string }).image;
  if (!image || typeof image !== "string") {
    return res.status(400).json({ error: "need an image" });
  }
  try {
    const { data, mediaType } = parseDataUrl(image);
    const result = await scanReceipt(data, mediaType);

    // If the receipt is in a foreign currency, convert it to USD ONCE here so
    // the split runs on USD cents. The original amount + locked rate are echoed
    // back for transparency. Any conversion problem falls back to "as today".
    if (result.currency && result.currency !== "USD" && isSupported(result.currency)) {
      try {
        const { usdCents, rate, asOf, source } = await convertForeignCentsToUsd(
          result.totalCents,
          result.currency
        );
        return res.json({
          total: (usdCents / 100).toFixed(2), // USD dollars used for the split
          totalFmt: fmt(usdCents), // USD
          currency: result.currency,
          merchant: result.merchant,
          confidence: result.confidence,
          converted: true,
          originalAmount: result.totalCents / 100,
          originalCurrency: result.currency,
          originalFmt: formatForeign(result.totalCents / 100, result.currency),
          rate,
          fxAsOf: asOf,
          fxSource: source,
        });
      } catch {
        /* fall through to the USD/passthrough response below */
      }
    }

    res.json({
      ...result,
      totalFmt: fmt(result.totalCents),
      // Dollars for prefilling the form (the client re-derives cents via the API).
      total: (result.totalCents / 100).toFixed(2),
      converted: false,
    });
  } catch (err) {
    if (err instanceof NoScanProvider) {
      // Honest, graceful fallback: tell the client to ask for the total manually.
      return res.status(503).json({ needsManualEntry: true, error: (err as Error).message });
    }
    res.status(502).json({ error: `scan failed: ${(err as Error).message}` });
  }
});

// FX quote: convert a local-currency MAJOR amount to USD at the current locked
// rate. e.g. GET /api/fx/THB/2450 -> USD value + rate/source/timestamp.
app.get("/api/fx/:from/:amount", async (req: Request, res: Response) => {
  const from = String(req.params.from || "").toUpperCase();
  const amount = Number(req.params.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "bad amount" });
  }
  if (!isSupported(from)) {
    return res.status(400).json({ error: `unsupported currency: ${from}` });
  }
  try {
    const { usdCents, rate, asOf, source } = await convertMajorToUsd(amount, from);
    res.json({
      from,
      amount,
      rate,
      asOf,
      source,
      usdCents,
      usdFmt: fmt(usdCents),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Card on-ramp links for an arbitrary wallet + amount. Used by the embedded
// pay page to top up a freshly created wallet.
app.get("/api/onramp/:wallet/:amountCents", (req: Request, res: Response) => {
  const amountCents = Number(req.params.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return res.status(400).json({ error: "bad amount" });
  }
  try {
    // eslint-disable-next-line no-new
    new PublicKey(req.params.wallet);
  } catch {
    return res.status(400).json({ error: "bad wallet address" });
  }
  res.json(cardOptions({ walletAddress: req.params.wallet, amountCents }));
});

// ---- Trips: shared multi-payer ledger -------------------------------------

function memberName(trip: Trip, id: string): string {
  const m = trip.members.find((x) => x.id === id);
  return m ? m.name : id;
}

// ---- Trip write-auth + input validation -----------------------------------

const MAX_TRIP_NAME = 120;
const MAX_MEMBER_NAME = 80;
const MAX_EXPENSE_TITLE = 140;
const MAX_AMOUNT_CENTS = 100_000_000; // $1,000,000 cap
const MAX_MEMBERS = 50;
const MAX_EXPENSES = 2000;

/**
 * A request is authorized for a trip if EITHER it carries `X-Trip-Token`
 * matching the trip's share token, OR it carries a valid Bearer session whose
 * user is the trip owner or a claimed member of the trip.
 */
function authorizeTrip(req: Request, trip: Trip): boolean {
  const providedToken = req.header("x-trip-token") || null;
  return isTripAuthorized({
    providedToken,
    shareToken: trip.shareToken,
    userId: req.userId || null,
    ownerUserId: trip.ownerUserId || null,
    memberUserIds: trip.members.map((m) => m.userId).filter((x): x is string => !!x),
  });
}

/** Validate a Solana wallet string; throws a 400-style Error on bad input. */
function assertValidWallet(wallet: string): void {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(wallet);
  } catch {
    throw new ValidationError("invalid wallet address");
  }
}

class ValidationError extends Error {}

function assertLen(value: string, label: string, min: number, max: number): string {
  const v = String(value || "").trim();
  if (v.length < min || v.length > max) {
    throw new ValidationError(`${label} must be ${min}..${max} characters`);
  }
  return v;
}

function serializeSettlement(trip: Trip) {
  const stored = getSettlement(trip.id);
  if (!stored) return null;
  const transfers = stored.transfers.map((t: SettlementTransfer) => ({
    from: t.from,
    fromName: memberName(trip, t.from),
    to: t.to,
    toName: memberName(trip, t.to),
    amountCents: t.amountCents,
    amountFmt: fmt(t.amountCents),
    url: t.url || null,
    reference: t.reference || null,
    needsWallet: !t.url,
    paid: !!t.paid,
  }));
  const payable = transfers.filter((t) => !t.needsWallet);
  const allPaid = payable.length > 0 && payable.every((t) => t.paid);
  return { transfers, allPaid, createdAt: stored.createdAt };
}

function serializeTrip(trip: Trip) {
  const memberIds = trip.members.map((m) => m.id);
  const balances = computeBalances(
    memberIds,
    trip.expenses.map((e) => ({
      amountCents: e.amountCents,
      paidBy: e.paidBy,
      participants: e.participants,
    }))
  );
  const totalCents = trip.expenses.reduce((a, e) => a + e.amountCents, 0);

  return {
    id: trip.id,
    name: trip.name,
    shareToken: trip.shareToken,
    shareUrlPath: `/t/${trip.shareToken}`,
    cluster: trip.cluster,
    createdAt: trip.createdAt,
    ownerUserId: trip.ownerUserId || null,
    members: trip.members.map((m) => ({
      id: m.id,
      name: m.name,
      wallet: m.wallet || null,
      userId: m.userId || null,
      claimed: !!m.userId,
    })),
    expenses: trip.expenses.map((e) => ({
      id: e.id,
      title: e.title,
      amountCents: e.amountCents,
      amountFmt: fmt(e.amountCents),
      paidBy: e.paidBy,
      paidByName: memberName(trip, e.paidBy),
      participants: e.participants,
      participantNames: e.participants.map((p) => memberName(trip, p)),
      fx: e.fx || null,
      fxNote: e.fx
        ? `Originally ${formatForeign(e.fx.sourceAmount, e.fx.sourceCurrency)} ${
            e.fx.sourceCurrency
          } @ $${Number(e.fx.rate).toFixed(4)} (as of ${e.fx.asOf})`
        : null,
      createdAt: e.createdAt,
    })),
    totalCents,
    totalFmt: fmt(totalCents),
    balances: balances.map((b) => ({
      memberId: b.memberId,
      name: memberName(trip, b.memberId),
      cents: b.cents,
      fmt: fmt(Math.abs(b.cents)),
      direction: b.cents > 0 ? "owed" : b.cents < 0 ? "owes" : "settled",
    })),
    settle: serializeSettlement(trip),
  };
}

app.post("/api/trips", (req: Request, res: Response) => {
  try {
    const body = req.body as {
      name?: string;
      cluster?: Cluster;
      members?: { name?: string; wallet?: string; userId?: string }[];
    };
    const name = assertLen(String(body.name || ""), "trip name", 1, MAX_TRIP_NAME);
    const members = (body.members || [])
      .map((m) => ({ name: String(m.name || "").trim(), wallet: m.wallet, userId: m.userId }))
      .filter((m) => m.name);
    if (members.length < 1) return res.status(400).json({ error: "need at least one member" });
    if (members.length > MAX_MEMBERS) {
      return res.status(400).json({ error: `too many members (max ${MAX_MEMBERS})` });
    }
    for (const m of members) {
      assertLen(m.name, "member name", 1, MAX_MEMBER_NAME);
      if (m.wallet) assertValidWallet(String(m.wallet));
    }
    const cluster = (body.cluster || (process.env.CLUSTER as Cluster) || "devnet") as Cluster;
    // If signed in, link the creator to their own member slot (the first member,
    // typically "you") so cross-trip balances see them in this trip — unless the
    // caller already pinned that slot to a specific account.
    if (req.userId && members[0] && !members[0].userId) {
      members[0].userId = req.userId;
      if (!members[0].wallet) {
        const w = getPrimaryWallet(req.userId);
        if (w) members[0].wallet = w;
      }
    }
    // Record ownership so this trip shows up in "my trips".
    const trip = createTrip(name, cluster, members, req.userId);
    res.json(serializeTrip(trip));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

function tripSummary(trip: Trip) {
  const memberIds = trip.members.map((m) => m.id);
  const balances = computeBalances(
    memberIds,
    trip.expenses.map((e) => ({
      amountCents: e.amountCents,
      paidBy: e.paidBy,
      participants: e.participants,
    }))
  );
  const totalCents = trip.expenses.reduce((a, e) => a + e.amountCents, 0);
  return {
    id: trip.id,
    name: trip.name,
    // shareToken intentionally omitted: list summaries must not hand out
    // working capability links.
    createdAt: trip.createdAt,
    memberCount: trip.members.length,
    expenseCount: trip.expenses.length,
    totalCents,
    totalFmt: fmt(totalCents),
    settledUp: balances.every((b) => b.cents === 0),
    ownerUserId: trip.ownerUserId || null,
  };
}

app.get("/api/trips", requireAuth, (req: Request, res: Response) => {
  // Privacy-scoped: only trips the caller owns or has claimed a spot in.
  // (?mine is accepted harmlessly; it's now the only behavior.)
  const trips = listTripsForUser(req.userId as string);
  res.json(trips.map(tripSummary));
});

app.get("/api/trips/:idOrToken", (req: Request, res: Response) => {
  const trip = getTripByIdOrToken(req.params.idOrToken);
  if (!trip) return res.status(404).json({ error: "not found" });
  // Authorized if the path was the share token (capability), if X-Trip-Token
  // matches, or if the caller is the owner / a claimed member.
  const pathIsToken = req.params.idOrToken === trip.shareToken;
  if (!pathIsToken && !authorizeTrip(req, trip)) {
    return res.status(403).json({ error: "not authorized for this trip" });
  }
  // They have access, so the full trip MAY include the shareToken.
  res.json(serializeTrip(trip));
});

app.post("/api/trips/:id/members", (req: Request, res: Response) => {
  try {
    const body = req.body as { name?: string; wallet?: string };
    const existing = getTrip(req.params.id);
    if (!existing) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, existing)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    if (existing.members.length >= MAX_MEMBERS) {
      return res.status(400).json({ error: `too many members (max ${MAX_MEMBERS})` });
    }
    const name = assertLen(String(body.name || ""), "member name", 1, MAX_MEMBER_NAME);
    if (body.wallet) assertValidWallet(String(body.wallet));
    const trip = addMember(req.params.id, { name, wallet: body.wallet });
    res.json(serializeTrip(trip));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.patch("/api/trips/:id/members/:mid", (req: Request, res: Response) => {
  try {
    const body = req.body as { name?: string; wallet?: string };
    const existing = getTrip(req.params.id);
    if (!existing) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, existing)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    const member = existing.members.find((m) => m.id === req.params.mid);
    if (!member) return res.status(404).json({ error: "member not found" });

    // Wallet changes are a payout redirect — require a SESSION check beyond the
    // capability token: the caller must be the trip owner OR own this member.
    if (body.wallet !== undefined && body.wallet) {
      assertValidWallet(String(body.wallet));
      const isOwner = !!req.userId && existing.ownerUserId === req.userId;
      const isSelf = !!req.userId && member.userId === req.userId;
      if (!isOwner && !isSelf) {
        return res.status(403).json({ error: "not authorized for this trip" });
      }
    }
    if (body.name !== undefined) {
      assertLen(String(body.name), "member name", 1, MAX_MEMBER_NAME);
    }
    const trip = updateMember(req.params.id, req.params.mid, body);
    res.json(serializeTrip(trip));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Claim your spot: a signed-in user takes over a member slot so settle-up routes
// to their primary wallet. Requires auth; the capability link still governs who
// can SEE the trip (per-member action authz is a fast-follow).
app.post("/api/trips/:id/members/:mid/claim", requireAuth, (req: Request, res: Response) => {
  try {
    const userId = req.userId as string;
    const existing = getTrip(req.params.id);
    if (!existing) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, existing)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    const wallet = getPrimaryWallet(userId);
    if (!wallet) return res.status(400).json({ error: "link a wallet first" });
    const trip = claimMember(req.params.id, req.params.mid, userId, wallet);
    res.json(serializeTrip(trip));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/trips/:id/expenses", (req: Request, res: Response) => {
  try {
    const trip = getTrip(req.params.id);
    if (!trip) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, trip)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    const body = req.body as {
      title?: string;
      total?: number | string;
      amountCents?: number;
      paidBy?: string;
      participants?: string[];
      fx?: any;
    };
    if (trip.expenses.length >= MAX_EXPENSES) {
      return res.status(400).json({ error: `too many expenses (max ${MAX_EXPENSES})` });
    }
    const amountCents = body.amountCents ?? (body.total != null ? toCents(body.total) : NaN);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return res.status(400).json({ error: "need a positive amount (total or amountCents)" });
    }
    if (amountCents > MAX_AMOUNT_CENTS) {
      return res.status(400).json({ error: `amount exceeds cap ($${MAX_AMOUNT_CENTS / 100})` });
    }
    if (body.title !== undefined && String(body.title).trim()) {
      assertLen(String(body.title), "expense title", 1, MAX_EXPENSE_TITLE);
    }
    const participants =
      body.participants && body.participants.length > 0
        ? body.participants
        : trip.members.map((m) => m.id);
    if (participants.length === 0) {
      return res.status(400).json({ error: "need at least one participant" });
    }
    const updated = addExpense(req.params.id, {
      title: String(body.title || ""),
      amountCents,
      paidBy: String(body.paidBy || ""),
      participants,
      fx: body.fx,
    });
    res.json(serializeTrip(updated));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete("/api/trips/:id/expenses/:eid", (req: Request, res: Response) => {
  try {
    const existing = getTrip(req.params.id);
    if (!existing) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, existing)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    const trip = deleteExpense(req.params.id, req.params.eid);
    res.json(serializeTrip(trip));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/trips/:id/settle", (req: Request, res: Response) => {
  try {
    const trip = getTrip(req.params.id);
    if (!trip) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, trip)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }

    const memberIds = trip.members.map((m) => m.id);
    const balances = computeBalances(
      memberIds,
      trip.expenses.map((e) => ({
        amountCents: e.amountCents,
        paidBy: e.paidBy,
        participants: e.participants,
      }))
    );
    const plan = minimalSettlement(balances);

    // Signature pins the settlement to the current set of balances. If nothing
    // material changed, reuse the stored transfers (preserving references/urls/paid).
    const signature = JSON.stringify(
      [...balances].sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0))
    );
    const existing = getSettlement(trip.id);

    let transfers: SettlementTransfer[];
    if (existing && existing.signature === signature) {
      transfers = existing.transfers;
    } else {
      transfers = plan.map((t) => {
        const recipient = trip.members.find((m) => m.id === t.to);
        if (recipient && recipient.wallet) {
          const reference = newReference();
          const url = buildSolanaPayUrl({
            recipient: recipient.wallet,
            amountCents: t.amountCents,
            splToken: USDC_MINT[trip.cluster],
            reference,
            label: trip.name,
            message: `${memberName(trip, t.from)} → ${memberName(trip, t.to)}`,
          });
          return { ...t, reference, url, paid: false };
        }
        return { ...t, reference: null, url: null, paid: false };
      });
      saveSettlement(trip.id, signature, transfers);
    }

    res.json(serializeTrip(getTrip(trip.id) as Trip));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/trips/:id/settle/verify", async (req: Request, res: Response) => {
  const trip = getTrip(req.params.id);
  if (!trip) return res.status(404).json({ error: "not found" });
  if (!authorizeTrip(req, trip)) {
    return res.status(403).json({ error: "not authorized for this trip" });
  }
  const stored = getSettlement(trip.id);
  if (!stored) return res.status(400).json({ error: "no settlement to verify; call /settle first" });
  try {
    const connection = new Connection(rpcUrl(trip.cluster), "confirmed");
    for (const t of stored.transfers) {
      if (t.paid) continue;
      const recipient = trip.members.find((m) => m.id === t.to);
      if (!t.reference || !recipient || !recipient.wallet) continue;
      const valid = await validatePayment(connection, {
        reference: t.reference,
        recipient: recipient.wallet,
        splToken: USDC_MINT[trip.cluster],
        amountCents: t.amountCents,
      });
      if (valid.ok) t.paid = true;
    }
    saveSettlement(trip.id, stored.signature, stored.transfers);
    res.json(serializeTrip(getTrip(trip.id) as Trip));
  } catch (err) {
    res.status(502).json({ error: `verify failed: ${(err as Error).message}` });
  }
});

// Shareable SPA link: the frontend reads the token from the path. Declared
// before any catch-all; it doesn't shadow /api or static assets.
app.get("/t/:token", (_req: Request, res: Response) => {
  res.sendFile(path.resolve(process.cwd(), "public/index.html"));
});

// ---- Pay page (server-rendered) -------------------------------------------

app.get("/pay/:id/:name", async (req: Request, res: Response) => {
  const bill = store.get(req.params.id);
  if (!bill) return res.status(404).send("Bill not found");
  const name = decodeURIComponent(req.params.name);
  const p = bill.participants.find((x) => x.name === name);
  if (!p) return res.status(404).send("Participant not found");

  const qr = await qrToDataUrl(p.url);
  const cards = cardOptions({ walletAddress: bill.collector, amountCents: p.amountCents });
  res.type("html").send(renderPayPage(bill, name, p.url, p.amountCents, qr, cards, p.paid));
});

// ---- helpers --------------------------------------------------------------

function serializeBill(bill: Bill) {
  const fxNote = bill.fx
    ? `Originally ${formatForeign(bill.fx.sourceAmount, bill.fx.sourceCurrency)} ${
        bill.fx.sourceCurrency
      } @ $${bill.fx.rate.toFixed(4)} (as of ${bill.fx.asOf})`
    : undefined;
  return {
    ...bill,
    totalFmt: fmt(bill.totalCents),
    collectedFmt: fmt(collectedCents(bill)),
    outstandingFmt: fmt(outstandingCents(bill)),
    settled: outstandingCents(bill) === 0,
    fx: bill.fx ?? null,
    ...(fxNote ? { fxNote } : {}),
    participants: bill.participants.map((p) => ({
      ...p,
      amountFmt: fmt(p.amountCents),
      payPath: `/pay/${bill.id}/${encodeURIComponent(p.name)}`,
    })),
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

function renderPayPage(
  bill: Bill,
  name: string,
  url: string,
  amountCents: number,
  qrDataUrl: string,
  cards: { moonpay: string; coinbase: string },
  paid: boolean
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(bill.title)} — ${esc(name)}'s share</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 24px;
         max-width: 480px; margin-inline: auto; line-height: 1.5; }
  h1 { font-size: 1.25rem; margin: 0 0 4px; }
  .muted { color: #888; font-size: .9rem; }
  .amount { font-size: 2.25rem; font-weight: 700; margin: 12px 0; }
  .card { border: 1px solid #8884; border-radius: 14px; padding: 18px; margin: 16px 0; text-align: center; }
  img.qr { width: 260px; height: 260px; image-rendering: pixelated; }
  a.btn { display: block; padding: 14px; border-radius: 12px; text-decoration: none;
          font-weight: 600; margin: 8px 0; border: 1px solid #8884; }
  a.btn.primary { background: #14f195; color: #04121a; }
  .paid { background: #14f195; color: #04121a; padding: 10px; border-radius: 10px; text-align:center; font-weight:700; }
  code { word-break: break-all; font-size: .75rem; color:#888; }
</style>
</head>
<body>
  <h1>${esc(bill.title)}</h1>
  <div class="muted">${esc(name)}'s share · settle in USDC on ${esc(bill.cluster)}</div>
  <div class="amount">${fmt(amountCents)}</div>
  ${paid ? `<div class="paid">✓ Paid — thank you!</div>` : `
  <div class="card">
    <strong>Pay with a Solana wallet</strong>
    <div class="muted">Scan with Phantom, Solflare, etc.</div>
    <p><img class="qr" src="${qrDataUrl}" alt="Solana Pay QR" /></p>
    <a class="btn primary" href="${esc(url)}">Open in wallet</a>
    <code>${esc(url)}</code>
  </div>
  <div class="card">
    <strong>No crypto? Pay with card</strong>
    <div class="muted">Buys USDC and sends it to the collector.</div>
    <a class="btn" href="${esc(cards.moonpay)}" target="_blank" rel="noopener">Pay with card · MoonPay</a>
    <a class="btn" href="${esc(cards.coinbase)}" target="_blank" rel="noopener">Pay with card · Coinbase</a>
  </div>
  <div class="card">
    <strong>No wallet at all?</strong>
    <div class="muted">Sign in with email/phone — we make you a wallet, no seed phrase.</div>
    <a class="btn" href="/embedded/?bill=${esc(bill.id)}&name=${encodeURIComponent(name)}">Create a wallet &amp; pay</a>
  </div>`}
  <p class="muted">Collector: <code>${esc(bill.collector)}</code></p>
</body>
</html>`;
}

if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Divvy web app on http://localhost:${PORT}  (cluster: ${CLUSTER})`);
    if (COLLECTOR === "11111111111111111111111111111111") {
      // eslint-disable-next-line no-console
      console.log("⚠  COLLECTOR_WALLET not set — using a placeholder. Set it in .env.");
    }
  });
}

export { app };
