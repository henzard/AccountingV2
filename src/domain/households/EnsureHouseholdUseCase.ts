import { randomUUID } from 'expo-crypto';
import { eq } from 'drizzle-orm';
import type { InferInsertModel } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { households, householdMembers } from '../../data/local/schema';
import { PendingSyncEnqueuerAdapter } from '../../data/repositories/PendingSyncEnqueuerAdapter';
import type { ISyncEnqueuer } from '../ports/ISyncEnqueuer';
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
  private readonly enqueuer: ISyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly userId: string,
    enqueuer?: ISyncEnqueuer,
  ) {
    this.enqueuer = enqueuer ?? new PendingSyncEnqueuerAdapter(db);
  }

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
        const seeder = new SeedBabyStepsUseCase(this.db);
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
      const memberRow: InferInsertModel<typeof householdMembers> = {
        id: memberId,
        householdId: legacy.id,
        userId: this.userId,
        role: 'owner',
        joinedAt: now,
        updatedAt: now,
      };
      await this.db.insert(householdMembers).values(memberRow);
      await this.enqueuer.enqueue('household_members', memberId, 'INSERT');
      await this.enqueuer.enqueue('households', legacy.id, 'INSERT');

      // Seed baby steps for legacy household (idempotent — fills any gaps)
      const seeder = new SeedBabyStepsUseCase(this.db);
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
