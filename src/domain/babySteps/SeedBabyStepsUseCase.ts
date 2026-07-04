/**
 * SeedBabyStepsUseCase — inserts any missing baby step rows (1-7) for a household.
 *
 * Idempotent under concurrent invocation because:
 * - The unique index on (household_id, step_number) means the DB enforces dedup.
 * - Each insert is pre-checked against existing rows, and a same-device race that
 *   slips past that check (two overlapping `execute()` calls) hits the unique
 *   index instead — caught via `isUniqueConstraintError` and treated as a no-op,
 *   the same pattern `CreateEnvelopeUseCase`'s EMF guard uses.
 *
 * Spec §Seeding:
 * - isManual=true for steps 4/5/7
 */

import { randomUUID } from 'expo-crypto';
import { eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { babySteps } from '../../data/local/schema';
import { MANUAL_STEP_NUMBERS } from './BabyStepRules';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import { isUniqueConstraintError } from '../../data/uow/createSyncedRepo';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

export class SeedBabyStepsUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(householdId: string): Promise<Result<void>> {
    try {
      const existing = await this.db
        .select({ stepNumber: babySteps.stepNumber })
        .from(babySteps)
        .where(eq(babySteps.householdId, householdId));
      const existingSteps = new Set(existing.map((r) => r.stepNumber));

      const now = new Date().toISOString();
      const repo = resolveSyncedRepo(this.db, 'baby_steps', this.deps);
      const ctx = resolveSyncedRepoCtx(this.deps);

      for (const stepNumber of [1, 2, 3, 4, 5, 6, 7] as const) {
        if (existingSteps.has(stepNumber)) continue;

        const row: Record<string, unknown> = {
          id: randomUUID(),
          household_id: householdId,
          step_number: stepNumber,
          is_completed: 0,
          completed_at: null,
          is_manual: MANUAL_STEP_NUMBERS.has(stepNumber) ? 1 : 0,
          celebrated_at: null,
          created_at: now,
          updated_at: now,
        };

        try {
          repo.insert(row, ctx);
        } catch (err) {
          // A same-device race (two overlapping execute() calls) can slip
          // past the existence check above and both attempt to insert the
          // same (household_id, step_number) row; the unique index rejects
          // the loser. That's the expected idempotent outcome here, not a
          // real error — swallow it exactly like CreateEnvelopeUseCase's EMF
          // duplicate guard does.
          if (!isUniqueConstraintError(err)) throw err;
        }
      }

      return createSuccess(undefined);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return createFailure({ code: 'DB_ERROR', message });
    }
  }
}
