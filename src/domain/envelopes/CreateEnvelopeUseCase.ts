import { randomUUID } from 'expo-crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import { isUniqueConstraintError } from '../../data/uow/createSyncedRepo';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { EnvelopeEntity, EnvelopeType } from './EnvelopeEntity';

interface CreateEnvelopeInput {
  householdId: string;
  name: string;
  allocatedCents: number;
  envelopeType: EnvelopeType;
  periodStart: string;
  targetAmountCents?: number | null;
  targetDate?: string | null;
}

export class CreateEnvelopeUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: CreateEnvelopeInput,
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

    // EMF create-time duplicate guard: only 'emergency_fund' is a household
    // singleton (sinking funds and other persistent types are legitimately
    // many). Without this, two devices — or two taps before the first
    // insert lands — can each pass validation and insert their own active
    // emergency_fund row, since nothing here previously checked for one.
    // `ReconcileEmergencyFundTypeUseCase` / `emergencyFundReconcileStore`
    // remain as an after-the-fact backstop for rows that still slip through
    // (e.g. two offline devices creating one each before ever syncing), but
    // this stops the common single-online-device double-tap/double-device
    // race at the source.
    //
    // This SELECT-then-INSERT is itself a TOCTOU-vulnerable pre-check: two
    // overlapping `execute()` calls on the same device/process can both
    // pass this SELECT before either INSERT lands. The partial unique index
    // `envelopes_one_active_emf_per_household` (0013_emf_unique.sql) is the
    // actual DB-level guarantee — the `catch` around `repo.insert` below
    // maps a same-device race loss to this same failure instead of letting
    // it throw.
    if (this.input.envelopeType === 'emergency_fund') {
      const existingActive = await this.db
        .select({ id: envelopes.id })
        .from(envelopes)
        .where(
          and(
            eq(envelopes.householdId, this.input.householdId),
            eq(envelopes.envelopeType, 'emergency_fund'),
            eq(envelopes.isArchived, false),
            isNull(envelopes.deletedAt),
          ),
        );
      if (existingActive.length > 0) {
        return createFailure({
          code: 'DUPLICATE_EMERGENCY_FUND',
          message: 'An emergency fund envelope already exists for this household',
        });
      }
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
      targetAmountCents: this.input.targetAmountCents ?? null,
      targetDate: this.input.targetDate ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const row: Record<string, unknown> = {
      id: envelope.id,
      household_id: envelope.householdId,
      name: envelope.name,
      allocated_cents: envelope.allocatedCents,
      envelope_type: envelope.envelopeType,
      // better-sqlite3 only binds numbers/strings/bigints/buffers/null —
      // not JS booleans — so the boolean columns are written as 0/1 (same
      // convention as StartNewPeriodUseCase's copy-forward insert).
      is_savings_locked: envelope.isSavingsLocked ? 1 : 0,
      is_archived: envelope.isArchived ? 1 : 0,
      period_start: envelope.periodStart,
      target_amount_cents: envelope.targetAmountCents,
      target_date: envelope.targetDate,
      created_at: envelope.createdAt,
      updated_at: envelope.updatedAt,
    };

    const repo = resolveSyncedRepo(this.db, 'envelopes', this.deps);
    try {
      repo.insert(row, resolveSyncedRepoCtx(this.deps));
    } catch (err) {
      // A same-device race that slipped past the pre-check above (two
      // overlapping `execute()` calls both read "no existing active EMF")
      // hits the partial unique index here instead. Translate that DB-level
      // rejection into the same clean failure the pre-check returns, rather
      // than letting a raw SqliteError escape to the caller.
      if (this.input.envelopeType === 'emergency_fund' && isUniqueConstraintError(err)) {
        return createFailure({
          code: 'DUPLICATE_EMERGENCY_FUND',
          message: 'An emergency fund envelope already exists for this household',
        });
      }
      throw err;
    }

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

    return createSuccess(envelope);
  }
}
