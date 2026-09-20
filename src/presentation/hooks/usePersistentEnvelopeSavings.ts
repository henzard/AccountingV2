/**
 * usePersistentEnvelopeSavings — derived SAVED balance per persistent
 * envelope ('sinking_fund' | 'emergency_fund' | 'savings' | 'baby_step').
 *
 * A persistent envelope's `allocatedCents` is the MONTHLY contribution the
 * household budgets, never a balance, so any screen showing "saved so far"
 * must read it from the contribution ledger instead — see
 * `getPersistentEnvelopeSavedCents`.
 *
 * Also runs the one-off legacy opening-balance backfill before reading, so a
 * fund that predates the ledger keeps showing the money it already had — and
 * only that money: the backfill MOVES the legacy `allocatedCents` into the
 * ledger and leaves the column at 0, because on those rows it was the saved
 * balance rather than a monthly contribution (see `ensureOpeningBalances`).
 *
 * The backfill is idempotent (deterministic row ids) and coalesced per
 * household, so the three calls the dashboard makes on first mount share one
 * write and every later call writes nothing.
 */

import { useCallback, useEffect, useState } from 'react';
import { db } from '../../data/local/db';
import { getPersistentEnvelopeSavedCents } from '../../data/local/balances/EnvelopeBalanceQuery';
import { ensureOpeningBalances } from '../../domain/budgets/PersistentContributions';

export interface UsePersistentEnvelopeSavingsResult {
  /** Envelope id -> saved cents. Empty until the first load resolves. */
  savedCentsByEnvelopeId: ReadonlyMap<string, number>;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

export function usePersistentEnvelopeSavings(
  householdId: string,
): UsePersistentEnvelopeSavingsResult {
  const [savedCentsByEnvelopeId, setSaved] = useState<ReadonlyMap<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (householdId === '') {
      setSaved(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const opening = await ensureOpeningBalances(db, householdId);
      if (!opening.success) {
        throw new Error(opening.error.message);
      }
      setSaved(await getPersistentEnvelopeSavedCents(db, householdId));
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { savedCentsByEnvelopeId, loading, error, reload };
}
