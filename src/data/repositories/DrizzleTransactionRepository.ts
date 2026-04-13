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

  async insert(t: TransactionEntity): Promise<void> {
    await this.db.insert(transactions).values({ ...t, isSynced: false });
  }

  async delete(id: string, householdId: string): Promise<void> {
    await this.db
      .delete(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)));
  }

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
