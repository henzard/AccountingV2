import { asc, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { scoreHistory } from '../../data/local/schema';

export interface PeriodScoreRow {
  periodStart: string;
  score: number;
}

/**
 * Every recorded `score_history` row for `householdId`, oldest period
 * first. Reads local-only data (see `RecordPeriodScoreUseCase`'s doc
 * comment — `score_history` is never synced), so this only ever reflects
 * what THIS device has recorded/received.
 *
 * Oldest-first ordering matters to both call sites: `useLevelAdvancement`'s
 * `check(recentScores)` reads its last 3/2 entries as the MOST RECENT
 * periods (`Array.prototype.slice(-3)`), and `RolloverWizard`'s review step
 * wants the single most recently closed period, i.e. the last entry here.
 */
export async function getPeriodScoresAscending(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
): Promise<PeriodScoreRow[]> {
  const rows = await db
    .select({ periodStart: scoreHistory.periodStart, score: scoreHistory.score })
    .from(scoreHistory)
    .where(eq(scoreHistory.householdId, householdId))
    .orderBy(asc(scoreHistory.periodStart));

  return rows
    .filter((row): row is { periodStart: string; score: number } => row.score !== null)
    .map((row) => ({ periodStart: row.periodStart ?? '', score: row.score }));
}
