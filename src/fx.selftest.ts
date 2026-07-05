/**
 * fx.selftest.ts — Per-expense currency on trips: log "¥3,000 ramen" in the
 * receipt's currency, settle in USD/USDC. Run with `npm test`.
 *
 * GUARDRAILS under test (all offline — rates are INJECTED, never fetched):
 *  - conversion math: minor units are zero-decimal aware (¥3,000 is 3000 minor,
 *    €40.00 is 4000), converted to USD cents with EXACTLY one rounding.
 *  - server validation: currency whitelist, integer minor units 1..10^10,
 *    sub-cent totals rejected, client-supplied rates/fx blobs NEVER trusted.
 *  - authz: foreign-currency entry needs a signed-in group member; the
 *    collaborative USD path is unchanged.
 *  - itemized + fx: item math runs in the original currency, the USD total is
 *    converted ONCE and distributed by original-currency shares (zero-sum);
 *    fx is stamped so the merged logical expense surfaces it.
 *  - fx-absent fallback (DIVVY_FX=off): picker metadata reports disabled,
 *    foreign entry 400s, USD-only flow keeps working.
 *  - display metadata roundtrip: fx {currency, originalAmount, rate, at}
 *    persists through the DB and serializes with fxOriginalFmt/fxNote.
 */

import type { AddressInfo } from "net";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { app } from "./server";
import {
  __setRatesForTest,
  buildExpenseFx,
  fxEnabled,
  fxNoteFor,
  fxOriginal,
  fxOriginalFmt,
  getUsdRates,
  isZeroDecimal,
  majorFromMinor,
  minorPerMajor,
  usdCentsFromForeignMinor,
  MAX_FX_MINOR,
} from "./fx";
import { mergeItemizedExpenses, TripExpense } from "./trips";

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

// Deterministic rates for the WHOLE run: FOREIGN units per 1 USD.
__setRatesForTest({ JPY: 150, EUR: 0.8, KRW: 1250, GBP: 0.5 });

// ---- pure: zero-decimal minor units + one-rounding conversion ----------------

ok("minor: JPY has no minor unit (1 per major)", minorPerMajor("JPY") === 1 && isZeroDecimal("krw"));
ok("minor: EUR uses cents (100 per major)", minorPerMajor("EUR") === 100 && !isZeroDecimal("EUR"));
ok("minor: ¥3,000 is 3000 minor → major 3000", majorFromMinor(3000, "JPY") === 3000);
ok("minor: €40.00 is 4000 minor → major 40", majorFromMinor(4000, "EUR") === 40);

// ¥3,000 at 150/USD → $20.00; €40 at 0.8/USD → $50.00; ₩12,500 at 1250 → $10.
ok("convert: ¥3,000 → 2000 USD cents", usdCentsFromForeignMinor(3000, "JPY", 1 / 150) === 2000);
ok("convert: €40.00 → 5000 USD cents", usdCentsFromForeignMinor(4000, "EUR", 1 / 0.8) === 5000);
ok("convert: ₩12,500 → 1000 USD cents", usdCentsFromForeignMinor(12500, "KRW", 1 / 1250) === 1000);
// One rounding, at the end: ¥100/150 = $0.66667 → 67 cents (not 66).
ok("convert: rounds exactly once", usdCentsFromForeignMinor(100, "JPY", 1 / 150) === 67);

// ---- pure: fx blob build + normalize (new AND legacy shapes) ------------------

{
  const fx = buildExpenseFx({ currency: "jpy", originalAmount: 3000, rate: 1 / 150, asOf: "t", source: "test" });
  ok(
    "blob: buildExpenseFx normalizes + stamps `at`",
    fx.currency === "JPY" && fx.originalAmount === 3000 && !!fx.at && fx.source === "test"
  );
  const o = fxOriginal(fx);
  ok("blob: fxOriginal reads the new shape (minor→major)", !!o && o!.currency === "JPY" && o!.amountMajor === 3000);
  ok("blob: fxOriginalFmt formats the receipt currency", fxOriginalFmt(fx) === "¥3,000");
  const note = fxNoteFor(fx) || "";
  ok("blob: fxNote carries provenance", note.indexOf("Originally ¥3,000 JPY") === 0 && note.indexOf("@ $0.0067") > 0);
  // Legacy bill-style blob (sourceCurrency + MAJOR sourceAmount) still displays.
  const legacy = { sourceCurrency: "THB", sourceAmount: 2450, rate: 0.0274, asOf: "t", source: "fallback" };
  const lo = fxOriginal(legacy);
  ok("blob: legacy {sourceCurrency, sourceAmount} still reads", !!lo && lo!.currency === "THB" && lo!.amountMajor === 2450);
  ok("blob: junk fx is null, USD fx is null", fxOriginal({ currency: "USD", originalAmount: 5 }) === null && fxOriginal("x") === null);
}

// ---- pure: merged itemized rows surface the fx stamped on every row -----------

{
  const fx = { currency: "JPY", originalAmount: 5000, rate: 1 / 150, at: "t", asOf: "t", source: "test" };
  const rows: TripExpense[] = [
    { id: "e1", title: "izakaya", amountCents: 833, paidBy: "a", participants: ["a"], createdAt: "t", splitId: "S", fx,
      splitMeta: { items: [{ label: "ramen", qty: 1, cents: 1000, memberIds: ["a"] }], extrasCents: 1000 } },
    { id: "e2", title: "izakaya", amountCents: 2500, paidBy: "a", participants: ["b"], createdAt: "t", splitId: "S", fx },
  ];
  const merged = mergeItemizedExpenses(rows);
  ok(
    "merge: itemized logical expense carries the rows' fx",
    merged.length === 1 && (merged[0].fx as any).currency === "JPY" && merged[0].amountCents === 3333
  );
}

ok("env: fx enabled by default", fxEnabled() === true);

// ---- HTTP: real app in-process (conversion at entry, authz, fallback) ---------

async function main(): Promise<void> {
  // Injected rates short-circuit getUsdRates — nothing below touches the network.
  const rates = await getUsdRates();
  ok("rates: injected test rates used (no network)", rates.source === "test" && rates.rates.JPY === 150);

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
    const owner = await mint();
    const trip = await fetch(`${B}/api/trips`, {
      method: "POST",
      headers: H(owner),
      body: JSON.stringify({ name: "Tokyo Trip", members: [{ name: "Owner" }, { name: "Bob" }, { name: "Cay" }] }),
    }).then((r) => r.json());
    const tid = trip.id as string;
    const share = trip.shareToken as string;
    const idOf = (nm: string) => trip.members.find((m: { name: string; id: string }) => m.name === nm).id as string;
    const ownerMid = idOf("Owner");
    const bobId = idOf("Bob");

    // picker metadata: whitelist + symbols, no network needed.
    const cur = await fetch(`${B}/api/fx/currencies`).then((r) => r.json());
    ok(
      "http: /api/fx/currencies lists the whitelist with symbols",
      cur.enabled === true &&
        cur.currencies.includes("JPY") &&
        cur.symbols.JPY === "¥" &&
        cur.zeroDecimal.includes("KRW") &&
        !cur.zeroDecimal.includes("EUR")
    );

    // authz: anonymous share-link holder can add USD, but NOT foreign currency.
    const anonUsd = await fetch(`${B}/api/trips/${tid}/expenses`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-trip-token": share },
      body: JSON.stringify({ title: "gas", amountCents: 900, paidBy: ownerMid }),
    });
    ok("http: collaborative USD path unchanged (anonymous 200)", anonUsd.status === 200);
    const anonFx = await fetch(`${B}/api/trips/${tid}/expenses`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-trip-token": share },
      body: JSON.stringify({ title: "ramen", currency: "JPY", originalAmount: 3000, paidBy: ownerMid }),
    });
    ok("http: anonymous foreign-currency entry rejected (401)", anonFx.status === 401);
    const stranger = await mint();
    const strangerFx = await fetch(`${B}/api/trips/${tid}/expenses`, {
      method: "POST",
      headers: { ...H(stranger), "x-trip-token": share },
      body: JSON.stringify({ title: "ramen", currency: "JPY", originalAmount: 3000, paidBy: ownerMid }),
    });
    ok("http: share-link stranger can't log foreign currency (403)", strangerFx.status === 403);

    // the real thing: ¥3,000 ramen — server converts AT ENTRY, ledger is USD.
    // A hostile payload also smuggles rate/fx/amountCents — all ignored.
    const res = await fetch(`${B}/api/trips/${tid}/expenses`, {
      method: "POST",
      headers: H(owner),
      body: JSON.stringify({
        title: "ramen",
        currency: "jpy",
        originalAmount: 3000,
        amountCents: 1, // ignored — server derives from its own rate
        rate: 999, // ignored
        fx: { currency: "JPY", originalAmount: 3000, rate: 999 }, // ignored
        paidBy: ownerMid,
      }),
    });
    const fresh = await res.json();
    ok("http: member logs ¥3,000 (200)", res.status === 200);
    const exp = (fresh.expenses || []).find((e: any) => e.title === "ramen");
    ok(
      "http: ledger stores the converted USD cents (¥3,000 → $20.00)",
      !!exp && exp.amountCents === 2000 && exp.amountFmt === "$20.00"
    );
    ok(
      "http: fx records {currency, originalAmount, rate, at} — server's rate, not the client's",
      !!exp &&
        exp.fx.currency === "JPY" &&
        exp.fx.originalAmount === 3000 &&
        Math.abs(exp.fx.rate - 1 / 150) < 1e-12 &&
        typeof exp.fx.at === "string" &&
        exp.fx.source === "test"
    );
    ok(
      "http: display metadata — original prominent, USD subordinate",
      !!exp && exp.fxOriginalFmt === "¥3,000" && exp.fxCurrency === "JPY" &&
        String(exp.fxNote || "").indexOf("Originally ¥3,000 JPY") === 0
    );
    ok(
      "http: balances stay pure USD (payer +2/3 of $20.00)",
      (fresh.balances || []).reduce((s: number, b: any) => s + b.cents, 0) === 0
    );

    // roundtrip: a fresh GET re-reads the fx blob from the DB intact.
    const got = await fetch(`${B}/api/trips/${tid}`, { headers: H(owner) }).then((r) => r.json());
    const gotExp = (got.expenses || []).find((e: any) => e.title === "ramen");
    ok(
      "http: fx roundtrips through storage",
      !!gotExp && gotExp.fx.currency === "JPY" && gotExp.fx.originalAmount === 3000 && gotExp.fxOriginalFmt === "¥3,000"
    );

    // validation: whitelist + integer minor units + caps + sub-cent totals.
    const post = (body: Record<string, unknown>) =>
      fetch(`${B}/api/trips/${tid}/expenses`, { method: "POST", headers: H(owner), body: JSON.stringify(body) });
    ok("http: unknown currency rejected (400)", (await post({ currency: "XXX", originalAmount: 100, paidBy: ownerMid })).status === 400);
    ok("http: zero originalAmount rejected", (await post({ currency: "JPY", originalAmount: 0, paidBy: ownerMid })).status === 400);
    ok("http: fractional originalAmount rejected", (await post({ currency: "EUR", originalAmount: 10.5, paidBy: ownerMid })).status === 400);
    ok("http: originalAmount above 10^10 rejected", (await post({ currency: "JPY", originalAmount: MAX_FX_MINOR + 1, paidBy: ownerMid })).status === 400);
    ok("http: sub-cent conversion rejected (₩1 ≈ $0.0008)", (await post({ currency: "KRW", originalAmount: 1, paidBy: ownerMid })).status === 400);
    ok(
      "http: over the USD ledger cap rejected (¥2B ≈ $13.3M)",
      (await post({ currency: "JPY", originalAmount: 2_000_000_000, paidBy: ownerMid })).status === 400
    );

    // itemized + fx: item math in yen, USD converted ONCE, shares zero-sum.
    // A FRESH trip so the balance assertions aren't polluted by the expenses above.
    const trip2 = await fetch(`${B}/api/trips`, {
      method: "POST",
      headers: H(owner),
      body: JSON.stringify({ name: "Izakaya", members: [{ name: "Owner" }, { name: "Bob" }] }),
    }).then((r) => r.json());
    const tid2 = trip2.id as string;
    const ownerMid2 = trip2.members.find((m: any) => m.name === "Owner").id as string;
    const bobId2 = trip2.members.find((m: any) => m.name === "Bob").id as string;
    const itemRes = await fetch(`${B}/api/trips/${tid2}/expenses/itemized`, {
      method: "POST",
      headers: H(owner),
      body: JSON.stringify({
        title: "izakaya night",
        currency: "JPY",
        originalAmount: 5000, // ¥5,000 receipt: ¥1,000 + ¥3,000 + ¥1,000 tip/tax
        paidBy: ownerMid2,
        items: [
          { label: "ramen", qty: 1, cents: 1000, memberIds: [ownerMid2] },
          { label: "omakase", qty: 1, cents: 3000, memberIds: [bobId2] },
        ],
      }),
    });
    const afterItem = await itemRes.json();
    ok("http: itemized foreign receipt accepted (200)", itemRes.status === 200);
    const iexp = (afterItem.expenses || []).find((e: any) => e.itemized);
    // ¥5,000 → 3333 cents; foreign shares 1250:3750 → USD 833 + 2500 = 3333.
    ok(
      "http: itemized USD shares sum EXACTLY to the once-converted total",
      !!iexp &&
        iexp.amountCents === 3333 &&
        iexp.breakdown.reduce((s: number, b: any) => s + b.cents, 0) === 3333 &&
        iexp.breakdown.find((b: any) => b.memberId === ownerMid2).cents === 833 &&
        iexp.breakdown.find((b: any) => b.memberId === bobId2).cents === 2500
    );
    ok(
      "http: itemized fx stamped + surfaced on the merged expense",
      !!iexp && iexp.fx && iexp.fx.currency === "JPY" && iexp.fx.originalAmount === 5000 && iexp.fxOriginalFmt === "¥5,000"
    );
    ok(
      "http: item lines/extras display in the receipt currency, breakdown in USD",
      !!iexp &&
        iexp.items[0].fmt === "¥1,000" &&
        iexp.extrasFmt === "¥1,000" &&
        iexp.breakdown[0].fmt.charAt(0) === "$"
    );
    ok(
      "http: balances stay zero-sum after the foreign itemized expense",
      (afterItem.balances || []).reduce((s: number, b: any) => s + b.cents, 0) === 0 &&
        (afterItem.balances || []).find((b: any) => b.memberId === bobId2).cents === -2500
    );

    // fx-absent fallback: DIVVY_FX=off → picker reports disabled, foreign entry
    // 400s, and the USD flow is untouched. (Checked per request, so flip live.)
    process.env.DIVVY_FX = "off";
    try {
      const offCur = await fetch(`${B}/api/fx/currencies`).then((r) => r.json());
      ok("http: DIVVY_FX=off reports enabled:false (picker hides)", offCur.enabled === false);
      ok("http: DIVVY_FX=off rejects foreign entry", (await post({ currency: "JPY", originalAmount: 3000, paidBy: ownerMid })).status === 400);
      ok("http: DIVVY_FX=off quote route 400s", (await fetch(`${B}/api/fx/JPY/3000`)).status === 400);
      const usdOk = await post({ title: "coffee", amountCents: 500, paidBy: ownerMid });
      ok("http: DIVVY_FX=off keeps the USD app fully working", usdOk.status === 200);
    } finally {
      delete process.env.DIVVY_FX;
    }
  } finally {
    server.close();
    __setRatesForTest(null);
  }

  console.log(`\nfx.selftest: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("fx.selftest crashed:", err);
  process.exit(1);
});
