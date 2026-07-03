import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

/**
 * Envelope types that are re-created per budget period. A period-scoped
 * envelope's `id` is unique to its period, so a transaction's `envelope_id`
 * already identifies which period it belongs to.
 */
const PERIOD_SCOPED_TYPES = ['spending', 'income', 'utility'] as const;

/**
 * Envelope types that keep the same row across periods (no per-period
 * recreation). Their balance is the all-time sum of their transactions.
 */
const PERSISTENT_TYPES = ['sinking_fund', 'emergency_fund', 'savings', 'baby_step'] as const;

/**
 * The minimal Drizzle database shape this query needs. Both the production
 * `ExpoSQLiteDatabase` (drizzle-orm/expo-sqlite) and the `BetterSQLite3Database`
 * used in the realsql test tier (drizzle-orm/better-sqlite3) extend this same
 * 'sync'-mode base class, so a single `db.all(sql\`...\`)` call works unchanged
 * against either engine. This is why no custom query-runner adapter is
 * needed: Drizzle's own `sql` tagged-template already parameterizes safely
 * and portably across both SQLite drivers, so we use it directly rather than
 * inventing a parallel abstraction.
 */
export type EnvelopeBalanceDb = BaseSQLiteDatabase<'sync', unknown, Record<string, unknown>>;

interface EnvelopeIdRow {
  id: string;
}

interface EnvelopeSpendRow {
  envelope_id: string;
  total_cents: number | null;
}

/** Renders a fixed, non-user-controlled list of envelope-type literals as a SQL IN(...) clause. */
function typeInClause(types: readonly string[]): string {
  return types.map((type) => `'${type}'`).join(',');
}

/**
 * The envelope-type/period scope predicate shared by every reader that
 * decides which envelope ROWS are "current" for `periodStart`: period-scoped
 * types only when their own `period_start` matches, persistent types
 * unconditionally (see the scope-rule doc above `getEnvelopeSpentCents`).
 *
 * Exported so other queries over the `envelopes` table (e.g.
 * `DrizzleEnvelopeRepository.listByHousehold`) apply the identical scope
 * instead of re-deriving it — reusing this predicate is what closes the bug
 * where `listByHousehold` returned every household envelope regardless of
 * period, leaking stale period-scoped rows into the current period's list.
 *
 * Callers still own `household_id` and `deleted_at` filtering; this only
 * covers the type/period part of the predicate so it composes cleanly with
 * both a hand-written raw `sql` WHERE (this file) and drizzle's
 * query-builder `.where(and(...))` (the repository).
 */
export function envelopeScopeCondition(periodStart: string): SQL {
  return sql`(
    (envelope_type IN (${sql.raw(typeInClause(PERIOD_SCOPED_TYPES))}) AND period_start = ${periodStart})
    OR envelope_type IN (${sql.raw(typeInClause(PERSISTENT_TYPES))})
  )`;
}

/**
 * Derived-balance read model: envelope spend computed by summing the
 * transaction ledger, instead of reading a stored `spent_cents` column.
 *
 * Scope rule:
 *  - period-scoped envelopes ('spending' | 'income' | 'utility') are
 *    re-created per budget period, so their `id` is already period-specific.
 *    A plain SUM of non-deleted transactions grouped by `envelope_id` is
 *    therefore period-correct with no additional date filtering — the
 *    period-scope filter only decides WHICH envelope rows are "this
 *    period's" (`period_start = periodStart`).
 *  - persistent envelopes ('sinking_fund' | 'emergency_fund' | 'savings' |
 *    'baby_step') keep the same row across periods, so the identical plain
 *    SUM per `envelope_id` is simultaneously their all-time total. They are
 *    included regardless of `period_start` since they are not recreated
 *    per period.
 *
 * Both scopes therefore reduce to the same transaction aggregate query; the
 * scope only changes which envelope rows are considered "current" for a
 * given call. (See task-1 report for the full reduction finding — this
 * matters for slice 4's rollover, not for this query.)
 *
 * Returns a Map of every matching household envelope's id to its spend in
 * cents, including 0 for envelopes with no (non-deleted) transactions.
 */
export async function getEnvelopeSpentCents(
  db: EnvelopeBalanceDb,
  householdId: string,
  periodStart: string,
): Promise<Map<string, number>> {
  const envelopeRows = (await db.all(
    sql`SELECT id FROM envelopes
        WHERE household_id = ${householdId}
          AND deleted_at IS NULL
          AND ${envelopeScopeCondition(periodStart)}`,
  )) as EnvelopeIdRow[];

  const result = new Map<string, number>();
  for (const row of envelopeRows) {
    result.set(row.id, 0);
  }
  if (result.size === 0) return result;

  // Scoped to exactly the envelope ids resolved above (`AND envelope_id IN
  // (...)`) rather than summing every household transaction and discarding
  // unrelated rows in JS — the aggregate now does proportional-to-result
  // work instead of proportional-to-the-whole-ledger work.
  const envelopeIdList = sql.join(
    Array.from(result.keys()).map((id) => sql`${id}`),
    sql.raw(', '),
  );

  const spendRows = (await db.all(
    sql`SELECT envelope_id, SUM(amount_cents) AS total_cents
        FROM transactions
        WHERE household_id = ${householdId}
          AND deleted_at IS NULL
          AND envelope_id IN (${envelopeIdList})
        GROUP BY envelope_id`,
  )) as EnvelopeSpendRow[];

  for (const row of spendRows) {
    if (result.has(row.envelope_id)) {
      result.set(row.envelope_id, row.total_cents ?? 0);
    }
  }

  return result;
}
