import { sql, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { debts } from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
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
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: LogDebtPaymentInput,
  ) {}

  async execute(): Promise<Result<DebtEntity>> {
    if (this.input.paymentAmountCents <= 0) {
      return createFailure({ code: 'INVALID_PAYMENT', message: 'Payment amount must be greater than zero' });
    }

    const now = new Date().toISOString();
    const newBalance = Math.max(
      0,
      this.input.currentDebt.outstandingBalanceCents - this.input.paymentAmountCents,
    );
    const isPaidOff = newBalance === 0;

    await this.db
      .update(debts)
      .set({
        outstandingBalanceCents: newBalance,
        totalPaidCents: sql`${debts.totalPaidCents} + ${this.input.paymentAmountCents}`,
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

    const updated: DebtEntity = {
      ...this.input.currentDebt,
      outstandingBalanceCents: newBalance,
      totalPaidCents: this.input.currentDebt.totalPaidCents + this.input.paymentAmountCents,
      isPaidOff,
      updatedAt: now,
    };

    return createSuccess(updated);
  }
}
