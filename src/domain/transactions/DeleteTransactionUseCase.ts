import { and, eq, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { transactions, envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuerAdapter } from '../../data/repositories/PendingSyncEnqueuerAdapter';
import type { ISyncEnqueuer } from '../ports/ISyncEnqueuer';
import type { Result } from '../shared/types';
import { createSuccess } from '../shared/types';
import type { TransactionEntity } from './TransactionEntity';

export class DeleteTransactionUseCase {
  private readonly enqueuer: ISyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly tx: TransactionEntity,
    enqueuer?: ISyncEnqueuer,
  ) {
    this.enqueuer = enqueuer ?? new PendingSyncEnqueuerAdapter(db);
  }

  async execute(): Promise<Result<void>> {
    const now = new Date().toISOString();

    await this.db
      .delete(transactions)
      .where(
        and(eq(transactions.id, this.tx.id), eq(transactions.householdId, this.tx.householdId)),
      );

    // Atomically decrement spentCents — scoped to household to prevent cross-household update
    await this.db
      .update(envelopes)
      .set({ spentCents: sql`${envelopes.spentCents} - ${this.tx.amountCents}`, updatedAt: now })
      .where(
        and(eq(envelopes.id, this.tx.envelopeId), eq(envelopes.householdId, this.tx.householdId)),
      );

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
