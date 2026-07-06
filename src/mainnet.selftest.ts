/**
 * mainnet.selftest.ts — offline regression tests for the mainnet-flip guards.
 * No network, no RPC; HTTP tests run the real Express app in-process against a
 * SCRATCH SQLite file (the dev database is never touched). Run with `npm test`.
 *
 * GUARDRAILS under test:
 *  - B1: CLUSTER validation — "mainnet" normalizes to "mainnet-beta" (guards
 *    engage), garbage hard-fails, devnet/unset stay devnet.
 *  - B2: cluster-aware money rails — a MoonPay pk_test_ key counts as live on
 *    devnet but NEVER on mainnet-beta; pk_live_ needs the secret key too.
 *  - M1: LEDGER_MAX_CENTS env cap — default $1M, tunable, garbage hard-fails.
 *  - M4: FX "fallback" rate source may never price NEW money rows on mainnet.
 *  - B4/H1: cross-cluster settlement guard — IOUs / tab settlements / bills /
 *    trips stamped on a different cluster refuse pay-URL rebuild + verification
 *    with a clear "closed" state instead of querying the wrong chain.
 */

import * as os from "os";
import * as path from "path";
import type { AddressInfo } from "net";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";

// Pin the shared db handle to a scratch file BEFORE loading the modules under
// test (imports would hoist above the assignment, so the app is require()d).
const SCRATCH_DB = path.join(os.tmpdir(), `divvy-mainnet-selftest-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = SCRATCH_DB;
delete process.env.CLUSTER; // the in-process app under test runs on devnet

/* eslint-disable @typescript-eslint/no-var-requires */
const { resolveCluster, clusterMismatchError } = require("./cluster") as typeof import("./cluster");
const { resolveLedgerMaxCents, DEFAULT_LEDGER_MAX_CENTS } =
  require("./limits") as typeof import("./limits");
const { ramsConfigured } = require("./onramp") as typeof import("./onramp");
const { fxSourceUsableOnCluster } = require("./fx") as typeof import("./fx");
const { app } = require("./server") as typeof import("./server");
const { db } = require("./db") as typeof import("./db");
/* eslint-enable @typescript-eslint/no-var-requires */

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// ---- B1: CLUSTER validation / normalization ---------------------------------

ok("B1: exact 'devnet' accepted", resolveCluster("devnet") === "devnet");
ok("B1: exact 'mainnet-beta' accepted", resolveCluster("mainnet-beta") === "mainnet-beta");
ok("B1: unset/empty default to devnet", resolveCluster(undefined) === "devnet" && resolveCluster("  ") === "devnet");
ok(
  "B1: 'mainnet' normalizes to 'mainnet-beta' (guards engage, not bypass)",
  resolveCluster("mainnet") === "mainnet-beta" &&
    resolveCluster("MAINNET") === "mainnet-beta" &&
    resolveCluster("Mainnet-Beta") === "mainnet-beta"
);
ok(
  "B1: garbage cluster hard-fails the boot",
  throws(() => resolveCluster("testnet")) &&
    throws(() => resolveCluster("main net")) &&
    throws(() => resolveCluster("mainnetbeta"))
);

// ---- M1: env-tunable ledger cap ----------------------------------------------

ok("M1: default cap is $1,000,000", resolveLedgerMaxCents(undefined) === DEFAULT_LEDGER_MAX_CENTS);
ok("M1: empty string keeps the default", resolveLedgerMaxCents("") === DEFAULT_LEDGER_MAX_CENTS);
ok("M1: a launch cap is honored (LEDGER_MAX_CENTS=50000 → $500)", resolveLedgerMaxCents("50000") === 50000);
ok(
  "M1: garbage cap hard-fails (never silently defaults)",
  throws(() => resolveLedgerMaxCents("abc")) &&
    throws(() => resolveLedgerMaxCents("-5")) &&
    throws(() => resolveLedgerMaxCents("1.5")) &&
    throws(() => resolveLedgerMaxCents("10")) // below $1 floor
);

// ---- B2: cluster-aware rails ---------------------------------------------------

function withRailsEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const keys = ["MOONPAY_API_KEY", "MOONPAY_SECRET_KEY", "COINBASE_ONRAMP_APP_ID"];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k] as string;
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  }
}

ok(
  "B2: no keys → rails dark on both clusters",
  withRailsEnv({}, () => !ramsConfigured("devnet") && !ramsConfigured("mainnet-beta"))
);
ok(
  "B2: pk_test_ key is live on devnet but NEVER on mainnet-beta",
  withRailsEnv({ MOONPAY_API_KEY: "pk_test_abc", MOONPAY_SECRET_KEY: "sk_test_x" }, () =>
    ramsConfigured("devnet") && !ramsConfigured("mainnet-beta"))
);
ok(
  "B2: pk_live_ key WITHOUT the secret does not count on mainnet",
  withRailsEnv({ MOONPAY_API_KEY: "pk_live_abc" }, () => !ramsConfigured("mainnet-beta"))
);
ok(
  "B2: pk_live_ key + secret is live on mainnet",
  withRailsEnv({ MOONPAY_API_KEY: "pk_live_abc", MOONPAY_SECRET_KEY: "sk_live_x" }, () =>
    ramsConfigured("mainnet-beta"))
);
ok(
  "B2: placeholder keys never count; a real Coinbase app id does",
  withRailsEnv({ MOONPAY_API_KEY: "pk_test_PLACEHOLDER" }, () => !ramsConfigured("devnet")) &&
    withRailsEnv({ COINBASE_ONRAMP_APP_ID: "real-app-id" }, () => ramsConfigured("mainnet-beta"))
);

// ---- M4: FX fallback source vs cluster ----------------------------------------

ok("M4: fallback rates are fine on devnet", fxSourceUsableOnCluster("fallback", "devnet"));
ok("M4: fallback rates are REFUSED on mainnet-beta", !fxSourceUsableOnCluster("fallback", "mainnet-beta"));
ok("M4: live rates are fine on mainnet-beta", fxSourceUsableOnCluster("open.er-api.com", "mainnet-beta"));

// ---- B4/H1: cross-cluster refusal over real HTTP (scratch sqlite) -------------

async function main(): Promise<void> {
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  const B = `http://127.0.0.1:${port}`;
  const H = (t: string) => ({ "content-type": "application/json", authorization: `Bearer ${t}` });

  // Mint a signed-in user via the real SIWS flow (links their wallet as primary).
  async function mint(): Promise<{ token: string; userId: string; wallet: string }> {
    const kp = Keypair.generate();
    const n = await fetch(`${B}/api/auth/nonce`).then((r) => r.json());
    const sig = nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey);
    const v = await fetch(`${B}/api/auth/siws/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pubkey: kp.publicKey.toBase58(),
        signature: Buffer.from(sig).toString("base64"),
        message: n.message,
      }),
    }).then((r) => r.json());
    return { token: v.token, userId: v.user.id, wallet: kp.publicKey.toBase58() };
  }

  const a = await mint();
  const b = await mint();

  // -- IOU (B4) ---------------------------------------------------------------
  const iou = await fetch(`${B}/api/ious`, {
    method: "POST",
    headers: H(a.token),
    body: JSON.stringify({ direction: "they_owe", counterpartyName: "sam", amountCents: 1234 }),
  }).then((r) => r.json());
  ok("iou: created payable on the current cluster (url built, not crossCluster)",
    !!iou.url && iou.crossCluster === false);
  const iouRow = db.prepare("SELECT cluster FROM ious WHERE id = ?").get(iou.id) as { cluster: string };
  ok("iou: row stamped with the creating cluster", iouRow.cluster === "devnet");

  db.prepare("UPDATE ious SET cluster = 'mainnet-beta' WHERE id = ?").run(iou.id);
  const iouList = (await fetch(`${B}/api/ious`, { headers: H(a.token) }).then((r) => r.json())) as any[];
  const closed = iouList.find((x) => x.id === iou.id);
  ok(
    "iou: cross-cluster row serializes CLOSED — no pay url, honest note",
    closed && closed.url === null && closed.crossCluster === true && !!closed.crossClusterNote
  );
  const iouVerify = await fetch(`${B}/api/ious/${iou.id}/settle/verify`, {
    method: "POST",
    headers: H(a.token),
  });
  ok("iou: cross-cluster verify refused with 409 (never queries the wrong chain)", iouVerify.status === 409);
  const iouVerifyBody = await iouVerify.json();
  // A devnet server refusing a mainnet-stamped row uses the generic wording;
  // the flip-day case (mainnet server, devnet row) uses the "test network" one.
  ok(
    "iou: refusal message is the shared clusterMismatchError wording",
    iouVerifyBody.error === clusterMismatchError("mainnet-beta") &&
      /closed/i.test(String(iouVerifyBody.error)) &&
      /test network/i.test(clusterMismatchError("devnet"))
  );

  // -- Tab settlement (B4) ------------------------------------------------------
  // Make a+b mutual friends directly (the friendship rows are the gate).
  const nowIso = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_user_id, created_at) VALUES (?, ?, ?)").run(a.userId, b.userId, nowIso);
  db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_user_id, created_at) VALUES (?, ?, ?)").run(b.userId, a.userId, nowIso);

  const entry = await fetch(`${B}/api/tabs/${b.userId}/entries`, {
    method: "POST",
    headers: H(a.token),
    body: JSON.stringify({ direction: "they_owe", amountCents: 500, note: "coffee" }),
  });
  ok("tab: entry added between mutual friends", entry.status === 201);

  // b owes a $5 → b requests the settlement (payer = b, payee = a).
  const settle = await fetch(`${B}/api/tabs/${a.userId}/settle`, {
    method: "POST",
    headers: H(b.token),
  }).then((r) => r.json());
  ok("tab: settlement built payable on the current cluster", !!settle.url && settle.crossCluster === false);
  const setRow = db.prepare("SELECT cluster FROM tab_settlements WHERE id = ?").get(settle.id) as { cluster: string };
  ok("tab: settlement row stamped with the creating cluster", setRow.cluster === "devnet");

  db.prepare("UPDATE tab_settlements SET cluster = 'mainnet-beta' WHERE id = ?").run(settle.id);
  const tabView = await fetch(`${B}/api/tabs/${a.userId}`, { headers: H(b.token) }).then((r) => r.json());
  ok(
    "tab: cross-cluster settlement serializes CLOSED — no pay url, honest note",
    tabView.settlement &&
      tabView.settlement.url === null &&
      tabView.settlement.crossCluster === true &&
      !!tabView.settlement.crossClusterNote
  );
  const tabVerify = await fetch(`${B}/api/tabs/${a.userId}/settle/verify`, {
    method: "POST",
    headers: H(b.token),
  });
  ok("tab: cross-cluster verify refused with 409", tabVerify.status === 409);
  const resettle = await fetch(`${B}/api/tabs/${a.userId}/settle`, {
    method: "POST",
    headers: H(b.token),
  });
  ok(
    "tab: cross-cluster open settlement is NOT superseded by a fresh real-money request (409)",
    resettle.status === 409
  );

  // NULL cluster = pre-migration devnet-era row → treated as devnet (open here).
  db.prepare("UPDATE tab_settlements SET cluster = NULL WHERE id = ?").run(settle.id);
  const nullView = await fetch(`${B}/api/tabs/${a.userId}`, { headers: H(b.token) }).then((r) => r.json());
  ok(
    "tab: NULL-cluster (pre-migration) row is devnet-era — open on a devnet server",
    nullView.settlement && !!nullView.settlement.url && nullView.settlement.crossCluster === false
  );

  // -- Bill (H1) ----------------------------------------------------------------
  const bill = await fetch(`${B}/api/bills`, {
    method: "POST",
    headers: H(a.token),
    body: JSON.stringify({ title: "sushi", total: 20, names: ["sam", "riley"] }),
  }).then((r) => r.json());
  ok("bill: created on the current cluster", bill.cluster === "devnet" && bill.crossCluster === false);

  const raw = db.prepare("SELECT data FROM bills WHERE id = ?").get(bill.id) as { data: string };
  const parsed = JSON.parse(raw.data);
  parsed.cluster = "mainnet-beta";
  db.prepare("UPDATE bills SET data = ? WHERE id = ?").run(JSON.stringify(parsed), bill.id);

  const billGet = await fetch(`${B}/api/bills/${bill.id}`).then((r) => r.json());
  ok("bill: cross-cluster bill serializes crossCluster + note", billGet.crossCluster === true && !!billGet.crossClusterNote);
  const billVerify = await fetch(`${B}/api/bills/${bill.id}/verify`, { method: "POST", headers: H(a.token) });
  ok("bill: cross-cluster verify refused with 409", billVerify.status === 409);
  const payPage = await fetch(`${B}/pay/${bill.id}`);
  ok("bill: cross-cluster pay page renders CLOSED (410), no payable UI", payPage.status === 410);
  const payPageHtml = await payPage.text();
  // (This run is the mirror case: a devnet server showing a mainnet-stamped
  // row, so the generic wording appears; flip-day shows "test network".)
  ok("bill: closed page explains the cluster provenance", /closed on this server|test network/i.test(payPageHtml));

  // -- Trip (H1) ------------------------------------------------------------------
  const trip = await fetch(`${B}/api/trips`, {
    method: "POST",
    headers: H(a.token),
    body: JSON.stringify({ name: "kyoto", members: [{ name: "ava" }, { name: "sam" }] }),
  }).then((r) => r.json());
  db.prepare("UPDATE trips SET cluster = 'mainnet-beta' WHERE id = ?").run(trip.id);
  const tripSettle = await fetch(`${B}/api/trips/${trip.id}/settle`, {
    method: "POST",
    headers: { ...H(a.token), "x-trip-token": trip.shareToken },
  });
  ok("trip: cross-cluster settle refused with 409 (no wrong-chain payment requests)", tripSettle.status === 409);
  const tripVerify = await fetch(`${B}/api/trips/${trip.id}/settle/verify`, {
    method: "POST",
    headers: { ...H(a.token), "x-trip-token": trip.shareToken },
  });
  ok("trip: cross-cluster verify refused with 409", tripVerify.status === 409);

  server.close();

  console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("mainnet.selftest crashed:", err);
  process.exit(1);
});
