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
import * as nodeCrypto from "crypto";
import { signApnsJwt, buildApnsBody } from "./pushNative";

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

    // --- saved groups are owner-scoped (no cross-tenant read/delete) ---
    const g = await fetch(`${B}/api/groups`, {
      method: "POST", headers: H(owner),
      body: JSON.stringify({ name: "Roomies", members: ["Alex", "Sam"] }),
    }).then((r) => r.json());
    const attackerSees = await fetch(`${B}/api/groups`, { headers: H(attacker) }).then((r) => r.json());
    ok("groups: another user can't list your groups", Array.isArray(attackerSees) && !attackerSees.some((x: { id: string }) => x.id === g.id));
    const gDelAtk = await fetch(`${B}/api/groups/${g.id}`, { method: "DELETE", headers: H(attacker) });
    ok("groups: another user can't delete your group (404)", gDelAtk.status === 404);
    const ownerSees = await fetch(`${B}/api/groups`, { headers: H(owner) }).then((r) => r.json());
    ok("groups: owner sees their own group", Array.isArray(ownerSees) && ownerSees.some((x: { id: string }) => x.id === g.id));

    // --- nudge: relationship-gated delivery (no account enumeration / spam) ---
    const ownerMe = await fetch(`${B}/api/me`, { headers: H(owner) }).then((r) => r.json());
    const ownerId = ownerMe.user && ownerMe.user.id;
    const stranger = await mint();
    const nUnrelated = await fetch(`${B}/api/nudge`, {
      method: "POST", headers: H(stranger),
      body: JSON.stringify({ userId: ownerId, name: "target" }),
    }).then((r) => r.json());
    ok("nudge: unrelated target is NOT delivered (sent:false)", nUnrelated.ok === true && nUnrelated.sent === false);
    // attacker claimed Bob's slot in owner's trip above -> they share a trip.
    const nRelated = await fetch(`${B}/api/nudge`, {
      method: "POST", headers: H(attacker),
      body: JSON.stringify({ userId: ownerId, name: "target" }),
    }).then((r) => r.json());
    ok("nudge: trip co-participant IS delivered (sent:true)", nRelated.ok === true && nRelated.sent === true);

    // --- bill input caps + server-pinned cluster ---
    const capCount = await fetch(`${B}/api/bills`, {
      method: "POST", headers: H(owner),
      body: JSON.stringify({ total: 10, count: 5000 }),
    });
    ok("bill: participant count capped (400)", capCount.status === 400);
    const capTitle = await fetch(`${B}/api/bills`, {
      method: "POST", headers: H(owner),
      body: JSON.stringify({ total: 10, count: 2, title: "x".repeat(500) }),
    });
    ok("bill: title length capped (400)", capTitle.status === 400);
    const clBill = await fetch(`${B}/api/bills`, {
      method: "POST", headers: H(owner),
      body: JSON.stringify({ total: 10, count: 2, cluster: "mainnet-beta" }),
    }).then((r) => r.json());
    ok("bill: client-supplied cluster ignored (server-pinned)", clBill.cluster !== "mainnet-beta");

    // --- session revocation: a deleted account's token stops resolving ---
    const doomed = await mint();
    const preDel = await fetch(`${B}/api/me`, { headers: H(doomed) }).then((r) => r.json());
    ok("delete: session resolves before deletion", !!(preDel.user && preDel.user.id));
    const del = await fetch(`${B}/api/me`, { method: "DELETE", headers: H(doomed) });
    const postDel = await fetch(`${B}/api/me`, { headers: H(doomed) }).then((r) => r.json());
    ok("delete: session token dies with the account", del.status === 200 && postDel.user === null);

    // --- rate limiting: burst 429 + trust-proxy first-hop bucketing ---
    // POST /api/trips is spam-tier limited (10/min per IP). We drive it directly
    // with an X-Forwarded-For header: app.set("trust proxy", 1) makes req.ip the
    // FIRST XFF hop, so distinct forwarded IPs get distinct buckets. Bodies are
    // intentionally invalid — the limiter runs BEFORE the handler, so a 400 still
    // counts toward the window and we avoid creating junk trips.
    const hitTrips = (ip: string) =>
      fetch(`${B}/api/trips`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({}),
      }).then((r) => r.status);

    let saw429 = false;
    for (let i = 0; i < 13; i++) {
      const s = await hitTrips("203.0.113.7"); // > spam cap (10) → must 429
      if (s === 429) saw429 = true;
    }
    ok("ratelimit: spam-tier endpoint 429s after a burst", saw429);

    // A DIFFERENT forwarded IP must get its OWN fresh bucket — proving req.ip is
    // the first X-Forwarded-For hop (trust proxy = 1), not the shared socket IP.
    // If XFF were ignored, every request above would share one bucket and this
    // would already be 429.
    const freshStatus = await hitTrips("198.51.100.42");
    ok("ratelimit: trust-proxy honors first X-Forwarded-For hop (distinct IP → fresh bucket)", freshStatus !== 429);

    // ---- APNs provider JWT + payload construction (pushNative, no network) ----
    // Sign with a throwaway EC P-256 key, then decode the JWT and cryptographically
    // verify the ES256 signature — this exercises the exact code path the live
    // sender uses to authenticate to api.push.apple.com.
    {
      const b64urlToBuf = (s: string): Buffer =>
        Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
      const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
      const iat = 1_700_000_000;
      const jwt = signApnsJwt({ keyId: "ABC1234DEF", teamId: "TEAM123456", key: privateKey, iat });
      const parts = jwt.split(".");
      ok("apns.jwt: has three dot-separated segments", parts.length === 3);

      const header = JSON.parse(b64urlToBuf(parts[0]).toString("utf8"));
      const payload = JSON.parse(b64urlToBuf(parts[1]).toString("utf8"));
      ok("apns.jwt: header alg=ES256", header.alg === "ES256", JSON.stringify(header));
      ok("apns.jwt: header carries the key id (kid)", header.kid === "ABC1234DEF");
      ok("apns.jwt: payload iss=team id", payload.iss === "TEAM123456");
      ok("apns.jwt: payload iat matches", payload.iat === iat);

      // JOSE ES256 signatures are raw r||s = 64 bytes (NOT DER).
      const sig = b64urlToBuf(parts[2]);
      ok("apns.jwt: signature is 64-byte IEEE-P1363", sig.length === 64, `len=${sig.length}`);
      const verified = nodeCrypto.verify(
        "sha256",
        Buffer.from(`${parts[0]}.${parts[1]}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        sig
      );
      ok("apns.jwt: signature verifies against the public key", verified);

      // Payload shape the aps sender emits.
      const body = JSON.parse(buildApnsBody({ title: "maya paid you", body: "$23 💸", tag: "nudge:1", url: "/#/activity" }));
      ok("apns.payload: aps.alert.title/body set", body.aps.alert.title === "maya paid you" && body.aps.alert.body === "$23 💸");
      ok("apns.payload: aps.sound=default", body.aps.sound === "default");
      ok("apns.payload: tag → aps.thread-id", body.aps["thread-id"] === "nudge:1");
      ok("apns.payload: url carried at top level", body.url === "/#/activity");
      const bodyNoTag = JSON.parse(buildApnsBody({ title: "t", body: "b" }));
      ok("apns.payload: url defaults to / and no thread-id without a tag",
        bodyNoTag.url === "/" && bodyNoTag.aps["thread-id"] === undefined);
    }

    // ---- HTTP security headers (headers.ts) ----------------------------------
    {
      const landing = await fetch(`${B}/`);
      ok("headers: X-Content-Type-Options nosniff", landing.headers.get("x-content-type-options") === "nosniff");
      ok("headers: X-Frame-Options DENY (clickjacking)", landing.headers.get("x-frame-options") === "DENY");
      ok("headers: Referrer-Policy strict-origin-when-cross-origin",
        (landing.headers.get("referrer-policy") || "").includes("strict-origin-when-cross-origin"));
      const pp = landing.headers.get("permissions-policy") || "";
      ok("headers: Permissions-Policy denies geolocation + microphone",
        pp.includes("geolocation=()") && pp.includes("microphone=()"));
      const csp = landing.headers.get("content-security-policy") || "";
      ok("headers: CSP enforced (default-src 'self' + connect-src 'self' + object-src 'none')",
        csp.includes("default-src 'self'") && csp.includes("connect-src 'self'") && csp.includes("object-src 'none'"),
        csp);
      // The /embedded surface keeps the baseline headers but is intentionally
      // exempt from the first-party CSP (vendored Privy/WalletConnect stack).
      const emb = await fetch(`${B}/embedded/`);
      ok("headers: /embedded keeps baseline nosniff header", emb.headers.get("x-content-type-options") === "nosniff");
      ok("headers: /embedded omits the first-party CSP (documented Privy carve-out)",
        !emb.headers.get("content-security-policy"));
    }

    // ---- pay page: user-controlled title can't break out of inline <script> (XSS) ----
    {
      const xssTitle = "</script><img src=x onerror=alert(1)>";
      const xssBill = await fetch(`${B}/api/bills`, {
        method: "POST", headers: H(owner),
        body: JSON.stringify({ total: 20, count: 2, title: xssTitle }),
      }).then((r) => r.json());
      const pname = xssBill.participants[0].name as string;
      const payHtml = await fetch(`${B}/pay/${xssBill.id}/${encodeURIComponent(pname)}`).then((r) => r.text());
      ok("payXSS: raw </script> breakout payload never appears in the served page",
        !payHtml.includes("</script><img"));
      ok("payXSS: breakout chars are unicode-escaped inside the data <script>",
        payHtml.includes("\\u003c/script"));
    }

    // ---- trip authz: read/patch by raw id requires token or membership ----
    {
      const solo = await fetch(`${B}/api/trips`, {
        method: "POST", headers: H(owner),
        body: JSON.stringify({ name: "Private", members: [{ name: "Me" }] }),
      }).then((r) => r.json());
      const outsider = await mint();
      const foreignRead = await fetch(`${B}/api/trips/${solo.id}`, { headers: H(outsider) });
      ok("tripAuthz: outsider can't GET a trip by raw id without token/membership (403)", foreignRead.status === 403);
      const tokenRead = await fetch(`${B}/api/trips/${solo.shareToken}`);
      ok("tripAuthz: share-token path grants read (shareable-by-link, by design)", tokenRead.status === 200);
      const foreignPatch = await fetch(`${B}/api/trips/${solo.id}`, {
        method: "PATCH", headers: H(outsider), body: JSON.stringify({ name: "hijacked" }),
      });
      ok("tripAuthz: outsider can't PATCH an owned trip (403)", foreignPatch.status === 403);
    }

    // ---- telemetry: the recent-events admin view is gated ----
    {
      const telUnauth = await fetch(`${B}/api/telemetry/recent`);
      ok("telemetry: /recent admin view 404s without ADMIN_TOKEN", telUnauth.status === 404);
      const telWrong = await fetch(`${B}/api/telemetry/recent`, { headers: { authorization: "Bearer wrong-admin" } });
      ok("telemetry: /recent admin view 404s with a wrong admin token", telWrong.status === 404);
    }
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
