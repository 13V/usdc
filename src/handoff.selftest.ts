/**
 * handoff.selftest.ts — regression guard for the native OAuth handoff endpoints.
 *
 * The iOS shell can't run Google OAuth in its WKWebView, so the system browser
 * completes sign-in and hands the session back through a single-use, short-TTL
 * code (divvy://auth?code=…). These endpoints are a session-minting surface, so
 * the single-use / TTL / auth-gating invariants are load-bearing:
 *
 *  - POST /api/auth/handoff requires a signed-in session (401 otherwise)
 *  - the mint response carries a code and nothing session-shaped
 *  - POST /api/auth/handoff/exchange redeems a code EXACTLY once for a working
 *    session token; the second use is a 401
 *  - unknown and malformed codes are 401 (indistinguishable from expired/reused)
 *  - expired codes are rejected (TTL honored — shrunk via HANDOFF_TTL_MS)
 *  - the route sits on the auth rate-limit tier (429 + JSON error shape)
 *
 * HTTP-level against the real Express app on an ephemeral port, like
 * security.selftest.ts. Run via `npm test`.
 */

import type { AddressInfo } from "net";
import { app } from "./server";
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  const B = `http://127.0.0.1:${port}`;
  const J = { "content-type": "application/json" };
  const H = (t: string) => ({ ...J, authorization: `Bearer ${t}` });

  // Burner SIWS user — same session-minting helper the security selftest uses.
  async function mintSession(): Promise<string> {
    const kp = Keypair.generate();
    const n = await fetch(`${B}/api/auth/nonce`).then((r) => r.json());
    const sig = nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey);
    const v = await fetch(`${B}/api/auth/siws/verify`, {
      method: "POST",
      headers: J,
      body: JSON.stringify({
        pubkey: kp.publicKey.toBase58(),
        signature: Buffer.from(sig).toString("base64"),
        message: n.message,
      }),
    }).then((r) => r.json());
    return v.token as string;
  }

  const mintHandoff = (token?: string) =>
    fetch(`${B}/api/auth/handoff`, { method: "POST", headers: token ? H(token) : J });
  const exchange = (code: unknown) =>
    fetch(`${B}/api/auth/handoff/exchange`, {
      method: "POST",
      headers: J,
      body: JSON.stringify({ code }),
    });

  try {
    // --- mint requires auth ---
    const unauth = await mintHandoff();
    ok("mint: requires auth (401)", unauth.status === 401);

    const session = await mintSession();
    const meBefore = await fetch(`${B}/api/me`, { headers: H(session) }).then((r) => r.json());
    const userId = meBefore.user && meBefore.user.id;
    ok("setup: burner user signed in", typeof userId === "string" && !!userId);

    // --- mint shape ---
    const mintRes = await mintHandoff(session);
    const minted = await mintRes.json();
    ok("mint: 200 with a code", mintRes.status === 200 && typeof minted.code === "string");
    ok("mint: code is 128-bit base64url (22 chars)", (minted.code || "").length === 22);
    ok("mint: response carries no session token", !("token" in minted) && !("user" in minted));

    // --- exchange consumes exactly once ---
    const ex1 = await exchange(minted.code);
    const ex1Body = await ex1.json();
    ok("exchange: first use returns 200 { token, user }",
      ex1.status === 200 && typeof ex1Body.token === "string" && !!ex1Body.user);
    ok("exchange: session is bound to the minting user", ex1Body.user && ex1Body.user.id === userId);
    const meAfter = await fetch(`${B}/api/me`, { headers: H(ex1Body.token) }).then((r) => r.json());
    ok("exchange: returned token authenticates as the same user",
      meAfter.user && meAfter.user.id === userId);

    const ex2 = await exchange(minted.code);
    ok("exchange: reuse of a consumed code is rejected (401)", ex2.status === 401);

    // --- unknown / malformed codes ---
    const unknown = await exchange("AAAAAAAAAAAAAAAAAAAAAA"); // well-formed, never minted
    ok("exchange: unknown code is 401", unknown.status === 401);
    const short = await exchange("abc");
    const long = await exchange("x".repeat(500));
    const wrongType = await exchange({ nested: true });
    const missing = await fetch(`${B}/api/auth/handoff/exchange`, {
      method: "POST",
      headers: J,
      body: JSON.stringify({}),
    });
    ok("exchange: malformed codes are 401 (short/long/non-string/missing)",
      short.status === 401 && long.status === 401 && wrongType.status === 401 && missing.status === 401);

    // --- TTL expiry (TTL read per-mint, so shrink it at runtime) ---
    process.env.HANDOFF_TTL_MS = "200";
    let expired: Response;
    try {
      const quick = await mintHandoff(session).then((r) => r.json());
      await sleep(350);
      expired = await exchange(quick.code);
    } finally {
      delete process.env.HANDOFF_TTL_MS;
    }
    ok("exchange: expired code is rejected (401)", expired.status === 401);
    const fresh = await mintHandoff(session).then((r) => r.json());
    const freshEx = await exchange(fresh.code);
    ok("exchange: fresh code still works after TTL test (default TTL restored)", freshEx.status === 200);

    // --- rate limit shape (LAST — poisons this IP's auth bucket) ---
    let limited: { status: number; body: { error?: string } } | null = null;
    for (let i = 0; i < 80 && !limited; i++) {
      const r = await exchange("AAAAAAAAAAAAAAAAAAAAAA");
      if (r.status === 429) limited = { status: r.status, body: await r.json().catch(() => ({})) };
    }
    ok("rate limit: exchange hits the auth tier (429)", !!limited);
    ok("rate limit: 429 body has the shared error shape",
      !!limited && /too many requests/i.test(limited.body.error || ""));
  } finally {
    server.close();
  }

  console.log(`\nhandoff selftest: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("handoff selftest crashed:", err);
    process.exit(1);
  }
);
