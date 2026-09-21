import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { bestEffortAudit } from '../shared/bestEffortAudit';
import type { MeterReadingEntity } from './MeterReadingEntity';

/**
 * Soft-deletes a meter reading (F3: a typo'd reading — e.g. 18000 instead of
 * 1800 — passes `LogMeterReadingUseCase`'s validation as long as it is still
 * >= the previous reading and there is no later one yet, and otherwise
 * permanently corrupts that meter's consumption/rate history). Deleting is
 * the fix rather than editing: it produces a normal `delete` op that older
 * builds and the server already understand, atomically paired with setting
 * `meter_readings.deleted_at` via the synced repo (mirrors
 * `DeleteTransactionUseCase`).
 *
 * `createSyncedRepo.softDelete` throws when the row doesn't match (0 rows
 * affected — missing id, a different household's reading, or one already
 * deleted), which this use case turns into a `METER_READING_NOT_FOUND`
 * failure instead of silently no-op'ing or throwing.
 */
export class DeleteMeterReadingUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly reading: MeterReadingEntity,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(): Promise<Result<void>> {
    const repo = resolveSyncedRepo(this.db, 'meter_readings', this.deps);

    try {
      repo.softDelete(this.reading.id, this.reading.householdId, resolveSyncedRepoCtx(this.deps));
    } catch {
      return createFailure({
        code: 'METER_READING_NOT_FOUND',
        message: 'Meter reading does not exist or was already deleted',
      });
    }

    // The soft-delete above has already committed (entity row + oplog, one
    // SQLite transaction). Audit logging is secondary/best-effort from here
    // — if it throws, execute() must still succeed, otherwise a caller
    // retry would re-run the (already-applied) delete/oplog path against a
    // row that no longer matches, or mask a delete that genuinely worked.
    await bestEffortAudit(this.audit, {
      householdId: this.reading.householdId,
      entityType: 'meter_reading',
      entityId: this.reading.id,
      action: 'delete',
      previousValue: {
        id: this.reading.id,
        meterType: this.reading.meterType,
        readingValue: this.reading.readingValue,
        readingDate: this.reading.readingDate,
      },
      newValue: null,
    });

    return createSuccess(undefined);
  }
}
