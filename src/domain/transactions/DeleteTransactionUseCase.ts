import { sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { transactions, envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuer } from '../../data/sync/PendingSyncEnqueuer';
import type { Result } from '../shared/types';
import { createSuccess } from '../shared/types';
import type { TransactionEntity } from './TransactionEntity';

export class DeleteTransactionUseCase {
  private readonly enqueuer: PendingSyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly tx: TransactionEntity,
  ) {
    this.enqueuer = new PendingSyncEnqueuer(db);
  }

  async execute(): Promise<Result<void>> {
    const now = new Date().toISOString();

    await this.db.delete(transactions).where(sql`${transactions.id} = ${this.tx.id}`);

    // Atomically decrement spentCents
    await this.db
      .update(envelopes)
      .set({ spentCents: sql`${envelopes.spentCents} - ${this.tx.amountCents}`, updatedAt: now })
      .where(sql`${envelopes.id} = ${this.tx.envelopeId}`);

    await this.audit.log({
      householdId: this.tx.householdId,
      entityType: 'transaction',
      entityId: this.tx.id,
      action: 'delete',
      previousValue: {
        id: this.tx.id,
        envelopeId: this.tx.envelopeId,
        amountCents: this.tx.amountCents,
        payee: this.tx.payee,
        transactionDate: this.tx.transactionDate,
      },
      newValue: null,
    });

    await this.enqueuer.enqueue('transactions', this.tx.id, 'DELETE');

    return createSuccess(undefined);
  }
}
