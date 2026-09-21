import { sql } from 'drizzle-orm';
import type { EnvelopeBalanceDb } from './EnvelopeBalanceQuery';

/**
 * Envelope types whose history is worth aggregating across periods. These are
 * exactly the PERIOD-scoped types (see `envelopeScopeCondition` /
 * `getEnvelopeScope`): they are re-created every period with a brand-new id,
 * so the only thing that links "Food" in March to "Food" in April is
 * (household, envelope_type, lower(trim(name))).
 *
 * Persistent types (sinking_fund / emergency_fund / savings / baby_step) are
 * deliberately absent: one row spans every period, so "what did this category
 * cost in period X" has no meaning for them — their balance is an all-time
 * total, not a per-period spend.
 */
const HISTORY_ENVELOPE_TYPES = ['spending', 'utility', 'income'] as const;

export type HistoryEnvelopeType = (typeof HISTORY_ENVELOPE_TYPES)[number];

/** Renders the fixed, non-user-controlled type list as a SQL IN(...) clause. */
function historyTypeInClause(): string {
  return HISTORY_ENVELOPE_TYPES.map((type) => `'${type}'`).join(',');
}

/** One closed period's figures for one category. */
export interface CategoryPeriodHistory {
  periodStart: string;
  /**
   * Signed SUM of that period's non-deleted transactions for this category —
   * refunds (negative amounts) NET against purchases, exactly as
   * `getEnvelopeSpentCents` computes a single envelope's spend. 0 when the
   * category existed that period but was never spent against (that zero is a
   * real observation and must count toward the median).
   */
  spendCents: number;
  /**
   * The same signed SUM, restricted to transactions falling on or before the
   * requested DAY-OF-PERIOD — i.e. "by day 9 of that period, this much had
   * been spent". Always 0 when no day-of-period was requested.
   */
  spendByDayCents: number;
  /** SUM of the category's `allocated_cents` that period (0 is a real budget decision). */
  allocatedCents: number;
}

/** Every closed period observed for one category, newest period first. */
export interface CategoryHistoryEntry {
  /** `lower(trim(name))` — the cross-period identity of the category. */
  categoryKey: string;
  /** The name as most recently spelled, for display. */
  displayName: string;
  envelopeType: HistoryEnvelopeType;
  periods: CategoryPeriodHistory[];
}

export interface CategoryHistory {
  /** The closed period starts actually observed, newest first. */
  periodStarts: string[];
  /** The day-of-period the `spendByDayCents` figures were cut at, or null. */
  throughDayOfPeriod: number | null;
  categories: CategoryHistoryEntry[];
}

export interface CategoryHistoryOptions {
  /** How many CLOSED periods to look back over. */
  maxPeriods: number;
  /**
   * Day-of-period (1-based, day 1 = `period_start`) to also cut a cumulative
   * figure at, so "by day 9 you have usually spent R x" is answerable.
   * Omitted (or <= 0) skips that aggregate entirely — one query fewer.
   */
  throughDayOfPeriod?: number;
}

interface PeriodStartRow {
  period_start: string;
}

interface CategoryAllocationRow {
  envelope_type: HistoryEnvelopeType;
  category_key: string;
  display_name: string;
  period_start: string;
  allocated_cents: number | null;
}

interface CategorySpendRow {
  envelope_type: HistoryEnvelopeType;
  category_key: string;
  period_start: string;
  total_cents: number | null;
}

/** Map key for a (envelope_type, category, period) cell. */
function cellKey(envelopeType: string, categoryKey: string, periodStart: string): string {
  return JSON.stringify([envelopeType, categoryKey, periodStart]);
}

/**
 * Per-category, per-period spend history for `householdId`, over the last
 * `maxPeriods` CLOSED periods (every period strictly before
 * `beforePeriodStart`).
 *
 * Why this exists: the forecast used to see only the current period and
 * extrapolate `spent / daysElapsed * daysRemaining`, which says nothing on
 * day 2 and nothing at all in a period that has no envelopes yet. 18 periods
 * of ledger already say what this household typically spends per category;
 * this is the read model that surfaces it.
 *
 * Cost: a fixed FOUR queries (three when no day-of-period is asked for) for
 * the whole screen, whatever the category count —
 *  1. the closed period starts (DISTINCT ... LIMIT n),
 *  2. category PRESENCE + allocation per period (no join, so no fan-out),
 *  3. total spend per category per period,
 *  4. spend per category per period cut at `throughDayOfPeriod`.
 *
 * Presence is read separately from spend on purpose: a category that had an
 * envelope but no transactions that period must contribute a real ZERO to its
 * median, and a spend-only aggregate simply has no row for it.
 *
 * Soft-deleted envelopes and transactions, and archived envelopes, are
 * excluded throughout. Amounts are signed sums, so refunds net.
 *
 * INCOME categories are returned alongside spending/utility ones but carry
 * their `envelopeType`, because a transaction on an income envelope is money
 * IN and must never be added to a spend total — callers separate the two by
 * type (see `buildCategoryBaselines`).
 */
export async function getCategoryHistory(
  db: EnvelopeBalanceDb,
  householdId: string,
  beforePeriodStart: string,
  options: CategoryHistoryOptions,
): Promise<CategoryHistory> {
  const throughDayOfPeriod =
    options.throughDayOfPeriod !== undefined && options.throughDayOfPeriod > 0
      ? Math.floor(options.throughDayOfPeriod)
      : null;

  const empty: CategoryHistory = { periodStarts: [], throughDayOfPeriod, categories: [] };
  if (options.maxPeriods <= 0) return empty;

  const typeIn = sql.raw(historyTypeInClause());

  const periodRows = (await db.all(
    sql`SELECT DISTINCT period_start
        FROM envelopes
        WHERE household_id = ${householdId}
          AND deleted_at IS NULL
          AND is_archived = 0
          AND envelope_type IN (${typeIn})
          AND period_start < ${beforePeriodStart}
        ORDER BY period_start DESC
        LIMIT ${options.maxPeriods}`,
  )) as PeriodStartRow[];

  const periodStarts = periodRows.map((row) => row.period_start);
  if (periodStarts.length === 0) return empty;

  const periodList = sql.join(
    periodStarts.map((periodStart) => sql`${periodStart}`),
    sql.raw(', '),
  );

  // Presence + allocation. Grouped straight off `envelopes` with no join, so
  // a category with several same-named envelopes in one period sums once and
  // nothing fans out against the transaction rows.
  const allocationRows = (await db.all(
    sql`SELECT envelope_type AS envelope_type,
               LOWER(TRIM(name)) AS category_key,
               MAX(name) AS display_name,
               period_start AS period_start,
               SUM(allocated_cents) AS allocated_cents
        FROM envelopes
        WHERE household_id = ${householdId}
          AND deleted_at IS NULL
          AND is_archived = 0
          AND envelope_type IN (${typeIn})
          AND period_start IN (${periodList})
        GROUP BY envelope_type, LOWER(TRIM(name)), period_start`,
  )) as CategoryAllocationRow[];

  const spendRows = (await db.all(
    sql`SELECT e.envelope_type AS envelope_type,
               LOWER(TRIM(e.name)) AS category_key,
               e.period_start AS period_start,
               SUM(t.amount_cents) AS total_cents
        FROM envelopes e
        JOIN transactions t
          ON t.envelope_id = e.id
         AND t.deleted_at IS NULL
        WHERE e.household_id = ${householdId}
          AND e.deleted_at IS NULL
          AND e.is_archived = 0
          AND e.envelope_type IN (${typeIn})
          AND e.period_start IN (${periodList})
        GROUP BY e.envelope_type, LOWER(TRIM(e.name)), e.period_start`,
  )) as CategorySpendRow[];

  // `julianday` on a 'YYYY-MM-DD' date is exact, so the difference is a whole
  // number of days; +1 makes period_start itself day 1, matching the
  // `daysElapsed` convention in CashFlowForecaster.
  const byDayRows =
    throughDayOfPeriod === null
      ? []
      : ((await db.all(
          sql`SELECT e.envelope_type AS envelope_type,
                     LOWER(TRIM(e.name)) AS category_key,
                     e.period_start AS period_start,
                     SUM(t.amount_cents) AS total_cents
              FROM envelopes e
              JOIN transactions t
                ON t.envelope_id = e.id
               AND t.deleted_at IS NULL
              WHERE e.household_id = ${householdId}
                AND e.deleted_at IS NULL
                AND e.is_archived = 0
                AND e.envelope_type IN (${typeIn})
                AND e.period_start IN (${periodList})
                AND CAST(julianday(t.transaction_date) - julianday(e.period_start) AS INTEGER) + 1
                    <= ${throughDayOfPeriod}
              GROUP BY e.envelope_type, LOWER(TRIM(e.name)), e.period_start`,
        )) as CategorySpendRow[]);

  const spendByCell = new Map<string, number>();
  for (const row of spendRows) {
    spendByCell.set(
      cellKey(row.envelope_type, row.category_key, row.period_start),
      row.total_cents ?? 0,
    );
  }
  const byDayByCell = new Map<string, number>();
  for (const row of byDayRows) {
    byDayByCell.set(
      cellKey(row.envelope_type, row.category_key, row.period_start),
      row.total_cents ?? 0,
    );
  }

  // Presence drives the result: one entry per (type, category), one period
  // record per period that category actually existed in.
  const entries = new Map<string, CategoryHistoryEntry>();
  const periodRank = new Map<string, number>();
  periodStarts.forEach((periodStart, index) => periodRank.set(periodStart, index));

  for (const row of allocationRows) {
    const entryKey = JSON.stringify([row.envelope_type, row.category_key]);
    let entry = entries.get(entryKey);
    if (entry === undefined) {
      entry = {
        categoryKey: row.category_key,
        displayName: row.display_name,
        envelopeType: row.envelope_type,
        periods: [],
      };
      entries.set(entryKey, entry);
    }
    const cell = cellKey(row.envelope_type, row.category_key, row.period_start);
    entry.periods.push({
      periodStart: row.period_start,
      spendCents: spendByCell.get(cell) ?? 0,
      spendByDayCents: byDayByCell.get(cell) ?? 0,
      allocatedCents: row.allocated_cents ?? 0,
    });
  }

  for (const entry of entries.values()) {
    entry.periods.sort(
      (a, b) =>
        (periodRank.get(a.periodStart) ?? 0) - (periodRank.get(b.periodStart) ?? 0) ||
        b.periodStart.localeCompare(a.periodStart),
    );
    // The name as most recently spelled wins: `MAX(name)` above is only an
    // arbitrary representative of the group.
    const newest = entry.periods[0];
    if (newest !== undefined) {
      const newestRow = allocationRows.find(
        (row) =>
          row.envelope_type === entry.envelopeType &&
          row.category_key === entry.categoryKey &&
          row.period_start === newest.periodStart,
      );
      if (newestRow !== undefined) entry.displayName = newestRow.display_name;
    }
  }

  return {
    periodStarts,
    throughDayOfPeriod,
    categories: Array.from(entries.values()),
  };
}
