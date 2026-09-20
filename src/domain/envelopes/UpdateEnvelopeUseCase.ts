import { parse, isValid } from 'date-fns';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { bestEffortAudit } from '../shared/bestEffortAudit';
import { isRowNotMatchedError } from '../../data/uow/createSyncedRepo';
import { getEnvelopeScope } from './EnvelopeEntity';
import type { EnvelopeEntity, EnvelopeType } from './EnvelopeEntity';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a real calendar date in strict 'yyyy-MM-dd' form. Guards
 * against SinkingFundCard's `parseISO(envelope.targetDate)` crashing the
 * Sinking Funds screen on a malformed value that made it past the screen's
 * plain-text input (DOM-9).
 */
function isValidDateOnlyString(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  return isValid(parse(value, 'yyyy-MM-dd', new Date()));
}

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
    // DOM-9: a malformed targetDate crashes the Sinking Funds screen
    // downstream (SinkingFundCard parses it with date-fns parseISO).
    if (this.input.targetDate != null && !isValidDateOnlyString(this.input.targetDate)) {
      return createFailure({
        code: 'INVALID_TARGET_DATE',
        message: 'Target date must be a valid date in yyyy-MM-dd format',
      });
    }

    const envelopeType =
      this.input.envelopeType !== undefined ? this.input.envelopeType : this.current.envelopeType;

    // UX-10: the edit screen's type selector only lists 4 of the 7
    // EnvelopeTypes and is locked in the UI once an envelope exists, but this
    // is the actual enforcement point. Changing type across scope
    // (period-scoped <-> persistent) would silently repoint a row whose
    // balance-derivation rule (EnvelopeBalanceQuery) depends on which scope
    // it's in — e.g. a persistent sinking_fund's id is reused across periods,
    // but a period-scoped envelope's id is period-specific, so "converting"
    // one into the other leaves stale/ambiguous balance history behind.
    if (
      this.input.envelopeType !== undefined &&
      this.input.envelopeType !== this.current.envelopeType &&
      getEnvelopeScope({ envelopeType: this.input.envelopeType }) !==
        getEnvelopeScope({ envelopeType: this.current.envelopeType })
    ) {
      return createFailure({
        code: 'INVALID_TYPE_CHANGE',
        message: 'Cannot change envelope type across scope (e.g. a fund into a budget envelope)',
      });
    }
    // Converting a spent-against envelope into 'income' would leave spend
    // attributed to an envelope type that must always have spentCents = 0
    // (see the income-mutation guard above) — reject the conversion instead
    // of silently orphaning that spend.
    if (
      envelopeType === 'income' &&
      this.current.envelopeType !== 'income' &&
      this.current.spentCents > 0
    ) {
      return createFailure({
        code: 'INVALID_TYPE_CHANGE',
        message: 'Cannot convert an envelope with recorded spending to income',
      });
    }

    const now = new Date().toISOString();
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

    // The ledger write above has already committed by this point — audit
    // logging is a secondary, best-effort concern that must not fail this
    // otherwise-successful update (see bestEffortAudit).
    await bestEffortAudit(this.audit, {
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
