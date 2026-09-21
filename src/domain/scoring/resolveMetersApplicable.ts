import { sql } from 'drizzle-orm';
import type { EnvelopeBalanceDb } from '../../data/local/balances/EnvelopeBalanceQuery';

interface MeterReadingIdRow {
  id: string;
}

/**
 * Whether the METERS component applies to `householdId` for a period ending
 * `periodEnd` — i.e. whether they had EVER logged a meter reading by then.
 *
 * Deliberately "on or before the period's end", not "inside the period":
 *  - A household that has never touched the feature is not being marked down
 *    for it, in any period. Meters are optional, and an all-or-nothing 20 of
 *    100 points they cannot win is a ceiling of 80 that makes the level
 *    thresholds unreachable no matter how disciplined they are.
 *  - From the period in which they FIRST log a reading onwards, the
 *    component applies exactly as it always has (all-or-nothing 20 for a
 *    reading inside that period) — so a household that starts using meters
 *    and then stops is scored on it, which is the point of the component.
 *  - Anchoring on the period's END rather than "ever" keeps a backfill
 *    deterministic: rescoring 2025's periods must not change just because a
 *    reading was logged in 2026.
 */
export async function resolveMetersApplicable(
  db: EnvelopeBalanceDb,
  householdId: string,
  periodEnd: string,
): Promise<boolean> {
  const rows = (await db.all(
    sql`SELECT id FROM meter_readings
        WHERE household_id = ${householdId}
          AND reading_date <= ${periodEnd}
          AND deleted_at IS NULL
        LIMIT 1`,
  )) as MeterReadingIdRow[];
  return rows.length > 0;
}
