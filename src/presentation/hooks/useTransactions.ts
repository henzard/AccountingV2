import { useState, useCallback } from 'react';
import { and, eq, gte, desc } from 'drizzle-orm';
import { db } from '../../data/local/db';
import { transactions as transactionsTable } from '../../data/local/schema';
import type { TransactionEntity } from '../../domain/transactions/TransactionEntity';

export interface UseTransactionsResult {
  transactions: TransactionEntity[];
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

export function useTransactions(householdId: string, periodStart: string): UseTransactionsResult {
  const [txs, setTxs] = useState<TransactionEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await db
        .select()
        .from(transactionsTable)
        .where(
          and(
            eq(transactionsTable.householdId, householdId),
            gte(transactionsTable.transactionDate, periodStart),
          ),
        )
        .orderBy(desc(transactionsTable.transactionDate));
      setTxs(rows as TransactionEntity[]);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [householdId, periodStart]);

  return { transactions: txs, loading, error, reload };
}
