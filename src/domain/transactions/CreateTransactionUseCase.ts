import { randomUUID } from 'expo-crypto';
import { and, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
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
  slipId?: string | null; // optional FK to slip_queue.id
  isBusinessExpense?: boolean;
  spendingTriggerNote?: string | null;
}

/**
 * Creates a transaction. Balance is DERIVED (see `EnvelopeBalanceQuery`), so
 * this use case no longer mutates `envelopes.spent_cents` — it only writes
 * the transaction row, atomically paired with one oplog `insert` row via
 * the synced repo (see `createSyncedRepo`). The transactions ledger is now
 * the single source of truth for spend.
 */
export class CreateTransactionUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: CreateTransactionInput,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(): Promise<Result<TransactionEntity>> {
    if (this.input.amountCents <= 0) {
      return createFailure({ code: 'INVALID_AMOUNT', message: 'Amount must be greater than zero' });
    }

    // Reject transactions targeting income envelopes; also scope to household to
    // prevent cross-household envelope access (CRITICAL-2).
    const [targetEnvelope] = await this.db
      .select()
      .from(envelopes)
      .where(
        and(
          eq(envelopes.id, this.input.envelopeId),
          eq(envelopes.householdId, this.input.householdId),
        ),
      )
      .limit(1);

    if (!targetEnvelope) {
      return createFailure({ code: 'ENVELOPE_NOT_FOUND', message: 'Envelope does not exist' });
    }
    if (targetEnvelope.envelopeType === 'income') {
      return createFailure({
        code: 'INVALID_ENVELOPE_TYPE',
        message: 'Cannot create a transaction against an income envelope',
      });
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
      isBusinessExpense: this.input.isBusinessExpense ?? false,
      spendingTriggerNote: this.input.spendingTriggerNote ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const row: Record<string, unknown> = {
      id: tx.id,
      household_id: tx.householdId,
      envelope_id: tx.envelopeId,
      amount_cents: tx.amountCents,
      payee: tx.payee,
      description: tx.description,
      transaction_date: tx.transactionDate,
      is_business_expense: tx.isBusinessExpense,
      spending_trigger_note: tx.spendingTriggerNote,
      slip_id: this.input.slipId ?? null,
      created_at: tx.createdAt,
      updated_at: tx.updatedAt,
      is_synced: false,
    };

    const repo = resolveSyncedRepo(this.db, 'transactions', this.deps);
    repo.insert(row, resolveSyncedRepoCtx(this.deps));

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

    return createSuccess(tx);
  }
}
