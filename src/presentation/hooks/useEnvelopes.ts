import { useState, useEffect, useCallback } from 'react';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../data/local/db';
import { envelopes as envelopesTable } from '../../data/local/schema';
import {
  getEnvelopeSpentCents,
  envelopeScopeCondition,
} from '../../data/local/balances/EnvelopeBalanceQuery';
import type { EnvelopeEntity } from '../../domain/envelopes/EnvelopeEntity';

export interface UseEnvelopesResult {
  envelopes: EnvelopeEntity[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useEnvelopes(householdId: string, periodStart: string): UseEnvelopesResult {
  const [envelopes, setEnvelopes] = useState<EnvelopeEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, [householdId, periodStart]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { envelopes, loading, error, reload };
}
