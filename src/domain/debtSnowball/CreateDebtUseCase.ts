import { randomUUID } from 'expo-crypto';
import { count, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { debts } from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuerAdapter } from '../../data/repositories/PendingSyncEnqueuerAdapter';
import type { ISyncEnqueuer } from '../ports/ISyncEnqueuer';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { DebtEntity, DebtType } from './DebtEntity';

export interface CreateDebtInput {
  householdId: string;
  creditorName: string;
  debtType: DebtType;
  outstandingBalanceCents: number;
  interestRatePercent: number;
  minimumPaymentCents: number;
}

export class CreateDebtUseCase {
  private readonly enqueuer: ISyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: CreateDebtInput,
    enqueuer?: ISyncEnqueuer,
  ) {
    this.enqueuer = enqueuer ?? new PendingSyncEnqueuerAdapter(db);
  }

  async execute(): Promise<Result<DebtEntity>> {
    if (this.input.outstandingBalanceCents <= 0) {
      return createFailure({
        code: 'INVALID_BALANCE',
        message: 'Outstanding balance must be greater than zero',
      });
    }
    if (this.input.minimumPaymentCents <= 0) {
      return createFailure({
        code: 'INVALID_PAYMENT',
        message: 'Minimum payment must be greater than zero',
      });
    }
    if (this.input.interestRatePercent < 0) {
      return createFailure({ code: 'INVALID_RATE', message: 'Interest rate cannot be negative' });
    }

    const countResult = await this.db
      .select({ count: count() })
      .from(debts)
      .where(eq(debts.householdId, this.input.householdId));
    const sortOrder = countResult[0]?.count ?? 0;

    const now = new Date().toISOString();
    const id = randomUUID();

    const debt: DebtEntity = {
      id,
      householdId: this.input.householdId,
      creditorName: this.input.creditorName,
      debtType: this.input.debtType,
      outstandingBalanceCents: this.input.outstandingBalanceCents,
      initialBalanceCents: this.input.outstandingBalanceCents,
      interestRatePercent: this.input.interestRatePercent,
      minimumPaymentCents: this.input.minimumPaymentCents,
      sortOrder,
      isPaidOff: false,
      totalPaidCents: 0,
      createdAt: now,
      updatedAt: now,
      isSynced: false,
    };

    await this.db.insert(debts).values(debt);

    await this.audit.log({
      householdId: this.input.householdId,
      entityType: 'debt',
      entityId: id,
      action: 'create',
      previousValue: null,
      newValue: {
        id,
        creditorName: debt.creditorName,
        debtType: debt.debtType,
        outstandingBalanceCents: debt.outstandingBalanceCents,
      },
    });

    await this.enqueuer.enqueue('debts', id, 'INSERT');

    return createSuccess(debt);
  }
}
