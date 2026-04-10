import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';
import type { InferInsertModel } from 'drizzle-orm';
import type * as schema from '../../data/local/schema';
import { households } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import type { Result } from '../shared/types';
import { createSuccess } from '../shared/types';

export interface HouseholdSummary {
  id: string;
  name: string;
  paydayDay: number;
  userLevel: 1 | 2 | 3;
}

export class EnsureHouseholdUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly userId: string,
  ) {}

  async execute(): Promise<Result<HouseholdSummary>> {
    const [existing] = await this.db
      .select()
      .from(households)
      .where(eq(households.id, this.userId))
      .limit(1);

    if (existing) {
      return createSuccess({
        id: existing.id,
        name: existing.name,
        paydayDay: existing.paydayDay,
        userLevel: existing.userLevel as 1 | 2 | 3,
      });
    }

    const now = new Date().toISOString();
    // paydayDay defaults to 25 (end-of-month) matching typical SA salary schedule.
    // The DB column default of 1 is a fallback only — app always sets this via use case.
    const newHousehold: InferInsertModel<typeof households> = {
      id: this.userId,
      name: 'My Household',
      paydayDay: 25,
      userLevel: 1,
      createdAt: now,
      updatedAt: now,
      isSynced: false,
    };

    await this.db.insert(households).values(newHousehold);
    await this.audit.log({
      householdId: this.userId,
      entityType: 'household',
      entityId: this.userId,
      action: 'create',
      previousValue: null,
      newValue: newHousehold as Record<string, unknown>,
    });

    return createSuccess({
      id: newHousehold.id,
      name: newHousehold.name,
      paydayDay: newHousehold.paydayDay ?? 25,
      userLevel: (newHousehold.userLevel ?? 1) as 1 | 2 | 3,
    });
  }
}
