/**
 * limits.ts — the single env-tunable ledger amount cap (M1).
 *
 * Every money write path (bills, trip expenses, tabs, IOUs, mochi actions,
 * subscriptions) historically hardcoded 100_000_000 cents ($1,000,000) as its
 * MAX_AMOUNT_CENTS. That stays the default, but launch wants a much lower cap
 * without a code change — LEDGER_MAX_CENTS makes it one env var, wired through
 * one shared constant so the caps can never drift apart again.
 *
 * NOTE: this is the LEDGER cap (what an expense/IOU/tab entry may record). The
 * fiat rails have their own, much lower RAIL_MAX_CENTS in server.ts.
 */

export const DEFAULT_LEDGER_MAX_CENTS = 100_000_000; // $1,000,000

/** Parse + validate a raw LEDGER_MAX_CENTS value. Throws on garbage (a money
 *  cap must never silently fall back after a typo). */
export function resolveLedgerMaxCents(raw: unknown): number {
  if (raw == null || String(raw).trim() === "") return DEFAULT_LEDGER_MAX_CENTS;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 100 || n > 10_000_000_000) {
    throw new Error(
      `Invalid LEDGER_MAX_CENTS "${raw}" — must be an integer number of cents ` +
        `between 100 ($1) and 10000000000 ($100M). Refusing to boot with a broken money cap.`
    );
  }
  return n;
}

/** The ledger-wide per-amount cap, integer cents. */
export const LEDGER_MAX_CENTS = resolveLedgerMaxCents(process.env.LEDGER_MAX_CENTS);
