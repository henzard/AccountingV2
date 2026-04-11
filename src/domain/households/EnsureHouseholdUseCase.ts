import { randomUUID } from 'expo-crypto';
import { eq } from 'drizzle-orm';
import type { InferInsertModel } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { households, householdMembers } from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuer } from '../../data/sync/PendingSyncEnqueuer';
import type { Result } from '../shared/types';
import { createSuccess } from '../shared/types';

export interface HouseholdSummary {
  id: string;
  name: string;
  paydayDay: number;
  userLevel: 1 | 2 | 3;
}

export class EnsureHouseholdUseCase {
  private readonly enqueuer: PendingSyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly userId: string,
  ) {
    this.enqueuer = new PendingSyncEnqueuer(db);
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
      };
      await this.db.insert(householdMembers).values(memberRow);
      await this.enqueuer.enqueue('household_members', memberId, 'INSERT');
      await this.enqueuer.enqueue('households', legacy.id, 'INSERT');
      return createSuccess({
        id: legacy.id,
        name: legacy.name,
        paydayDay: legacy.paydayDay,
        userLevel: legacy.userLevel as 1 | 2 | 3,
      });
    }

    // 3. Create new household with UUID + membership
    const householdId = randomUUID();
    const newHousehold: InferInsertModel<typeof households> = {
      id: householdId,
      name: 'My Household',
      paydayDay: 25,
      userLevel: 1,
      createdAt: now,
      updatedAt: now,
      isSynced: false,
    };
    await this.db.insert(households).values(newHousehold);

    const memberId = randomUUID();
    const memberRow: InferInsertModel<typeof householdMembers> = {
      id: memberId,
      householdId,
      userId: this.userId,
      role: 'owner',
      joinedAt: now,
    };
    await this.db.insert(householdMembers).values(memberRow);

    await this.audit.log({
      householdId,
      entityType: 'household',
      entityId: householdId,
      action: 'create',
      previousValue: null,
      newValue: { id: householdId, name: newHousehold.name, paydayDay: newHousehold.paydayDay },
    });

    await this.enqueuer.enqueue('households', householdId, 'INSERT');
    await this.enqueuer.enqueue('household_members', memberId, 'INSERT');

    return createSuccess({
      id: householdId,
      name: newHousehold.name,
      paydayDay: newHousehold.paydayDay ?? 25,
      userLevel: 1,
    });
  }
}
