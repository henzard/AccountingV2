import { randomUUID } from 'expo-crypto';
import { sql } from 'drizzle-orm';
import type { InferInsertModel } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { transactions, envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuer } from '../../data/sync/PendingSyncEnqueuer';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { TransactionEntity } from './TransactionEntity';

interface CreateTransactionInput {
  householdId: string;
  envelopeId: string;
  amountCents: number;
  payee: string | null;
  description: string | null;
  transactionDate: string; // YYYY-MM-DD
}

export class CreateTransactionUseCase {
  private readonly enqueuer: PendingSyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: CreateTransactionInput,
  ) {
    this.enqueuer = new PendingSyncEnqueuer(db);
  }

  async execute(): Promise<Result<TransactionEntity>> {
    if (this.input.amountCents <= 0) {
      return createFailure({ code: 'INVALID_AMOUNT', message: 'Amount must be greater than zero' });
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    const tx: TransactionEntity = {
      id,
      householdId: this.input.householdId,
      envelopeId: this.input.envelopeId,
      amountCents: this.input.amountCents,
      payee: this.input.payee,
      description: this.input.description,
      transactionDate: this.input.transactionDate,
      isBusinessExpense: false,
      spendingTriggerNote: null,
      createdAt: now,
      updatedAt: now,
    };

    const row: InferInsertModel<typeof transactions> = { ...tx, isSynced: false };
    await this.db.insert(transactions).values(row);

    // Atomically increment envelope spentCents without a read-modify-write race
    await this.db
      .update(envelopes)
      .set({ spentCents: sql`${envelopes.spentCents} + ${this.input.amountCents}`, updatedAt: now })
      .where(sql`${envelopes.id} = ${this.input.envelopeId}`);

    await this.audit.log({
      householdId: this.input.householdId,
      entityType: 'transaction',
      entityId: id,
      action: 'create',
      previousValue: null,
      newValue: {
        id: tx.id,
        envelopeId: tx.envelopeId,
        amountCents: tx.amountCents,
        payee: tx.payee,
        transactionDate: tx.transactionDate,
      },
    });

    await this.enqueuer.enqueue('transactions', id, 'INSERT');

    return createSuccess(tx);
  }
}
