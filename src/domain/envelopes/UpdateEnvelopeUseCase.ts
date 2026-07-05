import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { isRowNotMatchedError } from '../../data/uow/createSyncedRepo';
import type { EnvelopeEntity, EnvelopeType } from './EnvelopeEntity';

interface UpdateInput {
  name: string;
  allocatedCents: number;
  /** Optional: if provided, income envelopes reject any non-zero value */
  spentCents?: number;
  envelopeType?: EnvelopeType;
  targetAmountCents?: number | null;
  targetDate?: string | null;
}

export class UpdateEnvelopeUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly current: EnvelopeEntity,
    private readonly input: UpdateInput,
    private readonly deps: SyncWriteDeps = {},
  ) {}

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
    const envelopeType =
      this.input.envelopeType !== undefined ? this.input.envelopeType : this.current.envelopeType;
    // L3 (exhaustive audit): editing envelope_type into/out of 'savings' or
    // 'emergency_fund' must recompute is_savings_locked the same way
    // CreateEnvelopeUseCase derives it at creation — otherwise the flag
    // diverges depending on whether an envelope was created-as vs
    // edited-into a savings/emergency_fund type (e.g. a spending envelope
    // edited to 'savings' would persist is_savings_locked=0, while an
    // envelope created fresh as 'savings' persists 1).
    const isSavingsLocked = envelopeType === 'savings' || envelopeType === 'emergency_fund';
    const updated: EnvelopeEntity = {
      ...this.current,
      name: trimmedName,
      allocatedCents: this.input.allocatedCents,
      envelopeType,
      isSavingsLocked,
      targetAmountCents:
        this.input.targetAmountCents !== undefined
          ? this.input.targetAmountCents
          : this.current.targetAmountCents,
      targetDate:
        this.input.targetDate !== undefined ? this.input.targetDate : this.current.targetDate,
      updatedAt: now,
    };

    const fields: Record<string, unknown> = {
      name: updated.name,
      allocated_cents: updated.allocatedCents,
      envelope_type: updated.envelopeType,
      // better-sqlite3 only binds numbers/strings/bigints/buffers/null — not
      // JS booleans — so boolean columns are written as 0/1 (same convention
      // CreateEnvelopeUseCase uses).
      is_savings_locked: updated.isSavingsLocked ? 1 : 0,
      target_amount_cents: updated.targetAmountCents,
      target_date: updated.targetDate,
      updated_at: now,
    };

    try {
      const repo = resolveSyncedRepo(this.db, 'envelopes', this.deps);
      repo.update(
        this.current.id,
        this.current.householdId,
        fields,
        resolveSyncedRepoCtx(this.deps),
      );
    } catch (err) {
      // Only a genuine zero-rows-matched write means the envelope doesn't
      // exist (or was deleted/moved) — any other failure (DB error,
      // constraint violation, etc.) must NOT be reported as
      // ENVELOPE_NOT_FOUND, or real errors get masked as a plain "not
      // found" and silently discarded.
      if (isRowNotMatchedError(err)) {
        return createFailure({
          code: 'ENVELOPE_NOT_FOUND',
          message: 'Envelope does not exist or was already deleted',
        });
      }
      throw err;
    }

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
      action: 'update',
      entityId: this.current.id,
      previousValue: previousValueRecord,
      newValue: newValueRecord,
    });

    return createSuccess(updated);
  }
}
