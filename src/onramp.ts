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

export interface OnrampParams {
  /** Collector wallet (base58) — where the purchased USDC is delivered. */
  walletAddress: string;
  /** Amount to buy, integer cents (their share). */
  amountCents: number;
}

/**
 * MoonPay buy widget URL. USDC on Solana is currency code "usdc_sol".
 * Requires MOONPAY_API_KEY (publishable). Must be signed for production.
 */
export function moonpayUrl(params: OnrampParams, apiKey = process.env.MOONPAY_API_KEY): string {
  const base = "https://buy.moonpay.com";
  const q = new URLSearchParams();
  q.set("apiKey", apiKey || "pk_test_PLACEHOLDER");
  q.set("currencyCode", "usdc_sol");
  q.set("walletAddress", params.walletAddress);
  q.set("baseCurrencyAmount", dollars(params.amountCents).toFixed(2));
  q.set("baseCurrencyCode", "usd");
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
 */
export function ramsConfigured(): boolean {
  const mp = process.env.MOONPAY_API_KEY;
  const cb = process.env.COINBASE_ONRAMP_APP_ID;
  return Boolean((mp && !/PLACEHOLDER/i.test(mp)) || (cb && !/PLACEHOLDER/i.test(cb)));
}
