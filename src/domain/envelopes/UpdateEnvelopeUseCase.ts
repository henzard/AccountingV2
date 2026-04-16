import { eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuerAdapter } from '../../data/repositories/PendingSyncEnqueuerAdapter';
import type { ISyncEnqueuer } from '../ports/ISyncEnqueuer';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { EnvelopeEntity } from './EnvelopeEntity';

interface UpdateInput {
  name: string;
  allocatedCents: number;
  /** Optional: if provided, income envelopes reject any non-zero value */
  spentCents?: number;
  targetAmountCents?: number | null;
  targetDate?: string | null;
}

export class UpdateEnvelopeUseCase {
  private readonly enqueuer: ISyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly current: EnvelopeEntity,
    private readonly input: UpdateInput,
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
    // Income envelopes must always have spentCents = 0
    if (this.current.envelopeType === 'income' && (this.input.spentCents ?? 0) !== 0) {
      return createFailure({
        code: 'INVALID_INCOME_MUTATION',
        message: 'Income envelopes cannot have spending',
      });
    }

    const now = new Date().toISOString();
    const updated: EnvelopeEntity = {
      ...this.current,
      name: trimmedName,
      allocatedCents: this.input.allocatedCents,
      targetAmountCents:
        this.input.targetAmountCents !== undefined
          ? this.input.targetAmountCents
          : this.current.targetAmountCents,
      targetDate:
        this.input.targetDate !== undefined ? this.input.targetDate : this.current.targetDate,
      updatedAt: now,
    };

    await this.db
      .update(envelopes)
      .set({
        name: updated.name,
        allocatedCents: updated.allocatedCents,
        targetAmountCents: updated.targetAmountCents,
        targetDate: updated.targetDate,
        updatedAt: now,
        isSynced: false,
      })
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
      targetAmountCents: updated.targetAmountCents,
      targetDate: updated.targetDate,
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

    await this.enqueuer.enqueue('envelopes', this.current.id, 'UPDATE');

    return createSuccess(updated);
  }
}
