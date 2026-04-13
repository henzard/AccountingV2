import { and, eq, gte, lte } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { transactions } from '../../data/local/schema';

/**
 * Count distinct days on which at least one transaction was recorded
 * within the given period for the specified household.
 */
export async function resolveLoggingDays(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
  periodStart: string,
  periodEnd: string,
): Promise<number> {
  const rows = await db
    .select({ date: transactions.transactionDate })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        gte(transactions.transactionDate, periodStart),
        lte(transactions.transactionDate, periodEnd),
      ),
    );
  const distinctDays = new Set(rows.map((r) => r.date));
  return distinctDays.size;
}
