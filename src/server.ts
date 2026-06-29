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
import express, { Request, Response, NextFunction } from "express";
// Patches Express 4 so a rejected promise from an async route handler is routed
// to the error-handling middleware instead of becoming an unhandled rejection
// that crashes the process. Must be imported before routes are registered.
import "express-async-errors";
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
import { computeBalances, minimalSettlement, Transfer } from "./ledger";
import {
  Trip,
  SettlementTransfer,
  createTrip,
  getTrip,
  getTripByIdOrToken,
  addMember,
  updateMember,
  addExpense,
  editExpense,
  deleteExpense,
  saveSettlement,
  getSettlement,
  claimMember,
  listTripsForUser,
  isTripAuthorized,
  listAllSettlements,
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
import { fundingConfigured, fundWallet } from "./funding";
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
import { reactionsRouter } from "./reactions";

const PORT = Number(process.env.PORT || 3000);
const CLUSTER = (process.env.CLUSTER as Cluster) || "devnet";

/**
 * Tiny in-memory IP rate limiter — fixed window, no external dependency.
 * Tracks recent request timestamps per IP in a Map and rejects with 429 once a
 * client exceeds `max` requests within `windowMs`. Intended for the handful of
 * abuse-prone endpoints (auth nonce/verify, external scan provider).
 */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: () => void): void => {
    const now = Date.now();
    const ip = req.ip || "unknown";
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      // Opportunistically prune stale IPs so the Map can't grow unbounded.
      if (hits.size > 10000) {
        for (const [k, v] of hits) {
          if (v.every((t) => now - t >= windowMs)) hits.delete(k);
        }
      }
      res.status(429).json({ error: "too many requests, slow down" });
      return;
    }
    recent.push(now);
    hits.set(ip, recent);
    next();
  };
}

const authRateLimit = rateLimit(60, 60_000); // ~60 req/min
const scanRateLimit = rateLimit(10, 60_000); // ~10 req/min
const COLLECTOR =
  process.env.COLLECTOR_WALLET || "11111111111111111111111111111111"; // system program as a harmless default

function rpcUrl(cluster: Cluster): string {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  return clusterApiUrl(cluster);
}

const app = express();
// Behind Railway's (single) reverse proxy, trust exactly one hop so req.ip is the
// real client X-Forwarded-For address — NOT the shared proxy IP (which would make
// the per-IP rate limiter throttle all users as one bucket). A specific hop count
// (not `true`) keeps X-Forwarded-For unspoofable by clients.
app.set("trust proxy", 1);
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
app.use(reactionsRouter);

// ---- Auth & identity (progressive, optional) ------------------------------

app.get("/api/auth/config", (_req: Request, res: Response) => {
  res.json({ siws: true, privy: privyConfigured() });
});

app.get("/api/auth/nonce", authRateLimit, (_req: Request, res: Response) => {
  res.json(issueNonce());
});

app.post("/api/auth/siws/verify", authRateLimit, async (req: Request, res: Response) => {
  try {
    const body = req.body as { pubkey?: string; signature?: string; message?: string };
    const pubkey = String(body.pubkey || "");
    const signatureB64 = String(body.signature || "");
    const message = String(body.message || "");
    if (!verifySiws({ pubkey, signatureB64, message })) {
      return res.status(401).json({ error: "invalid signature or nonce" });
    }
    const user = await upsertUserByWallet(pubkey);
    res.json({ token: signSession(user.id), user: await serializeUser(user) });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
});

app.post("/api/auth/privy/verify", authRateLimit, async (req: Request, res: Response) => {
  if (!privyConfigured()) {
    return res.status(501).json({ error: "privy not configured" });
  }
  try {
    const body = req.body as { token?: string; wallet?: string };
    const verified = await verifyPrivyToken(String(body.token || ""));
    if (!verified) return res.status(401).json({ error: "invalid token" });
    const user = await upsertUserByIdentity("privy", verified.subject, { wallet: body.wallet });
    res.json({ token: signSession(user.id), user: await serializeUser(user) });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
});

app.get("/api/me", async (req: Request, res: Response) => {
  if (!req.userId) return res.json({ user: null });
  const user = await getUser(req.userId);
  res.json({ user: user ? await serializeUser(user) : null });
});

app.patch("/api/me", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const body = req.body as { handle?: string; displayName?: string; emoji?: string; color?: string };
  try {
    let user = await getUser(userId);
    if (!user) return res.status(404).json({ error: "not found" });
    if (body.handle !== undefined) user = await setHandle(userId, body.handle);
    if (body.displayName !== undefined) user = await setDisplayName(userId, body.displayName);
    if (body.emoji !== undefined || body.color !== undefined) {
      user = await setIdentity(userId, { emoji: body.emoji, color: body.color });
    }
    res.json({ user: await serializeUser(user) });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "handle taken") return res.status(409).json({ error: msg });
    res.status(400).json({ error: msg });
  }
});

// On-chain USDC balance of the signed-in user's primary wallet (read-only).
app.get("/api/me/wallet", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const wallet = await getPrimaryWallet(userId);
  if (!wallet) return res.json({ wallet: null, usdcCents: null, usdcFmt: null });
  try {
    const connection = new Connection(rpcUrl(CLUSTER), "confirmed");
    const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(wallet), {
      mint: new PublicKey(USDC_MINT[CLUSTER]),
    });
    // Sum base units (6-decimal integer strings) as BigInt, then floor to cents.
    // Never round a float uiAmount: that can disagree by a cent with the floored
    // amount used at pay time, surfacing as a confusing "insufficient funds".
    let baseUnits = 0n;
    for (const a of accounts.value) {
      const raw = (a.account.data as any).parsed?.info?.tokenAmount?.amount;
      if (typeof raw === "string" && /^\d+$/.test(raw)) baseUnits += BigInt(raw);
    }
    const usdcCents = Number(baseUnits / 10000n); // 6 decimals -> cents = /10^4
    res.json({ wallet, usdcCents, usdcFmt: fmt(usdcCents), cluster: CLUSTER });
  } catch (err) {
    // Network hiccup / no token account → report null rather than failing the screen.
    res.json({ wallet, usdcCents: null, usdcFmt: null, error: (err as Error).message });
  }
});

// Devnet demo funding: drip a little gas SOL + mint test-USDC to the caller's
// wallet so a freshly created wallet can actually settle. No-op (501) when the
// treasury isn't configured. Devnet/test value only.
app.post("/api/me/fund", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  if (CLUSTER !== "devnet" || !fundingConfigured()) {
    return res.status(501).json({ error: "funding not available" });
  }
  const wallet = await getPrimaryWallet(userId);
  if (!wallet) return res.status(400).json({ error: "link a wallet first" });
  try {
    const r = await fundWallet(wallet);
    res.json({
      wallet,
      sol: r.sol,
      usdcCents: Math.round(r.usdc * 100),
      usdcFmt: fmt(Math.round(r.usdc * 100)),
      funded: r.solDripped || r.usdcMinted,
    });
  } catch (err) {
    const status = isRpcFailure(err) ? 502 : 400;
    res.status(status).json({ error: `funding failed: ${(err as Error).message}` });
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

app.post("/api/bills", async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateBillBody;

    // Resolve participant names. Precedence: groupId > explicit names > count.
    let names = (body.names || []).map((n) => String(n).trim()).filter(Boolean);

    if (body.groupId) {
      const group = await getGroup(body.groupId);
      if (!group) return res.status(404).json({ error: "group not found" });
      names = group.members.map((m) => String(m).trim()).filter(Boolean);
      await touchGroup(body.groupId);
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
        await createGroup(saveGroupName, names);
      } catch {
        /* ignore — saving a group is a convenience, not a requirement */
      }
    }

    let totalCents = toCents(body.total);
    if (body.tipPercent) totalCents = withTip(totalCents, body.tipPercent);
    // Reject non-positive totals (a tiny foreign amount can round to $0.00 via the
    // FX path) — a $0 bill with payable URLs is junk state, and pairs badly with
    // any 0-amount verify match. Mirrors the trip-expense guard.
    if (totalCents <= 0) {
      return res.status(400).json({ error: "amount must be greater than $0" });
    }
    if (totalCents > MAX_AMOUNT_CENTS) {
      return res.status(400).json({ error: `amount exceeds cap ($${MAX_AMOUNT_CENTS / 100})` });
    }

    // The collector is WHO GETS PAID. Bind it to the signed-in creator's own
    // wallet so a standalone tab pays them — never the system-program placeholder
    // (money sent there is unspendable). Fall back to an explicit body.collector,
    // then refuse rather than silently collecting to the placeholder.
    const SYSTEM_PROGRAM = "11111111111111111111111111111111";
    const creatorWallet = req.userId ? await getPrimaryWallet(req.userId) : null;
    const collector = creatorWallet || body.collector || COLLECTOR;
    if (!collector || collector === SYSTEM_PROGRAM) {
      return res
        .status(400)
        .json({ error: "create or link a wallet before sending a tab" });
    }

    const bill = createBill({
      title: body.title || "Dinner",
      cluster: body.cluster || CLUSTER,
      creatorUserId: req.userId || undefined,
      collector,
      totalCents,
      names,
      mode: body.mode || "equal",
      weights: body.weights,
      customCents: body.customCents,
      fx: body.fx,
    });
    await store.put(bill);
    res.json(serializeBill(bill));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// The caller's own bills (standalone "tabs"), newest first, as lightweight
// summaries for the home screen. Scoped to creatorUserId so one user never
// sees another's tabs.
app.get("/api/me/bills", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const myWallet = await getPrimaryWallet(userId);
  const all = await store.all();
  const mine = all.filter(
    (b) => b.creatorUserId === userId || (!!myWallet && b.collector === myWallet)
  );
  // Backfill ownership on legacy bills created before creatorUserId existed:
  // a bill's collector is bound to its creator's primary wallet, so a match is
  // authoritative. Persist it best-effort so later queries are a clean id match.
  for (const b of mine) {
    if (!b.creatorUserId && myWallet && b.collector === myWallet) {
      b.creatorUserId = userId;
      try { await store.put(b); } catch { /* non-fatal */ }
    }
  }
  res.json({ bills: mine.map(billSummary) });
});

app.get("/api/bills/:id", async (req: Request, res: Response) => {
  const bill = await store.get(req.params.id);
  if (!bill) return res.status(404).json({ error: "not found" });
  res.json(serializeBill(bill));
});

app.post("/api/bills/:id/verify", requireAuth, async (req: Request, res: Response) => {
  const bill = await store.get(req.params.id);
  if (!bill) return res.status(404).json({ error: "not found" });
  try {
    const connection = new Connection(rpcUrl(bill.cluster), "confirmed");
    const updated: string[] = [];
    // Signatures already credited — one on-chain payment settles at most one share.
    const usedSigs = new Set<string>(
      bill.participants.filter((p) => p.paid && p.signature).map((p) => p.signature as string)
    );
    for (const p of bill.participants) {
      if (p.paid) continue;
      // Production gate: only mark PAID once the transfer is validated at
      // "finalized" with the exact amount, token, and collector ATA — and the
      // settling signature hasn't already been credited to another participant.
      const valid = await validatePayment(connection, {
        reference: p.reference,
        recipient: bill.collector,
        splToken: bill.splToken,
        amountCents: p.amountCents,
      }, { excludeSignatures: usedSigs });
      if (valid.ok) {
        p.paid = true;
        p.signature = valid.signature;
        if (valid.signature) usedSigs.add(valid.signature);
        updated.push(p.name);
      }
    }
    await store.put(bill);
    res.json({ ...serializeBill(bill), updated });
  } catch (err) {
    const status = isRpcFailure(err) ? 502 : 400;
    res.status(status).json({ error: `verify failed: ${(err as Error).message}` });
  }
});

// ---- Saved groups ---------------------------------------------------------

app.get("/api/groups", requireAuth, async (_req: Request, res: Response) => {
  res.json(await listGroups());
});

app.post("/api/groups", requireAuth, async (req: Request, res: Response) => {
  const body = req.body as { name?: string; members?: string[] };
  try {
    const group = await createGroup(body.name || "", body.members || []);
    res.json(group);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete("/api/groups/:id", requireAuth, async (req: Request, res: Response) => {
  if (await deleteGroup(req.params.id)) return res.json({ ok: true });
  res.status(404).json({ error: "not found" });
});

// Scan a receipt photo -> detected total (so the host can skip typing it).
// Body: { image: "data:image/jpeg;base64,..." | "<base64>" }
app.post("/api/scan", requireAuth, scanRateLimit, async (req: Request, res: Response) => {
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

/**
 * Heuristic: is this error a genuine RPC/network failure (→ 502) rather than a
 * bad-input/validation problem (→ 400)? Network errors from web3.js / fetch
 * surface as connection/timeout/fetch/DNS-style messages; everything else
 * (e.g. a malformed PublicKey thrown synchronously) is treated as bad input.
 */
function isRpcFailure(err: unknown): boolean {
  const msg = (err as Error)?.message || "";
  return /network|fetch|timeout|ECONN|ENOTFOUND|EAI_AGAIN|socket|rpc|503|502|429|failed to|getaddrinfo/i.test(
    msg
  );
}

function assertLen(value: string, label: string, min: number, max: number): string {
  const v = String(value || "").trim();
  if (v.length < min || v.length > max) {
    throw new ValidationError(`${label} must be ${min}..${max} characters`);
  }
  return v;
}

async function serializeSettlement(trip: Trip) {
  const stored = await getSettlement(trip.id);
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

async function serializeTrip(trip: Trip) {
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
    members: await Promise.all(trip.members.map(async (m) => {
      // A linked member shows that account's chosen emoji/color; otherwise the
      // member's own deterministic identity.
      const linked = m.userId ? await getUser(m.userId) : undefined;
      return {
        id: m.id,
        name: m.name,
        wallet: m.wallet || null,
        userId: m.userId || null,
        claimed: !!m.userId,
        emoji: (linked && linked.emoji) || m.emoji || null,
        color: (linked && linked.color) || m.color || null,
      };
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
    settle: await serializeSettlement(trip),
  };
}

app.post("/api/trips", async (req: Request, res: Response) => {
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
        const w = await getPrimaryWallet(req.userId);
        if (w) members[0].wallet = w;
      }
    }
    // Record ownership so this trip shows up in "my trips".
    const trip = await createTrip(name, cluster, members, req.userId);
    res.json(await serializeTrip(trip));
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

app.get("/api/trips", requireAuth, async (req: Request, res: Response) => {
  // Privacy-scoped: only trips the caller owns or has claimed a spot in.
  // (?mine is accepted harmlessly; it's now the only behavior.)
  const trips = await listTripsForUser(req.userId as string);
  res.json(trips.map(tripSummary));
});

app.get("/api/trips/:idOrToken", async (req: Request, res: Response) => {
  const trip = await getTripByIdOrToken(req.params.idOrToken);
  if (!trip) return res.status(404).json({ error: "not found" });
  // Authorized if the path was the share token (capability), if X-Trip-Token
  // matches, or if the caller is the owner / a claimed member.
  const pathIsToken = req.params.idOrToken === trip.shareToken;
  if (!pathIsToken && !authorizeTrip(req, trip)) {
    return res.status(403).json({ error: "not authorized for this trip" });
  }
  // They have access, so the full trip MAY include the shareToken.
  res.json(await serializeTrip(trip));
});

app.post("/api/trips/:id/members", async (req: Request, res: Response) => {
  try {
    const body = req.body as { name?: string; wallet?: string };
    const existing = await getTrip(req.params.id);
    if (!existing) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, existing)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    if (existing.members.length >= MAX_MEMBERS) {
      return res.status(400).json({ error: `too many members (max ${MAX_MEMBERS})` });
    }
    const name = assertLen(String(body.name || ""), "member name", 1, MAX_MEMBER_NAME);
    if (body.wallet) assertValidWallet(String(body.wallet));
    const trip = await addMember(req.params.id, { name, wallet: body.wallet });
    res.json(await serializeTrip(trip));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.patch("/api/trips/:id/members/:mid", async (req: Request, res: Response) => {
  try {
    const body = req.body as { name?: string; wallet?: string };
    const existing = await getTrip(req.params.id);
    if (!existing) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, existing)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    const member = existing.members.find((m) => m.id === req.params.mid);
    if (!member) return res.status(404).json({ error: "member not found" });

    // Wallet changes are a payout redirect — require a SESSION check beyond the
    // capability token: the caller must be the trip owner OR own this member.
    // This guards ANY wallet modification, including CLEARING it (null/"") — a
    // share-token holder must not be able to wipe a creditor's payout address.
    if (body.wallet !== undefined) {
      const isOwner = !!req.userId && existing.ownerUserId === req.userId;
      const isSelf = !!req.userId && member.userId === req.userId;
      if (!isOwner && !isSelf) {
        return res.status(403).json({ error: "not authorized for this trip" });
      }
      if (body.wallet) assertValidWallet(String(body.wallet));
    }
    if (body.name !== undefined) {
      assertLen(String(body.name), "member name", 1, MAX_MEMBER_NAME);
    }
    const trip = await updateMember(req.params.id, req.params.mid, body);
    res.json(await serializeTrip(trip));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Claim your spot: a signed-in user takes over a member slot so settle-up routes
// to their primary wallet. Requires auth; the capability link still governs who
// can SEE the trip (per-member action authz is a fast-follow).
app.post("/api/trips/:id/members/:mid/claim", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId as string;
    const existing = await getTrip(req.params.id);
    if (!existing) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, existing)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    const wallet = await getPrimaryWallet(userId);
    if (!wallet) return res.status(400).json({ error: "link a wallet first" });
    const trip = await claimMember(req.params.id, req.params.mid, userId, wallet);
    res.json(await serializeTrip(trip));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/trips/:id/expenses", async (req: Request, res: Response) => {
  try {
    const trip = await getTrip(req.params.id);
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
    const updated = await addExpense(req.params.id, {
      title: String(body.title || ""),
      amountCents,
      paidBy: String(body.paidBy || ""),
      participants,
      fx: body.fx,
    });
    res.json(await serializeTrip(updated));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.patch("/api/trips/:id/expenses/:eid", async (req: Request, res: Response) => {
  try {
    const trip = await getTrip(req.params.id);
    if (!trip) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, trip)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    const body = req.body as {
      title?: string;
      amountCents?: number;
      paidBy?: string;
      participants?: string[];
    };
    const patch: {
      title?: string;
      amountCents?: number;
      paidBy?: string;
      participants?: string[];
    } = {};
    if (body.title !== undefined) {
      if (String(body.title).trim()) {
        assertLen(String(body.title), "expense title", 1, MAX_EXPENSE_TITLE);
      }
      patch.title = String(body.title);
    }
    if (body.amountCents !== undefined) {
      const amountCents = body.amountCents;
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        return res.status(400).json({ error: "need a positive amountCents" });
      }
      if (amountCents > MAX_AMOUNT_CENTS) {
        return res.status(400).json({ error: `amount exceeds cap ($${MAX_AMOUNT_CENTS / 100})` });
      }
      patch.amountCents = amountCents;
    }
    if (body.paidBy !== undefined) patch.paidBy = String(body.paidBy);
    if (body.participants !== undefined) patch.participants = body.participants;

    const updated = await editExpense(req.params.id, req.params.eid, patch);
    res.json(await serializeTrip(updated));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete("/api/trips/:id/expenses/:eid", async (req: Request, res: Response) => {
  try {
    const existing = await getTrip(req.params.id);
    if (!existing) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, existing)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    const trip = await deleteExpense(req.params.id, req.params.eid);
    res.json(await serializeTrip(trip));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/trips/:id/settle", async (req: Request, res: Response) => {
  try {
    const trip = await getTrip(req.params.id);
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
    const existing = await getSettlement(trip.id);

    // Index the prior settlement's legs by identity (from→to, amount). When the
    // balance signature changes (an expense was added/edited), an UNCHANGED leg
    // must keep its existing reference/url/paid — otherwise a payment already
    // made against the old reference would never verify after the regeneration
    // overwrites it. Only genuinely new/changed legs get a fresh reference.
    const legKey = (t: { from: string; to: string; amountCents: number }) =>
      `${t.from}|${t.to}|${t.amountCents}`;
    const priorByLeg = new Map<string, SettlementTransfer>();
    for (const t of existing?.transfers || []) priorByLeg.set(legKey(t), t);

    // Build a payable transfer for a plan edge, or a wallet-less stub if the
    // recipient has no wallet yet.
    const buildTransfer = (t: Transfer): SettlementTransfer => {
      const recipient = trip.members.find((m) => m.id === t.to);
      if (recipient && recipient.wallet) {
        const prior = priorByLeg.get(legKey(t));
        // Reuse a still-valid reference/url for an identical leg so any payment
        // already in flight against it stays detectable.
        const reference = (prior && prior.reference) || newReference();
        const url =
          (prior && prior.url) ||
          buildSolanaPayUrl({
            recipient: recipient.wallet,
            amountCents: t.amountCents,
            splToken: USDC_MINT[trip.cluster],
            reference,
            label: trip.name,
            message: `${memberName(trip, t.from)} → ${memberName(trip, t.to)}`,
          });
        return { ...t, reference, url, paid: !!(prior && prior.paid) };
      }
      return { ...t, reference: null, url: null, paid: false };
    };

    let transfers: SettlementTransfer[];
    if (existing && existing.signature === signature) {
      // Reuse the cached plan, but FILL IN any transfer whose recipient has
      // gained a wallet since it was built (url still null). The balance-only
      // signature doesn't change when a member adds a wallet, so without this a
      // newly-claimed creditor would never get a payable link.
      let changed = false;
      transfers = existing.transfers.map((t) => {
        if (!t.url && !t.paid) {
          const recipient = trip.members.find((m) => m.id === t.to);
          if (recipient && recipient.wallet) {
            changed = true;
            return buildTransfer(t);
          }
        }
        return t;
      });
      if (changed) await saveSettlement(trip.id, signature, transfers);
    } else {
      transfers = plan.map(buildTransfer);
      await saveSettlement(trip.id, signature, transfers);
    }

    res.json(await serializeTrip(await getTrip(trip.id) as Trip));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/trips/:id/settle/verify", async (req: Request, res: Response) => {
  const trip = await getTrip(req.params.id);
  if (!trip) return res.status(404).json({ error: "not found" });
  if (!authorizeTrip(req, trip)) {
    return res.status(403).json({ error: "not authorized for this trip" });
  }
  const stored = await getSettlement(trip.id);
  if (!stored) return res.status(400).json({ error: "no settlement to verify; call /settle first" });
  try {
    const connection = new Connection(rpcUrl(trip.cluster), "confirmed");
    // Signatures already credited (this pass or a prior one) — one on-chain
    // payment settles at most one transfer.
    const usedSigs = new Set<string>(
      stored.transfers.filter((t) => t.paid && (t as any).signature).map((t) => (t as any).signature as string)
    );
    for (const t of stored.transfers) {
      if (t.paid) continue;
      const recipient = trip.members.find((m) => m.id === t.to);
      if (!t.reference || !recipient || !recipient.wallet) continue;
      const valid = await validatePayment(connection, {
        reference: t.reference,
        recipient: recipient.wallet,
        splToken: USDC_MINT[trip.cluster],
        amountCents: t.amountCents,
      }, { excludeSignatures: usedSigs });
      if (valid.ok) {
        t.paid = true;
        (t as any).signature = valid.signature; // record the on-chain sig for receipts/lookups
        if (valid.signature) usedSigs.add(valid.signature);
      }
    }
    await saveSettlement(trip.id, stored.signature, stored.transfers);
    res.json(await serializeTrip(await getTrip(trip.id) as Trip));
  } catch (err) {
    const status = isRpcFailure(err) ? 502 : 400;
    res.status(status).json({ error: `verify failed: ${(err as Error).message}` });
  }
});

// ---- Receipts -------------------------------------------------------------
// Look up a single payment by its Solana Pay reference OR confirmed signature,
// across both settlement transfers and bill participants. Returns the receipt
// fields, or { found:false } (HTTP 200) when nothing matches.
app.get("/api/receipts/:ref", requireAuth, async (req: Request, res: Response) => {
  const ref = String(req.params.ref || "");
  if (!ref) return res.json({ found: false });
  const userId = req.userId as string;

  // 1) Settlement transfers (transfer.reference or transfer.signature). Only
  // returned to a caller authorized for that trip — never leak another trip's
  // wallets/amounts/names. An unauthorized match is skipped (existence hidden).
  for (const stored of await listAllSettlements()) {
    const trip = await getTrip(stored.tripId);
    if (!trip) continue;
    for (const t of stored.transfers) {
      const sig = (t as any).signature as string | undefined;
      if (t.reference === ref || (sig && sig === ref)) {
        if (!authorizeTrip(req, trip)) continue;
        return res.json({
          found: true,
          title: trip.name,
          fromName: memberName(trip, t.from),
          toName: memberName(trip, t.to),
          amountCents: t.amountCents,
          amountFmt: fmt(t.amountCents),
          wallet: trip.members.find((m) => m.id === t.to)?.wallet || null,
          signature: sig || null,
          reference: t.reference || null,
          cluster: trip.cluster,
          paidAt: stored.createdAt,
        });
      }
    }
  }

  // 2) Bill participants — only the bill's collector (its creator wallet) may
  // read it back, so one person's split links don't expose another's.
  for (const bill of await store.all()) {
    for (const p of bill.participants) {
      if (p.reference === ref || (p.signature && p.signature === ref)) {
        if (await getPrimaryWallet(userId) !== bill.collector) continue;
        return res.json({
          found: true,
          title: bill.title,
          fromName: p.name,
          toName: "Collector",
          amountCents: p.amountCents,
          amountFmt: fmt(p.amountCents),
          wallet: bill.collector,
          signature: p.signature || null,
          reference: p.reference || null,
          cluster: bill.cluster,
          paidAt: bill.createdAt,
        });
      }
    }
  }

  res.json({ found: false });
});

// Shareable SPA link: the frontend reads the token from the path. Declared
// before any catch-all; it doesn't shadow /api or static assets.
app.get("/t/:token", (_req: Request, res: Response) => {
  res.sendFile(path.resolve(process.cwd(), "public/index.html"));
});

// ---- Pay page (server-rendered) -------------------------------------------

app.get("/pay/:id/:name", async (req: Request, res: Response) => {
  const bill = await store.get(req.params.id);
  if (!bill) return res.status(404).send("Bill not found");
  const name = decodeURIComponent(req.params.name);
  const p = bill.participants.find((x) => x.name === name);
  if (!p) return res.status(404).send("Participant not found");

  const qr = await qrToDataUrl(p.url);
  const cards = cardOptions({ walletAddress: bill.collector, amountCents: p.amountCents });
  res.type("html").send(renderPayPage(bill, name, p.url, p.amountCents, qr, cards, p.paid));
});

// ---- helpers --------------------------------------------------------------

/** Compact bill view for the home "tabs" list (no per-person pay URLs). */
function billSummary(bill: Bill) {
  const paid = bill.participants.filter((p) => p.paid).length;
  return {
    id: bill.id,
    title: bill.title,
    createdAt: bill.createdAt,
    totalCents: bill.totalCents,
    totalFmt: fmt(bill.totalCents),
    collectedCents: collectedCents(bill),
    collectedFmt: fmt(collectedCents(bill)),
    outstandingCents: outstandingCents(bill),
    outstandingFmt: fmt(outstandingCents(bill)),
    settled: outstandingCents(bill) === 0,
    peopleCount: bill.participants.length,
    paidCount: paid,
  };
}

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

// Final error-handling middleware. With express-async-errors above, a rejected
// promise from any async handler lands here instead of crashing the process.
// Maps known error shapes to status codes; everything else is a 500. Must be
// registered AFTER all routes.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  const message = (err as Error)?.message || "internal error";
  const status = err instanceof ValidationError ? 400 : isRpcFailure(err) ? 502 : 500;
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error("unhandled route error:", err);
  }
  res.status(status).json({ error: message });
});

// Last-resort backstop: a stray rejection from a background task (e.g. the
// recurring self-scheduler) must never take the whole server down. Log, stay up.
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("unhandledRejection:", reason);
});

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
