/**
 * ReconcileEmergencyFundTypeUseCase — oldest active emergency_fund wins.
 *
 * When multiple non-archived envelopes have type='emergency_fund' for a household,
 * the oldest by createdAt is kept. Others are flipped to 'savings' with isSynced=false.
 * Archived envelopes are skipped entirely.
 *
 * Triggered only after SyncOrchestrator.syncPending returns { failed: 0 }.
 *
 * Spec §ReconcileEmergencyFundTypeUseCase trigger.
 */

import { and, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { PendingSyncEnqueuerAdapter } from '../../data/repositories/PendingSyncEnqueuerAdapter';
import type { ISyncEnqueuer } from '../ports/ISyncEnqueuer';
import type { Result } from '../shared/types';
import { createSuccess } from '../shared/types';

export interface ReconcileEmergencyFundTypeResult {
  /** Number of envelopes flipped from emergency_fund to savings */
  flipped: number;
}

export class ReconcileEmergencyFundTypeUseCase {
  private readonly enqueuer: ISyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    enqueuer?: ISyncEnqueuer,
  ) {
    this.enqueuer = enqueuer ?? new PendingSyncEnqueuerAdapter(db);
  }

  async execute(householdId: string): Promise<Result<ReconcileEmergencyFundTypeResult>> {
    // 1. Find all non-archived emergency_fund envelopes, ordered by createdAt ASC
    const candidates = await this.db
      .select()
      .from(envelopes)
      .where(
        and(
          eq(envelopes.householdId, householdId),
          eq(envelopes.envelopeType, 'emergency_fund'),
          eq(envelopes.isArchived, false),
        ),
      );

    // Sort by createdAt ascending (oldest first)
    const sorted = [...candidates].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    if (sorted.length <= 1) {
      // Single EMF or none — no conflict
      return createSuccess({ flipped: 0 });
    }

    // 2. Keep the oldest; flip the rest to 'savings'
    const [, ...toFlip] = sorted;
    const now = new Date().toISOString();

    for (const envelope of toFlip) {
      await this.db
        .update(envelopes)
        .set({
          envelopeType: 'savings',
          updatedAt: now,
          isSynced: false,
        })
        .where(eq(envelopes.id, envelope.id));
      await this.enqueuer.enqueue('envelopes', envelope.id, 'UPDATE');
    }

    return createSuccess({ flipped: toFlip.length });
  }
}
