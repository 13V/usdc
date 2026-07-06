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

/**
 * FX provenance stamped on a trip expense whose amount was entered in a local
 * currency. The ledger's amountCents is ALWAYS the converted USD value — this
 * blob is the locked record of what the receipt actually said. The server
 * builds it from its own rates (never a client-supplied rate).
 */
export interface ExpenseFx {
  /** ISO code of the original currency, e.g. "JPY". */
  currency: string;
  /** Original amount in MINOR units (integer): ¥3,000 → 3000; €40 → 4000. */
  originalAmount: number;
  /** USD per 1 unit of the original currency, locked at entry. */
  rate: number;
  /** When the conversion happened (ISO). */
  at: string;
  /** When the rate was as-of (per the rate source). */
  asOf: string;
  /** Rate source, e.g. "open.er-api.com" or "fallback". */
  source: string;
}

/** Cap on a foreign original amount in minor units (validated server-side). */
export const MAX_FX_MINOR = 10_000_000_000; // 10^10

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

// Test seam: injected rates short-circuit getUsdRates so selftests never touch
// the network (and never depend on the fallback table's exact numbers).
let injectedRates: UsdRates | null = null;

/** TEST-ONLY: inject fixed rates (FOREIGN units per USD); null clears. */
export function __setRatesForTest(
  rates: Record<string, number> | null,
  asOf = "(test rates)"
): void {
  injectedRates = rates ? { rates: { ...rates, USD: 1 }, asOf, source: "test" } : null;
}

/**
 * M4 guard predicate: may a rate from `source` be used to CREATE a new money
 * row on `cluster`? On devnet the static fallback table is fine (test value).
 * On mainnet-beta a stale offline table must never price real money — new FX
 * entries are refused until the live rate source is reachable again. Display
 * of already-stored fx blobs is unaffected (they carry their own locked rate).
 */
export function fxSourceUsableOnCluster(source: string, cluster: string): boolean {
  return !(cluster === "mainnet-beta" && source === "fallback");
}

/** The friendly refusal used when fxSourceUsableOnCluster says no. */
export const FX_FALLBACK_UNAVAILABLE =
  "live exchange rates are unavailable right now — enter the amount in USD, or try again in a few minutes";

/**
 * Kill switch: set DIVVY_FX=off to disable multi-currency entry entirely.
 * The rate source itself is keyless (with an offline fallback table), so FX is
 * available by default — this exists so the app degrades to USD-only cleanly.
 */
export function fxEnabled(): boolean {
  return process.env.DIVVY_FX !== "off";
}

/** The stable, offline-known currency whitelist (the fallback table's keys). */
export function supportedCurrencies(): string[] {
  return Object.keys(FALLBACK_RATES);
}

/** Display symbol for a currency ("$", "¥", …); falls back to the ISO code. */
export function symbolFor(currency: string): string {
  return SYMBOLS[normalize(currency)] || `${normalize(currency)} `;
}

/** True when the currency has no minor unit (JPY, KRW, VND, IDR). */
export function isZeroDecimal(currency: string): boolean {
  return ZERO_DECIMAL.has(normalize(currency));
}

/** Minor units per 1 major unit: 1 for zero-decimal currencies, else 100. */
export function minorPerMajor(currency: string): number {
  return isZeroDecimal(currency) ? 1 : 100;
}

/** Convert an integer MINOR amount to major units: 3000 JPY→3000, 4000 EUR→40. */
export function majorFromMinor(minor: number, currency: string): number {
  return minor / minorPerMajor(currency);
}

/**
 * Pure helper: USD cents from an integer amount in the currency's OWN minor
 * units (zero-decimal aware). Rounds exactly once.
 */
export function usdCentsFromForeignMinor(
  minor: number,
  currency: string,
  ratePerUnit: number
): number {
  return Math.round(majorFromMinor(minor, currency) * ratePerUnit * 100);
}

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
  if (injectedRates && cur in injectedRates.rates) return true;
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
  if (injectedRates) return injectedRates;
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
 * Convert an integer amount in the currency's OWN minor units to USD (rates
 * fetched fresh per the module cache — the freshness convention). async.
 * rate = USD per 1 unit.
 */
export async function convertMinorToUsd(
  minor: number,
  currency: string
): Promise<FxConversion> {
  const { rates, asOf, source } = await getUsdRates();
  const rate = ratePerUnitToUsd(currency, rates);
  const usdCents = usdCentsFromForeignMinor(minor, currency, rate);
  return { usdCents, rate, asOf, source };
}

/** Build the ExpenseFx provenance blob for a just-converted expense. */
export function buildExpenseFx(input: {
  currency: string;
  originalAmount: number;
  rate: number;
  asOf: string;
  source: string;
}): ExpenseFx {
  return {
    currency: normalize(input.currency),
    originalAmount: input.originalAmount,
    rate: input.rate,
    at: new Date().toISOString(),
    asOf: input.asOf,
    source: input.source,
  };
}

/**
 * Normalize any stored fx blob (the new ExpenseFx shape OR the legacy
 * bill-style {sourceCurrency, sourceAmount(major)} shape) into the original
 * currency + MAJOR amount for display. Returns null when the blob is junk.
 */
export function fxOriginal(fx: unknown): { currency: string; amountMajor: number } | null {
  if (!fx || typeof fx !== "object") return null;
  const f = fx as Record<string, unknown>;
  const cur = normalize(String(f.currency || f.sourceCurrency || f.code || ""));
  if (!cur || cur === "USD") return null;
  if (Number.isFinite(f.originalAmount)) {
    return { currency: cur, amountMajor: majorFromMinor(f.originalAmount as number, cur) };
  }
  if (Number.isFinite(f.sourceAmount)) {
    return { currency: cur, amountMajor: f.sourceAmount as number };
  }
  return null;
}

/** "¥3,000" / "€40.00" for a stored fx blob, or null when there isn't one. */
export function fxOriginalFmt(fx: unknown): string | null {
  const o = fxOriginal(fx);
  return o ? formatForeign(o.amountMajor, o.currency) : null;
}

/** The dry provenance line: `Originally ¥3,000 JPY @ $0.0064 (as of …)`. */
export function fxNoteFor(fx: unknown): string | null {
  const o = fxOriginal(fx);
  if (!o) return null;
  const f = fx as Record<string, unknown>;
  const rate = Number(f.rate);
  const asOf = String(f.asOf || f.at || "");
  let note = `Originally ${formatForeign(o.amountMajor, o.currency)} ${o.currency}`;
  if (Number.isFinite(rate) && rate > 0) note += ` @ $${rate.toFixed(4)}`;
  if (asOf) note += ` (as of ${asOf})`;
  return note;
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
