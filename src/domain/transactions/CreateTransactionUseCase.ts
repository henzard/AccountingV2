import { randomUUID } from 'expo-crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { InferInsertModel } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { transactions, envelopes } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuerAdapter } from '../../data/repositories/PendingSyncEnqueuerAdapter';
import type { ISyncEnqueuer } from '../ports/ISyncEnqueuer';
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

export class CreateTransactionUseCase {
  private readonly enqueuer: ISyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: CreateTransactionInput,
    enqueuer?: ISyncEnqueuer,
  ) {
    this.enqueuer = enqueuer ?? new PendingSyncEnqueuerAdapter(db);
  }

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

    const row: InferInsertModel<typeof transactions> = {
      ...tx,
      slipId: this.input.slipId ?? null,
      isSynced: false,
    };
    await this.db.insert(transactions).values(row);

    // Atomically increment envelope spentCents without a read-modify-write race.
    // Scope by householdId to prevent cross-household write (CRITICAL-2).
    await this.db
      .update(envelopes)
      .set({ spentCents: sql`${envelopes.spentCents} + ${this.input.amountCents}`, updatedAt: now })
      .where(
        and(
          eq(envelopes.id, this.input.envelopeId),
          eq(envelopes.householdId, this.input.householdId),
        ),
      );

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
