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
import * as zlib from "node:zlib";
import express, { Request, Response, NextFunction } from "express";
// Patches Express 4 so a rejected promise from an async route handler is routed
// to the error-handling middleware instead of becoming an unhandled rejection
// that crashes the process. Must be imported before routes are registered.
import "express-async-errors";
import { Connection, clusterApiUrl, PublicKey } from "@solana/web3.js";
import { createBill, Bill, BillFx, BillItem, collectedCents, outstandingCents } from "./bill";
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
import { qrToDataUrl, qrToPngBuffer } from "./qr";
import { cardOptions, ramsConfigured, MOONPAY_MIN_CENTS } from "./onramp";
import { cashoutOptions } from "./offramp";
import { distributeWeighted, fmt, toCents, withTip, SplitMode } from "./split";
import { Cluster, buildSolanaPayUrl, newReference, USDC_MINT } from "./solanaPay";
// Validated + normalized cluster (hard-fails the boot on a garbage CLUSTER,
// normalizes "mainnet" → "mainnet-beta" — see src/cluster.ts).
import { CLUSTER, clusterMismatchError } from "./cluster";
// Env-tunable ledger amount cap (LEDGER_MAX_CENTS; default $1M) — see src/limits.ts.
import { LEDGER_MAX_CENTS } from "./limits";
import { computeBalances, minimalSettlement, Transfer } from "./ledger";
import { simplifyDebts, pairwiseDebts, simplifySummary } from "./simplify";
import {
  Trip,
  SettlementTransfer,
  createTrip,
  getTrip,
  getTripByIdOrToken,
  getTripByToken,
  addMember,
  updateMember,
  updateTrip,
  removeMember,
  addExpense,
  addItemizedExpense,
  mergeItemizedExpenses,
  editExpense,
  deleteExpense,
  saveSettlement,
  getSettlement,
  claimMember,
  listTripsForUser,
  isTripAuthorized,
  listAllSettlements,
} from "./trips";
import { validateItemized, itemizedShares, canItemize } from "./itemized";
import {
  authOptional,
  requireAuth,
  issueNonce,
  verifySiws,
  privyConfigured,
  verifyPrivyToken,
  fetchPrivyLinkedAccounts,
  extractPrivyWallets,
  extractPrivyOAuthIdentities,
  verifyAppleIdentityToken,
  createPrivyUserForApple,
  signSession,
  mintHandoffCode,
  exchangeHandoffCode,
} from "./auth";
import {
  upsertUserByWallet,
  upsertUserByIdentity,
  getIdentity,
  linkIdentityIfFree,
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
  buildExpenseFx,
  convertForeignCentsToUsd,
  convertMajorToUsd,
  convertMinorToUsd,
  formatForeign,
  fxEnabled,
  fxNoteFor,
  fxOriginal,
  fxOriginalFmt,
  fxSourceUsableOnCluster,
  FX_FALLBACK_UNAVAILABLE,
  isSupported,
  isZeroDecimal,
  majorFromMinor,
  MAX_FX_MINOR,
  supportedCurrencies,
  symbolFor,
  ExpenseFx,
} from "./fx";
import { dashboardRouter } from "./dashboard";
import { iouRouter } from "./ious";
import { tabsRouter } from "./tabs";
// Public no-login settle pages for 1:1 tab settlements + IOUs (/s/:reference).
import { settleLinkRouter } from "./settleLink";
import { activityRouter } from "./activity";
import { recurringRouter } from "./recurring";
import { subscriptionsRouter } from "./subscriptions";
import { householdRouter } from "./household";
import { friendsRouter } from "./friends";
import { chatRouter } from "./chat";
import { mochiRouter } from "./mochi";
import { journalRouter } from "./journal";
import { reactionsRouter } from "./reactions";
import { nudgesRouter } from "./nudges";
import { autonudgeRouter, validateDueAt } from "./autonudge";
import { pushRouter, sendPush } from "./push";
// Growth loops: OG share cards (og.ts) + invite attribution (referrals.ts).
import { ogMeta, tripShareHtml, rootShellHtml, OG_CARD_PATH } from "./og";
import { referralsRouter, setRefCookie, readRefCookie, recordReferral } from "./referrals";
import { rateLimit, moneyRateLimit, writeRateLimit, spamRateLimit } from "./ratelimit";
import {
  isOutsideMethod,
  methodPhrase,
  resolveOutsideAmount,
  decideClaimAction,
  newOutsideClaim,
  insertOutsideClaim,
  getOutsideClaim,
  transitionOutsideClaim,
  listPendingTripClaims,
  serializeOutsideClaim,
  ClaimVerb,
  OutsideMethod,
} from "./settleOutside";
import { securityHeaders } from "./headers";
import { telemetryRouter } from "./telemetry";
// Server-rendered legal + support pages (GET /terms, /privacy, /support). Static,
// no SPA. See src/legal.ts.
import { legalRouter } from "./legal";
// Public Mochi meme generator (GET /memes). Standalone shell + public/memes.js,
// no auth, pure client after load. See src/memes.ts.
import { memesRouter } from "./memes";
// Public Friend Debt Portfolio generator (GET /bags) — the CT growth toy.
// Same shape as /memes: server-rendered shell + public/bags.js, pure client.
import { bagsRouter } from "./bags";
import { waitlistRouter } from "./waitlist";

const PORT = Number(process.env.PORT || 3000);

// The fixed-window per-IP limiter itself lives in ./ratelimit (shared with the
// feature routers, and audited there for bucket cleanup + trust-proxy). The
// tiers below are server-only; moneyRateLimit/writeRateLimit/spamRateLimit are
// imported so routers share the exact same buckets.
const authRateLimit = rateLimit(60, 60_000); // ~60 req/min
const scanRateLimit = rateLimit(10, 60_000); // ~10 req/min
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

// ---- Static caching + compression -----------------------------------------

/**
 * Cache-Control policy for everything served out of public/ via express.static.
 * Runs once per file, keyed on the resolved path:
 *   - /embedded/assets/*   content-hashed build output → immutable, 1 year
 *   - /fonts/*             content-addressed woff2 filenames → immutable, 1 year
 *   - images (png/svg/…)   og cards + icons → 1 day
 *   - index.html           the shell changes every deploy → no-store
 *   - sw.js                the service worker must always revalidate → no-cache
 *   - app-shell js/css      app.js, divvy.css, screens/*, … are NOT hashed and
 *                          ship every deploy, but the SW fetches same-origin
 *                          network-first, so a short 5 min TTL + must-revalidate
 *                          is safe and still spares repeat cold hits the round trip.
 *   - manifest/json        1 hour
 */
function setStaticCacheHeaders(res: Response, filePath: string): void {
  const p = filePath.replace(/\\/g, "/");
  const YEAR = "public, max-age=31536000, immutable";
  if (p.includes("/embedded/assets/") || p.includes("/fonts/")) {
    res.setHeader("Cache-Control", YEAR);
    return;
  }
  if (p.endsWith("/index.html")) {
    res.setHeader("Cache-Control", "no-store");
    return;
  }
  if (p.endsWith("/sw.js")) {
    res.setHeader("Cache-Control", "no-cache");
    return;
  }
  if (/\.(png|jpe?g|gif|webp|svg|ico|avif)$/i.test(p)) {
    res.setHeader("Cache-Control", "public, max-age=86400"); // 1 day
    return;
  }
  if (/\.(js|css)$/i.test(p)) {
    res.setHeader("Cache-Control", "public, max-age=300, must-revalidate"); // 5 min
    return;
  }
  if (/\.(webmanifest|json)$/i.test(p)) {
    res.setHeader("Cache-Control", "public, max-age=3600"); // 1 hour
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
}

// Content types worth gzipping. woff2/png/jpeg are already compressed, so they're
// deliberately excluded (re-gzipping wastes CPU for ~0 bytes saved).
const COMPRESSIBLE_TYPE = /^(?:text\/|application\/(?:javascript|json|manifest\+json|xml|xhtml\+xml)|image\/svg\+xml)/i;
const GZIP_MIN_BYTES = 1024;

/**
 * Minimal gzip middleware (no new dependency). Buffers the response body, and if
 * the client sent `Accept-Encoding: gzip`, the type is compressible, and the body
 * clears 1 KB, gzips it asynchronously (never blocks the event loop) and rewrites
 * Content-Encoding / Content-Length / Vary. Everything else passes straight
 * through untouched — including already-encoded bodies and small responses.
 */
function gzipCompression(req: Request, res: Response, next: NextFunction): void {
  const accept = String(req.headers["accept-encoding"] || "");
  if (!/\bgzip\b/.test(accept)) return next();

  const chunks: Buffer[] = [];
  let buffering = true;
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);

  const push = (chunk: unknown, encoding?: BufferEncoding): void => {
    if (chunk == null) return;
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, encoding));
  };

  res.write = function (chunk: any, encoding?: any, cb?: any): boolean {
    if (!buffering) return origWrite(chunk, encoding, cb);
    if (typeof encoding === "function") { cb = encoding; encoding = undefined; }
    push(chunk, encoding);
    if (typeof cb === "function") cb();
    return true;
  } as typeof res.write;

  res.end = function (chunk?: any, encoding?: any, cb?: any): Response {
    if (typeof chunk === "function") { cb = chunk; chunk = undefined; encoding = undefined; }
    else if (typeof encoding === "function") { cb = encoding; encoding = undefined; }
    if (!buffering) return origEnd(chunk, encoding, cb) as unknown as Response;
    buffering = false;
    if (chunk != null) push(chunk, encoding);
    const body = Buffer.concat(chunks);

    const type = String(res.getHeader("Content-Type") || "");
    const alreadyEncoded = !!res.getHeader("Content-Encoding");
    res.write = origWrite;
    res.end = origEnd;
    if (alreadyEncoded || body.length < GZIP_MIN_BYTES || !COMPRESSIBLE_TYPE.test(type)) {
      // Not worth (or not safe) to compress — flush the buffered body verbatim.
      const vary = res.getHeader("Vary");
      if (!vary) res.setHeader("Vary", "Accept-Encoding");
      else if (!/accept-encoding/i.test(String(vary))) res.setHeader("Vary", `${vary}, Accept-Encoding`);
      return origEnd(body, cb) as unknown as Response;
    }
    zlib.gzip(body, (err, zipped) => {
      if (err) { origEnd(body, cb); return; }
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", String(zipped.length));
      const vary = res.getHeader("Vary");
      if (!vary) res.setHeader("Vary", "Accept-Encoding");
      else if (!/accept-encoding/i.test(String(vary))) res.setHeader("Vary", `${vary}, Accept-Encoding`);
      origEnd(zipped, cb);
    });
    return res;
  } as typeof res.end;

  next();
}

const app = express();
// Behind Railway's (single) reverse proxy, trust exactly one hop so req.ip is the
// real client X-Forwarded-For address — NOT the shared proxy IP (which would make
// the per-IP rate limiter throttle all users as one bucket). A specific hop count
// (not `true`) keeps X-Forwarded-For unspoofable by clients.
app.set("trust proxy", 1);
// Baseline security headers (nosniff, DENY framing, referrer, permissions) on
// every response + an enforced CSP on the first-party surface (see ./headers).
// Registered first so it applies to pages, API JSON, and static assets alike.
app.use(securityHeaders);
// Receipt images arrive as base64 in the JSON body, so allow a larger payload.
app.use(express.json({ limit: "12mb" }));
// gzip for compressible payloads. Express ships no compression and Railway's
// proxy doesn't add it, so a cold 4G visitor otherwise pulls the full ~740 KB of
// shell JS/CSS uncompressed. This tiny middleware (node:zlib, no new dep) buffers
// each response and gzips text-ish bodies over 1 KB when the client asked for it.
app.use(gzipCompression);
// Optional auth: populates req.userId from a Bearer session token when present.
// NEVER blocks — anonymous/capability-link flows stay fully usable.
app.use(authOptional);
// Root landing (GET /): serve the SPA shell with a branded OG card injected, so
// a cold link tapped on X unfurls into the journal share card instead of
// index.html's generic defaults. Registered BEFORE express.static so it wins
// over static's automatic index.html for "/". Hash routes (#/home, …) still load
// this same shell. Kept lean (no DB) so cold visitors get the landing instantly.
app.get("/", (req: Request, res: Response) => {
  const base = `${req.protocol}://${req.get("host")}`;
  // The shell changes every deploy and the SW re-fetches it network-first, so it
  // must never be held stale by an intermediary or the browser HTTP cache.
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(rootShellHtml(base));
});
app.use(
  express.static(path.resolve(process.cwd(), "public"), { setHeaders: setStaticCacheHeaders })
);

// Hub feature routers (cross-trip balances, one-off IOUs, activity feed).
// Each defines absolute /api paths and guards its own routes with requireAuth.
app.use(dashboardRouter);
app.use(iouRouter);
app.use(tabsRouter);
app.use(settleLinkRouter);
app.use(activityRouter);
app.use(recurringRouter);
app.use(subscriptionsRouter);
app.use(householdRouter);
app.use(friendsRouter);
app.use(chatRouter);
// "Ask Mochi" natural-language endpoint (Claude tool use; degrades gracefully
// without ANTHROPIC_API_KEY — same provider pattern as /api/scan).
app.use(mochiRouter);
// Spending journal: warm monthly digest of the caller's own spending.
app.use(journalRouter);
app.use(reactionsRouter);
app.use(nudgesRouter);
app.use(autonudgeRouter);
app.use(pushRouter);
app.use(referralsRouter);
// Legal + support pages: /terms, /privacy, /support (server-rendered, static).
app.use(legalRouter);
// Public Mochi meme generator page: /memes (server-rendered shell, no auth).
app.use(memesRouter);
// Public friend-debt portfolio card generator: /bags (no auth, pure client).
app.use(bagsRouter);
// Pre-launch waitlist (POST /api/waitlist) — called cross-origin by the static
// marketing site; carries its own narrow CORS allowance. See src/waitlist.ts.
app.use(waitlistRouter);
// First-party error + analytics ingest. Reuses the shared IP rate limiter
// (12/min per IP). authOptional (above) sets req.userId; telemetry stores only
// a hash of it, never the id. See src/telemetry.ts.
app.use(telemetryRouter(rateLimit(12, 60_000)));

// ---- Auth & identity (progressive, optional) ------------------------------

app.get("/api/auth/config", (_req: Request, res: Response) => {
  // `cluster` is public, non-secret config: the client gates devnet-only UX
  // (burner wallets, faucet copy, devnet badges) on it. Server-pinned — the
  // client can never choose the chain, only render honestly for it.
  res.json({ siws: true, privy: privyConfigured(), cluster: CLUSTER });
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
    // One server-side lookup per verify (auth-time only, not a hot path); null
    // means PRIVY_APP_SECRET is unset or Privy errored — skip gracefully.
    const linkedAccounts = await fetchPrivyLinkedAccounts(verified.subject);
    const ownedWallets = extractPrivyWallets(linkedAccounts || []);
    let wallet: string | undefined;
    if (body.wallet && ownedWallets.includes(body.wallet)) wallet = body.wallet;
    else if (ownedWallets.length) wallet = ownedWallets[0];
    if (body.wallet && !wallet) {
      logMoney("privy.wallet_unverified", req, { subject: verified.subject, claimed: body.wallet });
    }
    const user = await upsertUserByIdentity("privy", verified.subject, { wallet });
    // Identity LEARNING: Privy just proved which Apple/Google accounts this
    // person owns, so record ("apple", sub) / ("google", sub) on the same Divvy
    // user. That's what lets the NATIVE Apple sign-in resolve directly on every
    // later launch. Best-effort and never steals — linkIdentityIfFree skips
    // (with a warn) any subject already mapped to a different user.
    if (linkedAccounts) {
      for (const ident of extractPrivyOAuthIdentities(linkedAccounts)) {
        try {
          await linkIdentityIfFree(ident.provider, ident.subject, user.id);
        } catch {
          /* identity learning must never fail the sign-in itself */
        }
      }
    }
    res.json({ token: signSession(user.id), user: await serializeUser(user) });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
});

// ---- Native Sign in with Apple (Capacitor iOS shell) ------------------------
// The OS Face-ID sheet hands the shell an Apple identity token; verifying it
// here (signature/iss/aud/exp/nonce — see verifyAppleIdentityToken) signs a
// RETURNING user straight in. A subject we've never seen gets a FULLY NATIVE
// first run too: we pregenerate their Privy account server-side (apple_oauth +
// Solana embedded wallet + linked email when Apple shared one — see
// createPrivyUserForApple) and issue a session, indistinguishable from a
// returning user's 200. Only when that creation path is unavailable
// (PRIVY_APP_SECRET unset, Privy outage, unresolvable conflict) does the
// client get 404 { needsSetup: true } and fall back to the one-time Safari
// flow, whose Privy verify then LEARNS the ("apple", sub) identity. The 404
// body is identical regardless of the reason no account could be resolved.
// Tokens are bearer credentials — never logged.
app.post("/api/auth/apple/verify", authRateLimit, async (req: Request, res: Response) => {
  const body = (req.body || {}) as { identityToken?: unknown; rawNonce?: unknown };
  const identityToken = typeof body.identityToken === "string" ? body.identityToken : "";
  const rawNonce = typeof body.rawNonce === "string" ? body.rawNonce : undefined;
  // Field-size caps: real Apple identity tokens are ~1 KB and raw nonces are
  // 32 hex chars — anything wildly bigger is garbage; reject before crypto.
  if (
    !identityToken ||
    identityToken.length > 4096 ||
    (rawNonce !== undefined && rawNonce.length > 256)
  ) {
    return res.status(401).json({ error: "invalid token" });
  }
  const verified = await verifyAppleIdentityToken(identityToken, rawNonce);
  if (!verified) return res.status(401).json({ error: "invalid token" });
  try {
    const userId = await getIdentity("apple", verified.subject);
    let user = userId ? await getUser(userId) : undefined;
    if (!user) {
      // First-time native user. ONLY reachable after full JWKS verification of
      // the identity token (above). Create the Privy account (the same shape a
      // web-flow user gets) and mirror it as a Divvy user: primary identity
      // ("privy", did), secondary ("apple", sub), pregenerated wallet linked.
      const created = await createPrivyUserForApple({
        subject: verified.subject,
        email: verified.email,
      });
      if (created) {
        user = await upsertUserByIdentity("privy", created.did, { wallet: created.wallets[0] });
        const linked = await linkIdentityIfFree("apple", verified.subject, user.id);
        if (!linked) {
          // Lost a race for the apple mapping — first mapping wins, so this
          // session belongs to whoever holds it now.
          const winnerId = await getIdentity("apple", verified.subject);
          const winner = winnerId ? await getUser(winnerId) : undefined;
          if (winner) user = winner;
        }
      }
    }
    if (!user) return res.status(404).json({ needsSetup: true });
    res.json({ token: signSession(user.id), user: await serializeUser(user) });
  } catch {
    // Store hiccup: indistinguishable from "not found" — the Safari fallback
    // still signs the user in, so this fails toward the working path.
    res.status(404).json({ needsSetup: true });
  }
});

// ---- Native OAuth handoff (Capacitor iOS shell) ----------------------------
// Google OAuth can't run inside the shell's WKWebView ("disallowed_useragent"),
// so social sign-in completes in the system browser and hands the session back
// via a single-use, 60s-TTL code on a divvy:// deep link (see src/auth.ts for
// the storage/single-use guarantees). Codes are bearer credentials for the
// minting user — they are NEVER logged, and responses carry no identifiers
// beyond what the caller already holds.

// Mint: requires a signed-in session (the Safari leg just finished the normal
// Privy verify and holds a fresh Divvy token).
app.post("/api/auth/handoff", authRateLimit, requireAuth, async (req: Request, res: Response) => {
  const code = await mintHandoffCode(req.userId as string);
  // Store unavailable → fail closed (no unprovable single-use codes).
  if (!code) return res.status(503).json({ error: "handoff unavailable, try again" });
  res.json({ code });
});

// Exchange: unauthenticated by design (the shell has no session yet). One valid
// use returns a session; unknown/expired/reused codes are indistinguishable 401s.
app.post("/api/auth/handoff/exchange", authRateLimit, async (req: Request, res: Response) => {
  const body = (req.body || {}) as { code?: string };
  const userId = await exchangeHandoffCode(typeof body.code === "string" ? body.code : "");
  if (!userId) return res.status(401).json({ error: "invalid or expired code" });
  const user = await getUser(userId);
  if (!user) return res.status(401).json({ error: "invalid or expired code" });
  res.json({ token: signSession(user.id), user: await serializeUser(user) });
});

app.get("/api/me", async (req: Request, res: Response) => {
  if (!req.userId) return res.json({ user: null });
  const user = await getUser(req.userId);
  res.json({ user: user ? await serializeUser(user) : null });
});

app.patch("/api/me", writeRateLimit, requireAuth, async (req: Request, res: Response) => {
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
app.delete("/api/me", writeRateLimit, requireAuth, async (req: Request, res: Response) => {
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

// Local QR rendering for the pay/settle/receive screens — replaces the
// third-party QR image API that leaked payment URLs (recipient wallet, amount,
// reference) to an external host. Restricted to Solana Pay URLs and bare
// base58 addresses so this is not an open QR generator.
const qrRateLimit = rateLimit(60, 60_000);
const BASE58_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
app.get("/api/qr", qrRateLimit, async (req: Request, res: Response) => {
  const data = String(req.query.data || "");
  const ok = data.length <= 2048 && (data.startsWith("solana:") || BASE58_ADDR.test(data));
  if (!ok) return res.status(400).json({ error: "unsupported payload" });
  try {
    const png = await qrToPngBuffer(data);
    res.setHeader("content-type", "image/png");
    res.setHeader("cache-control", "private, max-age=300");
    res.send(png);
  } catch (_e) {
    res.status(400).json({ error: "unsupported payload" });
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
  /** Itemized "who had what" breakdown, when the split was built from a scan. */
  items?: { label?: string; qty?: number; cents?: number; names?: string[] }[];
}

/** Same caps as scan.ts so a hostile bill payload can't smuggle megabytes of
 *  items past the scanner's own limits. */
const MAX_BILL_ITEMS = 40;
const MAX_ITEM_LABEL = 80;

/**
 * Sanitize a client-supplied items array into stored BillItems. Defensive: drops
 * junk lines, clamps counts/lengths, integer cents only. Returns undefined when
 * nothing valid remains. Names are intersected with the real participant set so
 * a payload can't attach phantom people to a line.
 */
function sanitizeBillItems(
  raw: CreateBillBody["items"],
  validNames: string[]
): BillItem[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const nameSet = new Set(validNames);
  const out: BillItem[] = [];
  for (const it of raw) {
    if (out.length >= MAX_BILL_ITEMS) break;
    const cents = Number(it && it.cents);
    if (!Number.isInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) continue;
    let qty = Number(it && it.qty);
    if (!Number.isInteger(qty) || qty < 1) qty = 1;
    qty = Math.min(qty, 99);
    let label = String((it && it.label) || "item").trim().slice(0, MAX_ITEM_LABEL) || "item";
    const rawNames = it && it.names;
    const names = Array.isArray(rawNames)
      ? rawNames.map((n) => String(n)).filter((n) => nameSet.has(n))
      : [];
    out.push({ label, qty, cents, names });
  }
  return out.length ? out : undefined;
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
      items: sanitizeBillItems(body.items, names),
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
  // H1/B4: a bill stamped on a different cluster must never be verified against
  // this server's chain — a devnet-era bill would either stall forever against
  // mainnet or, worse, match a real transfer. Refuse with a clear closed state.
  if (bill.cluster !== CLUSTER) {
    return res.status(409).json({ error: clusterMismatchError(bill.cluster), crossCluster: true });
  }
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

app.post("/api/groups", writeRateLimit, requireAuth, async (req: Request, res: Response) => {
  const body = req.body as { name?: string; members?: string[] };
  try {
    const group = await createGroup(body.name || "", body.members || [], req.userId as string);
    res.json(group);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete("/api/groups/:id", writeRateLimit, requireAuth, async (req: Request, res: Response) => {
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

// Cheap read limiter for the public /api/fx/* endpoints — each quote can hit
// the upstream rate API (cache misses), so keep an anonymous client from using
// us as a free FX proxy. Generous enough that the currency picker never bites.
const fxRateLimit = rateLimit(60, 60_000); // ~60 req/min per IP

// The currency picker's menu: the offline-known whitelist + display metadata.
// `enabled:false` (DIVVY_FX=off) tells the client to hide the picker entirely —
// the app is fully usable USD-only.
app.get("/api/fx/currencies", fxRateLimit, (_req: Request, res: Response) => {
  if (!fxEnabled()) {
    return res.json({ enabled: false, currencies: ["USD"], symbols: { USD: "$" }, zeroDecimal: [] });
  }
  const currencies = supportedCurrencies();
  const symbols: Record<string, string> = {};
  for (const c of currencies) symbols[c] = symbolFor(c);
  res.json({
    enabled: true,
    currencies,
    symbols,
    zeroDecimal: currencies.filter((c) => isZeroDecimal(c)),
  });
});

// FX quote: convert a local-currency MAJOR amount to USD at the current locked
// rate. e.g. GET /api/fx/THB/2450 -> USD value + rate/source/timestamp.
app.get("/api/fx/:from/:amount", fxRateLimit, async (req: Request, res: Response) => {
  if (!fxEnabled()) return res.status(400).json({ error: "multi-currency is off" });
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
  // iOS/Safari clients pass ?applePay=1 so the widget opens straight onto the
  // Apple Pay sheet; everyone else gets MoonPay's default card flow.
  const paymentMethod = req.query.applePay === "1" ? "apple_pay" : undefined;
  const redirectURL = `${req.protocol}://${req.get("host")}/#/you`;
  res.json({
    wallet,
    amountCents,
    live: ramsConfigured(),
    ...cardOptions({ walletAddress: wallet, amountCents, paymentMethod, redirectURL }),
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
  const redirectURL = `${req.protocol}://${req.get("host")}/#/you`;
  res.json({
    wallet,
    amountCents,
    live: ramsConfigured(),
    ...cashoutOptions({ walletAddress: wallet, amountCents, redirectURL }),
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
// Ledger amount cap — env-tunable via LEDGER_MAX_CENTS (default $1,000,000).
// One shared constant across server/tabs/ious/mochi/subscriptions (src/limits.ts).
const MAX_AMOUNT_CENTS = LEDGER_MAX_CENTS;
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

/**
 * Group-settings auth (rename / emoji / archive / remove-member): the trip owner
 * OR any claimed member may administer the group. Keyless/anonymous trips stay
 * open to any authorized (share-token) caller, matching the collaborative
 * expense model.
 */
function canAdminTrip(req: Request, trip: Trip): boolean {
  if (!authorizeTrip(req, trip)) return false;
  if (!trip.ownerUserId) return true; // keyless/anonymous — open collaboration
  const uid = req.userId;
  if (!uid) return false;
  if (trip.ownerUserId === uid) return true;
  return trip.members.some((m) => m.userId === uid);
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
  // H1/B4: a settlement built on another cluster carries pay URLs for the
  // wrong chain — strip them so no client ever renders a payable request, and
  // say why. Paid history still shows.
  const crossCluster = trip.cluster !== CLUSTER;
  const transfers = stored.transfers.map((t: SettlementTransfer) => ({
    from: t.from,
    fromName: memberName(trip, t.from),
    to: t.to,
    toName: memberName(trip, t.to),
    amountCents: t.amountCents,
    amountFmt: fmt(t.amountCents),
    url: crossCluster ? null : t.url || null,
    reference: t.reference || null,
    needsWallet: !t.url,
    paid: !!t.paid,
  }));
  const payable = transfers.filter((t) => !t.needsWallet);
  const allPaid = payable.length > 0 && payable.every((t) => t.paid);
  return {
    transfers,
    allPaid,
    createdAt: stored.createdAt,
    crossCluster,
    ...(crossCluster ? { crossClusterNote: clusterMismatchError(trip.cluster) } : {}),
  };
}

async function serializeTrip(trip: Trip, opts?: { refUserId?: string | null }) {
  const memberIds = trip.members.map((m) => m.id);
  const ledgerExpenses = trip.expenses.map((e) => ({
    amountCents: e.amountCents,
    paidBy: e.paidBy,
    participants: e.participants,
  }));
  const balances = computeBalances(memberIds, ledgerExpenses);
  // Confirmed settle-outside transfers CLEAR balances (they're in ledgerExpenses)
  // but are money moving, not spending — keep them out of the group total.
  const totalCents = trip.expenses.reduce(
    (a, e) => a + (e.kind === "transfer" ? 0 : e.amountCents),
    0
  );
  // Debt simplification: the fewest-payments plan (same greedy the settle flow
  // executes, so these legs match /settle's transfers exactly) plus the naive
  // pairwise count it replaces — "3 payments instead of 6".
  const simplified = simplifyDebts(balances);
  const pairwiseCount = pairwiseDebts(memberIds, ledgerExpenses).length;
  // Due-date chips: a moment is overdue once it passes — but a settled-up
  // group has nothing left to be late on.
  const nowMs = Date.now();
  const settledUp = balances.every((b) => b.cents === 0);
  const isPast = (iso?: string | null) => !!(iso && new Date(iso).getTime() <= nowMs);

  return {
    id: trip.id,
    name: trip.name,
    shareToken: trip.shareToken,
    // Invite attribution: when an authenticated user loads their trip to share
    // it, stamp their id onto the share path so a friend who opens the link gets
    // a `divvy_ref` cookie and this user gets credit. The URL is capability-safe
    // (userId is already surfaced as ownerUserId/member.userId), self-referrals
    // are dropped at record time.
    shareUrlPath: `/t/${trip.shareToken}${
      opts && opts.refUserId ? `?ref=${encodeURIComponent(opts.refUserId)}` : ""
    }`,
    cluster: trip.cluster,
    createdAt: trip.createdAt,
    ownerUserId: trip.ownerUserId || null,
    emoji: trip.emoji || null,
    archived: !!trip.archived,
    dueAt: trip.dueAt || null,
    kind: trip.kind || null,
    overdue: isPast(trip.dueAt) && !settledUp,
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
        movedInAt: m.movedInAt || null,
        movedOutAt: m.movedOutAt || null,
      };
    })),
    // Itemized per-member rows collapse into ONE logical expense (id = the
    // shared splitId) with an exact breakdown; balances above still use the
    // raw rows, so the two views always agree.
    expenses: mergeItemizedExpenses(trip.expenses).map((e) => {
      // FX display metadata: the original receipt currency stays prominent
      // ("¥3,000 · $20.14") while amountCents/amountFmt remain the USD ledger
      // truth. fxOriginal handles both the new ExpenseFx shape and the legacy
      // bill-style {sourceCurrency, sourceAmount} blob.
      const orig = fxOriginal(e.fx);
      // Itemized foreign receipts store item lines/extras in the ORIGINAL
      // currency's minor units — format them as such.
      const lineFmt = (cents: number) =>
        orig ? formatForeign(majorFromMinor(cents, orig.currency), orig.currency) : fmt(cents);
      return {
        id: e.id,
        title: e.title,
        amountCents: e.amountCents,
        amountFmt: fmt(e.amountCents),
        paidBy: e.paidBy,
        paidByName: memberName(trip, e.paidBy),
        participants: e.participants,
        participantNames: e.participants.map((p) => memberName(trip, p)),
        kind: e.kind || null,
        dueAt: e.dueAt || null,
        overdue: isPast(e.dueAt) && !settledUp,
        fx: e.fx || null,
        fxNote: fxNoteFor(e.fx),
        fxCurrency: orig ? orig.currency : null,
        fxOriginalFmt: fxOriginalFmt(e.fx),
        createdAt: e.createdAt,
        itemized: !!e.itemized,
        breakdown: e.itemized
          ? e.itemized.breakdown.map((b) => ({
              memberId: b.memberId,
              name: memberName(trip, b.memberId),
              cents: b.cents,
              fmt: fmt(b.cents),
            }))
          : undefined,
        items: e.itemized
          ? e.itemized.items.map((it) => ({
              label: it.label,
              qty: it.qty,
              cents: it.cents,
              fmt: lineFmt(it.cents),
              memberIds: it.memberIds,
              names: it.memberIds.map((p) => memberName(trip, p)),
            }))
          : undefined,
        extrasCents: e.itemized ? e.itemized.extrasCents : undefined,
        extrasFmt: e.itemized ? lineFmt(e.itemized.extrasCents) : undefined,
      };
    }),
    totalCents,
    totalFmt: fmt(totalCents),
    balances: balances.map((b) => ({
      memberId: b.memberId,
      name: memberName(trip, b.memberId),
      cents: b.cents,
      fmt: fmt(Math.abs(b.cents)),
      direction: b.cents > 0 ? "owed" : b.cents < 0 ? "owes" : "settled",
    })),
    simplify: {
      transfers: simplified.map((t) => ({
        from: t.from,
        fromName: memberName(trip, t.from),
        to: t.to,
        toName: memberName(trip, t.to),
        cents: t.amountCents,
        fmt: fmt(t.amountCents),
      })),
      count: simplified.length,
      pairwiseCount,
      summary: simplifySummary({ simplifiedCount: simplified.length, pairwiseCount }),
    },
    settle: await serializeSettlement(trip),
    // Pending "settled another way" claims (settleOutside.ts). Pure metadata —
    // a pending claim NEVER moves a balance; only a confirm records a transfer.
    settleOutside: (await listPendingTripClaims(trip.id)).map((c) => ({
      ...serializeOutsideClaim(c),
      fromName: c.from_member_id ? memberName(trip, c.from_member_id) : null,
      toName: c.to_member_id ? memberName(trip, c.to_member_id) : null,
    })),
  };
}

app.post("/api/trips", spamRateLimit, async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      name?: string;
      members?: { name?: string; wallet?: string; userId?: string }[];
      dueAt?: unknown;
      kind?: unknown;
    };
    const name = assertLen(String(body.name || ""), "trip name", 1, MAX_TRIP_NAME);
    // Optional group kind — only the "roommates 🏠" household template for now.
    let kind: string | null = null;
    if (body.kind !== undefined && body.kind !== null && body.kind !== "") {
      if (body.kind !== "household") {
        return res.status(400).json({ error: 'kind must be "household"' });
      }
      kind = "household";
    }
    // Optional "settle by" date, set at creation (validated: future, ≤ 1 year).
    let dueAt: string | null = null;
    if (body.dueAt !== undefined) {
      const v = validateDueAt(body.dueAt, Date.now());
      if (!v.ok) return res.status(400).json({ error: v.error });
      dueAt = v.dueAt;
    }
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
    let trip = await createTrip(name, cluster, members, req.userId);
    if (dueAt || kind) trip = await updateTrip(trip.id, { ...(dueAt ? { dueAt } : {}), ...(kind ? { kind } : {}) });
    res.json(await serializeTrip(trip, { refUserId: req.userId }));
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
  // Transfers (settle-outside records) clear balances but aren't spending —
  // exclude them from the list summary's totals, like serializeTrip does.
  // Itemized per-member rows count as ONE logical expense (merge first).
  const spendExpenses = mergeItemizedExpenses(trip.expenses).filter((e) => e.kind !== "transfer");
  const totalCents = spendExpenses.reduce((a, e) => a + e.amountCents, 0);
  const settledUp = balances.every((b) => b.cents === 0);
  return {
    id: trip.id,
    name: trip.name,
    // shareToken intentionally omitted: list summaries must not hand out
    // working capability links.
    createdAt: trip.createdAt,
    memberCount: trip.members.length,
    expenseCount: spendExpenses.length,
    totalCents,
    totalFmt: fmt(totalCents),
    settledUp,
    ownerUserId: trip.ownerUserId || null,
    emoji: trip.emoji || null,
    archived: !!trip.archived,
    dueAt: trip.dueAt || null,
    kind: trip.kind || null,
    overdue: !!(trip.dueAt && new Date(trip.dueAt).getTime() <= Date.now() && !settledUp),
  };
}

app.get("/api/trips", requireAuth, async (req: Request, res: Response) => {
  // Privacy-scoped: only trips the caller owns or has claimed a spot in.
  // (?mine is accepted harmlessly; it's now the only behavior.)
  // Archived trips are hidden by default; ?archived=1 includes them (so the
  // groups screen can offer an "archived (N)" toggle from a single fetch).
  const includeArchived = req.query.archived === "1" || req.query.archived === "true";
  let trips = await listTripsForUser(req.userId as string);
  if (!includeArchived) trips = trips.filter((t) => !t.archived);
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
  // They have access, so the full trip MAY include the shareToken. Stamp the
  // requester's ref onto shareUrlPath so a link they share attributes back.
  res.json(await serializeTrip(trip, { refUserId: req.userId }));
});

// Group settings: rename, set emoji, archive/unarchive. Owner or any claimed
// member (see canAdminTrip). Only provided fields change.
app.patch("/api/trips/:id", writeRateLimit, async (req: Request, res: Response) => {
  try {
    const existing = await getTrip(req.params.id);
    if (!existing) return res.status(404).json({ error: "not found" });
    if (!canAdminTrip(req, existing)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    const body = req.body as { name?: string; emoji?: string; archived?: boolean; dueAt?: unknown };
    const patch: { name?: string; emoji?: string | null; archived?: boolean; dueAt?: string | null } = {};
    if (body.name !== undefined) {
      patch.name = assertLen(String(body.name), "trip name", 1, MAX_TRIP_NAME);
    }
    if (body.dueAt !== undefined) {
      // "settle by sunday" — future, ≤ 1 year out; null/"" clears it.
      const v = validateDueAt(body.dueAt, Date.now());
      if (!v.ok) return res.status(400).json({ error: v.error });
      patch.dueAt = v.dueAt;
    }
    if (body.emoji !== undefined) {
      // Same constraint style as member emoji: coerce + cap at 8 chars; empty clears.
      const e = String(body.emoji || "").slice(0, 8);
      patch.emoji = e || null;
    }
    if (body.archived !== undefined) {
      patch.archived = !!body.archived;
    }
    const trip = await updateTrip(req.params.id, patch);
    res.json(await serializeTrip(trip));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Remove a member slot. Allowed for the trip owner OR a member removing
// THEMSELVES. HARD RULE: refuse (409) if that member carries a nonzero balance
// or appears in any expense (paidBy/participants) — money history must never
// dangle a reference to a deleted member.
app.delete("/api/trips/:id/members/:mid", writeRateLimit, async (req: Request, res: Response) => {
  try {
    const existing = await getTrip(req.params.id);
    if (!existing) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, existing)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    const member = existing.members.find((m) => m.id === req.params.mid);
    if (!member) return res.status(404).json({ error: "member not found" });

    const uid = req.userId;
    const isOwner = !!uid && existing.ownerUserId === uid;
    const isSelf = !!uid && member.userId === uid;
    // Keyless/anonymous trips have no owner/identity to protect — stay open.
    const openTrip = !existing.ownerUserId;
    if (!isOwner && !isSelf && !openTrip) {
      return res.status(403).json({ error: "only the owner can remove another member" });
    }

    // Guard: no dangling money history.
    const inExpense = existing.expenses.some(
      (e) => e.paidBy === member.id || e.participants.includes(member.id)
    );
    const balances = computeBalances(
      existing.members.map((m) => m.id),
      existing.expenses.map((e) => ({
        amountCents: e.amountCents,
        paidBy: e.paidBy,
        participants: e.participants,
      }))
    );
    const bal = balances.find((b) => b.memberId === member.id);
    if (inExpense || (bal && bal.cents !== 0)) {
      return res.status(409).json({
        error: "this person is in the money history — settle up and remove their tabs first",
      });
    }

    const trip = await removeMember(req.params.id, req.params.mid);
    res.json(await serializeTrip(trip));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/trips/:id/members", writeRateLimit, async (req: Request, res: Response) => {
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

app.patch("/api/trips/:id/members/:mid", writeRateLimit, async (req: Request, res: Response) => {
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
app.post("/api/trips/:id/members/:mid/claim", writeRateLimit, requireAuth, async (req: Request, res: Response) => {
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
    // Invite attribution: claiming a slot is an identity moment. If this visitor
    // arrived via a ref link (divvy_ref cookie), credit the inviter — first wins,
    // never a self-referral. Best-effort: never let attribution break a claim.
    try {
      const ref = readRefCookie(req);
      if (ref) await recordReferral(ref, userId, "trip_claim");
    } catch { /* attribution is best-effort */ }
    res.json(await serializeTrip(trip, { refUserId: req.userId }));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * Resolve a foreign-currency expense entry ({currency, originalAmount} in the
 * currency's OWN minor units) into USD cents + a locked ExpenseFx blob. The
 * server converts AT ENTRY TIME with its own rates — any client-supplied
 * rate/fx blob is ignored. Returns null for USD/absent currency (no FX), or an
 * error string on a bad payload.
 */
async function resolveEntryFx(
  currencyRaw: unknown,
  originalAmountRaw: unknown
): Promise<{ usdCents: number; fx: ExpenseFx } | { error: string } | null> {
  const currency = String(currencyRaw || "").trim().toUpperCase();
  if (!currency || currency === "USD") return null;
  if (!fxEnabled()) return { error: "multi-currency is off — enter the amount in USD" };
  if (!isSupported(currency)) return { error: `unsupported currency: ${currency}` };
  const originalAmount = originalAmountRaw as number;
  if (!Number.isInteger(originalAmount) || originalAmount < 1 || originalAmount > MAX_FX_MINOR) {
    return { error: "originalAmount must be an integer amount in minor units (1..10^10)" };
  }
  const { usdCents, rate, asOf, source } = await convertMinorToUsd(originalAmount, currency);
  // M4: on mainnet a stale offline fallback table must never price real money.
  // New FX entries are refused (400) until live rates return; stored rows keep
  // displaying fine (their fx blob carries the rate locked at entry).
  if (!fxSourceUsableOnCluster(source, CLUSTER)) {
    return { error: FX_FALLBACK_UNAVAILABLE };
  }
  if (usdCents < 1) {
    return { error: `that's less than a cent in USD (${formatForeign(majorFromMinor(originalAmount, currency), currency)})` };
  }
  if (usdCents > MAX_AMOUNT_CENTS) {
    return { error: `amount exceeds cap ($${MAX_AMOUNT_CENTS / 100})` };
  }
  return { usdCents, fx: buildExpenseFx({ currency, originalAmount, rate, asOf, source }) };
}

app.post("/api/trips/:id/expenses", writeRateLimit, async (req: Request, res: Response) => {
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
      currency?: string;
      originalAmount?: number;
      dueAt?: unknown;
    };
    if (trip.expenses.length >= MAX_EXPENSES) {
      return res.status(400).json({ error: `too many expenses (max ${MAX_EXPENSES})` });
    }
    // Foreign-currency entry: the server converts ONCE at entry time and the
    // ledger stores USD cents (balances/settle/simplify untouched). Tighter
    // gate than the collaborative USD path: a signed-in trip member only.
    let fx: ExpenseFx | null = null;
    let amountCents: number;
    const fxr = await resolveEntryFx(body.currency, body.originalAmount);
    if (fxr && "error" in fxr) return res.status(400).json({ error: fxr.error });
    if (fxr) {
      if (!req.userId) return res.status(401).json({ error: "sign in to log a foreign-currency expense" });
      if (
        !canItemize({
          userId: req.userId,
          ownerUserId: trip.ownerUserId || null,
          memberUserIds: trip.members.map((m) => m.userId).filter((x): x is string => !!x),
        })
      ) {
        return res.status(403).json({ error: "only group members can log a foreign-currency expense" });
      }
      amountCents = fxr.usdCents;
      fx = fxr.fx;
    } else {
      amountCents = body.amountCents ?? (body.total != null ? toCents(body.total) : NaN);
    }
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
    // Optional "pay back by" moment (validated: future, ≤ 1 year).
    let dueAt: string | null = null;
    if (body.dueAt !== undefined) {
      const v = validateDueAt(body.dueAt, Date.now());
      if (!v.ok) return res.status(400).json({ error: v.error });
      dueAt = v.dueAt;
    }
    const updated = await addExpense(req.params.id, {
      title: String(body.title || ""),
      amountCents,
      paidBy: String(body.paidBy || ""),
      participants,
      // Server-derived provenance ONLY — a client-supplied fx blob (and any
      // client rate) is never trusted or stored.
      fx: fx ?? undefined,
      dueAt,
    });
    res.json(await serializeTrip(updated));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Itemized "who had what" group expense: the server recomputes the exact
// per-member shares from the raw items (never trusting client math) — each
// item split evenly among who had it, extras (tip + tax + unassigned lines)
// proportional to each member's item subtotal — and posts them as per-member
// rows sharing a splitId, surfaced as ONE logical expense. Tighter than the
// collaborative even-split ADD: requires a signed-in trip member.
app.post(
  "/api/trips/:id/expenses/itemized",
  writeRateLimit,
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const trip = await getTrip(req.params.id);
      if (!trip) return res.status(404).json({ error: "not found" });
      if (!authorizeTrip(req, trip)) {
        return res.status(403).json({ error: "not authorized for this trip" });
      }
      if (
        !canItemize({
          userId: req.userId,
          ownerUserId: trip.ownerUserId || null,
          memberUserIds: trip.members.map((m) => m.userId).filter((x): x is string => !!x),
        })
      ) {
        return res.status(403).json({ error: "only group members can itemize an expense" });
      }
      const body = req.body as {
        title?: string;
        totalCents?: number;
        paidBy?: string;
        items?: unknown;
        currency?: string;
        originalAmount?: number;
        dueAt?: unknown;
      };
      // Foreign receipt: totals AND item lines arrive in the original
      // currency's own minor units (what the receipt says); the server
      // converts the TOTAL to USD exactly once — rates its own, never the
      // client's — and item math runs in the original units below.
      const fxr = await resolveEntryFx(body.currency, body.originalAmount);
      if (fxr && "error" in fxr) return res.status(400).json({ error: fxr.error });
      const totalCents = fxr ? (body.originalAmount as number) : body.totalCents;
      if (!Number.isInteger(totalCents) || (totalCents as number) <= 0) {
        return res.status(400).json({ error: "need a positive integer totalCents" });
      }
      if (!fxr && (totalCents as number) > MAX_AMOUNT_CENTS) {
        return res.status(400).json({ error: `amount exceeds cap ($${MAX_AMOUNT_CENTS / 100})` });
      }
      if (body.title !== undefined && String(body.title).trim()) {
        assertLen(String(body.title), "expense title", 1, MAX_EXPENSE_TITLE);
      }
      const paidBy = String(body.paidBy || "");
      if (!trip.members.some((m) => m.id === paidBy)) {
        return res.status(400).json({ error: "paidBy must be a group member" });
      }
      const memberIds = trip.members.map((m) => m.id);
      const v = validateItemized(body.items, totalCents as number, memberIds);
      if (!v.ok) return res.status(400).json({ error: v.error });
      // Optional "pay back by" moment (validated: future, ≤ 1 year).
      let dueAt: string | null = null;
      if (body.dueAt !== undefined) {
        const dv = validateDueAt(body.dueAt, Date.now());
        if (!dv.ok) return res.status(400).json({ error: dv.error });
        dueAt = dv.dueAt;
      }
      // Exact shares (zero-sum with the payer's credit by construction). A
      // member with no items and no extras owes nothing → no row.
      const shares = itemizedShares(totalCents as number, v.items, memberIds);
      let entries = memberIds
        .map((id) => ({ memberId: id, cents: shares.get(id) as number }))
        .filter((s) => s.cents > 0);
      if (fxr) {
        // Ledger rows must be USD: convert the TOTAL once (rounded once, in
        // resolveEntryFx) and hand out the USD cents by each member's
        // original-currency share (largest-remainder) — proportions preserved,
        // USD rows summing EXACTLY to the converted total.
        const usd = distributeWeighted(fxr.usdCents, entries.map((s) => s.cents));
        entries = entries
          .map((s, i) => ({ memberId: s.memberId, cents: usd[i] }))
          .filter((s) => s.cents > 0);
        if (entries.length === 0) {
          return res.status(400).json({ error: "that's less than a cent in USD" });
        }
      }
      if (trip.expenses.length + entries.length > MAX_EXPENSES) {
        return res.status(400).json({ error: `too many expenses (max ${MAX_EXPENSES})` });
      }
      const updated = await addItemizedExpense(trip.id, {
        title: String(body.title || ""),
        paidBy,
        shares: entries,
        // Items/extras stay in the ORIGINAL currency's minor units when fx is
        // set (display formats them via the fx blob); USD cents otherwise.
        meta: { items: v.items, extrasCents: v.extrasCents },
        fx: fxr ? fxr.fx : undefined,
        dueAt,
      });
      res.json(await serializeTrip(updated));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

app.patch("/api/trips/:id/expenses/:eid", writeRateLimit, async (req: Request, res: Response) => {
  try {
    const trip = await getTrip(req.params.id);
    if (!trip) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, trip)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    // Itemized expenses (the merged id is the splitId, and each underlying row
    // carries one) can't be PATCHed — a partial edit would desync the exact
    // per-member rows from their item breakdown. Delete and re-add instead.
    if (trip.expenses.some((e) => e.splitId === req.params.eid || (e.id === req.params.eid && e.splitId))) {
      return res.status(403).json({ error: "itemized expenses can't be edited — delete and re-add it" });
    }
    const existingExpense = trip.expenses.find((e) => e.id === req.params.eid);
    if (!existingExpense) return res.status(404).json({ error: "expense not found" });
    if (existingExpense.kind === "transfer") {
      // A confirmed settle-outside payment is money history — rewriting it
      // would silently un-settle a debt the creditor already confirmed.
      return res.status(403).json({ error: "confirmed settle-ups can't be edited" });
    }
    if (!canMutateExpense(req, trip, existingExpense.paidBy)) {
      return res.status(403).json({ error: "only the trip owner or the person who paid can edit this expense" });
    }
    const body = req.body as {
      title?: string;
      amountCents?: number;
      paidBy?: string;
      participants?: string[];
      dueAt?: unknown;
    };
    const patch: {
      title?: string;
      amountCents?: number;
      paidBy?: string;
      participants?: string[];
      dueAt?: string | null;
      fx?: any | null;
    } = {};
    if (body.dueAt !== undefined) {
      const v = validateDueAt(body.dueAt, Date.now());
      if (!v.ok) return res.status(400).json({ error: v.error });
      patch.dueAt = v.dueAt;
    }
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
      // Rewriting the USD amount makes the original-currency provenance a lie
      // ("¥3,000" no longer explains the number) — drop it rather than mislead.
      if (existingExpense.fx && amountCents !== existingExpense.amountCents) patch.fx = null;
    }
    if (body.paidBy !== undefined) patch.paidBy = String(body.paidBy);
    if (body.participants !== undefined) patch.participants = body.participants;

    const updated = await editExpense(req.params.id, req.params.eid, patch);
    res.json(await serializeTrip(updated));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete("/api/trips/:id/expenses/:eid", writeRateLimit, async (req: Request, res: Response) => {
  try {
    const existing = await getTrip(req.params.id);
    if (!existing) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, existing)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    // An itemized expense is one LOGICAL expense stored as per-member rows —
    // the client deletes by the merged id (the shared splitId), and every row
    // of the group must void together so no partial breakdown lingers.
    const itemizedRows = existing.expenses.filter(
      (e) => e.splitId && (e.splitId === req.params.eid || e.id === req.params.eid)
    );
    if (itemizedRows.length > 0) {
      const splitId = itemizedRows[0].splitId as string;
      const group = existing.expenses.filter((e) => e.splitId === splitId);
      if (!canMutateExpense(req, existing, group[0].paidBy)) {
        return res.status(403).json({ error: "only the trip owner or the person who paid can delete this expense" });
      }
      let trip = existing;
      for (const row of group) trip = await deleteExpense(req.params.id, row.id);
      return res.json(await serializeTrip(trip));
    }
    const toDelete = existing.expenses.find((e) => e.id === req.params.eid);
    if (!toDelete) return res.status(404).json({ error: "expense not found" });
    if (toDelete.kind === "transfer") {
      return res.status(403).json({ error: "confirmed settle-ups can't be deleted" });
    }
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
    // H1/B4: never build payment requests for a group stamped on another
    // cluster — a devnet-era balance must not become a real mainnet ask.
    if (trip.cluster !== CLUSTER) {
      return res.status(409).json({ error: clusterMismatchError(trip.cluster), crossCluster: true });
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

    // Partial payment: the payer may choose to pay LESS than a full leg. We shrink
    // that one leg's amount so the Solana Pay URL + on-chain validation target the
    // partial cents. The debt is expense-derived (settlements never mutate the
    // ledger), so the remainder stays owed — a later full /settle regenerates the
    // outstanding leg. Only the payer themselves (or the owner / a keyless trip)
    // may shrink a leg; the amount is clamped to (0, owed].
    const partial = (req.body && (req.body as { partial?: unknown }).partial) as
      | { from?: string; to?: string; amountCents?: number }
      | undefined;
    let partialTag = "";
    if (partial && partial.to !== undefined) {
      const pTo = String(partial.to || "");
      const pFrom = partial.from !== undefined ? String(partial.from || "") : null;
      const amt = Number(partial.amountCents);
      const idx = plan.findIndex((e) => e.to === pTo && (pFrom == null || e.from === pFrom));
      if (idx < 0) return res.status(400).json({ error: "no matching amount to settle partially" });
      const edge = plan[idx];
      if (!Number.isInteger(amt) || amt <= 0 || amt > edge.amountCents) {
        return res.status(400).json({ error: "partial amount must be between 1 cent and the amount owed" });
      }
      const payer = trip.members.find((m) => m.id === edge.from);
      const isOwner = !!req.userId && trip.ownerUserId === req.userId;
      const isSelf = !!req.userId && !!payer && payer.userId === req.userId;
      if (trip.ownerUserId && !isOwner && !isSelf) {
        return res.status(403).json({ error: "you can only settle your own share" });
      }
      plan[idx] = { ...edge, amountCents: amt };
      partialTag = `|partial:${edge.from}->${edge.to}:${amt}`;
    }

    // Signature pins the settlement to the current set of balances (plus any
    // partial-amount override). If nothing material changed, reuse the stored
    // transfers (preserving references/urls/paid).
    const signature =
      JSON.stringify(
        [...balances].sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0))
      ) + partialTag;
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
  // H1/B4: verifying a foreign-cluster settlement would query the wrong chain
  // (rpcUrl() returns this server's RPC regardless) — refuse with a clear error.
  if (trip.cluster !== CLUSTER) {
    return res.status(409).json({ error: clusterMismatchError(trip.cluster), crossCluster: true });
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

// ---- Settled outside the app (cash / venmo / zelle) -------------------------
// Two-step handshake (settleOutside.ts): a debtor member files a PENDING claim
// against the simplified-plan leg they owe; only the creditor's CONFIRM records
// the payment — as a `kind:"transfer"` expense (paidBy debtor → participants
// [creditor]), so it flows through computeBalances everywhere, survives
// settlement cancel+rebuilds, and never counts as spending (journal/totals).

/**
 * POST /api/trips/:id/settle-outside { to, amountCents?, method, note? }
 * Debtor-only: both sides must hold CLAIMED member slots (the claimant to prove
 * who's talking, the creditor so someone can actually confirm + get the push).
 * Amount defaults to the whole leg, clamped to (0, leg] (partial semantics).
 */
app.post("/api/trips/:id/settle-outside", writeRateLimit, async (req: Request, res: Response) => {
  const trip = await getTrip(req.params.id);
  if (!trip) return res.status(404).json({ error: "not found" });
  if (!authorizeTrip(req, trip)) {
    return res.status(403).json({ error: "not authorized for this trip" });
  }
  if (!req.userId) return res.status(401).json({ error: "sign in first" });
  const me = trip.members.find((m) => m.userId === req.userId);
  if (!me) return res.status(403).json({ error: "claim your spot in this group first" });

  const body = (req.body || {}) as Record<string, unknown>;
  const toM = trip.members.find((m) => m.id === String(body.to || ""));
  if (!toM || toM.id === me.id) return res.status(400).json({ error: "pick who you paid" });
  if (!toM.userId) {
    return res.status(400).json({ error: "they need to claim their spot before they can confirm" });
  }
  const method = body.method;
  if (!isOutsideMethod(method)) {
    return res.status(400).json({ error: "method must be cash, venmo, zelle, or other" });
  }

  // What do I owe THEM right now? The same greedy plan the settle screen shows.
  const balances = computeBalances(
    trip.members.map((m) => m.id),
    trip.expenses.map((e) => ({ amountCents: e.amountCents, paidBy: e.paidBy, participants: e.participants }))
  );
  const leg = minimalSettlement(balances).find((t) => t.from === me.id && t.to === toM.id);
  if (!leg) return res.status(400).json({ error: "you don't owe them anything right now" });
  const amount = resolveOutsideAmount(leg.amountCents, body.amountCents);
  if ("error" in amount) return res.status(amount.status).json({ error: amount.error });

  let note: string | null = null;
  if (body.note != null && String(body.note).trim() !== "") {
    note = String(body.note).trim();
    if (note.length > MAX_EXPENSE_TITLE) {
      return res.status(400).json({ error: `note must be at most ${MAX_EXPENSE_TITLE} chars` });
    }
  }

  // A fresh claim supersedes any pending one on the same leg.
  for (const c of await listPendingTripClaims(trip.id)) {
    if (c.from_member_id === me.id && c.to_member_id === toM.id) {
      await transitionOutsideClaim(c.id, "cancelled", new Date().toISOString());
    }
  }

  const row = newOutsideClaim({
    context: "trip",
    tripId: trip.id,
    fromMemberId: me.id,
    toMemberId: toM.id,
    debtorUserId: req.userId,
    creditorUserId: toM.userId,
    amountCents: amount.amountCents,
    method: method as OutsideMethod,
    note,
  });
  await insertOutsideClaim(row);
  logMoney("settle.outside.claim", req, { tripId: trip.id, from: me.id, to: toM.id, amountCents: amount.amountCents, method });

  void sendPush(toM.userId, {
    title: "settled outside? 💵",
    body: `${me.name} says they paid you ${fmt(amount.amountCents)} ${methodPhrase(method)} · ${trip.name} — confirm?`,
    url: `/#/group/${trip.id}`,
    tag: `trip-outside:${row.id}`,
  });

  return res.status(201).json(serializeOutsideClaim(row, req.userId));
});

/**
 * POST /api/trips/:id/settle-outside/:claimId/(confirm|decline|cancel)
 * confirm/decline: the creditor's account only. cancel: the debtor's. Confirm
 * is idempotent + race-safe (atomic pending→confirmed transition), re-checks
 * the claim still fits the CURRENT plan leg, then records the transfer.
 */
app.post(
  "/api/trips/:id/settle-outside/:claimId/:verb(confirm|decline|cancel)",
  writeRateLimit,
  async (req: Request, res: Response) => {
    const trip = await getTrip(req.params.id);
    if (!trip) return res.status(404).json({ error: "not found" });
    if (!authorizeTrip(req, trip)) {
      return res.status(403).json({ error: "not authorized for this trip" });
    }
    if (!req.userId) return res.status(401).json({ error: "sign in first" });
    const verb = req.params.verb as ClaimVerb;

    const claim = await getOutsideClaim(req.params.claimId);
    if (!claim || claim.context !== "trip" || claim.trip_id !== trip.id) {
      return res.status(404).json({ error: "not found" });
    }

    const nowIso = new Date().toISOString();
    const decision = decideClaimAction(claim, verb, req.userId, nowIso);
    if (!decision.ok) {
      if (decision.status === 410) await transitionOutsideClaim(claim.id, "expired", nowIso);
      return res.status(decision.status).json({ error: decision.error });
    }
    if (decision.already) return res.json(await serializeTrip(trip));

    if (verb !== "confirm") {
      await transitionOutsideClaim(claim.id, decision.next, nowIso);
      if (verb === "decline") {
        void sendPush(claim.debtor_user_id, {
          title: "hmm — not confirmed",
          body: `your ${fmt(claim.amount_cents)} ${methodPhrase(claim.method)} wasn't confirmed · ${trip.name} — the ledger stays as-is`,
          url: `/#/group/${trip.id}`,
          tag: `trip-outside:${claim.id}`,
        });
      }
      return res.json(await serializeTrip(trip));
    }

    // CONFIRM — the claim must still fit inside what that member owes on the
    // CURRENT plan (expenses may have moved since it was filed).
    const balances = computeBalances(
      trip.members.map((m) => m.id),
      trip.expenses.map((e) => ({ amountCents: e.amountCents, paidBy: e.paidBy, participants: e.participants }))
    );
    const leg = minimalSettlement(balances).find(
      (t) => t.from === claim.from_member_id && t.to === claim.to_member_id
    );
    if (!leg || leg.amountCents < claim.amount_cents) {
      return res.status(409).json({
        error: "the ledger changed since this claim — ask them to claim it again",
      });
    }

    // Atomic transition is the idempotency/race lock — one winner, one transfer.
    const won = await transitionOutsideClaim(claim.id, "confirmed", nowIso);
    if (!won) {
      const latest = await getOutsideClaim(claim.id);
      if (latest && latest.status === "confirmed") return res.json(await serializeTrip(trip));
      return res.status(409).json({ error: `this claim was already ${latest?.status || "resolved"}` });
    }

    let updated: Trip;
    try {
      updated = await addExpense(trip.id, {
        title: `settled ${methodPhrase(claim.method)}`,
        amountCents: claim.amount_cents,
        paidBy: claim.from_member_id as string,
        participants: [claim.to_member_id as string],
        kind: "transfer",
      });
    } catch (err) {
      // Ledger write failed — put the claim back so the confirm can be retried.
      if (usingSupabase) {
        await supabase().from("outside_claims").update({ status: "pending", resolved_at: null }).eq("id", claim.id);
      } else {
        db.prepare("UPDATE outside_claims SET status = 'pending', resolved_at = NULL WHERE id = ?").run(claim.id);
      }
      throw err;
    }
    logMoney("settle.outside.confirm", req, { tripId: trip.id, claimId: claim.id, amountCents: claim.amount_cents, method: claim.method });

    const toName = memberName(trip, claim.to_member_id as string);
    void sendPush(claim.debtor_user_id, {
      title: "confirmed ✓",
      body: `${toName} confirmed your ${fmt(claim.amount_cents)} ${methodPhrase(claim.method)} · ${trip.name}`,
      url: `/#/group/${trip.id}`,
      tag: `trip-outside:${claim.id}`,
    });

    return res.json(await serializeTrip(updated));
  }
);

// ---- Receipts -------------------------------------------------------------
// Look up a single payment by its Solana Pay reference OR confirmed signature,
// across both settlement transfers and bill participants. Returns the receipt
// fields, or { found:false } (HTTP 200) when nothing matches.
app.get("/api/receipts/:ref", moneyRateLimit, requireAuth, async (req: Request, res: Response) => {
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

// 5s micro-cache for the OG-injected share page's trip lookup. A link that goes
// viral on X gets hammered by human taps AND every platform's link-unfurl crawler
// at once; without this, each hit is a fresh trip-by-token read (plus member +
// expense hydration). Collapsing them into one read per token per 5s takes the
// store out of the spike's hot path. Bounded to 100 entries; 5s staleness on a
// share card's total is inconsequential.
const SHARE_CACHE_TTL_MS = 5000;
const SHARE_CACHE_MAX = 100;
const shareTripCache = new Map<string, { at: number; trip: Trip | undefined }>();
async function getTripByTokenCached(token: string): Promise<Trip | undefined> {
  const now = Date.now();
  const hit = shareTripCache.get(token);
  if (hit && now - hit.at < SHARE_CACHE_TTL_MS) return hit.trip;
  const trip = await getTripByToken(token);
  shareTripCache.set(token, { at: now, trip });
  if (shareTripCache.size > SHARE_CACHE_MAX) {
    // Evict the oldest insertion (Map preserves insertion order) until bounded.
    for (const k of shareTripCache.keys()) {
      if (shareTripCache.size <= SHARE_CACHE_MAX) break;
      shareTripCache.delete(k);
    }
  }
  return trip;
}

// Shareable SPA link: the frontend reads the token from the path. Declared
// before any catch-all; it doesn't shadow /api or static assets.
app.get("/t/:token", async (req: Request, res: Response) => {
  // Invite attribution: if the link carried ?ref, drop the 30d divvy_ref cookie
  // so a signup/claim from this device credits the inviter.
  if (req.query.ref) setRefCookie(res, req.query.ref);
  const base = `${req.protocol}://${req.get("host")}`;
  // The share shell reflects the latest deploy + must re-check per visit.
  res.setHeader("Cache-Control", "no-store");
  // Server-render a trip-specific OG card into the SPA shell so the link unfurls
  // beautifully in iMessage/WhatsApp/Slack/Twitter. Falls back to the plain shell
  // if the token is unknown (the SPA renders its own not-found state).
  const trip = await getTripByTokenCached(req.params.token);
  if (!trip) {
    return res.sendFile(path.resolve(process.cwd(), "public/index.html"));
  }
  const totalCents = trip.expenses.reduce((a, e) => a + e.amountCents, 0);
  res.type("html").send(
    tripShareHtml({
      name: trip.name,
      token: trip.shareToken,
      memberCount: trip.members.length,
      totalCents,
      base,
    })
  );
});

// ---- Pay page (server-rendered) -------------------------------------------

// Tab landing: the link shared from "copy link" / "share tab" points here.
// Lists every share so whoever opens it can pick theirs and pay.
app.get("/pay/:id", async (req: Request, res: Response) => {
  const bill = await store.get(req.params.id);
  if (!bill) return res.status(404).send("Tab not found");
  // Cross-cluster tab (H1/B4): its Solana Pay URLs point at the wrong chain —
  // never render payable UI for it.
  if (bill.cluster !== CLUSTER) {
    return res.status(410).type("html").send(renderClosedPayPage(bill.title, bill.cluster));
  }
  if (req.query.ref) setRefCookie(res, req.query.ref); // invite attribution
  const base = `${req.protocol}://${req.get("host")}`;
  res.type("html").send(renderBillLanding(bill, base));
});

app.get("/pay/:id/:name", async (req: Request, res: Response) => {
  const bill = await store.get(req.params.id);
  if (!bill) return res.status(404).send("Bill not found");
  if (bill.cluster !== CLUSTER) {
    return res.status(410).type("html").send(renderClosedPayPage(bill.title, bill.cluster));
  }
  if (req.query.ref) setRefCookie(res, req.query.ref); // invite attribution
  const name = decodeURIComponent(req.params.name);
  const p = bill.participants.find((x) => x.name === name);
  if (!p) return res.status(404).send("Participant not found");

  const qr = await qrToDataUrl(p.url);
  // Who's asking: the bill creator's display name, if we know it — so the card
  // can say "alex is asking" instead of a faceless amount. Best-effort; a bill
  // created anonymously simply shows the tab title.
  let asker: string | null = null;
  if (bill.creatorUserId) {
    try {
      const creator = await getUser(bill.creatorUserId);
      asker = (creator && (creator.displayName || creator.handle)) || null;
    } catch {
      /* non-fatal — fall back to no asker name */
    }
  }
  const base = `${req.protocol}://${req.get("host")}`;
  res
    .type("html")
    .send(renderPayPage(bill, name, p.url, p.amountCents, qr, p.paid, base, asker, MOONPAY_MIN_CENTS));
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
  // Cross-cluster closed state (H1/B4): a row stamped on another cluster keeps
  // rendering (history), but the client must show it as closed — no pay CTA.
  const crossCluster = bill.cluster !== CLUSTER;
  return {
    ...bill,
    totalFmt: fmt(bill.totalCents),
    collectedFmt: fmt(collectedCents(bill)),
    outstandingFmt: fmt(outstandingCents(bill)),
    settled: outstandingCents(bill) === 0,
    crossCluster,
    ...(crossCluster ? { crossClusterNote: clusterMismatchError(bill.cluster) } : {}),
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

/**
 * Serialize a value for safe embedding inside an inline <script> element.
 * JSON.stringify does NOT escape `<`, `>`, `&`, or the JS line separators
 * U+2028/U+2029 — so a user-controlled string containing "</script>" (e.g. a
 * bill title or participant name) would otherwise close the script tag and inject
 * arbitrary HTML/JS into the pay page (stored XSS). Escaping these as \uXXXX keeps
 * the output valid JSON while making element-context breakout impossible.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Static "this tab is closed" page for a bill stamped on another cluster
 * (H1/B4). No pay UI, no QR, no JS — just an honest explanation.
 */
function renderClosedPayPage(title: string, rowCluster: string): string {
  const note = clusterMismatchError(rowCluster);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} — closed</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, system-ui, "Segoe UI", sans-serif; margin: 0;
         padding: 40px 22px; max-width: 440px; margin-inline: auto; background: #F7F1E3;
         color: #2B2118; line-height: 1.5; text-align: center; }
  .card { background: #FFFDF7; border: 2px solid #2B2118; border-radius: 20px;
          padding: 26px 22px; box-shadow: 6px 6px 0 #2B2118; margin-top: 40px; }
  h1 { font-size: 1.25rem; margin: 0 0 8px; }
  p { color: #7c7266; font-size: .95rem; margin: 8px 0 0; }
  a { display: inline-block; margin-top: 18px; color: #2775CA; font-weight: 700; text-decoration: none; }
</style></head><body>
  <div class="card">
    <h1>${esc(title)}</h1>
    <p>${esc(note)}</p>
    <p>nothing is owed here — if this split is still live, ask for a fresh link.</p>
    <a href="/">open divvy →</a>
  </div>
</body></html>`;
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
  const ogImage = `${baseUrl}${OG_CARD_PATH}`;
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
  <p class="foot" style="margin-top:14px; font-size:.72rem;">
    <a href="/terms" style="color:rgba(244,247,250,.45); text-decoration:none;">terms</a>
    <span style="color:rgba(244,247,250,.25);"> · </span>
    <a href="/privacy" style="color:rgba(244,247,250,.45); text-decoration:none;">privacy</a>
    <span style="color:rgba(244,247,250,.25);"> · </span>
    <a href="/support" style="color:rgba(244,247,250,.45); text-decoration:none;">support</a>
  </p>
</body></html>`;
}

function renderPayPage(
  bill: Bill,
  name: string,
  url: string,
  amountCents: number,
  qrDataUrl: string,
  paid: boolean,
  baseUrl = "",
  asker: string | null = null,
  moonpayMinCents = 2000
): string {
  // Rich link preview: "<name>, you owe <amount> 🧾" so the shared pay link
  // unfurls with the ask front-and-center. ogMeta escapes every value.
  const shareMeta = ogMeta({
    title: paid
      ? `${name} paid ${fmt(amountCents)} ✓`
      : `${name}, you owe ${fmt(amountCents)} 🧾`,
    description: asker
      ? `${asker} is asking — tap to pay your share of ${bill.title} on divvy`
      : `tap to pay your share of ${bill.title} on divvy`,
    imageUrl: `${baseUrl}${OG_CARD_PATH}`,
    url: `${baseUrl}/pay/${encodeURIComponent(bill.id)}/${encodeURIComponent(name)}`,
  });

  const embeddedUrl = `/embedded/?bill=${encodeURIComponent(bill.id)}&name=${encodeURIComponent(name)}`;
  const askerLine = asker
    ? `<span class="asker">${esc(asker)} is asking</span>`
    : `<span class="asker">you've got a tab</span>`;

  // Config the client JS reads. No secrets: bill id + name are already in the
  // URL, the collector + solana-pay url are public capability data.
  const payData = {
    id: bill.id,
    name,
    title: bill.title,
    share: amountCents,
    shareFmt: fmt(amountCents),
    moonpayMinCents,
    collector: bill.collector,
    cluster: bill.cluster,
    payUrl: url,
    embeddedUrl,
  };

  // The settled state is fully static — no JS, no watchers, fastest possible
  // paint for the "already paid" reload.
  const settled = `
    <div class="state settled">
      <div class="tick">✓</div>
      <h2>this one's settled ✨</h2>
      <p class="muted">${esc(name)}'s share of ${fmt(amountCents)} is paid. nothing to do.</p>
      <a class="ghost" href="/">keep divvy for next time →</a>
    </div>`;

  // Live funnel: server-renders the resting "card" state so it works with zero
  // JS (the primary button is a real link to the embedded flow); pay.js enhances
  // it into the inline fund-and-pay experience.
  const live = `
    <div class="state card" id="flow">
      <button class="primary" id="payBtn" data-href="${esc(embeddedUrl)}">pay ${fmt(amountCents)}</button>
      <noscript><a class="primary" href="${esc(embeddedUrl)}" style="display:block;text-align:center;text-decoration:none">pay ${fmt(amountCents)}</a></noscript>
      <p class="reassure muted">no app, no crypto — just your divvy balance. under a minute.</p>
    </div>
    <details class="wallet-alt">
      <summary>i already use a wallet app</summary>
      <div class="wallet-body">
        <p class="muted">scan or open this in phantom, solflare, or any solana wallet — it's already tagged to this tab.</p>
        <img class="qr" src="${qrDataUrl}" alt="pay QR" />
        <a class="ghost" href="${esc(url)}">open in wallet →</a>
      </div>
    </details>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#F7F1E3" />
${shareMeta}
<style>
  /* Journal theme — warm paper, ink, offset shadows. Critical + inlined. */
  @font-face { font-family:'Space Mono'; font-style:normal; font-weight:700;
    font-display:swap; src:url(/fonts/i7dMIFZifjKcF5UAWdDRaPpZUFWaHi6WZ3Q.woff2) format('woff2');
    unicode-range:U+0000-00FF; }
  :root { color-scheme: light; --paper:#F7F1E3; --card:#FFFDF7; --ink:#2B2118;
          --blue:#2775CA; --mint:#3DE8C7; --coral:#FF6B5E; --sun:#FFC65C; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html,body { margin:0; }
  body { font-family:-apple-system,system-ui,"Segoe UI",sans-serif; background:var(--paper);
         color:var(--ink); line-height:1.5; padding:22px 18px 48px; max-width:440px;
         margin-inline:auto; -webkit-font-smoothing:antialiased; }
  .brand { display:flex; align-items:center; gap:8px; margin:0 2px 20px; }
  .mark { width:30px; height:30px; border:2px solid var(--ink); border-radius:9px; background:var(--sun);
          display:flex; align-items:center; justify-content:center; font-weight:800; box-shadow:3px 3px 0 var(--ink); }
  .word { font-weight:800; font-size:1.15rem; letter-spacing:-.5px; }
  .hero { background:var(--card); border:2px solid var(--ink); border-radius:20px; padding:24px 22px 26px;
          box-shadow:6px 6px 0 var(--ink); }
  .asker { display:inline-block; font-weight:700; font-size:.95rem; background:var(--mint);
           border:2px solid var(--ink); border-radius:999px; padding:4px 12px; box-shadow:2px 2px 0 var(--ink); }
  h1 { font-size:1.35rem; margin:14px 0 2px; letter-spacing:-.4px; }
  .muted { color:#7c7266; font-size:.9rem; }
  .amount { font-family:'Space Mono',ui-monospace,monospace; font-weight:700; font-size:3.5rem;
            letter-spacing:-2px; margin:14px 0 6px; line-height:1; }
  .state { margin-top:18px; }
  button.primary, a.primary { display:block; width:100%; border:2px solid var(--ink); cursor:pointer;
            background:var(--blue); color:#fff; font-weight:800; font-size:1.15rem; padding:17px;
            border-radius:15px; box-shadow:5px 5px 0 var(--ink); font-family:inherit; letter-spacing:-.2px;
            transition:transform .06s ease, box-shadow .06s ease; }
  button.primary:active, a.primary:active { transform:translate(3px,3px); box-shadow:2px 2px 0 var(--ink); }
  button.primary[disabled] { opacity:.55; }
  .reassure { text-align:center; margin:12px 4px 0; }
  a.ghost { display:inline-block; margin-top:12px; color:var(--blue); font-weight:700; text-decoration:none; }
  .fund-note { background:var(--sun); border:2px solid var(--ink); border-radius:13px; padding:11px 13px;
               margin:14px 0; font-size:.86rem; font-weight:600; box-shadow:3px 3px 0 var(--ink); }
  .spin { width:34px; height:34px; border:4px solid #e5dcc9; border-top-color:var(--blue); border-radius:50%;
          animation:sp 1s linear infinite; margin:20px auto 12px; }
  @keyframes sp { to { transform:rotate(360deg); } }
  .center { text-align:center; }
  .settled .tick, .success .tick { width:56px; height:56px; margin:6px auto 10px; border:2px solid var(--ink);
          border-radius:50%; background:var(--mint); display:flex; align-items:center; justify-content:center;
          font-size:1.8rem; font-weight:800; box-shadow:3px 3px 0 var(--ink); }
  h2 { font-size:1.25rem; margin:6px 0; text-align:center; }
  .settled, .success { text-align:center; }
  details.wallet-alt { margin-top:22px; border-top:2px dashed #d8cdb6; padding-top:14px; }
  details.wallet-alt summary { list-style:none; cursor:pointer; color:#7c7266; font-size:.85rem; font-weight:700; text-align:center; }
  details.wallet-alt summary::-webkit-details-marker { display:none; }
  .wallet-body { text-align:center; margin-top:14px; }
  img.qr { width:220px; height:220px; image-rendering:pixelated; border:2px solid var(--ink);
           border-radius:12px; background:#fff; padding:6px; }
  .err { background:#ffe9e6; border:2px solid var(--ink); border-radius:13px; padding:13px; margin:14px 0;
         font-size:.9rem; box-shadow:3px 3px 0 var(--ink); }
  .retry { margin-top:10px; background:var(--coral); }
  .foot { text-align:center; margin-top:22px; }
  .confetti { position:fixed; top:-12px; width:9px; height:14px; z-index:9; pointer-events:none; border-radius:2px;
              animation:fall linear forwards; }
  @keyframes fall { to { transform:translateY(105vh) rotate(540deg); opacity:.9; } }
</style>
</head>
<body>
  <div class="brand"><span class="mark">/</span><span class="word">divvy</span></div>
  <div class="hero">
    ${askerLine}
    <h1>${esc(bill.title)}</h1>
    <div class="muted">${esc(name)}'s share</div>
    <div class="amount">${fmt(amountCents)}</div>
    ${paid ? settled : live}
  </div>
  <p class="foot muted">settles instantly in dollars. friends split, divvy handles the rest.</p>
  ${paid ? "" : `<script>window.__PAY__=${jsonForScript(payData)};</script>
  <script defer src="/pay.js"></script>`}
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
  // Never leak internal exception text (SQL/file paths/stack detail) to clients on
  // an unexpected 500 — the real message + stack are logged server-side above. 4xx
  // (validation feedback) and the controlled 502 "RPC unavailable" message are
  // intentional and safe to return.
  const clientMessage = status === 500 ? "something went wrong" : message;
  res.status(status).json({ error: clientMessage });
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
  // Defense-in-depth: src/cluster.ts already validated/normalized CLUSTER at
  // import (hard-failing on garbage), but assert the invariant here too so the
  // gate is self-contained if the boot order ever changes.
  if (process.env.CLUSTER !== "mainnet-beta") {
    problems.push('CLUSTER must be exactly "mainnet-beta"');
  }
  if (!process.env.RPC_URL) problems.push("RPC_URL must be a paid mainnet endpoint (not the public default)");
  if (!process.env.SESSION_SECRET) problems.push("SESSION_SECRET must be set");
  if (!usingSupabase) problems.push("DATA_BACKEND must be supabase (SQLite is ephemeral on Railway — money data would vanish on redeploy)");
  if (COLLECTOR === "11111111111111111111111111111111") problems.push("COLLECTOR_WALLET must be set");
  // Devnet faucet remnants: require EACH var individually absent. The old
  // fundingConfigured() check only tripped when the PAIR was present, so a
  // lone leftover secret or test mint sailed through.
  if (process.env.MINT_AUTHORITY_SECRET) {
    problems.push("MINT_AUTHORITY_SECRET (devnet faucet authority) must be removed on mainnet");
  }
  if (process.env.TEST_USDC_MINT) {
    problems.push("TEST_USDC_MINT (devnet test mint override) must be removed on mainnet");
  }
  if (process.env.CONSUMED_SIG_FAIL_OPEN === "1") problems.push("CONSUMED_SIG_FAIL_OPEN must not be enabled on mainnet");
  // Sign-up/sign-in is Privy-backed — without BOTH server-side vars, new users
  // simply cannot be created on mainnet (dead signup). Hard fail.
  if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) {
    problems.push("PRIVY_APP_ID and PRIVY_APP_SECRET must both be set — without them sign-up is dead");
  }
  // MoonPay key hygiene (B2): a pk_test_ key on mainnet opens the SANDBOX
  // widget — users think they added money and nothing arrives. A live key
  // without the secret can't produce the signed URLs MoonPay requires in prod.
  const mp = process.env.MOONPAY_API_KEY;
  if (mp && !/PLACEHOLDER/i.test(mp) && !mp.startsWith("pk_live_")) {
    problems.push("MOONPAY_API_KEY is a test key (pk_test_) — use a pk_live_ key on mainnet, or unset it to keep rails dark");
  }
  if (mp && !process.env.MOONPAY_SECRET_KEY) {
    problems.push("MOONPAY_SECRET_KEY is required when MOONPAY_API_KEY is set (MoonPay requires signed URLs in production)");
  }
  if (process.env.RAILS_REQUIRE_LIVE === "1" && !ramsConfigured()) {
    problems.push("on/off-ramp provider keys must be configured (RAILS_REQUIRE_LIVE=1)");
  }
  // Warn-only (boot proceeds): ops niceties the launch can survive without,
  // but the operator should know they're dark.
  if (!process.env.ALERT_WEBHOOK_URL) {
    // eslint-disable-next-line no-console
    console.warn("⚠  ALERT_WEBHOOK_URL is not set — money-path anomaly alerts have nowhere to go.");
  }
  if (!process.env.ADMIN_TOKEN) {
    // eslint-disable-next-line no-console
    console.warn("⚠  ADMIN_TOKEN is not set — /api/telemetry/recent (error read-back) is disabled.");
  }
  if (problems.length) {
    throw new Error(
      "Refusing to boot on mainnet-beta — unsafe configuration:\n  - " +
        problems.join("\n  - ") +
        "\nSee docs/GO-LIVE.md and docs/PRE-MAINNET.md."
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
