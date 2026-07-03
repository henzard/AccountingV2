import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { TransactionEntity } from './TransactionEntity';

/**
 * Soft-deletes a transaction. Balance is DERIVED (see `EnvelopeBalanceQuery`),
 * so this use case no longer decrements `envelopes.spent_cents` — it only
 * soft-deletes the transaction row (sets `deleted_at`), atomically paired
 * with one oplog `delete` row via the synced repo.
 *
 * `createSyncedRepo.softDelete` throws when the row doesn't match (0 rows
 * affected), which this use case turns into a `TRANSACTION_NOT_FOUND`
 * failure — closing the race where the row was deleted/moved between the
 * caller's original fetch and this call (deep-review finding).
 */
export class DeleteTransactionUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly tx: TransactionEntity,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(): Promise<Result<void>> {
    const repo = resolveSyncedRepo(this.db, 'transactions', this.deps);

    try {
      repo.softDelete(this.tx.id, this.tx.householdId, resolveSyncedRepoCtx(this.deps));
    } catch {
      return createFailure({
        code: 'TRANSACTION_NOT_FOUND',
        message: 'Transaction does not exist or was already deleted',
      });
    }

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

    return createSuccess(undefined);
  }
}
