/**
 * SeedBabyStepsUseCase — INSERT OR IGNORE for all 7 baby step rows.
 *
 * Idempotent under concurrent invocation because:
 * - The unique index on (household_id, step_number) means the DB enforces dedup.
 * - INSERT OR IGNORE / onConflictDoNothing() will not throw on duplicate.
 *
 * Spec §Seeding:
 * - isManual=true for steps 4/5/7
 * - isSynced=false on insert
 */

import { randomUUID } from 'expo-crypto';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { babySteps } from '../../data/local/schema';
import { MANUAL_STEP_NUMBERS } from './BabyStepRules';

export class SeedBabyStepsUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
  ) {}

  async execute(householdId: string): Promise<void> {
    const now = new Date().toISOString();

    const rows = ([1, 2, 3, 4, 5, 6, 7] as const).map((stepNumber) => ({
      id: randomUUID(),
      householdId,
      stepNumber,
      isCompleted: false,
      completedAt: null,
      isManual: MANUAL_STEP_NUMBERS.has(stepNumber),
      celebratedAt: null,
      createdAt: now,
      updatedAt: now,
      isSynced: false,
    }));

    // INSERT OR IGNORE — safe under concurrent invocation
    for (const row of rows) {
      await this.db
        .insert(babySteps)
        .values(row)
        .onConflictDoNothing();
    }
  }
}
