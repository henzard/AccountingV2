import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '../../../data/local/db';
import { getCategoryHistory } from '../../../data/local/balances/CategoryHistoryQuery';
import {
  BASELINE_PERIOD_WINDOW,
  buildCategoryBaselines,
} from '../../../domain/forecasting/CategoryBaseline';
import type { CategoryBaseline } from '../../../domain/forecasting/CategoryBaseline';
import { useReloadOnSync } from '../../hooks/useReloadOnSync';

export interface UseForecastHistoryResult {
  /** Baselines keyed by `baselineKey(envelopeType, name)`; empty until loaded. */
  baselines: Map<string, CategoryBaseline>;
  /** True only while the FIRST load of this hook instance is in flight (REG-9). */
  loading: boolean;
  /** True while a reload runs over data already on screen (focus, sync round). */
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const EMPTY_BASELINES: Map<string, CategoryBaseline> = new Map();

/**
 * The forecast screen's history feed: the last `BASELINE_PERIOD_WINDOW`
 * CLOSED periods, aggregated per category in SQL and reduced to one baseline
 * each.
 *
 * `dayOfPeriod` is the current period's 1-based day, so the cumulative
 * "by day N you have usually spent R x" figure is cut at the same day the
 * projection is blended at (`getPeriodDayCounts` feeds both).
 *
 * Reloads on focus and on a completed sync round, like every other screen —
 * `useReloadOnSync` handles the latter.
 */
export function useForecastHistory(
  householdId: string,
  periodStart: string,
  dayOfPeriod: number,
): UseForecastHistoryResult {
  const [baselines, setBaselines] = useState<Map<string, CategoryBaseline>>(EMPTY_BASELINES);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedOnceRef = useRef(false);
  // REQUEST-SEQUENCE GUARD. Focus, a sync round and a period/day change can
  // each start a load, and SQLite reads are not guaranteed to resolve in the
  // order they were issued — an older, slower read must never overwrite a
  // newer result. Every load takes a ticket; only the newest ticket is
  // allowed to write state. Also doubles as the unmount guard (the effect
  // below bumps the ticket on teardown, so no setState lands after unmount).
  const requestSeqRef = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    if (loadedOnceRef.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const history = await getCategoryHistory(db, householdId, periodStart, {
        maxPeriods: BASELINE_PERIOD_WINDOW,
        throughDayOfPeriod: dayOfPeriod,
      });
      if (seq !== requestSeqRef.current) return;
      setBaselines(buildCategoryBaselines(history));
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load spending history');
    } finally {
      if (seq === requestSeqRef.current) {
        loadedOnceRef.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [householdId, periodStart, dayOfPeriod]);

  useEffect(() => {
    void reload();
    return () => {
      // Invalidates whatever is in flight: its ticket can no longer be the
      // newest, so it cannot setState after this hook is torn down.
      requestSeqRef.current += 1;
    };
  }, [reload]);

  useReloadOnSync(reload);

  return { baselines, loading, refreshing, error, reload };
}
