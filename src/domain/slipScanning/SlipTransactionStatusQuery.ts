import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { transactions } from '../../data/local/schema';

/**
 * The minimal Drizzle database shape this query needs — same pattern as
 * `EnvelopeBalanceDb` (see EnvelopeBalanceQuery.ts): both the production
 * `ExpoSQLiteDatabase` and the realsql tier's `BetterSQLite3Database` extend
 * this 'sync'-mode base class, so one query-builder call works against either
 * driver.
 */
export type SlipTransactionStatusDb = BaseSQLiteDatabase<'sync', unknown, Record<string, unknown>>;

/**
 * REG-2: an EXTRACTED slip (`slip_queue.status = 'completed'`) does not mean
 * the user has ever confirmed/saved it — `ExtractSlipUseCase` flips a slip to
 * 'completed' the instant OpenAI extraction succeeds, before any transaction
 * exists. `SlipQueueScreen` must therefore never infer "already saved" from
 * `status` alone; it has to check whether this slip actually has confirmed
 * (non-deleted) transactions.
 *
 * Batches the check for every visible 'completed' slip into ONE query
 * (`slip_id IN (...)`) instead of one query per row, and returns the set of
 * slip ids that have at least one live transaction — i.e. were genuinely
 * confirmed, not merely extracted.
 */
export async function getConfirmedSlipIds(
  db: SlipTransactionStatusDb,
  householdId: string,
  slipIds: string[],
): Promise<Set<string>> {
  if (slipIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ slipId: transactions.slipId })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        inArray(transactions.slipId, slipIds),
        isNull(transactions.deletedAt),
      ),
    );
  return new Set(rows.map((r) => r.slipId).filter((id): id is string => id != null));
}
