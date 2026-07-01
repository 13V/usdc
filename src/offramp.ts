/**
 * offramp.ts — "Cash out" path (sell USDC → card/bank).
 *
 * Builds MoonPay / Coinbase Offramp (sell) widget URLs that sell USDC on Solana
 * from the user's wallet and pay the proceeds out to their card/bank. The mirror
 * image of onramp.ts.
 *
 * PRODUCTION NOTE: these URLs are correctly SHAPED but won't actually pay out
 * until you supply a real provider key. MoonPay additionally requires the URL
 * to be HMAC-signed server-side (signMoonPaySellUrl) with your secret key, or it
 * will reject the request.
 */

import { createHmac } from "crypto";
import { dollars } from "./split";
import { moonpayHost } from "./onramp";

export interface OfframpParams {
  /** User wallet (base58) — where the USDC to sell is held / refunded to. */
  walletAddress: string;
  /** Amount to sell, integer cents. */
  amountCents: number;
}

/**
 * MoonPay sell widget URL. USDC on Solana is currency code "usdc_sol".
 * Requires MOONPAY_API_KEY (publishable). Must be signed for production.
 */
export function moonpaySellUrl(params: OfframpParams, apiKey = process.env.MOONPAY_API_KEY): string {
  const base = moonpayHost("sell", apiKey);
  const q = new URLSearchParams();
  q.set("apiKey", apiKey || "pk_test_PLACEHOLDER");
  q.set("baseCurrencyCode", "usdc_sol");
  q.set("baseCurrencyAmount", dollars(params.amountCents).toFixed(2));
  q.set("quoteCurrencyCode", "usd");
  q.set("refundWalletAddress", params.walletAddress);
  return `${base}?${q.toString()}`;
}

/**
 * Sign a MoonPay sell URL with the secret key (HMAC-SHA256 of the query string,
 * base64). Returns the URL with `&signature=...` appended. Required in prod.
 */
export function signMoonPaySellUrl(url: string, secretKey = process.env.MOONPAY_SECRET_KEY): string {
  if (!secretKey) return url; // unsigned (test mode)
  const query = url.substring(url.indexOf("?")); // includes leading "?"
  const signature = createHmac("sha256", secretKey).update(query).digest("base64");
  return `${url}&signature=${encodeURIComponent(signature)}`;
}

/**
 * Coinbase Offramp (sell) URL. Requires COINBASE_ONRAMP_APP_ID. Production flows
 * should mint a session token server-side; this is the simple appId form.
 */
export function coinbaseOfframpUrl(
  params: OfframpParams,
  appId = process.env.COINBASE_ONRAMP_APP_ID
): string {
  const base = "https://pay.coinbase.com/v3/sell/input";
  const q = new URLSearchParams();
  q.set("appId", appId || "PLACEHOLDER_APP_ID");
  q.set(
    "addresses",
    JSON.stringify({ [params.walletAddress]: ["solana"] })
  );
  q.set("assets", JSON.stringify(["USDC"]));
  q.set("presetCryptoAmount", dollars(params.amountCents).toFixed(2));
  return `${base}?${q.toString()}`;
}

export interface CashoutOptions {
  moonpay: string;
  coinbase: string;
}

/** Build both cash-out options at once (MoonPay signed if a secret is present). */
export function cashoutOptions(params: OfframpParams): CashoutOptions {
  return {
    moonpay: signMoonPaySellUrl(moonpaySellUrl(params)),
    coinbase: coinbaseOfframpUrl(params),
  };
}
