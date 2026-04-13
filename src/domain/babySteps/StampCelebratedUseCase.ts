/**
 * StampCelebratedUseCase — sets celebrated_at = now, isSynced=false.
 *
 * Idempotent: if celebrated_at is already set, no-op (returns success).
 * Called from modal dismiss (both foreground and deferred-foreground paths).
 *
 * Spec §StampCelebratedUseCase, §celebrated_at is one-shot for life.
 */

import { and, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { babySteps } from '../../data/local/schema';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

export class StampCelebratedUseCase {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async execute(householdId: string, stepNumber: number): Promise<Result<void>> {
    // Read the current row to check idempotency
    const existing = await this.db
      .select()
      .from(babySteps)
      .where(and(eq(babySteps.householdId, householdId), eq(babySteps.stepNumber, stepNumber)));

    const row = existing[0];
    if (!row) {
      return createFailure({
        code: 'STEP_NOT_FOUND',
        message: `Baby step ${stepNumber} not found for household ${householdId}`,
      });
    }

    // Idempotent: if already stamped, no-op
    if (row.celebratedAt !== null) {
      return createSuccess(undefined);
    }

    const now = new Date().toISOString();

    await this.db
      .update(babySteps)
      .set({
        celebratedAt: now,
        updatedAt: now,
        isSynced: false,
      })
      .where(and(eq(babySteps.householdId, householdId), eq(babySteps.stepNumber, stepNumber)));

    return createSuccess(undefined);
  }
}
