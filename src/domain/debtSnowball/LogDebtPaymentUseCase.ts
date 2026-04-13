import { sql, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { debts } from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuer } from '../../data/sync/PendingSyncEnqueuer';
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
  private readonly enqueuer: PendingSyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: LogDebtPaymentInput,
  ) {
    this.enqueuer = new PendingSyncEnqueuer(db);
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

    await this.db
      .update(debts)
      .set({
        outstandingBalanceCents: newBalance,
        totalPaidCents: sql`${debts.totalPaidCents} + ${actualApplied}`,
        isPaidOff,
        updatedAt: now,
        isSynced: false,
      })
      .where(eq(debts.id, this.input.debtId));

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
