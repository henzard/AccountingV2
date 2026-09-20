import { and, desc, eq, lt } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { scoreHistory } from '../../data/local/schema';
import type { DebtSnapshot } from './RecordPeriodScoreUseCase';

function parseDebtSnapshot(componentsJson: string | null): DebtSnapshot | null {
  if (!componentsJson) return null;
  try {
    const parsed: unknown = JSON.parse(componentsJson);
    if (parsed === null || typeof parsed !== 'object') return null;
    const snapshot = (parsed as { debtSnapshot?: unknown }).debtSnapshot;
    if (snapshot === null || typeof snapshot !== 'object') return null;
    const { totalDebtCents, debtFreeDateISO } = snapshot as Partial<DebtSnapshot>;
    if (typeof totalDebtCents !== 'number') return null;
    if (debtFreeDateISO !== null && typeof debtFreeDateISO !== 'string') return null;
    return { totalDebtCents, debtFreeDateISO: debtFreeDateISO ?? null };
  } catch {
    return null;
  }
}

/**
 * The most recently closed period's debt-plan snapshot (VAL2-10) — i.e.
 * "last month's" `{ totalDebtCents, debtFreeDateISO }` — for the Snowball
 * dashboard's "N months sooner/later than last month" line. Reads
 * `score_history`, which is device-local (see `RecordPeriodScoreUseCase`'s
 * doc comment), so this only ever reflects what THIS device has recorded.
 *
 * Walks backward from (but excluding) `beforePeriodStart` until it finds a
 * row whose `components` JSON carries a well-formed `debtSnapshot` — rows
 * written before this feature shipped, or whose snapshot computation
 * failed, have none and are skipped rather than surfaced as bad data.
 */
export async function getLatestDebtSnapshot(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
  beforePeriodStart: string,
): Promise<DebtSnapshot | null> {
  const rows = await db
    .select({ components: scoreHistory.components })
    .from(scoreHistory)
    .where(
      and(
        eq(scoreHistory.householdId, householdId),
        lt(scoreHistory.periodStart, beforePeriodStart),
      ),
    )
    .orderBy(desc(scoreHistory.periodStart));

  for (const row of rows) {
    const snapshot = parseDebtSnapshot(row.components);
    if (snapshot) return snapshot;
  }
  return null;
}
