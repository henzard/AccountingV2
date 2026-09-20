import { useState, useEffect, useCallback, useRef } from 'react';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../data/local/db';
import { envelopes as envelopesTable } from '../../data/local/schema';
import {
  getEnvelopeSpentCents,
  envelopeScopeCondition,
} from '../../data/local/balances/EnvelopeBalanceQuery';
import type { EnvelopeEntity } from '../../domain/envelopes/EnvelopeEntity';
import { useReloadOnSync } from './useReloadOnSync';

export interface UseEnvelopesResult {
  envelopes: EnvelopeEntity[];
  /** True only while the FIRST load of this hook instance is in flight —
   * i.e. "there is nothing to show yet". Screens render their skeleton on
   * this. See `refreshing` for every reload after that (REG-9). */
  loading: boolean;
  /** True while a RELOAD is in flight over data that is already on screen
   * (a sync round via `useReloadOnSync`, a pull-to-refresh, a period
   * switch). Screens must keep rendering the current list and show at most a
   * subtle indicator — flipping `loading` here replaced the whole list with
   * skeletons ~1s after every save, losing scroll position. */
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useEnvelopes(householdId: string, periodStart: string): UseEnvelopesResult {
  const [envelopes, setEnvelopes] = useState<EnvelopeEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether a load has ever completed (success OR failure) for this hook
  // instance — the one thing that separates "nothing to show yet" from
  // "refreshing what is already shown".
  const loadedOnceRef = useRef(false);

  const reload = useCallback(async () => {
    if (loadedOnceRef.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      // Scope must match DrizzleEnvelopeRepository.listByHousehold /
      // getEnvelopeSpentCents: a raw `eq(periodStart, periodStart)` here used
      // to permanently exclude persistent envelope types (sinking_fund,
      // emergency_fund, savings, baby_step) from every period after the one
      // they were created in, since those rows are never re-created per
      // period and their `period_start` never advances. See
      // EnvelopeBalanceQuery.envelopeScopeCondition for the scope rule.
      const rows = await db
        .select()
        .from(envelopesTable)
        .where(
          and(
            eq(envelopesTable.householdId, householdId),
            isNull(envelopesTable.deletedAt),
            eq(envelopesTable.isArchived, false),
            envelopeScopeCondition(periodStart),
          ),
        );
      // spentCents is derived from the transaction ledger, not a stored column.
      const spentByEnvelope = await getEnvelopeSpentCents(db, householdId, periodStart);
      setEnvelopes(
        rows.map((row) => ({
          ...row,
          spentCents: spentByEnvelope.get(row.id) ?? 0,
        })) as EnvelopeEntity[],
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load envelopes');
    } finally {
      loadedOnceRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [householdId, periodStart]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A partner's envelope change lands in local SQLite during a sync round;
  // without this the screen showed it only after navigating away and back.
  useReloadOnSync(reload);

  return { envelopes, loading, refreshing, error, reload };
}
