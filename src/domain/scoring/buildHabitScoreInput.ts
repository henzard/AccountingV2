import type { HabitScoreInput } from './RamseyScoreCalculator';

/** The two envelope fields the on-budget count actually needs. */
export interface HabitScoreEnvelopeInput {
  spentCents: number;
  allocatedCents: number;
}

export interface BuildHabitScoreInputParams {
  loggingDaysCount: number;
  totalDaysInPeriod: number;
  /** Period-scoped spend envelopes for the period being scored. */
  envelopes: HabitScoreEnvelopeInput[];
  meterReadingsLoggedThisPeriod: boolean;
  babyStepIsActive: boolean;
}

/**
 * Pure assembly of `HabitScoreCalculator.calculate`'s input from raw period
 * data. Extracted from `DashboardScreen`'s inline block (VAL-14/DOM-13) so
 * both the dashboard's LIVE (current, still-open period) score and
 * `RecordPeriodScoreUseCase`'s CLOSING-period score go through the exact
 * same "on budget" rule — `spentCents <= allocatedCents` — instead of two
 * copies that could silently drift apart.
 */
export function buildHabitScoreInput(params: BuildHabitScoreInputParams): HabitScoreInput {
  const envelopesOnBudget = params.envelopes.filter((e) => e.spentCents <= e.allocatedCents).length;

  return {
    loggingDaysCount: params.loggingDaysCount,
    totalDaysInPeriod: params.totalDaysInPeriod,
    envelopesOnBudget,
    totalEnvelopes: params.envelopes.length,
    meterReadingsLoggedThisPeriod: params.meterReadingsLoggedThisPeriod,
    babyStepIsActive: params.babyStepIsActive,
  };
}
