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
import { claimSignature } from "./consumedSignatures";
import { alert, makeSpikeDetector } from "./alerts";
import { db } from "./db";
import { usingSupabase, supabase } from "./supabase";
import { qrToDataUrl } from "./qr";
import { cardOptions, ramsConfigured } from "./onramp";
import { cashoutOptions } from "./offramp";
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
  fetchPrivyWallets,
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
  deleteUser,
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
import { nudgesRouter } from "./nudges";
import { pushRouter, sendPush } from "./push";

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
    // Prune stale IPs on any insert once the Map gets large — NOT only in the 429
    // branch, or a flood of distinct never-limited IPs would grow it unboundedly.
    if (hits.size > 10000) {
      for (const [k, v] of hits) {
        if (v.every((t) => now - t >= windowMs)) hits.delete(k);
      }
    }
    if (recent.length >= max) {
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
// Money endpoints: tighter caps so the settle/verify + bill paths can't be
// hammered, and the funding faucet can't be drained by rapid repeat calls.
const moneyRateLimit = rateLimit(30, 60_000); // ~30 req/min per IP
const fundRateLimit = rateLimit(8, 60_000); // ~8 mints/min per IP (treasury guard)
const rpcProxyRateLimit = rateLimit(150, 60_000); // web3.js is chatty; per-IP cap

// Spike detectors feeding the alert webhook (src/alerts.ts). Tuned loose enough
// that normal polling never pages, tight enough that a real burst does. One page
// per window, not per event.
const verifyFailSpike = makeSpikeDetector(20, 60_000); // ≥20 verify errors / min
const fundVolumeSpike = makeSpikeDetector(40, 60_000); // ≥40 faucet drips / min
const serverErrorSpike = makeSpikeDetector(8, 60_000); // ≥8 unhandled 5xx / min → page

// Faucet per-USER cap. The IP limiter alone lets one account rotate IPs to drain
// the devnet treasury; key the cap on userId too. Devnet-only route, but cheap
// insurance. Runs after requireAuth so req.userId is set.
const fundUserHits = new Map<string, number[]>();
function fundUserLimit(req: Request, res: Response, next: () => void): void {
  const uid = (req as Request & { userId?: string }).userId;
  if (!uid) return next();
  const now = Date.now();
  const recent = (fundUserHits.get(uid) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 5) {
    res.status(429).json({ error: "funding limit reached, try again in a minute" });
    return;
  }
  recent.push(now);
  fundUserHits.set(uid, recent);
  if (fundUserHits.size > 10000) {
    for (const [k, v] of fundUserHits) if (v.every((t) => now - t >= 60_000)) fundUserHits.delete(k);
  }
  next();
}

/**
 * Structured audit line for money-moving actions. One JSON object per event so
 * it's greppable in the deploy logs (settle/fund/verify forensics).
 */
function logMoney(action: string, req: Request, extra: Record<string, unknown> = {}): void {
  try {
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        evt: "money",
        action,
        ip: req.ip || null,
        userId: (req as Request & { userId?: string }).userId || null,
        ...extra,
      })
    );
  } catch {
    /* never let logging break a request */
  }
}

// JSON-RPC methods the browser RPC proxy will forward. Read calls + the two
// write calls web3.js/Privy need (send + simulate). Heavy/scan methods
// (getProgramAccounts, getBlock(s), getLeaderSchedule…) are intentionally absent.
const RPC_ALLOWED_METHODS = new Set<string>([
  "getLatestBlockhash", "getLatestBlockhashAndContext", "getRecentBlockhash",
  "getAccountInfo", "getMultipleAccounts", "getBalance",
  "getTokenAccountBalance", "getTokenAccountsByOwner", "getTokenSupply",
  "getSignaturesForAddress", "getSignatureStatuses",
  "getTransaction", "getParsedTransaction",
  "sendTransaction", "simulateTransaction",
  "getMinimumBalanceForRentExemption", "getFeeForMessage",
  "getEpochInfo", "getVersion", "getGenesisHash", "getBlockHeight", "getSlot",
]);
// Write JSON-RPC methods get a much tighter per-IP cap than reads: the proxy is
// unauthenticated (web3.js can't attach a Bearer), so this limits its use as a
// transaction-broadcast relay / quota sink without breaking legit settles (which
// send only a handful of sendTransaction calls).
const RPC_WRITE_METHODS = new Set<string>(["sendTransaction"]);
const rpcWriteHits = new Map<string, number[]>();
function rpcWriteAllowed(ip: string): boolean {
  const now = Date.now();
  const recent = (rpcWriteHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 20) return false; // ~20 broadcasts/min/IP
  recent.push(now);
  rpcWriteHits.set(ip, recent);
  if (rpcWriteHits.size > 10000) {
    for (const [k, v] of rpcWriteHits) if (v.every((t) => now - t >= 60_000)) rpcWriteHits.delete(k);
  }
  return true;
}

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
app.use(nudgesRouter);
app.use(pushRouter);

// ---- Auth & identity (progressive, optional) ------------------------------

app.get("/api/auth/config", (_req: Request, res: Response) => {
  res.json({ siws: true, privy: privyConfigured() });
});

// Readiness probe for uptime monitoring: liveness + a cheap data-store ping +
// a config snapshot (no secrets). 503 if the data store is unreachable.
app.get("/healthz", async (_req: Request, res: Response) => {
  let dbOk = false;
  try {
    if (usingSupabase) {
      const { error } = await supabase().from("consumed_signatures").select("signature").limit(1);
      dbOk = !error;
    } else {
      db.prepare("SELECT 1").get();
      dbOk = true;
    }
  } catch {
    dbOk = false;
  }
  res.status(dbOk ? 200 : 503).json({
    ok: dbOk,
    cluster: CLUSTER,
    backend: usingSupabase ? "supabase" : "sqlite",
    rpc: !!process.env.RPC_URL,
    railsLive: ramsConfigured(),
    time: new Date().toISOString(),
  });
});

app.get("/api/auth/nonce", authRateLimit, (_req: Request, res: Response) => {
  res.json(issueNonce());
});

// ---- Deep-link association (Capacitor universal / app links) ---------------
// Served as application/json via explicit routes (Express static ignores the
// .well-known dotdir). Values come from env so no code edit is needed once the
// Apple Team ID / Android signing cert are known. Until then they're placeholders.
app.get(
  ["/.well-known/apple-app-site-association", "/apple-app-site-association"],
  (_req: Request, res: Response) => {
    const appID = `${process.env.APPLE_TEAM_ID || "TEAMID"}.com.divvysol.app`;
    res.type("application/json").json({
      applinks: {
        details: [{ appIDs: [appID], components: [{ "/": "/pay/*" }, { "/": "/t/*" }] }],
      },
      webcredentials: { apps: [appID] },
    });
  }
);
app.get("/.well-known/assetlinks.json", (_req: Request, res: Response) => {
  const fingerprint = process.env.ANDROID_CERT_SHA256 || "REPLACE_WITH_SHA256_FINGERPRINT";
  res.type("application/json").json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.divvysol.app",
        sha256_cert_fingerprints: [fingerprint],
      },
    },
  ]);
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
    // SECURITY: never trust body.wallet — a forged address would become the
    // account's PRIMARY wallet and be trusted for collector binding, incoming-tab
    // matching, and receipt access. Link only a wallet Privy authoritatively
    // confirms this user owns. If the client claimed a wallet, it must be in the
    // confirmed set; otherwise we link the first confirmed (embedded) wallet.
    const ownedWallets = await fetchPrivyWallets(verified.subject);
    let wallet: string | undefined;
    if (body.wallet && ownedWallets.includes(body.wallet)) wallet = body.wallet;
    else if (ownedWallets.length) wallet = ownedWallets[0];
    if (body.wallet && !wallet) {
      logMoney("privy.wallet_unverified", req, { subject: verified.subject, claimed: body.wallet });
    }
    const user = await upsertUserByIdentity("privy", verified.subject, { wallet });
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

// Permanently delete the signed-in user's account + login/PII (App Store
// requirement 5.1.1(v)). Non-custodial: their on-chain funds stay in their own
// wallet, which they keep — deleting the Divvy account only unlinks the login.
app.delete("/api/me", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  try {
    await deleteUser(userId);
    logMoney("account.delete", req, { userId });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// On-chain USDC balance of the signed-in user's primary wallet (read-only).
app.get("/api/me/wallet", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const wallet = await getPrimaryWallet(userId);
  const mint = USDC_MINT[CLUSTER];
  if (!wallet) return res.json({ wallet: null, usdcCents: null, usdcFmt: null, mint, cluster: CLUSTER });
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
    res.json({ wallet, usdcCents, usdcFmt: fmt(usdcCents), mint, cluster: CLUSTER });
  } catch (err) {
    // Network hiccup / no token account → report null rather than failing the screen.
    res.json({ wallet, usdcCents: null, usdcFmt: null, error: (err as Error).message });
  }
});

// Devnet demo funding: drip a little gas SOL + mint test-USDC to the caller's
// wallet so a freshly created wallet can actually settle. No-op (501) when the
// treasury isn't configured. Devnet/test value only.
app.post("/api/me/fund", fundRateLimit, requireAuth, fundUserLimit, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  if (CLUSTER !== "devnet" || !fundingConfigured()) {
    return res.status(501).json({ error: "funding not available" });
  }
  const wallet = await getPrimaryWallet(userId);
  if (!wallet) return res.status(400).json({ error: "link a wallet first" });
  try {
    const r = await fundWallet(wallet);
    logMoney("fund", req, { wallet, solDripped: r.solDripped, usdcMinted: r.usdcMinted });
    const fspike = fundVolumeSpike.record();
    if (fspike.fired) alert("medium", "fund_volume", { count: fspike.count, wallet });
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

// Browser RPC proxy: keeps the upstream RPC key (Helius) server-side instead of
// baking it into the embedded bundle. Forwards an allowlisted set of JSON-RPC
// methods to RPC_URL. HTTP only — the client never opens a subscription here
// (Privy confirms via its own websocket RPC), so no WS proxy is needed.
app.post("/api/rpc", rpcProxyRateLimit, async (req: Request, res: Response) => {
  const upstream = process.env.RPC_URL;
  if (!upstream) return res.status(501).json({ error: "rpc not configured" });
  const body = req.body;
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 20) {
    return res.status(400).json({ error: "bad rpc batch" });
  }
  let hasWrite = false;
  for (const c of calls) {
    if (!c || typeof c.method !== "string" || !RPC_ALLOWED_METHODS.has(c.method)) {
      return res.status(403).json({ error: `rpc method not allowed: ${c && c.method}` });
    }
    if (RPC_WRITE_METHODS.has(c.method)) hasWrite = true;
  }
  if (hasWrite && !rpcWriteAllowed(req.ip || "unknown")) {
    return res.status(429).json({ error: "too many transaction broadcasts, slow down" });
  }
  try {
    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await upstreamRes.text();
    res.status(upstreamRes.status).type("application/json").send(text);
  } catch {
    res.status(502).json({ error: "rpc upstream error" });
  }
});

// ---- API ------------------------------------------------------------------

interface CreateBillBody {
  title?: string;
  total?: number | string; // dollars
  tipPercent?: number;
  names?: string[];
  /** Per-participant identity (when split via the friend picker) so the tab can
   *  auto-appear on each friend's home. Aligned with `names` if both are sent. */
  members?: { name?: string; userId?: string; wallet?: string }[];
  mode?: SplitMode;
  weights?: number[];
  customCents?: number[];
  collector?: string;
  groupId?: string;
  count?: number;
  saveGroupName?: string;
  fx?: BillFx;
}

app.post("/api/bills", moneyRateLimit, async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateBillBody;

    // Resolve participant names. Precedence: members[] > groupId > names > count.
    // When `members` is provided (the friend picker), it carries identities so
    // the tab can be delivered to each friend's account.
    let names = (body.names || []).map((n) => String(n).trim()).filter(Boolean);
    let participantMeta: ({ userId?: string; wallet?: string } | null)[] | undefined;
    if (Array.isArray(body.members) && body.members.length) {
      const mem = body.members
        .map((m) => ({ name: String(m && m.name || "").trim(), userId: m && m.userId, wallet: m && m.wallet }))
        .filter((m) => m.name);
      if (mem.length) {
        names = mem.map((m) => m.name);
        participantMeta = mem.map((m) =>
          m.userId || m.wallet ? { userId: m.userId || undefined, wallet: m.wallet || undefined } : null
        );
      }
    }

    if (body.groupId) {
      // Saved groups are owner-scoped; an anonymous caller can't own one.
      const group = req.userId ? await getGroup(body.groupId, req.userId) : undefined;
      if (!group) return res.status(404).json({ error: "group not found" });
      names = group.members.map((m) => String(m).trim()).filter(Boolean);
      await touchGroup(body.groupId, req.userId as string);
    } else if (names.length === 0 && Number.isInteger(body.count) && (body.count as number) > 0) {
      if ((body.count as number) > MAX_MEMBERS) {
        return res.status(400).json({ error: `too many people (max ${MAX_MEMBERS})` });
      }
      names = Array.from({ length: body.count as number }, (_v, i) => `Person ${i + 1}`);
    }

    if (names.length === 0) return res.status(400).json({ error: "need at least one name" });
    // Same caps as trips: bounded participant count and name/title lengths, so a
    // hostile payload can't create megabyte bills or thousand-share splits.
    if (names.length > MAX_MEMBERS) {
      return res.status(400).json({ error: `too many people (max ${MAX_MEMBERS})` });
    }
    for (const n of names) {
      if (n.length > MAX_MEMBER_NAME) {
        return res.status(400).json({ error: `name too long (max ${MAX_MEMBER_NAME} chars)` });
      }
    }
    if (body.title && String(body.title).length > MAX_TRIP_NAME) {
      return res.status(400).json({ error: `title too long (max ${MAX_TRIP_NAME} chars)` });
    }
    if (body.total == null) return res.status(400).json({ error: "need a total" });

    // Best-effort: persist this set of names as a reusable group. Never let a
    // group-save failure block bill creation.
    const saveGroupName = body.saveGroupName && String(body.saveGroupName).trim();
    if (saveGroupName && req.userId) {
      try {
        await createGroup(saveGroupName, names, req.userId);
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
      // The server's CLUSTER is the sole authority on which chain money moves on —
      // a client-supplied cluster could point payers at the wrong network (or an
      // arbitrary string that breaks pay-URL building), so body.cluster is ignored.
      cluster: CLUSTER,
      creatorUserId: req.userId || undefined,
      collector,
      totalCents,
      names,
      participantMeta,
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
  // Targeted queries (server-side filtered on Supabase) instead of scanning every
  // bill in the system — bounded by what this user actually created / owes.
  const mine = await store.createdBy(userId, myWallet);
  // Backfill ownership on legacy bills created before creatorUserId existed:
  // a bill's collector is bound to its creator's primary wallet, so a match is
  // authoritative. Persist it best-effort so later queries are a clean id match.
  for (const b of mine) {
    if (!b.creatorUserId && myWallet && b.collector === myWallet) {
      b.creatorUserId = userId;
      try { await store.put(b); } catch { /* non-fatal */ }
    }
  }
  const mineIds = new Set(mine.map((b) => b.id));
  // Tabs someone else created where a share is YOURS — by linked userId, or
  // (fallback) by your primary wallet. These auto-appear as "tabs to pay".
  const incoming = (await store.sharedWith(userId, myWallet))
    .filter((b) => b.creatorUserId !== userId && !mineIds.has(b.id))
    .map((b) => {
      const share = b.participants.find(
        (p) => p.userId === userId || (!!myWallet && p.wallet === myWallet)
      );
      if (!share) return null;
      return {
        ...billSummary(b),
        mine: {
          name: share.name,
          amountCents: share.amountCents,
          amountFmt: fmt(share.amountCents),
          paid: share.paid,
          payPath: `/pay/${b.id}/${encodeURIComponent(share.name)}`,
        },
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  res.json({ bills: mine.map(billSummary), incoming });
});

app.get("/api/bills/:id", async (req: Request, res: Response) => {
  const bill = await store.get(req.params.id);
  if (!bill) return res.status(404).json({ error: "not found" });
  res.json(serializeBill(bill));
});

app.post("/api/bills/:id/verify", moneyRateLimit, requireAuth, async (req: Request, res: Response) => {
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
      if (valid.ok && valid.signature) {
        // Global guard: this signature must not have settled a DIFFERENT share
        // anywhere else (another bill/trip). One on-chain payment ⇒ one share.
        const claimed = await claimSignature(valid.signature, `bill:${bill.id}:${p.reference}`);
        if (!claimed) {
          logMoney("bill.verify.sig_conflict", req, { billId: bill.id, name: p.name, signature: valid.signature });
          // A signature that already settled a different share was re-presented —
          // exactly the double-credit attempt the global guard exists to stop. Page.
          alert("high", "signature_reuse_blocked", { context: "bill", billId: bill.id, name: p.name, signature: valid.signature });
          continue; // already consumed elsewhere — do not double-credit
        }
        p.paid = true;
        p.signature = valid.signature;
        usedSigs.add(valid.signature);
        updated.push(p.name);
        // Notify the collector that a share just landed. Best-effort, never blocks.
        void sendPush(bill.creatorUserId, {
          title: "You got paid 💸",
          body: `${p.name} paid you ${fmt(p.amountCents)} for ${bill.title}`,
          url: `/#/collect/${bill.id}`,
          tag: `bill:${bill.id}`,
        });
      }
    }
    await store.put(bill);
    res.json({ ...serializeBill(bill), updated });
  } catch (err) {
    const spike = verifyFailSpike.record();
    if (spike.fired) alert("medium", "verify_failure_spike", { context: "bill", count: spike.count, lastError: (err as Error).message });
    const status = isRpcFailure(err) ? 502 : 400;
    res.status(status).json({ error: `verify failed: ${(err as Error).message}` });
  }
});

// ---- Saved groups ---------------------------------------------------------

app.get("/api/groups", requireAuth, async (req: Request, res: Response) => {
  res.json(await listGroups(req.userId as string));
});

app.post("/api/groups", requireAuth, async (req: Request, res: Response) => {
  const body = req.body as { name?: string; members?: string[] };
  try {
    const group = await createGroup(body.name || "", body.members || [], req.userId as string);
    res.json(group);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete("/api/groups/:id", requireAuth, async (req: Request, res: Response) => {
  if (await deleteGroup(req.params.id, req.userId as string)) return res.json({ ok: true });
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

// Validate an amountCents path param: positive integer within the global cap.
// Returns the parsed value, or null if invalid (caller responds 400).
function parseAmountCents(raw: string): number | null {
  const amountCents = Number(raw);
  if (!Number.isInteger(amountCents) || amountCents <= 0) return null;
  if (amountCents > MAX_AMOUNT_CENTS) return null;
  return amountCents;
}

// Per-transaction ceiling on the fiat rails. Much lower than the $1M ledger cap —
// a sane launch limit that real KYC/AML + provider limits will refine. Override
// with RAIL_MAX_CENTS (e.g. 500000 = $5,000).
const RAIL_MAX_CENTS = Number(process.env.RAIL_MAX_CENTS || 200_000); // $2,000 default
function railAmountError(amountCents: number): string | null {
  if (amountCents > RAIL_MAX_CENTS) return `amount exceeds the per-transaction limit ($${RAIL_MAX_CENTS / 100})`;
  return null;
}

// Card on-ramp links for the signed-in user's own primary wallet. Top up your
// own balance with a card / Apple Pay. `live` reports whether real provider
// keys are present (vs. test mode — URLs build but won't actually charge).
app.get("/api/me/onramp/:amountCents", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const wallet = await getPrimaryWallet(userId);
  if (!wallet) return res.status(400).json({ error: "no wallet" });
  const amountCents = parseAmountCents(req.params.amountCents);
  if (amountCents === null) return res.status(400).json({ error: "bad amount" });
  const railErr = railAmountError(amountCents);
  if (railErr) return res.status(400).json({ error: railErr });
  res.json({
    wallet,
    amountCents,
    live: ramsConfigured(),
    ...cardOptions({ walletAddress: wallet, amountCents }),
  });
});

// Cash-out (off-ramp) links for the signed-in user's own primary wallet. Sell
// USDC back out to a card / bank. `live` reports whether real provider keys are
// present (vs. test mode — URLs build but won't actually pay out).
app.get("/api/me/offramp/:amountCents", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const wallet = await getPrimaryWallet(userId);
  if (!wallet) return res.status(400).json({ error: "no wallet" });
  const amountCents = parseAmountCents(req.params.amountCents);
  if (amountCents === null) return res.status(400).json({ error: "bad amount" });
  const railErr = railAmountError(amountCents);
  if (railErr) return res.status(400).json({ error: railErr });
  res.json({
    wallet,
    amountCents,
    live: ramsConfigured(),
    ...cashoutOptions({ walletAddress: wallet, amountCents }),
  });
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

/**
 * Editing or deleting an expense rewrites the ledger (and can erase a debt), so
 * it is gated tighter than the collaborative ADD: only the trip owner or the
 * person who fronted that expense (the payer slot's claimer) may mutate it.
 * Fully anonymous (ownerless) trips keep the open behavior — there is no identity
 * or payout to protect there.
 */
function canMutateExpense(req: Request, trip: Trip, paidBy: string): boolean {
  if (!trip.ownerUserId) return true; // keyless/anonymous trip — status quo
  const uid = req.userId;
  if (!uid) return false;
  if (trip.ownerUserId === uid) return true;
  const payer = trip.members.find((m) => m.id === paidBy);
  return !!payer && payer.userId === uid;
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
    // Server-pinned, same as bills: clients don't get to choose the chain.
    const cluster = CLUSTER;
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
// to their primary wallet. Requires auth; the capability link governs who can SEE
// the trip. SECURITY: claiming a slot sets that member's payout wallet, so a slot
// that is OWED money (has paid for any expense → a net creditor) must not be
// claimable by an arbitrary share-link holder, or they could reroute the
// creditor's settle-up payout to themselves. Such slots may be claimed only by the
// trip owner (or re-claimed by the same user); a non-owner creditor's wallet is
// assigned by the owner via PATCH …/members/:mid. Debtor/even slots stay freely
// self-claimable (no incoming payout to hijack).
app.post("/api/trips/:id/members/:mid/claim", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId as string;
    const existing = await getTrip(req.params.id);
    if (!existing) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, existing)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    const member = existing.members.find((m) => m.id === req.params.mid);
    if (!member) return res.status(404).json({ error: "member not found" });
    const isOwner = existing.ownerUserId === userId;
    const isPayer = (existing.expenses || []).some((e) => e.paidBy === req.params.mid);
    if (isPayer && !isOwner && member.userId !== userId) {
      logMoney("trip.claim.creditor_blocked", req, { tripId: existing.id, memberId: req.params.mid });
      return res.status(403).json({ error: "this member is owed money — ask the trip owner to assign their wallet" });
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
    const existingExpense = trip.expenses.find((e) => e.id === req.params.eid);
    if (!existingExpense) return res.status(404).json({ error: "expense not found" });
    if (!canMutateExpense(req, trip, existingExpense.paidBy)) {
      return res.status(403).json({ error: "only the trip owner or the person who paid can edit this expense" });
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
    const toDelete = existing.expenses.find((e) => e.id === req.params.eid);
    if (!toDelete) return res.status(404).json({ error: "expense not found" });
    if (!canMutateExpense(req, existing, toDelete.paidBy)) {
      return res.status(403).json({ error: "only the trip owner or the person who paid can delete this expense" });
    }
    const trip = await deleteExpense(req.params.id, req.params.eid);
    res.json(await serializeTrip(trip));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/trips/:id/settle", moneyRateLimit, async (req: Request, res: Response) => {
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

app.post("/api/trips/:id/settle/verify", moneyRateLimit, async (req: Request, res: Response) => {
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
      if (valid.ok && valid.signature) {
        // Global guard: one on-chain payment settles at most one share, across
        // every bill/trip — not just within this settlement.
        const claimed = await claimSignature(valid.signature, `trip:${trip.id}:${t.from}->${t.to}`);
        if (!claimed) {
          logMoney("settle.verify.sig_conflict", req, { tripId: trip.id, from: t.from, to: t.to, signature: valid.signature });
          alert("high", "signature_reuse_blocked", { context: "trip", tripId: trip.id, from: t.from, to: t.to, signature: valid.signature });
          continue; // already consumed elsewhere — do not double-credit
        }
        t.paid = true;
        (t as any).signature = valid.signature; // record the on-chain sig for receipts/lookups
        usedSigs.add(valid.signature);
        // Notify the payee that a settlement landed. Best-effort.
        const payer = trip.members.find((m) => m.id === t.from);
        void sendPush(recipient.userId, {
          title: "You got paid 💸",
          body: `${payer ? payer.name : "Someone"} settled up ${fmt(t.amountCents)} · ${trip.name}`,
          url: `/#/group/${trip.id}`,
          tag: `trip:${trip.id}`,
        });
      }
    }
    await saveSettlement(trip.id, stored.signature, stored.transfers);
    res.json(await serializeTrip(await getTrip(trip.id) as Trip));
  } catch (err) {
    const spike = verifyFailSpike.record();
    if (spike.fired) alert("medium", "verify_failure_spike", { context: "trip", count: spike.count, lastError: (err as Error).message });
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

// Tab landing: the link shared from "copy link" / "share tab" points here.
// Lists every share so whoever opens it can pick theirs and pay.
app.get("/pay/:id", async (req: Request, res: Response) => {
  const bill = await store.get(req.params.id);
  if (!bill) return res.status(404).send("Tab not found");
  const base = `${req.protocol}://${req.get("host")}`;
  res.type("html").send(renderBillLanding(bill, base));
});

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

function renderBillLanding(bill: Bill, baseUrl = ""): string {
  const rows = bill.participants
    .map((p) => {
      const href = `/pay/${bill.id}/${encodeURIComponent(p.name)}`;
      const initial = esc((p.name || "?").trim().charAt(0).toUpperCase() || "?");
      const right = p.paid
        ? `<span class="pill paid">paid ✓</span>`
        : `<a class="pay" href="${esc(href)}">pay ${fmt(p.amountCents)}</a>`;
      return `<div class="row"><span class="av">${initial}</span><span class="nm">${esc(p.name)}</span><span class="amt">${fmt(p.amountCents)}</span>${right}</div>`;
    })
    .join("");
  const out = outstandingCents(bill);
  const paidCount = bill.participants.filter((p) => p.paid).length;
  const pct = bill.totalCents > 0 ? Math.round((collectedCents(bill) / bill.totalCents) * 100) : 0;
  // Rich link preview for the share loop (iMessage/WhatsApp/Slack/Twitter). The
  // shared "pay" link is the product's main growth surface, so make it look good.
  const ogTitle =
    out > 0 ? `${esc(bill.title)} — ${fmt(out)} left to settle` : `${esc(bill.title)} — all settled ✓`;
  const ogDesc =
    out > 0
      ? `${paidCount}/${bill.participants.length} paid · ${fmt(out)} left. Pay your share in seconds — no app, no crypto, just dollars.`
      : `All settled ✓ — ${esc(bill.title)} on Divvy.`;
  const ogImage = `${baseUrl}/og.png`;
  const ogUrl = `${baseUrl}/pay/${esc(bill.id)}`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(bill.title)} — split the tab</title>
<meta name="description" content="${ogDesc}" />
<meta name="theme-color" content="#0B1622" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Divvy" />
<meta property="og:title" content="${ogTitle}" />
<meta property="og:description" content="${ogDesc}" />
<meta property="og:url" content="${ogUrl}" />
<meta property="og:image" content="${ogImage}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${ogTitle}" />
<meta name="twitter:description" content="${ogDesc}" />
<meta name="twitter:image" content="${ogImage}" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, "Segoe UI", sans-serif; margin: 0; padding: 22px 20px 40px;
         max-width: 440px; margin-inline: auto; background: #0B1622; color: #F4F7FA; line-height: 1.45;
         -webkit-font-smoothing: antialiased; }
  .brand { display:flex; align-items:center; gap:8px; margin-bottom: 22px; }
  .mark { width:30px; height:30px; border-radius:9px; background:linear-gradient(150deg,#3286db,#2775CA 60%,#1f5fa8);
          display:flex; align-items:center; justify-content:center; font-weight:800; font-size:19px; color:#fff;
          box-shadow:0 5px 14px rgba(39,117,202,.4); }
  .word { font-weight:700; font-size:19px; letter-spacing:-.5px; }
  .hero { background:#13212E; border:1px solid rgba(244,247,250,.08); border-radius:22px; padding:20px;
          box-shadow:0 14px 36px rgba(0,0,0,.32); }
  h1 { font-size: 1.5rem; margin: 0 0 3px; letter-spacing:-.4px; }
  .muted { color: rgba(244,247,250,.5); font-size: .85rem; }
  .total { font-size: 2.6rem; font-weight: 800; margin: 12px 0 4px; letter-spacing: -1.5px;
           background:linear-gradient(120deg,#7fc0ff,#3DE8C7); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .bar { height:7px; border-radius:999px; background:rgba(244,247,250,.08); overflow:hidden; margin:14px 0 4px; }
  .bar > i { display:block; height:100%; width:${pct}%; background:linear-gradient(90deg,#2775CA,#3DE8C7); border-radius:999px; }
  .sec { font-family: "Space Mono", ui-monospace, monospace; font-size:.62rem; letter-spacing:1.5px; text-transform:uppercase;
         color:rgba(244,247,250,.4); margin:24px 4px 10px; }
  .row { display: flex; align-items: center; gap: 12px; background: #13212E; border: 1px solid rgba(244,247,250,.07);
         border-radius: 16px; padding: 13px 14px; margin: 9px 0; }
  .av { width:38px; height:38px; border-radius:50%; flex:none; display:flex; align-items:center; justify-content:center;
        font-weight:700; background:linear-gradient(150deg,#2775CA,#3DE8C7); color:#04121a; }
  .nm { font-weight: 700; }
  .amt { margin-left: auto; font-variant-numeric: tabular-nums; color: rgba(244,247,250,.6); font-size:.9rem; }
  a.pay { text-decoration: none; padding: 10px 18px; border-radius: 999px; font-weight: 800; font-size: .88rem;
          background: linear-gradient(120deg,#3286db,#2775CA); color: #fff; white-space: nowrap;
          box-shadow:0 6px 16px rgba(39,117,202,.4); }
  .pill.paid { padding: 8px 14px; border-radius: 999px; font-size: .78rem; font-weight: 800;
               background: rgba(61,232,199,.14); color: #3DE8C7; }
  .foot { margin-top: 22px; text-align:center; }
</style></head><body>
  <div class="brand"><span class="mark">/</span><span class="word">divvy</span></div>
  <div class="hero">
    <h1>${esc(bill.title)}</h1>
    <div class="muted">${bill.participants.length} ${bill.participants.length === 1 ? "person" : "people"} · ${out > 0 ? `${fmt(out)} still owed` : "all settled ✨"}</div>
    <div class="total">${fmt(bill.totalCents)}</div>
    <div class="bar"><i></i></div>
    <div class="muted">${paidCount} of ${bill.participants.length} paid · settles in USDC</div>
  </div>
  <div class="sec">tap your name to pay</div>
  ${rows}
  <p class="foot muted">no app needed — pay your share with a card or a wallet.<br/>dollars, just faster.</p>
</body></html>`;
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
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  const message = (err as Error)?.message || "internal error";
  const status = err instanceof ValidationError ? 400 : isRpcFailure(err) ? 502 : 500;
  if (status >= 500) {
    // Structured, greppable error record for every 5xx…
    try {
      console.error(JSON.stringify({
        t: new Date().toISOString(), evt: "server_error", status,
        method: req.method, path: req.path, message,
        stack: (err as Error)?.stack,
      }));
    } catch { /* never let logging throw */ }
    // …and page when they spike (a burst of 500s = something's broken).
    const spike = serverErrorSpike.record();
    if (spike.fired) alert("high", "server_error_spike", { count: spike.count, lastPath: req.path, lastMessage: message });
  }
  res.status(status).json({ error: message });
});

// Last-resort backstop: a stray rejection from a background task (e.g. the
// recurring self-scheduler) must never take the whole server down. Log + page,
// stay up. An unhandled rejection means an un-awaited failure — worth knowing.
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("unhandledRejection:", reason);
  alert("high", "unhandled_rejection", { reason: reason instanceof Error ? reason.message : String(reason) });
});
process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("uncaughtException:", err);
  alert("critical", "uncaught_exception", { message: err?.message, stack: err?.stack });
  // Stay up (money app — a crash is downtime); the alert makes it loud.
});

/**
 * Refuse to boot on mainnet in a half-configured (unsafe) state, so the go-live
 * cutover is a deliberate flag-flip rather than a silent slide into real money on
 * a misconfigured server. No-op on devnet. See docs/PRE-MAINNET.md.
 */
function assertMainnetReadiness(): void {
  if (CLUSTER !== "mainnet-beta") return;
  const problems: string[] = [];
  if (!process.env.RPC_URL) problems.push("RPC_URL must be a paid mainnet endpoint (not the public default)");
  if (!process.env.SESSION_SECRET) problems.push("SESSION_SECRET must be set");
  if (!usingSupabase) problems.push("DATA_BACKEND must be supabase (SQLite is ephemeral on Railway — money data would vanish on redeploy)");
  if (COLLECTOR === "11111111111111111111111111111111") problems.push("COLLECTOR_WALLET must be set");
  if (fundingConfigured()) problems.push("the devnet faucet (MINT_AUTHORITY_SECRET) must be removed on mainnet");
  if (process.env.CONSUMED_SIG_FAIL_OPEN === "1") problems.push("CONSUMED_SIG_FAIL_OPEN must not be enabled on mainnet");
  if (process.env.RAILS_REQUIRE_LIVE === "1" && !ramsConfigured()) {
    problems.push("on/off-ramp provider keys must be configured (RAILS_REQUIRE_LIVE=1)");
  }
  if (problems.length) {
    throw new Error(
      "Refusing to boot on mainnet-beta — unsafe configuration:\n  - " +
        problems.join("\n  - ") +
        "\nSee docs/PRE-MAINNET.md."
    );
  }
}

if (require.main === module) {
  assertMainnetReadiness();
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
