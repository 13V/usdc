/**
 * appleauth.selftest.ts — regression guard for NATIVE Sign in with Apple.
 *
 * POST /api/auth/apple/verify is a session-minting surface fed by an
 * Apple-signed JWT, so the verification invariants are load-bearing:
 *
 *  - RS256 signature against Apple's JWKS (injected here — never the network)
 *  - issuer https://appleid.apple.com, audience com.divvysol.app, expiry
 *  - nonce binding: token nonce claim === sha256(rawNonce) when both present
 *  - known ("apple", sub) identity → standard divvy session token
 *  - unknown sub + Privy API available → FULLY NATIVE first run: the user is
 *    created via Privy's server API (apple_oauth + solana wallet + email) and
 *    gets a normal 200, indistinguishable from a returning user
 *  - unknown sub + Privy unavailable (no secret / API down / unresolvable
 *    conflict) → 404 { needsSetup: true } and NOTHING else in the body
 *  - creation conflicts resolve to the EXISTING Privy user (verified by apple
 *    subject) — never a duplicate, never a stranger's account
 *  - secondary-identity linking never STEALS a mapping (first mapping wins)
 *  - Privy linked-accounts parsing (identity learning) from a faked payload
 *
 * JWKS + Privy fetcher are injected via the auth.ts test seams (same pattern
 * as fx.ts's injected rates), so this runs fully offline. HTTP-level against
 * the real Express app on an ephemeral port, like handoff.selftest.ts.
 * Run via `npm test`.
 */

import * as crypto from "crypto";
import type { AddressInfo } from "net";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { app } from "./server";
import {
  __setAppleJwksForTest,
  __setPrivyAccountsFetcherForTest,
  __setPrivyApiForTest,
  extractPrivyOAuthIdentities,
  extractPrivyWallets,
  fetchPrivyLinkedAccounts,
  verifyAppleIdentityToken,
} from "./auth";
import { getIdentity, linkIdentityIfFree, upsertUserByIdentity } from "./users";

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

const APPLE_ISS = "https://appleid.apple.com";
const APPLE_AUD = "com.divvysol.app";
const KID = "apple-selftest-key";

const sha256Hex = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

async function main(): Promise<void> {
  // ---- offline Apple "JWKS": a local RSA keypair injected into auth.ts ------
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const { privateKey: rogueKey } = await generateKeyPair("RS256"); // never in the JWKS
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };
  __setAppleJwksForTest({ keys: [jwk] });

  // Mint an Apple-shaped identity token, with overridable claims for the
  // negative cases.
  async function mintAppleToken(opts: {
    sub: string;
    iss?: string;
    aud?: string;
    expiresIn?: string;
    nonce?: string;
    email?: string;
    key?: CryptoKey;
  }): Promise<string> {
    let jwt = new SignJWT({
      ...(opts.nonce !== undefined ? { nonce: opts.nonce } : {}),
      ...(opts.email !== undefined ? { email: opts.email, email_verified: true } : {}),
    })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(opts.iss ?? APPLE_ISS)
      .setAudience(opts.aud ?? APPLE_AUD)
      .setSubject(opts.sub)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? "5m");
    return jwt.sign(opts.key ?? privateKey);
  }

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  const B = `http://127.0.0.1:${port}`;
  const J = { "content-type": "application/json" };
  const verify = (body: unknown) =>
    fetch(`${B}/api/auth/apple/verify`, { method: "POST", headers: J, body: JSON.stringify(body) });

  try {
    // ---- JWKS-injected verification: the negative gauntlet ------------------
    const sub = `apple-sub-${crypto.randomUUID()}`;

    const badAud = await mintAppleToken({ sub, aud: "com.evil.other" });
    ok("verify: wrong audience is rejected (401)", (await verify({ identityToken: badAud })).status === 401);

    const badIss = await mintAppleToken({ sub, iss: "https://accounts.google.com" });
    ok("verify: wrong issuer is rejected (401)", (await verify({ identityToken: badIss })).status === 401);

    const expired = await mintAppleToken({ sub, expiresIn: "-5m" });
    ok("verify: expired token is rejected (401)", (await verify({ identityToken: expired })).status === 401);

    const badSig = await mintAppleToken({ sub, key: rogueKey }); // same kid, wrong key
    ok("verify: bad signature is rejected (401)", (await verify({ identityToken: badSig })).status === 401);

    const rawNonce = crypto.randomBytes(16).toString("hex");
    const nonceToken = await mintAppleToken({ sub, nonce: sha256Hex(rawNonce) });
    const nonceMismatch = await verify({ identityToken: nonceToken, rawNonce: "not-the-nonce" });
    ok("verify: nonce mismatch is rejected (401)", nonceMismatch.status === 401);

    const malformed = await verify({ identityToken: "" });
    const huge = await verify({ identityToken: "x".repeat(5000) });
    const missing = await verify({});
    ok(
      "verify: malformed tokens are 401 (empty/huge/missing)",
      malformed.status === 401 && huge.status === 401 && missing.status === 401
    );

    // ---- unknown sub, Privy unavailable: the needsSetup fallback -------------
    // No PRIVY_APP_SECRET and no injected API here, so the native creation path
    // is unavailable and the route must degrade to the Safari-fallback 404.
    const unknown = await verify({ identityToken: nonceToken, rawNonce });
    const unknownBody = (await unknown.json()) as Record<string, unknown>;
    ok("verify: unknown sub without Privy API is 404 (no-secret fallback)", unknown.status === 404);
    ok(
      "verify: 404 body is exactly { needsSetup: true }",
      unknownBody.needsSetup === true && Object.keys(unknownBody).length === 1
    );

    // ---- known sub: standard session ----------------------------------------
    const user = await upsertUserByIdentity("apple", sub);
    const known = await verify({ identityToken: await mintAppleToken({ sub, nonce: sha256Hex(rawNonce) }), rawNonce });
    const knownBody = (await known.json()) as { token?: string; user?: { id?: string } };
    ok(
      "verify: known sub returns 200 { token, user }",
      known.status === 200 && typeof knownBody.token === "string" && knownBody.user?.id === user.id
    );
    const me = await fetch(`${B}/api/me`, {
      headers: { ...J, authorization: `Bearer ${knownBody.token}` },
    }).then((r) => r.json());
    ok("verify: returned token authenticates as the same user", me.user && me.user.id === user.id);

    // A nonce-carrying token with NO rawNonce still verifies (old client)…
    const noRaw = await verify({ identityToken: await mintAppleToken({ sub, nonce: sha256Hex(rawNonce) }) });
    ok("verify: nonce claim without rawNonce still accepted (old clients)", noRaw.status === 200);
    // …and the pure verifier agrees on the nonce contract.
    const direct = await verifyAppleIdentityToken(
      await mintAppleToken({ sub, nonce: sha256Hex(rawNonce) }),
      rawNonce
    );
    ok("verifyAppleIdentityToken: matching nonce yields the subject", direct?.subject === sub);

    // ---- fully native FIRST RUN: server-side Privy creation ------------------
    const freshSub = `apple-first-${crypto.randomUUID()}`;
    const freshEmail = `relay-${crypto.randomUUID()}@privaterelay.appleid.com`;
    const freshDid = `did:privy:${crypto.randomUUID()}`;
    let createCalls = 0;
    let createBody: Record<string, unknown> | null = null;
    __setPrivyApiForTest(async (path, init) => {
      if (path === "/users" && init.method === "POST") {
        createCalls++;
        createBody = init.body as Record<string, unknown>;
        return {
          status: 200,
          json: {
            id: freshDid,
            linked_accounts: [
              { type: "apple_oauth", subject: freshSub, email: freshEmail },
              { type: "email", address: freshEmail },
              { type: "wallet", chain_type: "solana", address: "PregenSo1WalletAddr" },
            ],
          },
        };
      }
      return { status: 404, json: null };
    });
    const first = await verify({ identityToken: await mintAppleToken({ sub: freshSub, email: freshEmail }) });
    const firstBody = (await first.json()) as {
      token?: string;
      user?: { id?: string; primaryWallet?: string | null };
    };
    ok(
      "first run: unknown sub is created natively (200 { token, user })",
      first.status === 200 && typeof firstBody.token === "string" && !!firstBody.user?.id
    );
    ok("first run: pregenerated solana wallet is linked as primary",
      firstBody.user?.primaryWallet === "PregenSo1WalletAddr");
    const sent = (createBody || {}) as {
      linked_accounts?: Array<Record<string, unknown>>;
      wallets?: Array<Record<string, unknown>>;
    };
    ok(
      "first run: create call carries apple_oauth subject + email",
      !!sent.linked_accounts?.some(
        (a) => a.type === "apple_oauth" && a.subject === freshSub && a.email === freshEmail
      )
    );
    ok(
      "first run: create call links the email account (in-shell OTP path later)",
      !!sent.linked_accounts?.some((a) => a.type === "email" && a.address === freshEmail)
    );
    ok(
      "first run: create call pregenerates a solana wallet",
      JSON.stringify(sent.wallets) === JSON.stringify([{ chain_type: "solana" }])
    );
    ok(
      "first run: divvy identities recorded (privy primary, apple secondary)",
      (await getIdentity("privy", freshDid)) === firstBody.user?.id &&
        (await getIdentity("apple", freshSub)) === firstBody.user?.id
    );
    const second = await verify({ identityToken: await mintAppleToken({ sub: freshSub, email: freshEmail }) });
    const secondBody = (await second.json()) as { user?: { id?: string } };
    ok(
      "first run: second native verify resolves the SAME user without re-creating",
      second.status === 200 && secondBody.user?.id === firstBody.user?.id && createCalls === 1
    );

    // ---- creation conflict: resolve to the existing Privy user ---------------
    const conflictSub = `apple-conflict-${crypto.randomUUID()}`;
    const conflictEmail = `relay-${crypto.randomUUID()}@privaterelay.appleid.com`;
    const existingDid = `did:privy:${crypto.randomUUID()}`;
    const existingUser = await upsertUserByIdentity("privy", existingDid);
    __setPrivyApiForTest(async (path, init) => {
      if (path === "/users" && init.method === "POST") {
        return { status: 409, json: { error: "user already exists" } };
      }
      if (path === "/users/email/address" && init.method === "POST") {
        return {
          status: 200,
          json: {
            id: existingDid,
            linked_accounts: [
              { type: "apple_oauth", subject: conflictSub, email: conflictEmail },
              { type: "email", address: conflictEmail },
            ],
          },
        };
      }
      return { status: 404, json: null };
    });
    const conflictRes = await verify({
      identityToken: await mintAppleToken({ sub: conflictSub, email: conflictEmail }),
    });
    const conflictBody = (await conflictRes.json()) as { user?: { id?: string } };
    ok(
      "conflict: create 409 resolves to the EXISTING privy user (no duplicate)",
      conflictRes.status === 200 && conflictBody.user?.id === existingUser.id
    );
    ok(
      "conflict: apple identity learned onto the existing user",
      (await getIdentity("apple", conflictSub)) === existingUser.id
    );

    // Email lookup finds a user who does NOT own this apple subject → must NOT
    // attach; degrade to the 404 fallback instead of a stranger's account.
    const strangerSub = `apple-stranger-${crypto.randomUUID()}`;
    __setPrivyApiForTest(async (path, init) => {
      if (path === "/users" && init.method === "POST") {
        return { status: 409, json: { error: "user already exists" } };
      }
      if (path === "/users/email/address" && init.method === "POST") {
        return {
          status: 200,
          json: { id: existingDid, linked_accounts: [{ type: "email", address: conflictEmail }] },
        };
      }
      return { status: 404, json: null };
    });
    const stranger = await verify({
      identityToken: await mintAppleToken({ sub: strangerSub, email: conflictEmail }),
    });
    ok(
      "conflict: email match WITHOUT the apple subject is refused (404 fallback)",
      stranger.status === 404
    );

    // ---- Privy API down → 404 fallback (degrade, never break) ----------------
    __setPrivyApiForTest(async () => null);
    const apiDown = await verify({
      identityToken: await mintAppleToken({ sub: `apple-down-${crypto.randomUUID()}` }),
    });
    const apiDownBody = (await apiDown.json()) as Record<string, unknown>;
    ok(
      "first run: Privy API down degrades to 404 { needsSetup: true }",
      apiDown.status === 404 && apiDownBody.needsSetup === true
    );
    __setPrivyApiForTest(null);

    // ---- identity-conflict refusal (first mapping wins) ----------------------
    const userB = await upsertUserByIdentity("privy", `did:privy:${crypto.randomUUID()}`);
    const contested = `apple-contested-${crypto.randomUUID()}`;
    ok("link: free identity links", (await linkIdentityIfFree("apple", contested, user.id)) === true);
    ok("link: re-link to the same user is a no-op true", (await linkIdentityIfFree("apple", contested, user.id)) === true);
    ok(
      "link: NEVER steals — mapped identity refuses a different user",
      (await linkIdentityIfFree("apple", contested, userB.id)) === false
    );
    ok("link: original mapping intact after refusal", (await getIdentity("apple", contested)) === user.id);

    // ---- Privy linked-accounts learning (injected fetcher, no network) -------
    const appleSub = `apple-learned-${crypto.randomUUID()}`;
    const googleSub = `google-learned-${crypto.randomUUID()}`;
    const fakePayload = [
      { type: "apple_oauth", subject: appleSub, email: "who@example.com" },
      { type: "google_oauth", subject: googleSub, email: "who@gmail.com", name: "Who" },
      { type: "wallet", address: "So1anaAddre55", chain_type: "solana" },
      { type: "wallet", address: "0xEthereum", chain_type: "ethereum" },
      { type: "email", address: "who@example.com" },
      { type: "apple_oauth" }, // no subject — must be ignored
    ];
    __setPrivyAccountsFetcherForTest(async () => fakePayload);
    const accounts = await fetchPrivyLinkedAccounts("did:privy:whatever");
    ok("privy: injected fetcher supplies the payload", Array.isArray(accounts) && accounts.length === 6);
    ok(
      "privy: wallet extraction keeps solana only",
      JSON.stringify(extractPrivyWallets(accounts || [])) === JSON.stringify(["So1anaAddre55"])
    );
    const idents = extractPrivyOAuthIdentities(accounts || []);
    ok(
      "privy: oauth extraction finds apple + google subjects (and skips junk)",
      idents.length === 2 &&
        idents.some((i) => i.provider === "apple" && i.subject === appleSub) &&
        idents.some((i) => i.provider === "google" && i.subject === googleSub)
    );
    // The learning loop the privy/verify route runs: upsert onto one user…
    for (const ident of idents) await linkIdentityIfFree(ident.provider, ident.subject, userB.id);
    ok("privy: learned apple identity maps to the privy user", (await getIdentity("apple", appleSub)) === userB.id);
    ok("privy: learned google identity maps to the privy user", (await getIdentity("google", googleSub)) === userB.id);
    // …after which the native verify resolves that user directly.
    const learned = await verify({ identityToken: await mintAppleToken({ sub: appleSub }) });
    const learnedBody = (await learned.json()) as { user?: { id?: string } };
    ok(
      "privy→apple: native verify now resolves the learned account",
      learned.status === 200 && learnedBody.user?.id === userB.id
    );
    // Learning must not steal: the contested subject stays with its first user.
    __setPrivyAccountsFetcherForTest(async () => [{ type: "apple_oauth", subject: contested }]);
    const again = await fetchPrivyLinkedAccounts("did:privy:whatever");
    for (const ident of extractPrivyOAuthIdentities(again || [])) {
      await linkIdentityIfFree(ident.provider, ident.subject, userB.id);
    }
    ok("privy→apple: learning cannot steal an existing mapping", (await getIdentity("apple", contested)) === user.id);

    // ---- graceful skip when PRIVY_APP_SECRET is unset -------------------------
    __setPrivyAccountsFetcherForTest(null);
    const prevSecret = process.env.PRIVY_APP_SECRET;
    delete process.env.PRIVY_APP_SECRET;
    try {
      ok("privy: no app secret → null (skip), not a throw", (await fetchPrivyLinkedAccounts("did:x")) === null);
    } finally {
      if (prevSecret !== undefined) process.env.PRIVY_APP_SECRET = prevSecret;
    }
  } finally {
    __setAppleJwksForTest(null);
    __setPrivyAccountsFetcherForTest(null);
    __setPrivyApiForTest(null);
    server.close();
  }

  console.log(`\nappleauth selftest: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("appleauth selftest crashed:", err);
    process.exit(1);
  }
);
