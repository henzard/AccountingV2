import { sql } from 'drizzle-orm';
import type { EnvelopeBalanceDb } from '../../../data/local/balances/EnvelopeBalanceQuery';

interface MeterReadingIdRow {
  id: string;
}

/**
 * True when at least one non-deleted meter reading was logged with a
 * `reading_date` inside [periodStart, periodEnd] for the household — the
 * real input `HabitScoreCalculator`'s `meterReadingsLoggedThisPeriod` flag
 * expects. Replaces a hardcoded `false`, which made that flag's 20 points
 * permanently unreachable regardless of what the household actually logged.
 */
export async function resolveMeterReadingsLogged(
  db: EnvelopeBalanceDb,
  householdId: string,
  periodStart: string,
  periodEnd: string,
): Promise<boolean> {
  const rows = (await db.all(
    sql`SELECT id FROM meter_readings
        WHERE household_id = ${householdId}
          AND reading_date >= ${periodStart}
          AND reading_date <= ${periodEnd}
          AND deleted_at IS NULL
        LIMIT 1`,
  )) as MeterReadingIdRow[];
  return rows.length > 0;
}
