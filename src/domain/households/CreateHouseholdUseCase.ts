import { randomUUID } from 'expo-crypto';
import type { InferInsertModel } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { households, householdMembers } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuerAdapter } from '../../data/repositories/PendingSyncEnqueuerAdapter';
import { DrizzleHouseholdRepository } from '../../data/repositories/DrizzleHouseholdRepository';
import type { ISyncEnqueuer } from '../ports/ISyncEnqueuer';
import type { IHouseholdRepository } from '../ports/IHouseholdRepository';
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
  private readonly enqueuer: ISyncEnqueuer;
  private readonly repo: IHouseholdRepository;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: CreateHouseholdInput,
    enqueuer?: ISyncEnqueuer,
    repo?: IHouseholdRepository,
  ) {
    this.enqueuer = enqueuer ?? new PendingSyncEnqueuerAdapter(db);
    this.repo = repo ?? new DrizzleHouseholdRepository(db);
  }

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

    const newHousehold = {
      id: householdId,
      name,
      paydayDay: this.input.paydayDay,
      userLevel: 1,
      createdAt: now,
      updatedAt: now,
      isSynced: false,
    } satisfies InferInsertModel<typeof households>;
    await this.repo.insert(newHousehold);

    const memberId = randomUUID();
    const memberRow: InferInsertModel<typeof householdMembers> = {
      id: memberId,
      householdId,
      userId: this.input.userId,
      role: 'owner',
      joinedAt: now,
      updatedAt: now,
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
