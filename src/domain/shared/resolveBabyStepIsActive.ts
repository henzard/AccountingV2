/**
 * resolveBabyStepIsActive — returns true if any baby step is completed for a household.
 *
 * Returns false when no rows exist (seeder not yet run or empty state).
 * Used by the RamseyScoreCalculator caller to determine the babyStepIsActive input.
 *
 * Spec §Scoring integration, §resolveBabyStepIsActive.
 */

import { and, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { babySteps } from '../../data/local/schema';

export async function resolveBabyStepIsActive(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(babySteps)
    .where(
      and(
        eq(babySteps.householdId, householdId),
        eq(babySteps.isCompleted, true),
      ),
    );

  return rows.length > 0;
}
