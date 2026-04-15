export interface HabitScoreInput {
  loggingDaysCount: number; // days with at least one transaction logged
  totalDaysInPeriod: number; // calendar days in the current budget period
  envelopesOnBudget: number; // envelopes where spentCents <= allocatedCents
  totalEnvelopes: number;
  meterReadingsLoggedThisPeriod: boolean;
  babyStepIsActive: boolean;
}

export interface HabitScoreResult {
  score: number; // 0–100
  loggingPoints: number; // 0–30
  disciplinePoints: number; // 0–30
  metersPoints: number; // 0–20
  babyStepPoints: number; // 0–20
}

export class HabitScoreCalculator {
  calculate(input: HabitScoreInput): HabitScoreResult {
    const loggingPoints =
      input.totalDaysInPeriod > 0
        ? Math.min(30, Math.round((input.loggingDaysCount / input.totalDaysInPeriod) * 30))
        : 0;

    const disciplinePoints =
      input.totalEnvelopes > 0
        ? Math.min(30, Math.round((input.envelopesOnBudget / input.totalEnvelopes) * 30))
        : 30; // no envelopes = nothing to overspend

    const metersPoints = input.meterReadingsLoggedThisPeriod ? 20 : 0;
    const babyStepPoints = input.babyStepIsActive ? 20 : 0;

    const score = Math.min(100, loggingPoints + disciplinePoints + metersPoints + babyStepPoints);

    return { score, loggingPoints, disciplinePoints, metersPoints, babyStepPoints };
  }
}

// Back-compat aliases — remove once all callers are migrated.
export type RamseyScoreInput = HabitScoreInput;
export type RamseyScoreResult = HabitScoreResult;
/** @deprecated Use HabitScoreCalculator */
export const RamseyScoreCalculator = HabitScoreCalculator;
