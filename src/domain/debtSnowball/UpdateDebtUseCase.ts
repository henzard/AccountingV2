import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { bestEffortAudit } from '../shared/bestEffortAudit';
import { isRowNotMatchedError } from '../../data/uow/createSyncedRepo';
import type { DebtEntity } from './DebtEntity';

export interface UpdateDebtInput {
  householdId: string;
  debtId: string;
  outstandingBalanceCents: number;
  interestRatePercent: number;
  minimumPaymentCents: number;
  creditorName: string;
}

export class UpdateDebtUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly current: DebtEntity,
    private readonly input: UpdateDebtInput,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(): Promise<Result<DebtEntity>> {
    // Validate balance: must be a safe integer >= 0 (statement can show zero)
    if (
      !Number.isSafeInteger(this.input.outstandingBalanceCents) ||
      this.input.outstandingBalanceCents < 0
    ) {
      return createFailure({
        code: 'INVALID_BALANCE',
        message: 'Outstanding balance must be a valid non-negative amount',
      });
    }

    // Validate rate: finite, 0–100
    if (
      !Number.isFinite(this.input.interestRatePercent) ||
      this.input.interestRatePercent < 0 ||
      this.input.interestRatePercent > 100
    ) {
      return createFailure({
        code: 'INVALID_RATE',
        message: 'Interest rate must be between 0 and 100',
      });
    }

    // Validate minimum payment: safe integer > 0
    if (
      !Number.isSafeInteger(this.input.minimumPaymentCents) ||
      this.input.minimumPaymentCents <= 0
    ) {
      return createFailure({
        code: 'INVALID_PAYMENT',
        message: 'Minimum payment must be greater than zero',
      });
    }

    // Validate creditor name: non-empty after trim
    const trimmedName = this.input.creditorName.trim();
    if (!trimmedName) {
      return createFailure({
        code: 'INVALID_NAME',
        message: 'Creditor name is required',
      });
    }

    const now = new Date().toISOString();
    const isPaidOff = this.input.outstandingBalanceCents === 0;

    const fields: Record<string, unknown> = {
      outstanding_balance_cents: this.input.outstandingBalanceCents,
      interest_rate_percent: this.input.interestRatePercent,
      minimum_payment_cents: this.input.minimumPaymentCents,
      creditor_name: trimmedName,
      // better-sqlite3 only binds numbers/strings/bigints/buffers/null — not
      // JS booleans — so boolean columns are written as 0/1 (same convention
      // CreateDebtUseCase uses).
      is_paid_off: isPaidOff ? 1 : 0,
      updated_at: now,
    };

    try {
      const repo = resolveSyncedRepo(this.db, 'debts', this.deps);
      repo.update(
        this.input.debtId,
        this.input.householdId,
        fields,
        resolveSyncedRepoCtx(this.deps),
      );
    } catch (err) {
      if (isRowNotMatchedError(err)) {
        return createFailure({
          code: 'DEBT_NOT_FOUND',
          message: 'Debt does not exist or was already deleted',
        });
      }
      throw err;
    }

    const updated: DebtEntity = {
      ...this.current,
      outstandingBalanceCents: this.input.outstandingBalanceCents,
      interestRatePercent: this.input.interestRatePercent,
      minimumPaymentCents: this.input.minimumPaymentCents,
      creditorName: trimmedName,
      isPaidOff,
      updatedAt: now,
    };

    const previousValueRecord: Record<string, unknown> = {
      id: this.current.id,
      outstandingBalanceCents: this.current.outstandingBalanceCents,
      interestRatePercent: this.current.interestRatePercent,
      minimumPaymentCents: this.current.minimumPaymentCents,
      creditorName: this.current.creditorName,
      isPaidOff: this.current.isPaidOff,
    };

    const newValueRecord: Record<string, unknown> = {
      id: updated.id,
      outstandingBalanceCents: updated.outstandingBalanceCents,
      interestRatePercent: updated.interestRatePercent,
      minimumPaymentCents: updated.minimumPaymentCents,
      creditorName: updated.creditorName,
      isPaidOff: updated.isPaidOff,
    };

    await bestEffortAudit(this.audit, {
      householdId: this.input.householdId,
      entityType: 'debt',
      entityId: this.input.debtId,
      action: 'update',
      previousValue: previousValueRecord,
      newValue: newValueRecord,
    });

    return createSuccess(updated);
  }
}
