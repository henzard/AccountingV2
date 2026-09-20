import { useState, useCallback, useRef } from 'react';
import { and, eq, gte, lte, desc, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../data/local/db';
import { transactions as transactionsTable } from '../../data/local/schema';
import type { TransactionEntity } from '../../domain/transactions/TransactionEntity';
import { useReloadOnSync } from './useReloadOnSync';

/**
 * Envelope types that are RE-CREATED per budget period, so a row's own
 * `period_start` identifies which period it belongs to.
 *
 * Deliberately not `envelopeScopeCondition` from EnvelopeBalanceQuery: that
 * predicate also matches every PERSISTENT type (sinking_fund, emergency_fund,
 * savings, baby_step) unconditionally, because those rows are shared across
 * periods. Unioning it into this list's WHERE therefore pulled every
 * transaction ever booked to a sinking fund into EVERY period's list and
 * total — a March fuel-fund spend showing up, and counted, in September
 * (REG-6). Persistent-envelope rows belong to the period their own
 * `transaction_date` falls in, which the date window already decides.
 */
const PERIOD_SCOPED_ENVELOPE_TYPES = ['spending', 'income', 'utility'] as const;

export interface UseTransactionsResult {
  transactions: TransactionEntity[];
  /** True only while the FIRST load of this hook instance is in flight (see
   * `useEnvelopes` for the full REG-9 note). */
  loading: boolean;
  /** True while a reload is in flight over data already on screen. */
  refreshing: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

/** A closed budget-period window: `[periodStart, periodEnd]`, inclusive. */
export interface TransactionPeriodRange {
  periodStart: string;
  periodEnd: string;
}

/**
 * Loads a household's non-deleted transactions for a budget period.
 *
 * A row is included when EITHER:
 *  - its own `transaction_date` falls within `[periodStart, periodEnd]`
 *    (callers still using the legacy `periodStart`-only positional form get
 *    the original lower-bound-only behaviour, with no upper bound), OR
 *  - it is booked against a PERIOD-SCOPED envelope whose `period_start` is
 *    this period (see `PERIOD_SCOPED_ENVELOPE_TYPES`).
 *
 * The second clause matters because `getEnvelopeSpentCents` counts a
 * transaction toward an envelope's balance purely by `envelope_id`, with no
 * date filter of its own — so a back-dated transaction (dated before
 * `periodStart` but booked against a current-period envelope) was counted
 * in the envelope balance yet invisible in this list. Unioning in the
 * period-scoped envelopes keeps the list and those balances in agreement,
 * without dragging persistent envelopes' whole history into every period.
 */
export function useTransactions(householdId: string, periodStart: string): UseTransactionsResult;
export function useTransactions(
  householdId: string,
  period: TransactionPeriodRange,
): UseTransactionsResult;
export function useTransactions(
  householdId: string,
  periodArg: string | TransactionPeriodRange,
): UseTransactionsResult {
  const periodStart = typeof periodArg === 'string' ? periodArg : periodArg.periodStart;
  const periodEnd = typeof periodArg === 'string' ? undefined : periodArg.periodEnd;

  const [txs, setTxs] = useState<TransactionEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const loadedOnceRef = useRef(false);

  const reload = useCallback(async () => {
    if (loadedOnceRef.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const dateCondition = periodEnd
        ? and(
            gte(transactionsTable.transactionDate, periodStart),
            lte(transactionsTable.transactionDate, periodEnd),
          )
        : gte(transactionsTable.transactionDate, periodStart);

      // Rows whose PERIOD-SCOPED envelope belongs to THIS period count toward
      // that envelope's balance regardless of the transaction's own date (see
      // `getEnvelopeSpentCents`), so they must stay visible here too.
      const periodScopedTypes = sql.join(
        PERIOD_SCOPED_ENVELOPE_TYPES.map((type) => sql`${type}`),
        sql.raw(', '),
      );
      const envelopeInPeriod = sql`${transactionsTable.envelopeId} IN (
        SELECT id FROM envelopes
        WHERE household_id = ${householdId}
          AND deleted_at IS NULL
          AND envelope_type IN (${periodScopedTypes})
          AND period_start = ${periodStart}
      )`;

      const rows = await db
        .select()
        .from(transactionsTable)
        .where(
          and(
            eq(transactionsTable.householdId, householdId),
            isNull(transactionsTable.deletedAt),
            or(dateCondition, envelopeInPeriod),
          ),
        )
        .orderBy(desc(transactionsTable.transactionDate));
      setTxs(rows as TransactionEntity[]);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      loadedOnceRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [householdId, periodStart, periodEnd]);

  // A partner's transaction lands in local SQLite during a sync round;
  // without this the screen showed it only after navigating away and back.
  useReloadOnSync(reload);

  return { transactions: txs, loading, refreshing, error, reload };
}
