import { useState, useCallback } from 'react';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../../data/local/db';
import { meterReadings as meterReadingsTable } from '../../data/local/schema';
import type { MeterReadingEntity, MeterType } from '../../domain/meterReadings/MeterReadingEntity';

export interface UseMeterReadingsResult {
  readings: MeterReadingEntity[];
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

export function useMeterReadings(
  householdId: string,
  meterType: MeterType,
  limit = 24,
): UseMeterReadingsResult {
  const [readings, setReadings] = useState<MeterReadingEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await db
        .select()
        .from(meterReadingsTable)
        .where(
          and(
            eq(meterReadingsTable.householdId, householdId),
            eq(meterReadingsTable.meterType, meterType),
          ),
        )
        .orderBy(desc(meterReadingsTable.readingDate))
        .limit(limit);
      setReadings(rows as MeterReadingEntity[]);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [householdId, meterType, limit]);

  return { readings, loading, error, reload };
}
