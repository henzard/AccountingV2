import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { EnvelopeEntity } from './EnvelopeEntity';

export class ArchiveEnvelopeUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly envelope: EnvelopeEntity,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(): Promise<Result<void>> {
    const now = new Date().toISOString();
    const repo = resolveSyncedRepo(this.db, 'envelopes', this.deps);

    try {
      repo.update(
        this.envelope.id,
        this.envelope.householdId,
        // better-sqlite3 only binds numbers/strings/bigints/buffers/null —
        // not JS booleans — so the boolean column is written as 1 (archived),
        // same convention as CreateEnvelopeUseCase/StartNewPeriodUseCase.
        { is_archived: 1, updated_at: now },
        resolveSyncedRepoCtx(this.deps),
      );
    } catch {
      return createFailure({
        code: 'ENVELOPE_NOT_FOUND',
        message: 'Envelope does not exist or was already deleted',
      });
    }

    await this.audit.log({
      householdId: this.envelope.householdId,
      entityType: 'envelope',
      entityId: this.envelope.id,
      action: 'archive',
      previousValue: { isArchived: false } as Record<string, unknown>,
      newValue: { isArchived: true } as Record<string, unknown>,
    });

    return createSuccess(undefined);
  }
}
