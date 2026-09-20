import { useState, useCallback, useRef } from 'react';
import { asc, eq } from 'drizzle-orm';
import { db } from '../../data/local/db';
import { debts as debtsTable } from '../../data/local/schema';
import type { DebtEntity } from '../../domain/debtSnowball/DebtEntity';
import { useReloadOnSync } from './useReloadOnSync';

export interface UseDebtsResult {
  debts: DebtEntity[];
  /** True only while the FIRST load of this hook instance is in flight (see
   * `useEnvelopes` for the full REG-9 note). */
  loading: boolean;
  /** True while a reload is in flight over data already on screen. */
  refreshing: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

export function useDebts(householdId: string): UseDebtsResult {
  const [debts, setDebts] = useState<DebtEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const loadedOnceRef = useRef(false);

  const reload = useCallback(async () => {
    if (loadedOnceRef.current) setRefreshing(true);
    else setLoading(true);
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
      loadedOnceRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [householdId]);

  // A partner's debt payment lands in local SQLite during a sync round;
  // without this the screen showed it only after navigating away and back.
  useReloadOnSync(reload);

  return { debts, loading, refreshing, error, reload };
}
