import { randomUUID } from 'expo-crypto';
import type { InferInsertModel } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { households, householdMembers } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuer } from '../../data/sync/PendingSyncEnqueuer';
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
  private readonly enqueuer: PendingSyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: CreateHouseholdInput,
  ) {
    this.enqueuer = new PendingSyncEnqueuer(db);
  }

  async execute(): Promise<Result<HouseholdSummary>> {
    const name = this.input.name.trim();
    if (!name) {
      return createFailure({ code: 'INVALID_NAME', message: 'Household name is required' });
    }
    if (this.input.paydayDay < 1 || this.input.paydayDay > 28) {
      return createFailure({ code: 'INVALID_PAYDAY', message: 'Payday day must be between 1 and 28' });
    }

    const now = new Date().toISOString();
    const householdId = randomUUID();

    const newHousehold: InferInsertModel<typeof households> = {
      id: householdId,
      name,
      paydayDay: this.input.paydayDay,
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
      userId: this.input.userId,
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
      newValue: { id: householdId, name, paydayDay: this.input.paydayDay },
    });

    await this.enqueuer.enqueue('households', householdId, 'INSERT');
    await this.enqueuer.enqueue('household_members', memberId, 'INSERT');

    // Seed the 7 baby steps for the new household (idempotent)
    const seeder = new SeedBabyStepsUseCase(this.db);
    await seeder.execute(householdId);

    return createSuccess({ id: householdId, name, paydayDay: this.input.paydayDay, userLevel: 1 });
  }
}
