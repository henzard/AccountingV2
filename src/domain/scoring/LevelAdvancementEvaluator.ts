export interface LevelEvaluationResult {
  shouldAdvanceToLevel2: boolean;
  shouldShowCoachingWarning: boolean;
}

export class LevelAdvancementEvaluator {
  private static readonly ADVANCE_THRESHOLD = 70;
  private static readonly WARNING_THRESHOLD = 60;

  evaluate(recentScores: number[]): LevelEvaluationResult {
    const lastThree = recentScores.slice(-3);
    const shouldAdvanceToLevel2 =
      lastThree.length >= 3 &&
      lastThree.every((s) => s >= LevelAdvancementEvaluator.ADVANCE_THRESHOLD);

    const lastTwo = recentScores.slice(-2);
    const shouldShowCoachingWarning =
      lastTwo.length >= 2 && lastTwo.every((s) => s < LevelAdvancementEvaluator.WARNING_THRESHOLD);

    return { shouldAdvanceToLevel2, shouldShowCoachingWarning };
  }
}
