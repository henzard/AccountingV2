import { randomUUID } from 'expo-crypto';
import { count, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { debts } from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
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
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: CreateDebtInput,
    private readonly deps: SyncWriteDeps = {},
  ) {}

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
    };

    const row: Record<string, unknown> = {
      id: debt.id,
      household_id: debt.householdId,
      creditor_name: debt.creditorName,
      debt_type: debt.debtType,
      outstanding_balance_cents: debt.outstandingBalanceCents,
      initial_balance_cents: debt.initialBalanceCents,
      interest_rate_percent: debt.interestRatePercent,
      minimum_payment_cents: debt.minimumPaymentCents,
      sort_order: debt.sortOrder,
      // better-sqlite3 only binds numbers/strings/bigints/buffers/null — not
      // JS booleans — so boolean columns are written as 0/1 (same convention
      // CreateEnvelopeUseCase/StartNewPeriodUseCase use).
      is_paid_off: debt.isPaidOff ? 1 : 0,
      total_paid_cents: debt.totalPaidCents,
      created_at: debt.createdAt,
      updated_at: debt.updatedAt,
    };

    const repo = resolveSyncedRepo(this.db, 'debts', this.deps);
    repo.insert(row, resolveSyncedRepoCtx(this.deps));

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

    return createSuccess(debt);
  }
}
