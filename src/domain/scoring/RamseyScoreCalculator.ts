export interface HabitScoreInput {
  loggingDaysCount: number; // days with at least one transaction logged
  totalDaysInPeriod: number; // calendar days in the current budget period
  envelopesOnBudget: number; // envelopes where spentCents <= allocatedCents
  totalEnvelopes: number;
  meterReadingsLoggedThisPeriod: boolean;
  babyStepIsActive: boolean;
  /**
   * Whether the METERS component applies to this household for this period
   * at all — i.e. whether they had EVER logged a meter reading by the end of
   * it (see `resolveMetersApplicable`).
   *
   * Meters are all-or-nothing 20 of 100 points. For a household that has
   * never used the feature — and may never: it is optional — that is a hard
   * ceiling of 80 they can do nothing about, which puts the Lv1 -> Lv2 rule
   * (three periods at 70+) within a few points of unreachable and Lv2 -> Lv3
   * (85+) out of reach entirely, however disciplined they actually are. A
   * component for a feature the household does not use must not cap their
   * score, so when this is false the component is EXCLUDED and the remaining
   * 80 points are re-normalised to 100.
   *
   * Omitted is treated as APPLICABLE, so every existing caller and every
   * previously recorded score keeps its exact meaning.
   */
  metersApplicable?: boolean;
}

export interface HabitScoreResult {
  score: number; // 0–100
  loggingPoints: number; // 0–30
  disciplinePoints: number; // 0–30
  /** 0–20, or null when the meters component did not apply (see `metersApplicable`). */
  metersPoints: number | null;
  babyStepPoints: number; // 0–20
  /**
   * Explicit applicability marker, and the thing that makes a stored
   * `score_history.components` row self-describing: a row written before
   * this existed has NO `metersApplicable` key at all, which is how
   * `BackfillPeriodScoresUseCase` recognises an old-formula row and
   * recomputes it exactly once. Readers must tolerate its absence.
   */
  metersApplicable: boolean;
}

/** Point ceilings per component — the denominator re-normalisation divides by. */
const MAX_LOGGING_POINTS = 30;
const MAX_DISCIPLINE_POINTS = 30;
const MAX_METERS_POINTS = 20;
const MAX_BABY_STEP_POINTS = 20;
const MAX_SCORE = 100;
/** What is still winnable once the meters component is excluded. */
const MAX_SCORE_WITHOUT_METERS = MAX_LOGGING_POINTS + MAX_DISCIPLINE_POINTS + MAX_BABY_STEP_POINTS;

export class HabitScoreCalculator {
  calculate(input: HabitScoreInput): HabitScoreResult {
    const loggingPoints =
      input.totalDaysInPeriod > 0
        ? Math.min(
            MAX_LOGGING_POINTS,
            Math.round((input.loggingDaysCount / input.totalDaysInPeriod) * MAX_LOGGING_POINTS),
          )
        : 0;

    const disciplinePoints =
      input.totalEnvelopes > 0
        ? Math.min(
            MAX_DISCIPLINE_POINTS,
            Math.round((input.envelopesOnBudget / input.totalEnvelopes) * MAX_DISCIPLINE_POINTS),
          )
        : MAX_DISCIPLINE_POINTS; // no envelopes = nothing to overspend

    const babyStepPoints = input.babyStepIsActive ? MAX_BABY_STEP_POINTS : 0;

    // NOT APPLICABLE: drop the component and re-normalise what is left onto
    // the same 0–100 scale, so the level thresholds keep meaning the same
    // thing for a household that uses meters and one that never will.
    if (input.metersApplicable === false) {
      const earned = loggingPoints + disciplinePoints + babyStepPoints;
      return {
        score: Math.min(MAX_SCORE, Math.round((earned / MAX_SCORE_WITHOUT_METERS) * MAX_SCORE)),
        loggingPoints,
        disciplinePoints,
        metersPoints: null,
        babyStepPoints,
        metersApplicable: false,
      };
    }

    const metersPoints = input.meterReadingsLoggedThisPeriod ? MAX_METERS_POINTS : 0;

    return {
      score: Math.min(MAX_SCORE, loggingPoints + disciplinePoints + metersPoints + babyStepPoints),
      loggingPoints,
      disciplinePoints,
      metersPoints,
      babyStepPoints,
      metersApplicable: true,
    };
  }
}

// Back-compat aliases — remove once all callers are migrated.
export type RamseyScoreInput = HabitScoreInput;
export type RamseyScoreResult = HabitScoreResult;
/** @deprecated Use HabitScoreCalculator */
export const RamseyScoreCalculator = HabitScoreCalculator;
