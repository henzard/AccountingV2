import type {
  CategoryHistory,
  CategoryHistoryEntry,
  HistoryEnvelopeType,
} from '../../data/local/balances/CategoryHistoryQuery';

/**
 * How many CLOSED periods a baseline looks back over. Six is a season of
 * budgets: long enough that one unusual month cannot define "typical", short
 * enough that a genuine change in the household's spending (a new car, a
 * child starting school) works its way into the figure within half a year.
 */
export const BASELINE_PERIOD_WINDOW = 6;

/**
 * Fewest closed periods that may be called a baseline. With one observation
 * "typical" is just "that one time", which is exactly the kind of confident
 * nonsense the current-period-only forecast already produces. Below this the
 * forecast falls back to today's pure run-rate behaviour.
 */
export const MIN_PERIODS_FOR_BASELINE = 2;

/**
 * The cross-period identity of a category. Envelope ids change every period,
 * so "Food" in March and "Food " in April are the same category only because
 * of this: (envelope_type, lower(trim(name))) within one household.
 */
export function categoryKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Map key for a baseline: the envelope type is part of the identity. */
export function baselineKey(envelopeType: string, name: string): string {
  return JSON.stringify([envelopeType, categoryKey(name)]);
}

/**
 * MEDIAN of `values`, rounded to whole cents. The median, not the mean:
 * one month with a R14,000 car repair in Transportation would drag a mean
 * upward for half a year and tell the household it "typically" spends money
 * it has spent exactly once.
 *
 * Even counts average the two middle values, the usual definition.
 * Returns 0 for an empty list.
 */
export function medianCents(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return Math.round(sorted[middle]);
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export interface CategoryBaseline {
  categoryKey: string;
  displayName: string;
  envelopeType: HistoryEnvelopeType;
  /** How many closed periods this baseline is built from (>= MIN_PERIODS_FOR_BASELINE). */
  periodsObserved: number;
  /** MEDIAN whole-period spend across those periods. */
  typicalPeriodSpendCents: number;
  /** Lowest and highest whole-period spend observed — the honest range around the median. */
  lowestPeriodSpendCents: number;
  highestPeriodSpendCents: number;
  /**
   * MEDIAN CUMULATIVE spend by the same day-of-period the history was cut at,
   * i.e. "by day 9 you have usually spent R x". Null when no day-of-period
   * was requested.
   */
  typicalSpendByDayCents: number | null;
  /** The day-of-period `typicalSpendByDayCents` refers to, or null. */
  throughDayOfPeriod: number | null;
  /** MEDIAN allocation for this category across those periods. */
  typicalAllocatedCents: number;
}

function toBaseline(
  entry: CategoryHistoryEntry,
  throughDayOfPeriod: number | null,
): CategoryBaseline | null {
  if (entry.periods.length < MIN_PERIODS_FOR_BASELINE) return null;

  // INCOME: a transaction on an income envelope is money IN, never spending.
  // The sums are kept as they are stored (positive = money received) and the
  // TYPE is carried through, so no caller can add them to a spend total by
  // accident — `spendingBaselines` below filters them out outright.
  const spends = entry.periods.map((p) => p.spendCents);

  return {
    categoryKey: entry.categoryKey,
    displayName: entry.displayName,
    envelopeType: entry.envelopeType,
    periodsObserved: entry.periods.length,
    typicalPeriodSpendCents: medianCents(spends),
    lowestPeriodSpendCents: Math.min(...spends),
    highestPeriodSpendCents: Math.max(...spends),
    typicalSpendByDayCents:
      throughDayOfPeriod === null ? null : medianCents(entry.periods.map((p) => p.spendByDayCents)),
    throughDayOfPeriod,
    typicalAllocatedCents: medianCents(entry.periods.map((p) => p.allocatedCents)),
  };
}

export type CategoryBaselines = ReadonlyMap<string, CategoryBaseline>;

/**
 * Turns raw per-period history into one baseline per category, keyed by
 * `baselineKey(envelopeType, name)`. Categories seen in fewer than
 * `MIN_PERIODS_FOR_BASELINE` closed periods are dropped rather than guessed
 * at, so a caller holding a baseline always holds real evidence.
 */
export function buildCategoryBaselines(history: CategoryHistory): Map<string, CategoryBaseline> {
  const result = new Map<string, CategoryBaseline>();
  for (const entry of history.categories) {
    const baseline = toBaseline(entry, history.throughDayOfPeriod);
    if (baseline !== null) {
      result.set(baselineKey(entry.envelopeType, entry.categoryKey), baseline);
    }
  }
  return result;
}

/** The SPENDING-side baselines only (income excluded), newest-typical first. */
export function spendingBaselines(baselines: CategoryBaselines): CategoryBaseline[] {
  return Array.from(baselines.values())
    .filter((b) => b.envelopeType !== 'income')
    .sort((a, b) => b.typicalPeriodSpendCents - a.typicalPeriodSpendCents);
}

/** The INCOME-side baselines only. */
export function incomeBaselines(baselines: CategoryBaselines): CategoryBaseline[] {
  return Array.from(baselines.values()).filter((b) => b.envelopeType === 'income');
}
