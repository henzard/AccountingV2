import { eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuerAdapter } from '../../data/repositories/PendingSyncEnqueuerAdapter';
import type { ISyncEnqueuer } from '../ports/ISyncEnqueuer';
import type { Result } from '../shared/types';
import { createSuccess } from '../shared/types';
import type { EnvelopeEntity } from './EnvelopeEntity';

export class ArchiveEnvelopeUseCase {
  private readonly enqueuer: ISyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly envelope: EnvelopeEntity,
    enqueuer?: ISyncEnqueuer,
  ) {
    this.enqueuer = enqueuer ?? new PendingSyncEnqueuerAdapter(db);
  }

  async execute(): Promise<Result<void>> {
    const now = new Date().toISOString();
    await this.db
      .update(envelopes)
      .set({ isArchived: true, updatedAt: now, isSynced: false })
      .where(eq(envelopes.id, this.envelope.id));

    await this.audit.log({
      householdId: this.envelope.householdId,
      entityType: 'envelope',
      entityId: this.envelope.id,
      action: 'archive',
      previousValue: { isArchived: false } as Record<string, unknown>,
      newValue: { isArchived: true } as Record<string, unknown>,
    });

    await this.enqueuer.enqueue('envelopes', this.envelope.id, 'UPDATE');

    return createSuccess(undefined);
  }
}
