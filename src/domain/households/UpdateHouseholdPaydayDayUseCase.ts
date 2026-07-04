import { randomUUID } from 'expo-crypto';
import { sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { runInUnitOfWork } from '../../data/uow/UnitOfWork';
import { resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

export class UpdateHouseholdPaydayDayUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly householdId: string,
    private readonly paydayDay: number,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(): Promise<Result<void>> {
    if (this.paydayDay < 1 || this.paydayDay > 28) {
      return createFailure({
        code: 'INVALID_PAYDAY',
        message: 'Payday day must be between 1 and 28',
      });
    }

    const now = new Date().toISOString();
    const ctx = resolveSyncedRepoCtx(this.deps);

    // `households` has no `household_id` column (see CreateHouseholdUseCase's
    // matching comment) — a household's own `id` IS its scope — so this
    // drives `runInUnitOfWork` directly rather than `createSyncedRepo.update`,
    // which always scopes its WHERE clause by a `household_id` column.
    runInUnitOfWork(this.db, (uow) => {
      uow.db.run(sql`
        UPDATE households SET payday_day = ${this.paydayDay}, updated_at = ${now}
        WHERE id = ${this.householdId}
      `);
      uow.appendOp({
        opId: ctx.genId ? ctx.genId() : randomUUID(),
        householdId: this.householdId,
        tableName: 'households',
        rowId: this.householdId,
        opType: 'update',
        payload: { payday_day: this.paydayDay, updated_at: now },
        actorUserId: ctx.actorUserId,
        deviceId: ctx.deviceId,
        clientCreatedAt: ctx.clock(),
      });
    });

    return createSuccess(undefined);
  }
}
