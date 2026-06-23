/**
 * split.ts — Money math.
 *
 * GUARDRAIL: ALL money is integer cents. Never use floats for money.
 * Every split MUST sum to the total EXACTLY (no lost/created pennies).
 */

export type SplitMode = "equal" | "weighted" | "custom";

export interface SplitInput {
  /** Total to collect, in integer cents (includes tip/tax already if you want). */
  totalCents: number;
  /** Participant names. Order is stable; pennies are distributed left-to-right. */
  names: string[];
  mode: SplitMode;
  /**
   * For "weighted": one weight per participant (e.g. [2,1,1] = first owes double).
   * Weights may be any positive numbers; only their ratios matter.
   */
  weights?: number[];
  /**
   * For "custom": an explicit amount in cents per participant. Must sum to total.
   */
  customCents?: number[];
}

export interface SplitShare {
  name: string;
  cents: number;
}

/** Convert a dollar amount (number or numeric string) to integer cents, safely. */
export function toCents(dollars: number | string): number {
  const n = typeof dollars === "string" ? Number(dollars) : dollars;
  if (!Number.isFinite(n)) throw new Error(`toCents: not a finite number: ${dollars}`);
  // Round to nearest cent to avoid float dust like 0.1+0.2.
  return Math.round(n * 100);
}

/** Cents (integer) -> dollars (number), e.g. 2914 -> 29.14. */
export function dollars(cents: number): number {
  return cents / 100;
}

/** Cents (integer) -> "$29.14" string. */
export function fmt(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const d = Math.floor(abs / 100);
  const c = abs % 100;
  return `${sign}$${d}.${c.toString().padStart(2, "0")}`;
}

/**
 * Add a tip on top of a base amount, in cents.
 * tipPercent is a number like 18 for 18%.
 */
export function withTip(baseCents: number, tipPercent: number): number {
  if (!Number.isInteger(baseCents)) throw new Error("withTip: baseCents must be integer cents");
  const tip = Math.round((baseCents * tipPercent) / 100);
  return baseCents + tip;
}

/**
 * Distribute `totalCents` across `n` buckets as evenly as possible.
 * Returns integers that sum EXACTLY to totalCents. The first `remainder`
 * buckets get one extra cent (deterministic, fair, left-to-right).
 */
export function distributeEven(totalCents: number, n: number): number[] {
  assertIntCents(totalCents, "distributeEven");
  if (n <= 0) throw new Error("distributeEven: need at least one bucket");
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n; // 0..n-1, always integer
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(base + (i < remainder ? 1 : 0));
  return out;
}

/**
 * Distribute `totalCents` by integer weights, summing EXACTLY to total.
 * Uses the largest-remainder (Hamilton) method so leftover pennies go to the
 * participants with the biggest fractional claim — fair and total-preserving.
 */
export function distributeWeighted(totalCents: number, weights: number[]): number[] {
  assertIntCents(totalCents, "distributeWeighted");
  if (weights.length === 0) throw new Error("distributeWeighted: no weights");
  if (weights.some((w) => !(w > 0))) throw new Error("distributeWeighted: weights must be > 0");

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  // Exact ideal share per bucket = total * w / totalWeight.
  const ideal = weights.map((w) => (totalCents * w) / totalWeight);
  const floors = ideal.map((x) => Math.floor(x));
  let assigned = floors.reduce((a, b) => a + b, 0);
  let leftover = totalCents - assigned; // integer count of pennies still to hand out

  // Rank buckets by descending fractional remainder; ties broken by index.
  const order = ideal
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

  const out = floors.slice();
  let k = 0;
  while (leftover > 0) {
    out[order[k % order.length].i] += 1;
    leftover -= 1;
    k += 1;
  }
  return out;
}

/**
 * Compute the split. Returns one share per participant. The shares ALWAYS sum
 * to input.totalCents exactly. Throws if the requested split can't honor that.
 */
export function computeSplit(input: SplitInput): SplitShare[] {
  const { totalCents, names, mode } = input;
  assertIntCents(totalCents, "computeSplit");
  if (names.length === 0) throw new Error("computeSplit: need at least one participant");

  let amounts: number[];
  switch (mode) {
    case "equal":
      amounts = distributeEven(totalCents, names.length);
      break;
    case "weighted": {
      const weights = input.weights;
      if (!weights || weights.length !== names.length) {
        throw new Error("computeSplit(weighted): need one weight per participant");
      }
      amounts = distributeWeighted(totalCents, weights);
      break;
    }
    case "custom": {
      const custom = input.customCents;
      if (!custom || custom.length !== names.length) {
        throw new Error("computeSplit(custom): need one amount per participant");
      }
      if (custom.some((c) => !Number.isInteger(c))) {
        throw new Error("computeSplit(custom): amounts must be integer cents");
      }
      const sum = custom.reduce((a, b) => a + b, 0);
      if (sum !== totalCents) {
        throw new Error(
          `computeSplit(custom): amounts sum to ${fmt(sum)} but total is ${fmt(totalCents)}`
        );
      }
      amounts = custom.slice();
      break;
    }
    default:
      throw new Error(`computeSplit: unknown mode ${mode}`);
  }

  // Invariant: never lose or create a penny.
  const check = amounts.reduce((a, b) => a + b, 0);
  if (check !== totalCents) {
    throw new Error(`computeSplit: internal error, ${check} !== ${totalCents}`);
  }

  return names.map((name, i) => ({ name, cents: amounts[i] }));
}

function assertIntCents(v: number, where: string): void {
  if (!Number.isInteger(v)) throw new Error(`${where}: expected integer cents, got ${v}`);
  if (v < 0) throw new Error(`${where}: amount must be >= 0, got ${v}`);
}
