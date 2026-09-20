import { and, desc, eq, isNull } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../../data/local/schema';
import { transactions } from '../../../data/local/schema';
import type { TransactionEntity } from '../../../domain/transactions/TransactionEntity';

/**
 * This envelope's non-deleted transactions, newest first.
 *
 * A PERIOD-scoped envelope ('spending' | 'income' | 'utility') gets a fresh
 * `id` every period (see `getEnvelopeScope`), so filtering by `envelopeId`
 * alone already scopes the result to that envelope's own period — no extra
 * date filter is needed, and none is applied here.
 *
 * A PERSISTENT envelope ('sinking_fund' | 'emergency_fund' | 'savings' |
 * 'baby_step') keeps the same row across every period, so its transactions
 * span its whole lifetime; pass `limit` (e.g. 20) to cap the result to the
 * most recent ones instead of the full history.
 */
export async function resolveEnvelopeTransactions(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
  envelopeId: string,
  limit?: number,
): Promise<TransactionEntity[]> {
  const query = db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.envelopeId, envelopeId),
        isNull(transactions.deletedAt),
      ),
    )
    .orderBy(desc(transactions.transactionDate));

  const rows = limit === undefined ? await query : await query.limit(limit);
  return rows as TransactionEntity[];
}
