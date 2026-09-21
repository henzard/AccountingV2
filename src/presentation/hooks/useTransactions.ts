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
 * Membership mirrors the LEDGER rule (`getEnvelopeSpentCents`), so a row is
 * listed by exactly one period and the on-screen total agrees with the
 * envelope balances:
 *  - a row booked against a PERIOD-SCOPED envelope belongs to that
 *    envelope's period and ONLY that period, whatever its own
 *    `transaction_date` says — the ledger counts it toward that envelope
 *    purely by `envelope_id`, with no date filter of its own;
 *  - every other row — persistent-type envelope (shared across periods), or
 *    no / unknown / deleted envelope — belongs to the period its
 *    `transaction_date` falls in, i.e. `[periodStart, periodEnd]` (callers
 *    still using the legacy `periodStart`-only positional form get the
 *    original lower-bound-only behaviour, with no upper bound).
 *
 * This used to be a plain OR of the date window and the envelope clause,
 * which double-counted: a row on period A's envelope but dated inside
 * period B appeared in — and was summed into — BOTH periods, something the
 * ledger never does.
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

      const periodScopedTypes = sql.join(
        PERIOD_SCOPED_ENVELOPE_TYPES.map((type) => sql`${type}`),
        sql.raw(', '),
      );

      // The row's PERIOD-SCOPED envelope is THIS period's — the ledger
      // attributes it here regardless of its own `transaction_date`.
      const envelopeInThisPeriod = sql`EXISTS (
        SELECT 1 FROM envelopes
        WHERE envelopes.id = ${transactionsTable.envelopeId}
          AND envelopes.household_id = ${householdId}
          AND envelopes.deleted_at IS NULL
          AND envelopes.envelope_type IN (${periodScopedTypes})
          AND envelopes.period_start = ${periodStart}
      )`;

      // ...and the converse: the row is NOT on any (live) period-scoped
      // envelope, so no envelope claims it and its own date decides.
      // Deliberately `EXISTS` rather than `envelope_id IN (...)`: on a row
      // with a NULL `envelope_id`, `NOT (NULL IN (...))` evaluates to NULL
      // and would drop orphan rows from every period's list, whereas
      // `NOT EXISTS` is correctly true for them.
      const onSomePeriodScopedEnvelope = sql`EXISTS (
        SELECT 1 FROM envelopes
        WHERE envelopes.id = ${transactionsTable.envelopeId}
          AND envelopes.household_id = ${householdId}
          AND envelopes.deleted_at IS NULL
          AND envelopes.envelope_type IN (${periodScopedTypes})
      )`;

      const rows = await db
        .select()
        .from(transactionsTable)
        .where(
          and(
            eq(transactionsTable.householdId, householdId),
            isNull(transactionsTable.deletedAt),
            or(envelopeInThisPeriod, and(sql`NOT ${onSomePeriodScopedEnvelope}`, dateCondition)),
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
