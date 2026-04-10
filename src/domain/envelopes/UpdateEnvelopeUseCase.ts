import { eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { EnvelopeEntity } from './EnvelopeEntity';

interface UpdateInput {
  name: string;
  allocatedCents: number;
}

export class UpdateEnvelopeUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly current: EnvelopeEntity,
    private readonly input: UpdateInput,
  ) {}

  async execute(): Promise<Result<EnvelopeEntity>> {
    const trimmedName = this.input.name.trim();
    if (!trimmedName) {
      return createFailure({ code: 'INVALID_NAME', message: 'Envelope name is required' });
    }
    if (this.input.allocatedCents <= 0) {
      return createFailure({ code: 'INVALID_AMOUNT', message: 'Budget amount must be greater than zero' });
    }

    const now = new Date().toISOString();
    const updated: EnvelopeEntity = {
      ...this.current,
      name: trimmedName,
      allocatedCents: this.input.allocatedCents,
      updatedAt: now,
    };

    await this.db
      .update(envelopes)
      .set({ name: updated.name, allocatedCents: updated.allocatedCents, updatedAt: now, isSynced: false })
      .where(eq(envelopes.id, this.current.id));

    const previousValueRecord: Record<string, unknown> = {
      id: this.current.id,
      householdId: this.current.householdId,
      name: this.current.name,
      allocatedCents: this.current.allocatedCents,
      spentCents: this.current.spentCents,
      envelopeType: this.current.envelopeType,
      isSavingsLocked: this.current.isSavingsLocked,
      isArchived: this.current.isArchived,
      periodStart: this.current.periodStart,
      createdAt: this.current.createdAt,
      updatedAt: this.current.updatedAt,
    };

    const newValueRecord: Record<string, unknown> = {
      id: updated.id,
      householdId: updated.householdId,
      name: updated.name,
      allocatedCents: updated.allocatedCents,
      spentCents: updated.spentCents,
      envelopeType: updated.envelopeType,
      isSavingsLocked: updated.isSavingsLocked,
      isArchived: updated.isArchived,
      periodStart: updated.periodStart,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };

    await this.audit.log({
      householdId: this.current.householdId,
      entityType: 'envelope',
      entityId: this.current.id,
      action: 'update',
      previousValue: previousValueRecord,
      newValue: newValueRecord,
    });

    return createSuccess(updated);
  }
}
