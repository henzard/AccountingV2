import { randomUUID } from 'expo-crypto';
import { sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { runInUnitOfWork } from '../../data/uow/UnitOfWork';
import { insertRowWithinUow } from '../../data/uow/createSyncedRepo';
import { resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { HouseholdSummary } from './EnsureHouseholdUseCase';
import { SeedBabyStepsUseCase } from '../babySteps/SeedBabyStepsUseCase';

interface CreateHouseholdInput {
  userId: string;
  name: string;
  paydayDay: number;
}

export class CreateHouseholdUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: CreateHouseholdInput,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(): Promise<Result<HouseholdSummary>> {
    const name = this.input.name.trim();
    if (!name) {
      return createFailure({ code: 'INVALID_NAME', message: 'Household name is required' });
    }
    if (this.input.paydayDay < 1 || this.input.paydayDay > 28) {
      return createFailure({
        code: 'INVALID_PAYDAY',
        message: 'Payday day must be between 1 and 28',
      });
    }

    const now = new Date().toISOString();
    const householdId = randomUUID();
    const memberId = randomUUID();
    const ctx = resolveSyncedRepoCtx(this.deps);

    // Household + owner-membership creation MUST be atomic: a crash between the
    // two inserts would otherwise leave a household with no owner (unclaimable,
    // and — post 0002 — un-bootstrappable through sync_push). Both entity rows
    // and both oplog ops therefore commit inside ONE `runInUnitOfWork`
    // transaction, in the order the server's bootstrap authorization requires
    // (household insert op, then the owner household_members insert op).
    //
    // `households` has no `household_id` column — a household IS its own scope
    // (its `id` is the household id) — so it can't go through the generic
    // synced-repo insert (which requires a `row.household_id` distinct from
    // `row.id`). It is written raw here; the owner membership row DOES have a
    // `household_id`, so it uses `insertRowWithinUow` to share this same
    // transaction rather than opening a second one.
    runInUnitOfWork(this.db, (uow) => {
      uow.db.run(sql`
        INSERT INTO households (id, name, payday_day, user_level, created_at, updated_at)
        VALUES (${householdId}, ${name}, ${this.input.paydayDay}, 1, ${now}, ${now})
      `);
      uow.appendOp({
        opId: ctx.genId ? ctx.genId() : randomUUID(),
        householdId,
        tableName: 'households',
        rowId: householdId,
        opType: 'insert',
        payload: {
          id: householdId,
          name,
          payday_day: this.input.paydayDay,
          user_level: 1,
          created_at: now,
          updated_at: now,
        },
        actorUserId: ctx.actorUserId,
        deviceId: ctx.deviceId,
        clientCreatedAt: ctx.clock(),
      });

      insertRowWithinUow(
        uow,
        'household_members',
        {
          id: memberId,
          household_id: householdId,
          user_id: this.input.userId,
          role: 'owner',
          joined_at: now,
          updated_at: now,
        },
        ctx,
      );
    });

    await this.audit.log({
      householdId,
      entityType: 'household',
      entityId: householdId,
      action: 'create',
      previousValue: null,
      newValue: { id: householdId, name, paydayDay: this.input.paydayDay },
    });

    // Seed the 7 baby steps for the new household (idempotent)
    const seeder = new SeedBabyStepsUseCase(this.db, this.deps);
    await seeder.execute(householdId);

    return createSuccess({ id: householdId, name, paydayDay: this.input.paydayDay, userLevel: 1 });
  }
}
