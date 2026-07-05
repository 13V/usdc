/**
 * settleOutside.selftest.ts — "settled another way" (cash/venmo/zelle) tests.
 *
 * GUARDRAILS under test:
 *  - a debtor's claim alone NEVER changes any balance (pending = pure metadata)
 *  - only the creditor can confirm/decline; only the debtor can cancel;
 *    strangers and self-confirms are rejected; confirm is idempotent
 *  - tabs: a confirmed cash claim inserts a "cash_payment" offset (partial) or
 *    flips the covered entries (full net), mirroring on-chain settle semantics
 *  - trips: a confirmed claim records a kind='transfer' expense that clears the
 *    balances, SURVIVES settlement cancel+rebuilds, and is immutable history
 *  - journal digests never count outside settles as spending (transfers move
 *    money, they don't spend it); trip totals exclude them too
 *  - claims expire; expired/declined/cancelled claims are inert
 *
 * Pure state-machine tests + the real Express app booted in-process (the
 * security.selftest.ts pattern). SQLite backend. Run with `npm test`.
 */

import type { AddressInfo } from "net";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";

import { app } from "./server";
import { db } from "./db";
import {
  resolveOutsideAmount,
  decideClaimAction,
  isClaimExpired,
  isOutsideMethod,
  methodPhrase,
  MAX_OUTSIDE_CENTS,
} from "./settleOutside";

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

// ---- Pure: amount resolution -------------------------------------------------

{
  const isOk = (r: ReturnType<typeof resolveOutsideAmount>): r is { amountCents: number } =>
    !("error" in r);
  const d = resolveOutsideAmount(4700);
  ok("amount: omitted defaults to the whole debt", isOk(d) && d.amountCents === 4700);
  const p = resolveOutsideAmount(4700, 2000);
  ok("amount: explicit partial accepted", isOk(p) && p.amountCents === 2000);
  const bad = [0, -5, 1.5, 4701, NaN, "nope"].map((v) => resolveOutsideAmount(4700, v));
  ok("amount: 0 / negative / fraction / > net / junk all reject 400",
    bad.every((r) => !isOk(r) && r.status === 400));
  const square = resolveOutsideAmount(0);
  ok("amount: nothing owed → 400", !isOk(square) && square.status === 400);
  const huge = resolveOutsideAmount(MAX_OUTSIDE_CENTS + 5);
  ok("amount: default is capped at MAX_OUTSIDE_CENTS", isOk(huge) && huge.amountCents === MAX_OUTSIDE_CENTS);
}

// ---- Pure: methods -------------------------------------------------------------

ok("method: allowlist accepts the four methods, rejects junk",
  isOutsideMethod("cash") && isOutsideMethod("venmo") && isOutsideMethod("zelle") &&
  isOutsideMethod("other") && !isOutsideMethod("paypal") && !isOutsideMethod(1) && !isOutsideMethod(null));
ok("method: phrases read naturally", methodPhrase("cash") === "in cash 💵" && methodPhrase("venmo") === "on venmo");

// ---- Pure: claim state machine ---------------------------------------------------

{
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  const now = new Date().toISOString();
  const base = { status: "pending", expires_at: future, debtor_user_id: "deb", creditor_user_id: "cred" };

  const c1 = decideClaimAction(base, "confirm", "cred", now);
  ok("state: creditor confirm on pending → confirmed", c1.ok && !("already" in c1 && c1.already) && (c1 as any).next === "confirmed");
  const c2 = decideClaimAction(base, "decline", "cred", now);
  ok("state: creditor decline on pending → declined", c2.ok && (c2 as any).next === "declined");
  const c3 = decideClaimAction(base, "cancel", "deb", now);
  ok("state: debtor cancel on pending → cancelled", c3.ok && (c3 as any).next === "cancelled");

  ok("state: debtor can't confirm their own claim (403)",
    !decideClaimAction(base, "confirm", "deb", now).ok &&
    (decideClaimAction(base, "confirm", "deb", now) as any).status === 403);
  ok("state: creditor can't cancel (403)",
    (decideClaimAction(base, "cancel", "cred", now) as any).status === 403);
  ok("state: a stranger can do nothing (403 across all verbs)",
    (["confirm", "decline", "cancel"] as const).every(
      (v) => (decideClaimAction(base, v, "mallory", now) as any).status === 403));

  const confirmed = { ...base, status: "confirmed" };
  const again = decideClaimAction(confirmed, "confirm", "cred", now);
  ok("state: confirming twice is idempotent (already:true)", again.ok && (again as any).already === true);
  ok("state: declining a confirmed claim → 409",
    (decideClaimAction(confirmed, "decline", "cred", now) as any).status === 409);
  ok("state: cancelling a confirmed claim → 409",
    (decideClaimAction(confirmed, "cancel", "deb", now) as any).status === 409);
  ok("state: confirming a declined claim → 409",
    (decideClaimAction({ ...base, status: "declined" }, "confirm", "cred", now) as any).status === 409);

  const stale = { ...base, expires_at: past };
  ok("state: expired pending claim can't be confirmed (410)",
    (decideClaimAction(stale, "confirm", "cred", now) as any).status === 410);
  ok("state: expired pending claim CAN still be cancelled",
    decideClaimAction(stale, "cancel", "deb", now).ok === true);
  ok("expiry: pending past TTL is expired; resolved rows never are",
    isClaimExpired(stale, now) === true &&
    isClaimExpired(base, now) === false &&
    isClaimExpired({ status: "confirmed", expires_at: past }, now) === false);
}

// ---- HTTP: the full handshake against the real app --------------------------------

async function main(): Promise<void> {
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  const B = `http://127.0.0.1:${port}`;
  const H = (t: string) => ({ "content-type": "application/json", authorization: `Bearer ${t}` });
  const month = new Date().toISOString().slice(0, 7);

  async function mint(): Promise<{ token: string; pubkey: string; id: string }> {
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
    const me = await fetch(`${B}/api/me`, { headers: H(v.token) }).then((r) => r.json());
    return { token: v.token as string, pubkey: kp.publicKey.toBase58(), id: me.user.id as string };
  }
  const post = (path: string, tok: string, body?: unknown, extra?: Record<string, string>) =>
    fetch(`${B}${path}`, {
      method: "POST",
      headers: { ...H(tok), ...(extra || {}) },
      body: JSON.stringify(body || {}),
    });
  const get = (path: string, tok: string) => fetch(`${B}${path}`, { headers: H(tok) }).then((r) => r.json());

  try {
    const deb = await mint(); // debtor on the tab
    const cred = await mint(); // creditor on the tab
    const mallory = await mint(); // stranger

    // Mutual friendship (both directions = accepted).
    await post("/api/friends", deb.token, { wallet: cred.pubkey });
    await post("/api/friends", cred.token, { wallet: deb.pubkey });

    // ---- tabs: claim → confirm (partial) → confirm (rest) --------------------
    const ent = await post(`/api/tabs/${deb.id}/entries`, cred.token, {
      direction: "they_owe",
      amountCents: 4700,
      note: "concert tix",
    });
    ok("tab: setup entry created (debtor owes $47)", ent.status === 201);

    // Creditor can't file an outside claim (they're owed, not owing).
    const wrongWay = await post(`/api/tabs/${deb.id}/settle-outside`, cred.token, { method: "cash" });
    ok("tab: creditor-initiated claim rejected (400)", wrongWay.status === 400);

    // A stranger gets a 404 (no relationship, no enumeration).
    const strangerClaim = await post(`/api/tabs/${deb.id}/settle-outside`, mallory.token, { method: "cash" });
    ok("tab: stranger's claim → 404", strangerClaim.status === 404);

    // Input validation.
    ok("tab: bad method rejected (400)",
      (await post(`/api/tabs/${cred.id}/settle-outside`, deb.token, { method: "paypal" })).status === 400);
    ok("tab: amount over the net rejected (400)",
      (await post(`/api/tabs/${cred.id}/settle-outside`, deb.token, { method: "cash", amountCents: 4701 })).status === 400);
    ok("tab: zero amount rejected (400)",
      (await post(`/api/tabs/${cred.id}/settle-outside`, deb.token, { method: "cash", amountCents: 0 })).status === 400);
    ok("tab: 141-char note rejected (400)",
      (await post(`/api/tabs/${cred.id}/settle-outside`, deb.token, { method: "cash", note: "x".repeat(141) })).status === 400);

    // Debtor files a $20 partial cash claim.
    const claimRes = await post(`/api/tabs/${cred.id}/settle-outside`, deb.token, {
      method: "cash",
      amountCents: 2000,
      note: "at the bar",
    });
    const claim = await claimRes.json();
    ok("tab: debtor's partial claim accepted (201, pending)", claimRes.status === 201 && claim.status === "pending");

    // Pending claim is pure metadata — balances untouched, both sides see it.
    const tabDeb = await get(`/api/tabs/${cred.id}`, deb.token);
    ok("tab: pending claim does NOT move the balance", tabDeb.balanceCents === -4700);
    ok("tab: debtor sees the pending claim (iAmDebtor)",
      !!tabDeb.outsideClaim && tabDeb.outsideClaim.id === claim.id && tabDeb.outsideClaim.iAmDebtor === true);
    const tabCred = await get(`/api/tabs/${deb.id}`, cred.token);
    ok("tab: creditor sees the confirm card (iAmCreditor)",
      !!tabCred.outsideClaim && tabCred.outsideClaim.iAmCreditor === true);

    // Authz on confirm.
    ok("tab: stranger can't confirm (404)",
      (await post(`/api/tabs/${deb.id}/settle-outside/${claim.id}/confirm`, mallory.token)).status === 404);
    ok("tab: debtor can't confirm their own claim (403)",
      (await post(`/api/tabs/${cred.id}/settle-outside/${claim.id}/confirm`, deb.token)).status === 403);
    ok("tab: creditor can't cancel the debtor's claim (403)",
      (await post(`/api/tabs/${deb.id}/settle-outside/${claim.id}/cancel`, cred.token)).status === 403);

    // Journal digests before/after the confirm must be identical (transfers
    // move money, they don't spend it).
    const jDebBefore = await get(`/api/journal/${month}`, deb.token);
    const jCredBefore = await get(`/api/journal/${month}`, cred.token);

    const conf = await post(`/api/tabs/${deb.id}/settle-outside/${claim.id}/confirm`, cred.token);
    ok("tab: creditor confirm succeeds (200)", conf.status === 200);
    const tabAfter = await get(`/api/tabs/${cred.id}`, deb.token);
    ok("tab: confirmed $20 shrinks the $47 tab to $27", tabAfter.balanceCents === -2700);
    const cashRows = tabAfter.entries.filter((e: any) => e.cash);
    ok("tab: exactly one cash ledger row, live + marked", cashRows.length === 1 &&
      cashRows[0].payment === true && cashRows[0].status === "open" && /cash 💵/.test(cashRows[0].note || ""));
    ok("tab: confirmed claim leaves the pending slot empty", tabAfter.outsideClaim === null);

    const jDebAfter = await get(`/api/journal/${month}`, deb.token);
    const jCredAfter = await get(`/api/journal/${month}`, cred.token);
    ok("journal: debtor's spent/fronted unchanged by a cash settle",
      jDebAfter.spentCents === jDebBefore.spentCents && jDebAfter.frontedCents === jDebBefore.frontedCents,
      `${jDebBefore.spentCents}/${jDebBefore.frontedCents} → ${jDebAfter.spentCents}/${jDebAfter.frontedCents}`);
    ok("journal: creditor's spent/fronted unchanged by a cash settle",
      jCredAfter.spentCents === jCredBefore.spentCents && jCredAfter.frontedCents === jCredBefore.frontedCents);

    // Idempotent confirm: no double-credit.
    const conf2 = await post(`/api/tabs/${deb.id}/settle-outside/${claim.id}/confirm`, cred.token);
    const conf2Body = await conf2.json();
    ok("tab: double-confirm is idempotent (already:true)", conf2.status === 200 && conf2Body.already === true);
    const tabAfter2 = await get(`/api/tabs/${cred.id}`, deb.token);
    ok("tab: double-confirm did not double-credit",
      tabAfter2.balanceCents === -2700 && tabAfter2.entries.filter((e: any) => e.cash).length === 1);

    // Full-net claim (default amount) flips everything, like an on-chain settle.
    const rest = await post(`/api/tabs/${cred.id}/settle-outside`, deb.token, { method: "venmo" }).then((r) => r.json());
    ok("tab: bare claim defaults to the remainder ($27)", rest.amountCents === 2700);
    await post(`/api/tabs/${deb.id}/settle-outside/${rest.id}/confirm`, cred.token);
    const squared = await get(`/api/tabs/${cred.id}`, deb.token);
    ok("tab: full-net confirm squares the tab", squared.balanceCents === 0);
    ok("tab: full-net confirm flips every row to history",
      squared.entries.length > 0 && squared.entries.every((e: any) => e.status === "paid"));

    // Supersede: a newer claim replaces the pending one.
    await post(`/api/tabs/${deb.id}/entries`, cred.token, { direction: "they_owe", amountCents: 1000 });
    await post(`/api/tabs/${cred.id}/settle-outside`, deb.token, { method: "cash", amountCents: 600 });
    await post(`/api/tabs/${cred.id}/settle-outside`, deb.token, { method: "cash", amountCents: 800 });
    const superseded = await get(`/api/tabs/${cred.id}`, deb.token);
    ok("tab: a fresh claim supersedes the pending one",
      !!superseded.outsideClaim && superseded.outsideClaim.amountCents === 800);

    // Cancel (debtor-only), then decline.
    const cancelRes = await post(`/api/tabs/${cred.id}/settle-outside/${superseded.outsideClaim.id}/cancel`, deb.token);
    ok("tab: debtor cancels their claim (200)", cancelRes.status === 200);
    ok("tab: cancelled claim is gone", (await get(`/api/tabs/${cred.id}`, deb.token)).outsideClaim === null);

    const dec = await post(`/api/tabs/${cred.id}/settle-outside`, deb.token, { method: "zelle" }).then((r) => r.json());
    const decRes = await post(`/api/tabs/${deb.id}/settle-outside/${dec.id}/decline`, cred.token);
    const afterDecline = await get(`/api/tabs/${cred.id}`, deb.token);
    ok("tab: creditor decline removes the claim, balance untouched",
      decRes.status === 200 && afterDecline.outsideClaim === null && afterDecline.balanceCents === -1000);

    // Ledger drift: entries changed so the claim no longer fits → 409.
    const drift = await post(`/api/tabs/${cred.id}/settle-outside`, deb.token, { method: "cash", amountCents: 1000 }).then((r) => r.json());
    const credView = await get(`/api/tabs/${deb.id}`, cred.token);
    const myOpen = credView.entries.find((e: any) => e.addedByMe && e.status === "open" && !e.payment);
    await fetch(`${B}/api/tabs/entries/${myOpen.id}`, { method: "DELETE", headers: H(cred.token) });
    const driftConf = await post(`/api/tabs/${deb.id}/settle-outside/${drift.id}/confirm`, cred.token);
    ok("tab: confirm after the ledger shrank below the claim → 409", driftConf.status === 409);

    // Expiry (lazy): force the pending claim past its TTL, then confirm → 410.
    db.prepare("UPDATE outside_claims SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), drift.id);
    const expiredConf = await post(`/api/tabs/${deb.id}/settle-outside/${drift.id}/confirm`, cred.token);
    ok("tab: expired claim can't be confirmed (410)", expiredConf.status === 410);

    // ---- trips: claim → confirm records a transfer that clears balances ------
    const owner = await mint();
    let trip = await post("/api/trips", owner.token, {
      name: "Cash Trip",
      members: [{ name: "Owner" }, { name: "Dee" }, { name: "Ghost" }],
    }).then((r) => r.json());
    const tid = trip.id as string;
    const share = trip.shareToken as string;
    const midOf = (nm: string) => trip.members.find((m: any) => m.name === nm).id as string;
    const ownerMid = midOf("Owner");
    const deeMid = midOf("Dee");
    const ghostMid = midOf("Ghost");

    // mallory (fresh account here) claims the Dee slot via the share link.
    await post(`/api/trips/${tid}/members/${deeMid}/claim`, mallory.token, {}, { "x-trip-token": share });
    trip = await post(`/api/trips/${tid}/expenses`, owner.token, {
      title: "dinner",
      total: 100,
      paidBy: ownerMid,
      participants: [ownerMid, deeMid],
    }).then((r) => r.json());
    ok("trip: setup — Dee owes $50", trip.balances.find((b: any) => b.memberId === deeMid).cents === -5000);

    // Authz on claim creation.
    ok("trip: outsider without token/membership can't file a claim (403)",
      (await post(`/api/trips/${tid}/settle-outside`, deb.token, { to: ownerMid, method: "cash" })).status === 403);
    ok("trip: claiming toward an UNCLAIMED member is rejected (400)",
      (await post(`/api/trips/${tid}/settle-outside`, mallory.token, { to: ghostMid, method: "cash" })).status === 400);
    ok("trip: a creditor claiming the wrong direction is rejected (400)",
      (await post(`/api/trips/${tid}/settle-outside`, owner.token, { to: deeMid, method: "cash" })).status === 400);

    // Build an on-chain settlement FIRST — the confirmed cash record must
    // survive the settlement being superseded (cancel+rebuild).
    const preSettle = await post(`/api/trips/${tid}/settle`, owner.token).then((r) => r.json());
    ok("trip: on-chain settlement plan exists before the cash claim",
      preSettle.settle && preSettle.settle.transfers.length === 1);

    const tClaim = await post(`/api/trips/${tid}/settle-outside`, mallory.token, { to: ownerMid, method: "cash" })
      .then((r) => r.json());
    ok("trip: debtor's claim defaults to the whole leg ($50)", tClaim.amountCents === 5000 && tClaim.status === "pending");
    const tripPending = await get(`/api/trips/${tid}`, owner.token);
    ok("trip: pending claim listed on the trip, balances untouched",
      tripPending.settleOutside.length === 1 &&
      tripPending.balances.find((b: any) => b.memberId === deeMid).cents === -5000);

    ok("trip: debtor can't confirm their own claim (403)",
      (await post(`/api/trips/${tid}/settle-outside/${tClaim.id}/confirm`, mallory.token)).status === 403);
    // A share-link holder is trip-authorized but still not the creditor.
    ok("trip: share-token holder who isn't the creditor can't confirm (403)",
      (await post(`/api/trips/${tid}/settle-outside/${tClaim.id}/confirm`, deb.token, {}, { "x-trip-token": share })).status === 403);

    const jOwnerBefore = await get(`/api/journal/${month}`, owner.token);
    const jDeeBefore = await get(`/api/journal/${month}`, mallory.token);
    const confirmed = await post(`/api/trips/${tid}/settle-outside/${tClaim.id}/confirm`, owner.token);
    const confirmedTrip = await confirmed.json();
    ok("trip: creditor confirm succeeds (200)", confirmed.status === 200);
    ok("trip: confirmed transfer clears the balances",
      confirmedTrip.balances.every((b: any) => b.cents === 0));
    const transferRow = confirmedTrip.expenses.find((e: any) => e.kind === "transfer");
    ok("trip: the transfer is recorded distinctly (kind='transfer')",
      !!transferRow && transferRow.amountCents === 5000 && /cash 💵/.test(transferRow.title));
    ok("trip: group total still counts spending only ($100)", confirmedTrip.totalCents === 10000);

    const jOwnerAfter = await get(`/api/journal/${month}`, owner.token);
    const jDeeAfter = await get(`/api/journal/${month}`, mallory.token);
    ok("journal: trip cash settle never counts as spending (both sides)",
      jOwnerAfter.spentCents === jOwnerBefore.spentCents && jOwnerAfter.frontedCents === jOwnerBefore.frontedCents &&
      jDeeAfter.spentCents === jDeeBefore.spentCents && jDeeAfter.frontedCents === jDeeBefore.frontedCents);

    // Idempotent trip confirm.
    const confirm2 = await post(`/api/trips/${tid}/settle-outside/${tClaim.id}/confirm`, owner.token);
    const confirm2Trip = await confirm2.json();
    ok("trip: double-confirm is idempotent (still one transfer, balances 0)",
      confirm2.status === 200 &&
      confirm2Trip.expenses.filter((e: any) => e.kind === "transfer").length === 1 &&
      confirm2Trip.balances.every((b: any) => b.cents === 0));

    // The settlement rebuild after the balances changed shows NO stale debt —
    // the cash record fed the balance computation and survived the rebuild.
    const rebuilt = await post(`/api/trips/${tid}/settle`, owner.token).then((r) => r.json());
    ok("trip: settlement rebuild after cash settle plans zero transfers",
      rebuilt.settle && rebuilt.settle.transfers.length === 0);

    // New spending on top: only the NEW debt shows (the $50 stays settled).
    const trip2 = await post(`/api/trips/${tid}/expenses`, owner.token, {
      title: "gas",
      total: 30,
      paidBy: ownerMid,
      participants: [ownerMid, deeMid],
    }).then((r) => r.json());
    ok("trip: cash record survives new expenses (Dee owes only the new $15)",
      trip2.balances.find((b: any) => b.memberId === deeMid).cents === -1500);

    // Transfer rows are immutable history.
    ok("trip: transfer can't be edited (403)",
      (await fetch(`${B}/api/trips/${tid}/expenses/${transferRow.id}`, {
        method: "PATCH", headers: H(owner.token), body: JSON.stringify({ amountCents: 1 }),
      })).status === 403);
    ok("trip: transfer can't be deleted (403)",
      (await fetch(`${B}/api/trips/${tid}/expenses/${transferRow.id}`, {
        method: "DELETE", headers: H(owner.token),
      })).status === 403);

    // Partial trip claim: $5 of the $15.
    const part = await post(`/api/trips/${tid}/settle-outside`, mallory.token, {
      to: ownerMid, method: "venmo", amountCents: 500,
    }).then((r) => r.json());
    const partTrip = await post(`/api/trips/${tid}/settle-outside/${part.id}/confirm`, owner.token).then((r) => r.json());
    ok("trip: partial cash settle leaves the remainder owed",
      partTrip.balances.find((b: any) => b.memberId === deeMid).cents === -1000);

    // Activity feed shows the settle as a payment, not an expense.
    const feed = await get("/api/activity", owner.token);
    ok("activity: cash settle reads as a payment event",
      Array.isArray(feed) && feed.some((e: any) => e.type === "paid" && /outside the app/.test(e.text || "")));
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
  if (failed > 0) process.exit(1);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("settleOutside.selftest crashed:", e);
    process.exit(1);
  }
);
