/**
 * ReconcileEmergencyFundTypeUseCase — oldest active emergency_fund wins.
 *
 * When multiple non-archived envelopes have type='emergency_fund' for a household,
 * the oldest by createdAt is kept. Others are flipped to 'savings'.
 * Archived envelopes are skipped entirely.
 *
 * Kept (not deleted) as of slice 5 task 6 — verified this remains a live,
 * load-bearing backstop for the cross-device duplicate-EMF race (see
 * `.superpowers/sdd/task-6-report.md`): the slice-4 create-time guard +
 * local unique index (`0013_emf_unique.sql`) only close the SAME-DEVICE
 * half of the race; two offline devices each creating their own
 * `emergency_fund` envelope before either syncs still produce two active
 * rows today.
 *
 * Previously triggered only after the OLD `SyncOrchestrator.syncPending`
 * returned `{ failed: 0 }`. That call site was deleted with the rest of
 * SyncOrchestrator (slice 5 task 6) and re-wired onto the new engine: it now
 * runs from `SyncScheduler`'s `onSyncSuccess` hook (see `App.tsx`'s
 * `ensureSyncRuntime()`) after every successful `SyncEngine.sync()` round —
 * a looser gate than the old exact `{failed: 0}` requirement, but
 * idempotent, so an opportunistic re-run on a partially-clean round is
 * harmless and self-correcting on the next successful round.
 *
 * Spec §ReconcileEmergencyFundTypeUseCase trigger.
 */

import { and, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess } from '../shared/types';

export interface ReconcileEmergencyFundTypeResult {
  /** Number of envelopes flipped from emergency_fund to savings */
  flipped: number;
}

export class ReconcileEmergencyFundTypeUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly deps: SyncWriteDeps = {},
  ) {}

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
    const repo = resolveSyncedRepo(this.db, 'envelopes', this.deps);
    const ctx = resolveSyncedRepoCtx(this.deps);

    for (const envelope of toFlip) {
      repo.update(envelope.id, householdId, { envelope_type: 'savings', updated_at: now }, ctx);
    }

    return createSuccess({ flipped: toFlip.length });
  }
}
