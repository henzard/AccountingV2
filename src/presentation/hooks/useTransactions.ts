import { useState, useCallback } from 'react';
import { and, eq, gte, lte, desc, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../data/local/db';
import { transactions as transactionsTable } from '../../data/local/schema';
import { envelopeScopeCondition } from '../../data/local/balances/EnvelopeBalanceQuery';
import type { TransactionEntity } from '../../domain/transactions/TransactionEntity';
import { useReloadOnSync } from './useReloadOnSync';

export interface UseTransactionsResult {
  transactions: TransactionEntity[];
  loading: boolean;
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
 *  - it is booked against an envelope that belongs to THIS period per
 *    `envelopeScopeCondition` (see `EnvelopeBalanceQuery.ts`).
 *
 * The second clause matters because `getEnvelopeSpentCents` counts a
 * transaction toward an envelope's balance purely by `envelope_id`, with no
 * date filter of its own — so a back-dated transaction (dated before
 * `periodStart` but booked against a current-period envelope) was counted
 * in the envelope balance yet invisible in this list. Unioning in the
 * envelope-scope condition keeps the list and the balances in agreement.
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
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dateCondition = periodEnd
        ? and(
            gte(transactionsTable.transactionDate, periodStart),
            lte(transactionsTable.transactionDate, periodEnd),
          )
        : gte(transactionsTable.transactionDate, periodStart);

      // Rows whose envelope is scoped to THIS period count toward that
      // envelope's balance regardless of the transaction's own date (see
      // `getEnvelopeSpentCents`), so they must stay visible here too.
      const envelopeInPeriod = sql`${transactionsTable.envelopeId} IN (
        SELECT id FROM envelopes
        WHERE household_id = ${householdId}
          AND deleted_at IS NULL
          AND ${envelopeScopeCondition(periodStart)}
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
      setLoading(false);
    }
  }, [householdId, periodStart, periodEnd]);

  // A partner's transaction lands in local SQLite during a sync round;
  // without this the screen showed it only after navigating away and back.
  useReloadOnSync(reload);

  return { transactions: txs, loading, error, reload };
}
