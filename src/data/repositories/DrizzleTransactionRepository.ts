import { and, eq, desc } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../local/schema';
import { transactions } from '../local/schema';
import type { ITransactionRepository } from '../../domain/ports/ITransactionRepository';
import type { TransactionEntity } from '../../domain/transactions/TransactionEntity';

export class DrizzleTransactionRepository implements ITransactionRepository {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async findById(id: string, householdId: string): Promise<TransactionEntity | null> {
    const [row] = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
      .limit(1);
    if (!row) return null;
    return this.rowToEntity(row);
  }

  async findByHousehold(householdId: string, limit = 100): Promise<TransactionEntity[]> {
    const rows = await this.db
      .select()
      .from(transactions)
      .where(eq(transactions.householdId, householdId))
      .orderBy(desc(transactions.transactionDate))
      .limit(limit);
    return rows.map((r) => this.rowToEntity(r));
  }

  // READ-ONLY on purpose. This repository used to expose `insert` and a
  // physical `delete`, neither with a caller and both bypassing the oplog: a
  // row written here would never sync, and a row physically deleted here
  // leaves no tombstone — which slip confirmation relies on (its id generation
  // counts every row that ever carried a slip_id) and which the server would
  // never hear about. Every transaction write goes through the synced-write
  // use cases (Create/Update/DeleteTransactionUseCase, ConfirmSlipUseCase).

  private rowToEntity(row: typeof transactions.$inferSelect): TransactionEntity {
    return {
      id: row.id,
      householdId: row.householdId,
      envelopeId: row.envelopeId,
      amountCents: row.amountCents,
      payee: row.payee ?? null,
      description: row.description ?? null,
      transactionDate: row.transactionDate,
      isBusinessExpense: row.isBusinessExpense,
      spendingTriggerNote: row.spendingTriggerNote ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
