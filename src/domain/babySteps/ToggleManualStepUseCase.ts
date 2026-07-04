/**
 * ToggleManualStepUseCase — flips manual steps 4/5/7.
 *
 * Rejects non-manual step numbers (only 4/5/7 are allowed).
 *
 * Spec §ToggleManualStepUseCase.
 */

import { eq, and } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { babySteps } from '../../data/local/schema';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { MANUAL_STEP_NUMBERS } from './BabyStepRules';

export class ToggleManualStepUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly deps: SyncWriteDeps = {},
  ) {}

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

    const [row] = await this.db
      .select({ id: babySteps.id })
      .from(babySteps)
      .where(and(eq(babySteps.householdId, householdId), eq(babySteps.stepNumber, stepNumber)));
    if (!row) {
      return createFailure({
        code: 'STEP_NOT_FOUND',
        message: `Baby step ${stepNumber} not found for household ${householdId}`,
      });
    }

    const now = new Date().toISOString();
    const repo = resolveSyncedRepo(this.db, 'baby_steps', this.deps);
    repo.update(
      row.id,
      householdId,
      {
        is_completed: completed ? 1 : 0,
        completed_at: completed ? now : null,
        updated_at: now,
      },
      resolveSyncedRepoCtx(this.deps),
    );

    return createSuccess(undefined);
  }
}
