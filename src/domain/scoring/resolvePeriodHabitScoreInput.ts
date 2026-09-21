import { differenceInDays, parseISO } from 'date-fns';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { resolveLoggingDays } from './resolveLoggingDays';
import { resolveBabyStepIsActive } from '../shared/resolveBabyStepIsActive';
import { resolveMeterReadingsLogged } from '../../presentation/screens/dashboard/resolveMeterReadingsLogged';
import { resolveMetersApplicable } from './resolveMetersApplicable';
import { buildHabitScoreInput } from './buildHabitScoreInput';
import type { HabitScoreEnvelopeInput } from './buildHabitScoreInput';
import type { HabitScoreInput } from './RamseyScoreCalculator';

/**
 * Thin data-loading wrapper around `buildHabitScoreInput`: loads the three
 * async period signals (logging days, meter readings, baby-step activity)
 * for `[periodStart, periodEnd]` and assembles them, alongside the given
 * envelope list, into a `HabitScoreInput` ready for `HabitScoreCalculator`.
 *
 * Used by `RecordPeriodScoreUseCase` to score the CLOSING period from real
 * data rather than a dashboard's live in-memory state — `DashboardScreen`
 * itself already holds these three signals as focus-effect state (see its
 * own `useFocusEffect`), so it calls `buildHabitScoreInput` directly instead
 * of this wrapper, but both paths produce input in exactly the same shape.
 */
export async function resolvePeriodHabitScoreInput(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
  periodStart: string,
  periodEnd: string,
  envelopes: HabitScoreEnvelopeInput[],
): Promise<HabitScoreInput> {
  const [loggingDaysCount, meterReadingsLoggedThisPeriod, babyStepIsActive, metersApplicable] =
    await Promise.all([
      resolveLoggingDays(db, householdId, periodStart, periodEnd),
      resolveMeterReadingsLogged(db, householdId, periodStart, periodEnd),
      resolveBabyStepIsActive(db, householdId),
      resolveMetersApplicable(db, householdId, periodEnd),
    ]);

  const totalDaysInPeriod = differenceInDays(parseISO(periodEnd), parseISO(periodStart)) + 1;

  return buildHabitScoreInput({
    loggingDaysCount,
    totalDaysInPeriod,
    envelopes,
    meterReadingsLoggedThisPeriod,
    babyStepIsActive,
    metersApplicable,
  });
}
