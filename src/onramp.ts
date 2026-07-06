/**
 * onramp.ts — No-wallet "Pay with card" path.
 *
 * Builds MoonPay / Coinbase Onramp widget URLs that buy USDC on Solana and
 * deliver it straight to the collector's wallet. Friends who don't hold crypto
 * can pay their share with a card.
 *
 * PRODUCTION NOTE: these URLs are correctly SHAPED but won't actually charge
 * until you supply a real provider key. MoonPay additionally requires the URL
 * to be HMAC-signed server-side (signMoonPayUrl) with your secret key, or it
 * will reject the request.
 */

import { createHmac } from "crypto";
import { dollars } from "./split";
import { CLUSTER } from "./cluster";
import type { Cluster } from "./solanaPay";

export interface OnrampParams {
  /** Collector wallet (base58) — where the purchased USDC is delivered. */
  walletAddress: string;
  /** Amount to buy, integer cents (their share). */
  amountCents: number;
  /**
   * MoonPay payment-method hint. When the client is iOS/Safari we pass
   * "apple_pay" so the widget opens straight onto the Apple Pay sheet; omitted
   * otherwise (widget picks its default card flow). Valid MoonPay values include
   * "apple_pay", "google_pay", "credit_debit_card".
   */
  paymentMethod?: string;
  /** URL the widget returns the user to when the purchase completes. */
  redirectURL?: string;
  /** Widget accent color (defaults to Divvy blue). */
  colorCode?: string;
}

/** Divvy brand blue — the widget accent so the checkout feels like our app. */
export const MOONPAY_ACCENT = "#2775CA";

/**
 * MoonPay's per-purchase minimum for USD→USDC. Real minimums hover around
 * $20–30; kept as a single honest constant (env-overridable) so the guest pay
 * page can tell a friend the truth when their share is below it: they buy the
 * minimum and the remainder stays in their own balance "for next time" instead
 * of us pretending the card can be charged exactly $12. Not used by signing.
 */
export const MOONPAY_MIN_CENTS = Number(process.env.MOONPAY_MIN_CENTS || 2000); // $20

/**
 * How much USDC to actually buy on the card ramp to cover a `shareCents` share.
 * Card ramps skim a spread/fee, so buying the exact share can land a cent short
 * and fail the pay — add a 5% cushion, round up to a whole dollar, then floor at
 * the provider minimum. Returns the buy amount, whether the minimum forced it
 * up, and the leftover that stays in the payer's balance afterwards.
 */
export function topUpPlan(
  shareCents: number,
  minCents = MOONPAY_MIN_CENTS
): { buyCents: number; atMinimum: boolean; leftoverCents: number } {
  const withSpread = Math.ceil((shareCents * 1.05) / 100) * 100; // +5%, ceil to $1
  const buyCents = Math.max(withSpread, minCents);
  return {
    buyCents,
    atMinimum: minCents > withSpread,
    leftoverCents: Math.max(0, buyCents - shareCents),
  };
}

/**
 * MoonPay widget environment follows the key: a pk_test_ key only works against
 * the -sandbox widget domains (prod domains reject it outright), and a pk_live_
 * key only works against prod. Deriving it from the prefix means flipping to
 * live is just swapping MOONPAY_API_KEY — no second env var to forget.
 */
export function moonpayHost(kind: "buy" | "sell", apiKey: string | undefined): string {
  const sandbox = !apiKey || apiKey.startsWith("pk_test_");
  return `https://${kind}${sandbox ? "-sandbox" : ""}.moonpay.com`;
}

/**
 * MoonPay buy widget URL. USDC on Solana is currency code "usdc_sol".
 * Requires MOONPAY_API_KEY (publishable). Must be signed for production.
 */
export function moonpayUrl(params: OnrampParams, apiKey = process.env.MOONPAY_API_KEY): string {
  const base = moonpayHost("buy", apiKey);
  const q = new URLSearchParams();
  q.set("apiKey", apiKey || "pk_test_PLACEHOLDER");
  // USDC on Solana. baseCurrency=usd, quote=usdc_sol, amount pre-filled so the
  // widget is as short as possible — the user just confirms.
  q.set("currencyCode", "usdc_sol");
  q.set("walletAddress", params.walletAddress);
  q.set("baseCurrencyCode", "usd");
  q.set("baseCurrencyAmount", dollars(params.amountCents).toFixed(2));
  // Jump straight to Apple Pay when the client hinted iOS/Safari.
  if (params.paymentMethod) q.set("paymentMethod", params.paymentMethod);
  // Brand the checkout so it reads as one continuous flow.
  q.set("colorCode", params.colorCode || MOONPAY_ACCENT);
  q.set("theme", "light");
  if (params.redirectURL) q.set("redirectURL", params.redirectURL);
  return `${base}?${q.toString()}`;
}

/**
 * Sign a MoonPay URL with the secret key (HMAC-SHA256 of the query string,
 * base64). Returns the URL with `&signature=...` appended. Required in prod.
 */
export function signMoonPayUrl(url: string, secretKey = process.env.MOONPAY_SECRET_KEY): string {
  if (!secretKey) return url; // unsigned (test mode)
  const query = url.substring(url.indexOf("?")); // includes leading "?"
  const signature = createHmac("sha256", secretKey).update(query).digest("base64");
  return `${url}&signature=${encodeURIComponent(signature)}`;
}

/**
 * Coinbase Onramp URL. Requires COINBASE_ONRAMP_APP_ID. Production flows should
 * mint a session token server-side; this is the simple appId form.
 */
export function coinbaseOnrampUrl(
  params: OnrampParams,
  appId = process.env.COINBASE_ONRAMP_APP_ID
): string {
  const base = "https://pay.coinbase.com/buy/select-asset";
  const q = new URLSearchParams();
  q.set("appId", appId || "PLACEHOLDER_APP_ID");
  q.set("defaultAsset", "USDC");
  q.set("defaultNetwork", "solana");
  q.set("presetFiatAmount", dollars(params.amountCents).toFixed(2));
  q.set("fiatCurrency", "USD");
  q.set(
    "addresses",
    JSON.stringify({ [params.walletAddress]: ["solana"] })
  );
  return `${base}?${q.toString()}`;
}

export interface CardOptions {
  moonpay: string;
  coinbase: string;
}

/** Build both card options at once (MoonPay signed if a secret is present). */
export function cardOptions(params: OnrampParams): CardOptions {
  return {
    moonpay: signMoonPayUrl(moonpayUrl(params)),
    coinbase: coinbaseOnrampUrl(params),
  };
}

/**
 * Whether the money rails are "live" — i.e. a real provider key is present and
 * not a placeholder. Shared by both the on-ramp and off-ramp routes so the
 * client can tell test-mode (URLs build but won't charge/pay out) from real.
 *
 * CLUSTER-AWARE (B2): on mainnet-beta a MoonPay pk_test_ key must NOT count as
 * live — moonpayHost() derives the SANDBOX widget domain from the key prefix,
 * so a test key on mainnet would report railsLive:true, open
 * buy-sandbox.moonpay.com, let the user "add money", and deliver nothing. On
 * mainnet MoonPay counts only with a pk_live_ key AND the secret key present
 * (MoonPay requires signed URLs in production). Keys unset still degrade
 * gracefully to the "coming soon" UI everywhere.
 */
export function ramsConfigured(cluster: Cluster = CLUSTER): boolean {
  const mp = process.env.MOONPAY_API_KEY;
  const cb = process.env.COINBASE_ONRAMP_APP_ID;
  const mpSet = Boolean(mp && !/PLACEHOLDER/i.test(mp));
  const cbSet = Boolean(cb && !/PLACEHOLDER/i.test(cb));
  if (cluster !== "mainnet-beta") return mpSet || cbSet;
  const mpLive =
    mpSet && (mp as string).startsWith("pk_live_") && Boolean(process.env.MOONPAY_SECRET_KEY);
  return mpLive || cbSet;
}
