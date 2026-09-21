import { randomUUID } from 'expo-crypto';
import { eq, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { households } from '../../data/local/schema';
import { runInUnitOfWork } from '../../data/uow/UnitOfWork';
import { resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { MAX_LEVEL } from './LevelAdvancementEvaluator';

export interface PersistUserLevelInput {
  householdId: string;
  /** The level the household's score history has earned. */
  level: 1 | 2 | 3;
}

export interface PersistUserLevelOutput {
  /** The level stored after this call — never lower than it was before. */
  level: number;
  /** false when the stored level already met or exceeded `level` (nothing written). */
  changed: boolean;
}

/**
 * PersistUserLevelUseCase — the only writer of `households.user_level`.
 *
 * Until this existed, `user_level` was written exactly once, by
 * `CreateHouseholdUseCase`'s INSERT, and never again: `useLevelAdvancement`
 * pushed the earned level into `appStore`, which has no persist middleware,
 * so the badge reset to Lv1 on every cold start and the level never reached
 * the household's other devices at all.
 *
 * SYNCED WRITE. `households` IS on the server's `apply_one_op` allowlist
 * (`c_tables`, latest body in `supabase/migrations/0009_slip_attempts_rate_limit.sql`),
 * and `user_level` is an existing column on it — no schema change is involved
 * here, only a column that was already there finally being written. It
 * therefore goes through `runInUnitOfWork` + `appendOp`, exactly like
 * `UpdateHouseholdPaydayDayUseCase`'s payday write, which is the one other
 * place a `households` column is updated. (That use case also documents why
 * this drives the unit of work directly instead of `updateRowWithinUow`:
 * `households` has no `household_id` column — a household's own `id` IS its
 * scope.)
 *
 * NEVER DEMOTES. A level is earned, not rented: a backfill that computes an
 * older, lower level for a partially-synced history must not take away a
 * level this household already reached on another device. `level` is treated
 * as a floor, and a call asking for the same or a lower level writes NOTHING
 * — no row touched, no oplog op, so a boot that re-derives the same level
 * does not push a redundant op on every start.
 */
export class PersistUserLevelUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(input: PersistUserLevelInput): Promise<Result<PersistUserLevelOutput>> {
    try {
      if (input.level < 1 || input.level > MAX_LEVEL) {
        return createFailure({
          code: 'INVALID_LEVEL',
          message: `User level must be between 1 and ${MAX_LEVEL}`,
        });
      }

      const [row] = await this.db
        .select({ userLevel: households.userLevel })
        .from(households)
        .where(eq(households.id, input.householdId));

      if (row === undefined) {
        return createFailure({
          code: 'HOUSEHOLD_NOT_FOUND',
          message: 'Household not found',
        });
      }

      if (row.userLevel >= input.level) {
        return createSuccess({ level: row.userLevel, changed: false });
      }

      const ctx = resolveSyncedRepoCtx(this.deps);
      const now = ctx.clock();

      runInUnitOfWork(this.db, (uow) => {
        uow.db.run(sql`
          UPDATE households SET user_level = ${input.level}, updated_at = ${now}
          WHERE id = ${input.householdId}
        `);
        uow.appendOp({
          opId: ctx.genId ? ctx.genId() : randomUUID(),
          householdId: input.householdId,
          tableName: 'households',
          rowId: input.householdId,
          opType: 'update',
          payload: { user_level: input.level, updated_at: now },
          actorUserId: ctx.actorUserId,
          deviceId: ctx.deviceId,
          clientCreatedAt: ctx.clock(),
        });
      });

      return createSuccess({ level: input.level, changed: true });
    } catch (err) {
      return createFailure({
        code: 'persist_user_level_failed',
        message: err instanceof Error ? err.message : 'Failed to persist user level',
      });
    }
  }
}
