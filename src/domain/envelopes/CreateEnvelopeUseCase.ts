import { randomUUID } from 'expo-crypto';
import type { InferInsertModel } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuerAdapter } from '../../data/repositories/PendingSyncEnqueuerAdapter';
import type { ISyncEnqueuer } from '../ports/ISyncEnqueuer';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { EnvelopeEntity, EnvelopeType } from './EnvelopeEntity';

interface CreateEnvelopeInput {
  householdId: string;
  name: string;
  allocatedCents: number;
  envelopeType: EnvelopeType;
  periodStart: string;
}

export class CreateEnvelopeUseCase {
  private readonly enqueuer: ISyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: CreateEnvelopeInput,
    enqueuer?: ISyncEnqueuer,
  ) {
    this.enqueuer = enqueuer ?? new PendingSyncEnqueuerAdapter(db);
  }

  async execute(): Promise<Result<EnvelopeEntity>> {
    const trimmedName = this.input.name.trim();
    if (!trimmedName) {
      return createFailure({ code: 'INVALID_NAME', message: 'Envelope name is required' });
    }
    if (this.input.allocatedCents <= 0) {
      return createFailure({
        code: 'INVALID_AMOUNT',
        message: 'Budget amount must be greater than zero',
      });
    }

    const isSavingsLocked =
      this.input.envelopeType === 'savings' || this.input.envelopeType === 'emergency_fund';

    const now = new Date().toISOString();
    const id = randomUUID();

    const envelope: EnvelopeEntity = {
      id,
      householdId: this.input.householdId,
      name: trimmedName,
      allocatedCents: this.input.allocatedCents,
      spentCents: 0,
      envelopeType: this.input.envelopeType,
      isSavingsLocked,
      isArchived: false,
      periodStart: this.input.periodStart,
      targetAmountCents: null,
      targetDate: null,
      createdAt: now,
      updatedAt: now,
    };

    const row: InferInsertModel<typeof envelopes> = { ...envelope, isSynced: false };
    await this.db.insert(envelopes).values(row);

    const envelopeRecord: Record<string, unknown> = {
      id: envelope.id,
      householdId: envelope.householdId,
      name: envelope.name,
      allocatedCents: envelope.allocatedCents,
      spentCents: envelope.spentCents,
      envelopeType: envelope.envelopeType,
      isSavingsLocked: envelope.isSavingsLocked,
      isArchived: envelope.isArchived,
      periodStart: envelope.periodStart,
      createdAt: envelope.createdAt,
      updatedAt: envelope.updatedAt,
    };

    await this.audit.log({
      householdId: this.input.householdId,
      entityType: 'envelope',
      entityId: id,
      action: 'create',
      previousValue: null,
      newValue: envelopeRecord,
    });

    await this.enqueuer.enqueue('envelopes', id, 'INSERT');

    return createSuccess(envelope);
  }
}
