/**
 * fx.ts — Multi-currency FX: convert a local-currency amount (Thai baht, euro,
 * yen, ...) into USD/USDC so a foreign receipt can still be split.
 *
 * GUARDRAIL: money is ALWAYS integer cents. We convert foreign -> USD ONCE,
 * rounding a single time into integer USDC cents; from there the existing split
 * math takes over and every split still sums EXACTLY.
 *
 * 1 USDC is treated as 1 USD (it is a USD stablecoin). That peg can drift in a
 * depeg — we note that honestly in the README rather than pretend it is exact.
 *
 * Rate source: the free, no-key endpoint https://open.er-api.com/v6/latest/USD
 * which returns FOREIGN units per 1 USD. So the USD value of 1 foreign unit is
 * 1 / rates[CUR]. We cache for ~10 minutes and fall back to a static table on
 * any failure so the feature degrades gracefully offline.
 */

export interface UsdRates {
  /** Foreign units per 1 USD (e.g. THB: 32.93). USD is always 1. */
  rates: Record<string, number>;
  /** Human/ISO timestamp the rates were last updated. */
  asOf: string;
  /** "open.er-api.com" on a live fetch, "fallback" when offline. */
  source: string;
}

export interface FxConversion {
  /** USD value in integer cents (rounded ONCE). */
  usdCents: number;
  /** USD per 1 foreign unit. */
  rate: number;
  asOf: string;
  source: string;
}

const RATE_API_URL = "https://open.er-api.com/v6/latest/USD";
const CACHE_TTL_MS = 10 * 60 * 1000; // ~10 minutes

/**
 * Static fallback: approximate FOREIGN units per 1 USD for a set of common
 * travel currencies. Used when the live API is unreachable. USD must be 1.
 */
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  THB: 36.5,
  IDR: 16250,
  JPY: 157,
  AUD: 1.52,
  VND: 25400,
  MXN: 17.1,
  INR: 83.4,
  TRY: 32.5,
  SGD: 1.35,
  CAD: 1.36,
  CHF: 0.89,
  CNY: 7.24,
  KRW: 1370,
  PHP: 58.3,
  MYR: 4.7,
  AED: 3.67,
  ZAR: 18.6,
};

const FALLBACK: UsdRates = {
  rates: { ...FALLBACK_RATES },
  asOf: "(offline fallback)",
  source: "fallback",
};

/** Display symbols (prefix) for common currencies. */
const SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  THB: "฿",
  JPY: "¥",
  CNY: "¥",
  KRW: "₩",
  VND: "₫",
  INR: "₹",
  PHP: "₱",
  TRY: "₺",
  IDR: "Rp",
  AUD: "A$",
  CAD: "C$",
  SGD: "S$",
  MXN: "$",
  CHF: "CHF ",
  MYR: "RM",
  AED: "AED ",
  ZAR: "R",
};

/** Currencies that have no minor unit (whole numbers only). */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "IDR"]);

// In-memory cache of the last successful (or fallback) fetch.
let cache: { value: UsdRates; at: number } | null = null;

/**
 * Pure helper: USD cents from foreign MINOR units (cents) given the USD value
 * of 1 foreign unit. Rounds exactly once.
 */
export function usdCentsFromForeignCents(foreignCents: number, ratePerUnit: number): number {
  return Math.round(foreignCents * ratePerUnit);
}

/**
 * Pure helper: USD cents from a foreign MAJOR amount (e.g. 2450.00 baht) given
 * the USD value of 1 foreign unit. Rounds exactly once.
 */
export function usdCentsFromForeignMajor(amountMajor: number, ratePerUnit: number): number {
  return Math.round(amountMajor * ratePerUnit * 100);
}

function normalize(currency: string): string {
  return String(currency || "").trim().toUpperCase();
}

/** True if we can convert this currency (live or fallback table). */
export function isSupported(currency: string): boolean {
  const cur = normalize(currency);
  if (cur === "USD") return true;
  if (cur in FALLBACK_RATES) return true;
  if (cache && cur in cache.value.rates) return true;
  return false;
}

/** USD per 1 foreign unit. 1 for USD. Throws if the currency is unknown. */
export function ratePerUnitToUsd(currency: string, rates: Record<string, number>): number {
  const cur = normalize(currency);
  if (cur === "USD") return 1;
  const perUsd = rates[cur];
  if (!perUsd || !Number.isFinite(perUsd) || perUsd <= 0) {
    throw new Error(`fx: unknown or invalid currency "${cur}"`);
  }
  return 1 / perUsd;
}

/**
 * Fetch the latest USD rates, cached in-memory for ~10 minutes. On any failure
 * (network, bad shape, non-2xx) returns the STATIC FALLBACK table.
 */
export async function getUsdRates(): Promise<UsdRates> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;

  try {
    const resp = await fetch(RATE_API_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as {
      result?: string;
      time_last_update_utc?: string;
      rates?: Record<string, number>;
    };
    if (data.result !== "success" || !data.rates || typeof data.rates !== "object") {
      throw new Error("unexpected response shape");
    }
    const rates = { ...data.rates, USD: 1 };
    const value: UsdRates = {
      rates,
      asOf: data.time_last_update_utc || new Date().toISOString(),
      source: "open.er-api.com",
    };
    cache = { value, at: now };
    return value;
  } catch {
    // Cache the fallback briefly too, so we don't hammer a down endpoint.
    cache = { value: FALLBACK, at: now };
    return FALLBACK;
  }
}

/**
 * Convert a foreign MAJOR amount to USD. async. rate = USD per 1 unit.
 */
export async function convertMajorToUsd(
  amountMajor: number,
  currency: string
): Promise<FxConversion> {
  const { rates, asOf, source } = await getUsdRates();
  const rate = ratePerUnitToUsd(currency, rates);
  const usdCents = usdCentsFromForeignMajor(amountMajor, rate);
  return { usdCents, rate, asOf, source };
}

/**
 * Convert foreign MINOR units (cents) to USD. async. rate = USD per 1 unit.
 */
export async function convertForeignCentsToUsd(
  foreignCents: number,
  currency: string
): Promise<FxConversion> {
  const { rates, asOf, source } = await getUsdRates();
  const rate = ratePerUnitToUsd(currency, rates);
  const usdCents = usdCentsFromForeignCents(foreignCents, rate);
  return { usdCents, rate, asOf, source };
}

/**
 * Format a foreign MAJOR amount for display, e.g. "฿2,450.00", "€42.00",
 * "¥1,600". Zero-decimal currencies (JPY, KRW, VND, IDR) show no cents. Unknown
 * currencies fall back to "<amount> <CUR>" with thousands separators.
 */
export function formatForeign(amountMajor: number, currency: string): string {
  const cur = normalize(currency);
  const decimals = ZERO_DECIMAL.has(cur) ? 0 : 2;
  const n = Number(amountMajor) || 0;
  const num = n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sym = SYMBOLS[cur];
  if (sym) return `${sym}${num}`;
  return `${num} ${cur}`;
}
