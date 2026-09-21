import { sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../shared/BudgetPeriodEngine';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import { computePeriodScore } from './computePeriodScore';
import { RecordPeriodScoreUseCase } from './RecordPeriodScoreUseCase';

export interface BackfillPeriodScoresInput {
  householdId: string;
  /** The household's `payday_day` — decides where every period boundary falls. */
  paydayDay: number;
  /** Test/DI seam for "now". Defaults to the real clock. */
  now?: Date;
}

export interface BackfillPeriodScoresOutput {
  /** Closed periods that have period-scoped envelopes, i.e. are scoreable at all. */
  scoreablePeriods: number;
  /** Periods this run actually wrote a `score_history` row for. */
  recorded: number;
  /** Those periods' keys, oldest first. */
  recordedPeriodStarts: string[];
  /** Periods whose existing row was written by an older formula and has been recomputed. */
  recomputed: number;
  /** Those periods' keys, oldest first. */
  recomputedPeriodStarts: string[];
}

interface PeriodKeyRow {
  period_start: string;
}

interface ScoredRow {
  period_start: string;
  components: string | null;
}

/**
 * True when a stored `components` JSON predates the meters-applicability
 * rule — i.e. has no `metersApplicable` key at all — and so holds a score
 * from the OLD formula, in which a household that has never logged a meter
 * reading was silently capped at 80.
 *
 * A row that cannot be parsed counts as stale too: an unreadable breakdown
 * is worth recomputing from the ledger, which is still there.
 */
function needsRecompute(componentsJson: string | null): boolean {
  if (!componentsJson) return true;
  try {
    const parsed: unknown = JSON.parse(componentsJson);
    if (parsed === null || typeof parsed !== 'object') return true;
    return !('metersApplicable' in (parsed as Record<string, unknown>));
  } catch {
    return true;
  }
}

const engine = new BudgetPeriodEngine();

/** The "there was nothing to do" result, so every early exit reports the same shape. */
const EMPTY_RESULT: BackfillPeriodScoresOutput = {
  scoreablePeriods: 0,
  recorded: 0,
  recordedPeriodStarts: [],
  recomputed: 0,
  recomputedPeriodStarts: [],
};

/** A `yyyy-MM-dd` period key as the UTC instant `BudgetPeriodEngine` builds its boundaries at. */
function periodKeyToUtcDate(periodKey: string): Date {
  const [year, month, day] = periodKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * BackfillPeriodScoresUseCase — records the `score_history` row every CLOSED
 * budget period should already have.
 *
 * WHY THIS EXISTS: a period's score is only ever written as a side effect of
 * the in-app rollover (`RolloverWizard` -> `RecordPeriodScoreUseCase`).
 * History that arrived any other way — through SYNC from a partner's device,
 * or through `RestoreService` on a reinstall/second phone — brings the
 * envelopes and transactions but runs none of the app's own side effects, so
 * it produces no scores. A household can therefore hold eighteen closed
 * periods of real budgeting and still show an empty score/level feature that
 * can never progress, which is precisely the state this was written for.
 *
 * WHAT COUNTS AS A CLOSED PERIOD: any `period_start` strictly before the
 * household's CURRENT period (per `BudgetPeriodEngine` and `paydayDay`) that
 * has at least one live period-scoped envelope. Periods with no envelopes are
 * not scoreable — there was no budget to keep — and are skipped, never
 * recorded as a zero.
 *
 * NO INVENTED DATA: each period is scored by `computePeriodScore`, the same
 * function a live rollover uses. A signal the household never recorded (this
 * one has zero meter readings) scores exactly as it would for a live period
 * with none — the query simply finds nothing — rather than being guessed at
 * or defaulted to something flattering.
 *
 * ONE-TIME REPAIR: a period whose row was written before the
 * meters-applicability rule (its `components` JSON has no `metersApplicable`
 * key) is RECOMPUTED once, so a household is never shown an old-formula
 * score sitting next to a new one in the same trend. The recomputed row then
 * carries the marker and is never touched again.
 *
 * IDEMPOTENT: periods that already have a current-formula row are filtered out, and
 * `RecordPeriodScoreUseCase` is itself id-deterministic and
 * `onConflictDoNothing`, so a second run writes nothing even if it races the
 * first. CHEAP WHEN IDLE: two small queries and no scoring work at all when
 * every closed period is already recorded. ORDERED oldest -> newest, so the
 * level replayed from the result sees history in the order it happened.
 * ATOMIC PER PERIOD: each period is one single-row insert; a failure part way
 * through leaves the periods already recorded intact and simply returns a
 * failure, and the next run picks up where this one stopped.
 */
export class BackfillPeriodScoresUseCase {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async execute(input: BackfillPeriodScoresInput): Promise<Result<BackfillPeriodScoresOutput>> {
    try {
      const referenceDate = input.now ?? new Date();
      const currentPeriodStart = formatPeriodDateKey(
        engine.getCurrentPeriod(input.paydayDay, referenceDate).startDate,
      );

      // Query 1: the distinct closed periods that actually have a budget.
      const periodRows = (await this.db.all(
        sql`SELECT DISTINCT period_start AS period_start
            FROM envelopes
            WHERE household_id = ${input.householdId}
              AND deleted_at IS NULL
              AND is_archived = 0
              AND envelope_type IN ('spending','income','utility')
              AND period_start < ${currentPeriodStart}
            ORDER BY period_start ASC`,
      )) as PeriodKeyRow[];

      if (periodRows.length === 0) {
        return createSuccess(EMPTY_RESULT);
      }

      // Query 2: which of them are already scored, and with which formula.
      // Read once, in bulk — asking per period would turn a no-op run into N
      // round trips.
      const scoredRows = (await this.db.all(
        sql`SELECT period_start AS period_start, components AS components
            FROM score_history
            WHERE household_id = ${input.householdId}`,
      )) as ScoredRow[];

      const staleByPeriod = new Map<string, boolean>();
      for (const row of scoredRows) {
        staleByPeriod.set(row.period_start, needsRecompute(row.components));
      }

      // A period is work if it has no row at all, or an old-formula row.
      // Everything else is skipped, which is what keeps a second run free.
      const todo = periodRows
        .map((row) => row.period_start)
        .filter((periodStart) => staleByPeriod.get(periodStart) !== false);

      if (todo.length === 0) {
        return createSuccess({
          ...EMPTY_RESULT,
          scoreablePeriods: periodRows.length,
        });
      }

      const recorder = new RecordPeriodScoreUseCase(this.db);
      const recordedPeriodStarts: string[] = [];
      const recomputedPeriodStarts: string[] = [];

      for (const periodStart of todo) {
        const isRecompute = staleByPeriod.has(periodStart);
        // The period's OWN end date, from the engine — not "the next recorded
        // period's start minus a day". Skipped periods are normal in this
        // history, and dividing logging days by a multi-month window would
        // collapse a good period's score to a fraction of what it earned
        // (the same trap `closingPeriodEnd` documents in RolloverWizard).
        const periodEnd = formatPeriodDateKey(
          engine.getPeriodForDate(input.paydayDay, periodKeyToUtcDate(periodStart)).endDate,
        );

        const score = await computePeriodScore(this.db, input.householdId, periodStart, periodEnd);

        const recorded = await recorder.execute({
          householdId: input.householdId,
          periodStart,
          periodEnd,
          score,
          overwriteExisting: isRecompute,
        });

        if (!recorded.success) {
          return createFailure({
            code: 'backfill_period_scores_failed',
            message: `Failed to record score for ${periodStart}: ${recorded.error.message}`,
          });
        }
        if (recorded.data.created) recordedPeriodStarts.push(periodStart);
        else if (recorded.data.updated) recomputedPeriodStarts.push(periodStart);
      }

      return createSuccess({
        scoreablePeriods: periodRows.length,
        recorded: recordedPeriodStarts.length,
        recordedPeriodStarts,
        recomputed: recomputedPeriodStarts.length,
        recomputedPeriodStarts,
      });
    } catch (err) {
      return createFailure({
        code: 'backfill_period_scores_failed',
        message: err instanceof Error ? err.message : 'Failed to backfill period scores',
      });
    }
  }
}
