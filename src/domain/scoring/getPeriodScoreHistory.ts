import { asc, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { scoreHistory } from '../../data/local/schema';
import type { HabitScoreResult } from './RamseyScoreCalculator';

export interface PeriodScoreHistoryEntry {
  periodStart: string;
  score: number;
  /**
   * The point breakdown stored in `components`, when it is well-formed.
   * Null for a row whose JSON is unreadable or predates the current shape —
   * the score itself still stands, only its explanation is missing.
   */
  breakdown: HabitScoreResult | null;
}

/** `components` JSON -> breakdown, or null when it is not the shape we expect. */
function parseBreakdown(componentsJson: string | null, score: number): HabitScoreResult | null {
  if (!componentsJson) return null;
  try {
    const parsed: unknown = JSON.parse(componentsJson);
    if (parsed === null || typeof parsed !== 'object') return null;
    const { loggingPoints, disciplinePoints, metersPoints, babyStepPoints, metersApplicable } =
      parsed as Partial<HabitScoreResult>;
    if (
      typeof loggingPoints !== 'number' ||
      typeof disciplinePoints !== 'number' ||
      typeof babyStepPoints !== 'number'
    ) {
      return null;
    }
    // `metersApplicable` is ABSENT on every row written before the
    // applicability rule existed, and those rows always carry a numeric
    // `metersPoints`. Absent therefore reads as "applicable", which is
    // exactly what such a row meant when it was written — the backfill
    // recomputes it separately rather than this reader guessing at it.
    const applicable = metersApplicable !== false;
    if (applicable && typeof metersPoints !== 'number') return null;
    return {
      score,
      loggingPoints,
      disciplinePoints,
      metersPoints: applicable ? (metersPoints as number) : null,
      babyStepPoints,
      metersApplicable: applicable,
    };
  } catch {
    return null;
  }
}

/**
 * Every recorded period score for `householdId`, oldest period first, WITH
 * its point breakdown.
 *
 * `getPeriodScoresAscending` deliberately stays as it is — its two callers
 * (`useLevelAdvancement`, `RolloverWizard`) want bare numbers and nothing
 * else. This is the read the score/level SURFACE needs: the latest period's
 * breakdown in plain language, and the trend behind it.
 *
 * Reads local-only data (`score_history` is absent from the server's
 * `c_tables` allowlist — see `RecordPeriodScoreUseCase`), so it reflects what
 * THIS device has recorded, which for a synced history is whatever
 * `BackfillPeriodScoresUseCase` has computed.
 */
export async function getPeriodScoreHistory(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
): Promise<PeriodScoreHistoryEntry[]> {
  const rows = await db
    .select({
      periodStart: scoreHistory.periodStart,
      score: scoreHistory.score,
      components: scoreHistory.components,
    })
    .from(scoreHistory)
    .where(eq(scoreHistory.householdId, householdId))
    .orderBy(asc(scoreHistory.periodStart));

  return rows
    .filter(
      (row): row is { periodStart: string | null; score: number; components: string | null } =>
        row.score !== null,
    )
    .map((row) => ({
      periodStart: row.periodStart ?? '',
      score: row.score,
      breakdown: parseBreakdown(row.components, row.score),
    }));
}
