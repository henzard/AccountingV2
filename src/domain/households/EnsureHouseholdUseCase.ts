import { randomUUID } from 'expo-crypto';
import { eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { households, householdMembers } from '../../data/local/schema';
import { runInUnitOfWork } from '../../data/uow/UnitOfWork';
import { insertRowWithinUow } from '../../data/uow/createSyncedRepo';
import { resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { SeedBabyStepsUseCase } from '../babySteps/SeedBabyStepsUseCase';

export interface HouseholdSummary {
  id: string;
  name: string;
  paydayDay: number;
  userLevel: 1 | 2 | 3;
}

export class EnsureHouseholdUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly userId: string,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(): Promise<Result<HouseholdSummary>> {
    // 1. Check if user already has a membership row
    const [membership] = await this.db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, this.userId))
      .limit(1);

    if (membership) {
      const [hh] = await this.db
        .select()
        .from(households)
        .where(eq(households.id, membership.householdId))
        .limit(1);
      if (hh) {
        // Seed baby steps for existing household (idempotent — fills any gaps)
        const seeder = new SeedBabyStepsUseCase(this.db, this.deps);
        await seeder.execute(hh.id);
        return createSuccess({
          id: hh.id,
          name: hh.name,
          paydayDay: hh.paydayDay,
          userLevel: hh.userLevel as 1 | 2 | 3,
        });
      }
    }

    // 2. Check for legacy household where id = userId
    const [legacy] = await this.db
      .select()
      .from(households)
      .where(eq(households.id, this.userId))
      .limit(1);

    const now = new Date().toISOString();

    if (legacy) {
      const memberId = randomUUID();
      const ctx = resolveSyncedRepoCtx(this.deps);

      // L1 (exhaustive audit): the household catch-up op and the owner
      // membership insert used to run in TWO separate `runInUnitOfWork`
      // transactions, member-before-household — the reverse of the order
      // CreateHouseholdUseCase's atomic transaction documents as required
      // for server bootstrap (household op must land before/with the member
      // op). A crash between the two transactions could leave the member
      // row + its op committed with the household catch-up op never
      // appended, permanently orphaning the membership server-side. Both
      // now commit in ONE transaction, household op first, mirroring
      // CreateHouseholdUseCase's ordering exactly.
      //
      // The `legacy` household row itself already exists locally (created
      // before this device ever had sync) — there is nothing to (re)insert
      // into the local `households` table, only an oplog `insert` op
      // carrying its full snapshot so the server (which has never seen it)
      // can (re)create it there — see task-1-report.md, "household"
      // section. The owner membership row DOES need a literal local insert,
      // so it uses `insertRowWithinUow` to share this same transaction
      // rather than opening a second one (same primitive
      // CreateHouseholdUseCase uses for its owner-membership insert).
      runInUnitOfWork(this.db, (uow) => {
        uow.appendOp({
          opId: ctx.genId ? ctx.genId() : randomUUID(),
          householdId: legacy.id,
          tableName: 'households',
          rowId: legacy.id,
          opType: 'insert',
          payload: {
            id: legacy.id,
            name: legacy.name,
            payday_day: legacy.paydayDay,
            user_level: legacy.userLevel,
            created_at: legacy.createdAt,
            updated_at: legacy.updatedAt,
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
            household_id: legacy.id,
            user_id: this.userId,
            role: 'owner',
            joined_at: now,
            updated_at: now,
          },
          ctx,
        );
      });

      // Seed baby steps for legacy household (idempotent — fills any gaps)
      const seeder = new SeedBabyStepsUseCase(this.db, this.deps);
      await seeder.execute(legacy.id);

      return createSuccess({
        id: legacy.id,
        name: legacy.name,
        paydayDay: legacy.paydayDay,
        userLevel: legacy.userLevel as 1 | 2 | 3,
      });
    }

    // 3. No existing membership and no legacy household.
    // Return failure so the navigator shows the create/join choice screen.
    // Household creation is now explicit — triggered by CreateHouseholdUseCase
    // when the user taps "Create Household", or by AcceptInviteUseCase when
    // the user enters an invite code.
    return createFailure({ code: 'no_household', message: 'no_household' });
  }
}
