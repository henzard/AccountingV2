/**
 * ToggleManualStepUseCase — flips manual steps 4/5/7.
 *
 * Rejects non-manual step numbers (only 4/5/7 are allowed).
 * Always writes isSynced=false.
 *
 * Spec §ToggleManualStepUseCase.
 */

import { and, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { babySteps } from '../../data/local/schema';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { MANUAL_STEP_NUMBERS } from './BabyStepRules';

export class ToggleManualStepUseCase {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async execute(
    householdId: string,
    stepNumber: number,
    completed: boolean,
  ): Promise<Result<void>> {
    if (!MANUAL_STEP_NUMBERS.has(stepNumber)) {
      return createFailure({
        code: 'INVALID_STEP_NUMBER',
        message: `Step ${stepNumber} is not a manual step. Only steps 4, 5, and 7 can be toggled.`,
      });
    }

    const now = new Date().toISOString();

    await this.db
      .update(babySteps)
      .set({
        isCompleted: completed,
        completedAt: completed ? now : null,
        updatedAt: now,
        isSynced: false,
      })
      .where(and(eq(babySteps.householdId, householdId), eq(babySteps.stepNumber, stepNumber)));

    return createSuccess(undefined);
  }
}
