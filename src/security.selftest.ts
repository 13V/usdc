/**
 * security.selftest.ts — regression guard for the money-safety invariants.
 *
 * Boots the real Express app in-process on an ephemeral port and asserts the
 * authz / dedup / cap behavior that the hardening pass established, so a future
 * change can't silently reopen a hole. Pure HTTP + a couple of unit checks; uses
 * the SQLite backend (default). Run with `npm run test:sec` (and via `npm test`).
 *
 * GUARDRAILS under test:
 *  - one on-chain signature settles at most one share (fail-closed dedup)
 *  - a share-link holder can't claim a creditor slot (payout reroute)
 *  - a share-link holder can't edit/delete an expense they didn't pay (ledger)
 *  - on/off-ramp require auth + enforce the per-transaction cap
 *  - the Privy route is inert without server-side config
 *  - the RPC proxy rejects non-allowlisted methods
 */

import type { AddressInfo } from "net";
import { app } from "./server";
import { claimSignature } from "./consumedSignatures";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";

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

async function main(): Promise<void> {
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  const B = `http://127.0.0.1:${port}`;
  const H = (t: string) => ({ "content-type": "application/json", authorization: `Bearer ${t}` });

  async function mint(): Promise<string> {
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
    return v.token as string;
  }

  try {
    // --- unit: global signature dedup (fail-closed store) ---
    const sig = "SELFTEST_" + passed + "_" + Math.floor(performance.now());
    const a = await claimSignature(sig, "bill:1:refA");
    const b = await claimSignature(sig, "bill:1:refA");
    const c = await claimSignature(sig, "bill:2:refB");
    ok("dedup: one signature settles at most one share (fresh/same/different)", a === true && b === true && c === false);

    // --- auth gating on the rails ---
    const onUnauth = await fetch(`${B}/api/me/onramp/5000`);
    ok("onramp requires auth (401)", onUnauth.status === 401);

    const owner = await mint();

    // --- rail per-transaction cap ($2,000 default) ---
    const railOk = await fetch(`${B}/api/me/onramp/200000`, { headers: H(owner) });
    const railOver = await fetch(`${B}/api/me/onramp/200100`, { headers: H(owner) });
    const railOverBody = await railOver.json().catch(() => ({}));
    ok("rail cap: $2,000 allowed", railOk.status === 200);
    ok("rail cap: $2,001 rejected", railOver.status === 400 && /per-transaction limit/.test(railOverBody.error || ""));
    const badAmt = await fetch(`${B}/api/me/onramp/0`, { headers: H(owner) });
    ok("rail: zero amount rejected (400)", badAmt.status === 400);

    // --- push: vapid config endpoint + subscribe requires auth ---
    const vapid = await fetch(`${B}/api/push/vapid`).then((r) => r.json());
    ok("push: /api/push/vapid reports enabled flag", typeof vapid.enabled === "boolean");
    const subUnauth = await fetch(`${B}/api/push/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: "https://example.com/x" }),
    });
    ok("push: subscribe requires auth (401)", subUnauth.status === 401);

    // --- Privy route inert without server-side config ---
    const privy = await fetch(`${B}/api/auth/privy/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "x", wallet: "FAKE" }),
    });
    ok("privy verify inert without PRIVY_APP_ID (501)", privy.status === 501);

    // --- RPC proxy rejects non-allowlisted methods ---
    const rpcBad = await fetch(`${B}/api/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getProgramAccounts", params: [] }),
    });
    // 403 (method not allowed) when RPC configured, or 501 when RPC_URL unset — both are safe.
    ok("rpc proxy blocks non-allowlisted method (403/501)", rpcBad.status === 403 || rpcBad.status === 501);

    // --- trip authz: creditor-claim payout reroute + expense mutation ---
    let trip = await fetch(`${B}/api/trips`, {
      method: "POST",
      headers: H(owner),
      body: JSON.stringify({ name: "Sec Trip", members: [{ name: "Owner" }, { name: "Bob" }, { name: "Alice" }] }),
    }).then((r) => r.json());
    const tid = trip.id;
    const share = trip.shareToken as string;
    const idOf = (nm: string) => trip.members.find((m: { name: string; id: string }) => m.name === nm).id;
    const aliceId = idOf("Alice");
    const bobId = idOf("Bob");
    const ownerMid = idOf("Owner");

    // Alice fronts an expense -> Alice is a creditor; expense is owner-paid below for the mutate test.
    trip = await fetch(`${B}/api/trips/${tid}/expenses`, {
      method: "POST",
      headers: { ...H(owner), "x-trip-token": share },
      body: JSON.stringify({ title: "Cabin", total: 300, paidBy: aliceId, participants: [ownerMid, bobId, aliceId] }),
    }).then((r) => r.json());
    const gasTrip = await fetch(`${B}/api/trips/${tid}/expenses`, {
      method: "POST",
      headers: { ...H(owner), "x-trip-token": share },
      body: JSON.stringify({ title: "Gas", total: 60, paidBy: ownerMid, participants: [ownerMid, bobId, aliceId] }),
    }).then((r) => r.json());
    const gasEid = gasTrip.expenses.find((e: { title: string; id: string }) => e.title === "Gas").id;

    const attacker = await mint();
    const claim = async (tok: string, mid: string) =>
      (await fetch(`${B}/api/trips/${tid}/members/${mid}/claim`, {
        method: "POST",
        headers: { ...H(tok), "x-trip-token": share },
      })).status;

    ok("trip: attacker can't claim a creditor slot (403)", (await claim(attacker, aliceId)) === 403);
    ok("trip: debtor slot stays self-claimable (200)", (await claim(attacker, bobId)) === 200);
    ok("trip: owner can claim creditor slot (200)", (await claim(owner, aliceId)) === 200);

    const delAttacker = await fetch(`${B}/api/trips/${tid}/expenses/${gasEid}`, {
      method: "DELETE",
      headers: { ...H(attacker), "x-trip-token": share },
    });
    ok("trip: attacker can't delete an expense they didn't pay (403)", delAttacker.status === 403);
    const delOwner = await fetch(`${B}/api/trips/${tid}/expenses/${gasEid}`, {
      method: "DELETE",
      headers: { ...H(owner), "x-trip-token": share },
    });
    ok("trip: owner can delete the expense (200)", delOwner.status === 200);
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
  if (failed > 0) process.exit(1);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("security.selftest crashed:", e);
    process.exit(1);
  }
);
