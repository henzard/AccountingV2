import { and, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes, transactions } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import { isRowNotMatchedError } from '../../data/uow/createSyncedRepo';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { bestEffortAudit } from '../shared/bestEffortAudit';
import {
  validateTransactionAmountCents,
  validateTransactionDate,
  validateTargetEnvelope,
} from './transactionValidation';
import type { TransactionEntity } from './TransactionEntity';

export interface UpdateTransactionInput {
  envelopeId: string;
  amountCents: number;
  payee: string | null;
  description: string | null;
  transactionDate: string; // YYYY-MM-DD
  isBusinessExpense?: boolean;
}

/**
 * Edits an existing transaction (UX-9). Modelled on `CreateTransactionUseCase`
 * — same amount/date/target-envelope validation (via `transactionValidation`)
 * — plus two edit-only guards:
 *
 *  - Refuses to edit a soft-deleted transaction: re-reads the row's
 *    `deleted_at` at write time (not just trusting the caller's possibly
 *    stale `current` snapshot), closing the race where the transaction was
 *    deleted (this device or another, via sync) between the screen loading
 *    it and Save being pressed.
 *  - `slipId` is not part of `UpdateTransactionInput` at all, and the write
 *    below never includes `slip_id` in `fields` — a slip-created
 *    transaction's link to its source slip is therefore structurally
 *    immutable through this use case, not just validated away.
 *
 * Balance stays DERIVED (see `EnvelopeBalanceQuery`) — this only writes the
 * transaction row, atomically paired with one oplog `update` row via the
 * synced repo.
 */
export class UpdateTransactionUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly current: TransactionEntity,
    private readonly input: UpdateTransactionInput,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(): Promise<Result<TransactionEntity>> {
    const amountResult = validateTransactionAmountCents(this.input.amountCents);
    if (!amountResult.success) return amountResult;

    const dateResult = validateTransactionDate(this.input.transactionDate);
    if (!dateResult.success) return dateResult;

    // Re-read deleted_at at write time rather than trusting `this.current`
    // (which may be a stale snapshot the screen loaded before a delete —
    // this device's own, or another device's via sync — landed).
    const [currentRow] = await this.db
      .select({ deletedAt: transactions.deletedAt })
      .from(transactions)
      .where(
        and(
          eq(transactions.id, this.current.id),
          eq(transactions.householdId, this.current.householdId),
        ),
      )
      .limit(1);

    if (!currentRow) {
      return createFailure({
        code: 'TRANSACTION_NOT_FOUND',
        message: 'Transaction does not exist',
      });
    }
    if (currentRow.deletedAt) {
      return createFailure({
        code: 'TRANSACTION_DELETED',
        message: 'Cannot edit a deleted transaction',
      });
    }

    // REG-12: only re-validate the target envelope when it's actually
    // CHANGING. `validateTargetEnvelope` rejects an archived/deleted
    // envelope — correct when the user is moving the transaction TO one, but
    // wrong when they're just editing payee/amount/date on a transaction
    // that already belongs to an envelope archived AFTER it was created:
    // that edit has nothing to do with the (unchanged) envelope and must not
    // be blocked by it. Scope to household to prevent cross-household
    // envelope access (same rule as CreateTransactionUseCase).
    if (this.input.envelopeId !== this.current.envelopeId) {
      const [targetEnvelope] = await this.db
        .select()
        .from(envelopes)
        .where(
          and(
            eq(envelopes.id, this.input.envelopeId),
            eq(envelopes.householdId, this.current.householdId),
          ),
        )
        .limit(1);

      const envelopeResult = validateTargetEnvelope(targetEnvelope);
      if (!envelopeResult.success) return envelopeResult;
    }

    const now = new Date().toISOString();
    const updated: TransactionEntity = {
      ...this.current,
      envelopeId: this.input.envelopeId,
      amountCents: this.input.amountCents,
      payee: this.input.payee,
      description: this.input.description,
      transactionDate: this.input.transactionDate,
      isBusinessExpense: this.input.isBusinessExpense ?? false,
      updatedAt: now,
    };

    const fields: Record<string, unknown> = {
      envelope_id: updated.envelopeId,
      amount_cents: updated.amountCents,
      payee: updated.payee,
      description: updated.description,
      transaction_date: updated.transactionDate,
      // better-sqlite3 only binds numbers/strings/bigints/buffers/null — not
      // JS booleans — so the boolean column is written as 0/1 (same
      // convention as CreateTransactionUseCase).
      is_business_expense: updated.isBusinessExpense ? 1 : 0,
      updated_at: updated.updatedAt,
      // NOTE: slip_id is deliberately never assigned here — a slip-created
      // transaction's link to its source slip is not editable.
    };

    const repo = resolveSyncedRepo(this.db, 'transactions', this.deps);
    try {
      repo.update(
        this.current.id,
        this.current.householdId,
        fields,
        resolveSyncedRepoCtx(this.deps),
      );
    } catch (err) {
      if (isRowNotMatchedError(err)) {
        return createFailure({
          code: 'TRANSACTION_NOT_FOUND',
          message: 'Transaction does not exist or was already deleted',
        });
      }
      throw err;
    }

    // The ledger write above (entity row + oplog, one SQLite transaction) has
    // already committed by this point. Audit logging is a secondary,
    // best-effort concern — see bestEffortAudit.
    await bestEffortAudit(this.audit, {
      householdId: this.current.householdId,
      entityType: 'transaction',
      entityId: this.current.id,
      action: 'update',
      previousValue: {
        id: this.current.id,
        envelopeId: this.current.envelopeId,
        amountCents: this.current.amountCents,
        payee: this.current.payee,
        transactionDate: this.current.transactionDate,
      },
      newValue: {
        id: updated.id,
        envelopeId: updated.envelopeId,
        amountCents: updated.amountCents,
        payee: updated.payee,
        transactionDate: updated.transactionDate,
      },
    });

    return createSuccess(updated);
  }
}
