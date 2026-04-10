import { useState, useEffect, useCallback } from 'react';
import { eq, and } from 'drizzle-orm';
import { db } from '../../data/local/db';
import { envelopes as envelopesTable } from '../../data/local/schema';
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
      const rows = await db
        .select()
        .from(envelopesTable)
        .where(
          and(
            eq(envelopesTable.householdId, householdId),
            eq(envelopesTable.periodStart, periodStart),
            eq(envelopesTable.isArchived, false),
          ),
        );
      setEnvelopes(rows as EnvelopeEntity[]);
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
