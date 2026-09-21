import { sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import type { HabitScoreEnvelopeInput } from './buildHabitScoreInput';
import { HabitScoreCalculator } from './RamseyScoreCalculator';
import type { HabitScoreResult } from './RamseyScoreCalculator';
import { resolvePeriodHabitScoreInput } from './resolvePeriodHabitScoreInput';

/** Exactly the envelope types `isRolloverSource` treats as PERIOD-scoped. */
const PERIOD_SCOPED_TYPES = "'spending','income','utility'";

interface PeriodEnvelopeRow {
  envelope_type: string;
  allocated_cents: number;
  spent_cents: number | null;
}

const calculator = new HabitScoreCalculator();

/**
 * The period-scoped, non-archived, non-deleted envelopes of `periodStart`
 * with their spend — the SAME envelope set `RolloverWizard` hands
 * `resolvePeriodHabitScoreInput` when it scores a closing period
 * (`loadPeriodScopedEnvelopes` -> `isRolloverSource`), and the same
 * transaction-sum balance rule as `getEnvelopeSpentCents`.
 *
 * One aggregate query, not a ledger read: a correlated SUM per envelope row
 * keeps this proportional to the period's ~12 envelopes instead of pulling
 * the household's entire transaction table into JS once per period (887
 * rows x 18 periods, for a household this size).
 */
export async function loadPeriodScoreEnvelopes(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
  periodStart: string,
): Promise<HabitScoreEnvelopeInput[]> {
  const rows = (await db.all(
    sql`SELECT e.envelope_type AS envelope_type,
               e.allocated_cents AS allocated_cents,
               COALESCE((
                 SELECT SUM(t.amount_cents) FROM transactions t
                 WHERE t.envelope_id = e.id AND t.deleted_at IS NULL
               ), 0) AS spent_cents
        FROM envelopes e
        WHERE e.household_id = ${householdId}
          AND e.deleted_at IS NULL
          AND e.is_archived = 0
          AND e.period_start = ${periodStart}
          AND e.envelope_type IN (${sql.raw(PERIOD_SCOPED_TYPES)})`,
  )) as PeriodEnvelopeRow[];

  return rows.map((row) => ({
    envelopeType: row.envelope_type,
    allocatedCents: row.allocated_cents,
    spentCents: row.spent_cents ?? 0,
  }));
}

/**
 * The habit score `[periodStart, periodEnd]` earns, computed from the
 * ledger through the EXACT calculation a rollover uses:
 * `resolvePeriodHabitScoreInput` (logging days, meter readings, baby-step
 * activity) -> `buildHabitScoreInput` -> `HabitScoreCalculator`.
 *
 * Shared on purpose. `BackfillPeriodScoresUseCase` scores a period that
 * closed months ago, and `RolloverWizard` scores the one closing right now;
 * running both through this one function is what makes a backfilled score
 * and a live one the same number rather than two implementations that agree
 * only until someone edits one of them.
 *
 * Signals that did not exist historically need no special-casing: a period
 * with no meter readings scores its 0 meter points here exactly as a live
 * period with none would, because both ask the same query the same question.
 */
export async function computePeriodScore(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
  periodStart: string,
  periodEnd: string,
): Promise<HabitScoreResult> {
  const envelopes = await loadPeriodScoreEnvelopes(db, householdId, periodStart);
  const input = await resolvePeriodHabitScoreInput(
    db,
    householdId,
    periodStart,
    periodEnd,
    envelopes,
  );
  return calculator.calculate(input);
}
