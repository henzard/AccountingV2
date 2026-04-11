import { useState, useCallback } from 'react';
import { asc, eq } from 'drizzle-orm';
import { db } from '../../data/local/db';
import { debts as debtsTable } from '../../data/local/schema';
import type { DebtEntity } from '../../domain/debtSnowball/DebtEntity';

export interface UseDebtsResult {
  debts: DebtEntity[];
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

export function useDebts(householdId: string): UseDebtsResult {
  const [debts, setDebts] = useState<DebtEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await db
        .select()
        .from(debtsTable)
        .where(eq(debtsTable.householdId, householdId))
        .orderBy(asc(debtsTable.sortOrder));
      setDebts(rows as DebtEntity[]);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  return { debts, loading, error, reload };
}
