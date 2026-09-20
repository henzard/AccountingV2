import { useState, useCallback, useRef } from 'react';
import { and, asc, eq, isNull } from 'drizzle-orm';
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
      // Excludes soft-deleted debts (a tombstone from this device or a
      // partner's) — without this, a deleted debt stayed in the live list
      // and projection forever, while RolloverWizard's snapshot (which does
      // filter `deletedAt`) silently used a DIFFERENT debt set than the
      // dashboard/Snowball screens it's compared against.
      const rows = await db
        .select()
        .from(debtsTable)
        .where(and(eq(debtsTable.householdId, householdId), isNull(debtsTable.deletedAt)))
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
