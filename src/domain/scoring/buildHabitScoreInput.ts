import type { HabitScoreInput } from './RamseyScoreCalculator';

/** The envelope fields the on-budget count actually needs. */
export interface HabitScoreEnvelopeInput {
  spentCents: number;
  allocatedCents: number;
  /**
   * The envelope's type, when the caller knows it. `'income'` envelopes are
   * EXCLUDED from the on-budget count entirely: a transaction on an income
   * envelope is money coming IN (a salary deposit), not spending, so
   * `spentCents > allocatedCents` there means "paid more than budgeted for",
   * which is good news being scored as an overspend.
   *
   * `DashboardScreen`'s live score never hit this because it feeds
   * `selectSpendEnvelopes`' already income-free list (DOM-5/UX-4/VAL-1), but
   * `RolloverWizard` feeds `isRolloverSource`'s list, which is every
   * PERIOD-scoped type — 'spending' | 'income' | 'utility' — so the closing
   * period's recorded score silently counted the household's income envelope
   * as one more envelope that could "overspend". Filtering here (rather than
   * at each call site) is what keeps every score path on one rule.
   *
   * Omitted is treated as a non-income envelope, so a caller that has already
   * filtered income out (the dashboard) needs no change.
   */
  envelopeType?: string;
}

export interface BuildHabitScoreInputParams {
  loggingDaysCount: number;
  totalDaysInPeriod: number;
  /** Period-scoped spend envelopes for the period being scored. */
  envelopes: HabitScoreEnvelopeInput[];
  meterReadingsLoggedThisPeriod: boolean;
  babyStepIsActive: boolean;
  /**
   * Whether the household had EVER logged a meter reading by this period's
   * end (`resolveMetersApplicable`). Omitted = applicable, which keeps every
   * existing caller's behaviour identical. See `HabitScoreInput`.
   */
  metersApplicable?: boolean;
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
  // Income envelopes are money IN, never spending — see `envelopeType`.
  const scoredEnvelopes = params.envelopes.filter((e) => e.envelopeType !== 'income');
  const envelopesOnBudget = scoredEnvelopes.filter((e) => e.spentCents <= e.allocatedCents).length;

  return {
    loggingDaysCount: params.loggingDaysCount,
    totalDaysInPeriod: params.totalDaysInPeriod,
    envelopesOnBudget,
    totalEnvelopes: scoredEnvelopes.length,
    meterReadingsLoggedThisPeriod: params.meterReadingsLoggedThisPeriod,
    babyStepIsActive: params.babyStepIsActive,
    metersApplicable: params.metersApplicable,
  };
}
