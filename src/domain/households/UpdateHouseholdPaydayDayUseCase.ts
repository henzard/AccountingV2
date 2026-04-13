import { eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { households } from '../../data/local/schema';
import { PendingSyncEnqueuer } from '../../data/sync/PendingSyncEnqueuer';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

export class UpdateHouseholdPaydayDayUseCase {
  private readonly enqueuer: PendingSyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly householdId: string,
    private readonly paydayDay: number,
  ) {
    this.enqueuer = new PendingSyncEnqueuer(db);
  }

  async execute(): Promise<Result<void>> {
    if (this.paydayDay < 1 || this.paydayDay > 28) {
      return createFailure({
        code: 'INVALID_PAYDAY',
        message: 'Payday day must be between 1 and 28',
      });
    }

    const now = new Date().toISOString();
    await this.db
      .update(households)
      .set({ paydayDay: this.paydayDay, updatedAt: now, isSynced: false })
      .where(eq(households.id, this.householdId));

    await this.enqueuer.enqueue('households', this.householdId, 'UPDATE');

    return createSuccess(undefined);
  }
}
