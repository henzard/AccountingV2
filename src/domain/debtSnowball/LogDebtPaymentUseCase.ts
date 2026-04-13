import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuerAdapter } from '../../data/repositories/PendingSyncEnqueuerAdapter';
import { DrizzleDebtRepository } from '../../data/repositories/DrizzleDebtRepository';
import type { ISyncEnqueuer } from '../ports/ISyncEnqueuer';
import type { IDebtRepository } from '../ports/IDebtRepository';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { DebtEntity } from './DebtEntity';

export interface LogDebtPaymentInput {
  householdId: string;
  debtId: string;
  paymentAmountCents: number;
  currentDebt: DebtEntity;
}

export class LogDebtPaymentUseCase {
  private readonly enqueuer: ISyncEnqueuer;
  private readonly repo: IDebtRepository;

  constructor(
    db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: LogDebtPaymentInput,
    enqueuer?: ISyncEnqueuer,
    repo?: IDebtRepository,
  ) {
    this.enqueuer = enqueuer ?? new PendingSyncEnqueuerAdapter(db);
    this.repo = repo ?? new DrizzleDebtRepository(db);
  }

  async execute(): Promise<Result<DebtEntity>> {
    if (this.input.paymentAmountCents <= 0) {
      return createFailure({
        code: 'INVALID_PAYMENT',
        message: 'Payment amount must be greater than zero',
      });
    }

    const now = new Date().toISOString();
    const actualApplied = Math.min(
      this.input.paymentAmountCents,
      this.input.currentDebt.outstandingBalanceCents,
    );
    const newBalance = this.input.currentDebt.outstandingBalanceCents - actualApplied;
    const isPaidOff = newBalance === 0;

    const newTotalPaid = this.input.currentDebt.totalPaidCents + actualApplied;
    await this.repo.update({
      id: this.input.debtId,
      householdId: this.input.householdId,
      outstandingBalanceCents: newBalance,
      totalPaidCents: newTotalPaid,
      isPaidOff,
      updatedAt: now,
      isSynced: false,
    });

    await this.audit.log({
      householdId: this.input.householdId,
      entityType: 'debt',
      entityId: this.input.debtId,
      action: 'payment',
      previousValue: {
        outstandingBalanceCents: this.input.currentDebt.outstandingBalanceCents,
        totalPaidCents: this.input.currentDebt.totalPaidCents,
      },
      newValue: {
        paymentAmountCents: this.input.paymentAmountCents,
        outstandingBalanceCents: newBalance,
        isPaidOff,
      },
    });

    await this.enqueuer.enqueue('debts', this.input.currentDebt.id, 'UPDATE');

    const updated: DebtEntity = {
      ...this.input.currentDebt,
      outstandingBalanceCents: newBalance,
      totalPaidCents: this.input.currentDebt.totalPaidCents + actualApplied,
      isPaidOff,
      updatedAt: now,
    };

    return createSuccess(updated);
  }
}
