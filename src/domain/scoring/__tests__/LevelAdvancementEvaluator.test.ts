import {
  LevelAdvancementEvaluator,
  LEVEL_RULES,
  deriveLevelFromScores,
  describeLevelProgress,
} from '../LevelAdvancementEvaluator';

describe('LevelAdvancementEvaluator', () => {
  const evaluator = new LevelAdvancementEvaluator();

  it('advances when last 3 scores are all >= 70', () => {
    const result = evaluator.evaluate([55, 72, 75, 80]);
    expect(result.shouldAdvanceToLevel2).toBe(true);
    expect(result.shouldShowCoachingWarning).toBe(false);
  });

  it('does not advance when only 2 scores >= 70', () => {
    const result = evaluator.evaluate([55, 45, 75, 80]);
    expect(result.shouldAdvanceToLevel2).toBe(false);
  });

  it('does not advance when fewer than 3 scores provided', () => {
    const result = evaluator.evaluate([75, 80]);
    expect(result.shouldAdvanceToLevel2).toBe(false);
  });

  it('shows coaching warning when last 2 scores are both < 60', () => {
    const result = evaluator.evaluate([75, 80, 55, 45]);
    expect(result.shouldShowCoachingWarning).toBe(true);
    expect(result.shouldAdvanceToLevel2).toBe(false);
  });

  it('does not show coaching warning when only 1 of last 2 is < 60', () => {
    const result = evaluator.evaluate([75, 80, 55, 65]);
    expect(result.shouldShowCoachingWarning).toBe(false);
  });

  it('does not show coaching warning with fewer than 2 scores', () => {
    const result = evaluator.evaluate([45]);
    expect(result.shouldShowCoachingWarning).toBe(false);
  });

  // ── Level 2 -> 3 (Mentor) ────────────────────────────────────────────────
  // Same shape as the Lv1->Lv2 rule, both dials turned up — see LEVEL_RULES'
  // PRODUCT DEFAULT note. These assert the rule as implemented; the numbers
  // are read from LEVEL_RULES so a confirmed product change moves both.
  describe('level 3', () => {
    it(`advances when the last ${LEVEL_RULES.level3.streak} scores all reach ${LEVEL_RULES.level3.minScore}`, () => {
      const scores = Array(LEVEL_RULES.level3.streak).fill(LEVEL_RULES.level3.minScore);
      expect(evaluator.evaluate(scores).shouldAdvanceToLevel3).toBe(true);
      expect(deriveLevelFromScores(scores)).toBe(3);
    });

    it('does not advance when the streak is one period short', () => {
      const scores = Array(LEVEL_RULES.level3.streak - 1).fill(95);
      expect(evaluator.evaluate(scores).shouldAdvanceToLevel3).toBe(false);
      expect(deriveLevelFromScores(scores)).toBe(2);
    });

    it('does not advance when one period inside the streak dipped below the threshold', () => {
      const scores = Array(LEVEL_RULES.level3.streak).fill(95);
      scores[scores.length - 2] = LEVEL_RULES.level3.minScore - 1;
      expect(evaluator.evaluate(scores).shouldAdvanceToLevel3).toBe(false);
      expect(deriveLevelFromScores(scores)).toBe(2);
    });

    it('a long history that only clears the Lv2 bar stays at Lv2', () => {
      const scores = Array(12).fill(LEVEL_RULES.level2.minScore);
      expect(deriveLevelFromScores(scores)).toBe(2);
    });

    it('an empty history is Lv1', () => {
      expect(deriveLevelFromScores([])).toBe(1);
    });
  });

  describe('describeLevelProgress', () => {
    it('counts only the CURRENT trailing run towards the next level', () => {
      const progress = describeLevelProgress(1, [90, 30, 75, 80]);
      expect(progress.nextLevelName).toBe('Practitioner');
      expect(progress.periodsRemaining).toBe(1);
      expect(progress.message).toBe('1 more period scoring 70+ to reach Practitioner.');
    });

    it('starts the run again after a period that missed the threshold', () => {
      const progress = describeLevelProgress(1, [90, 95, 40]);
      expect(progress.periodsRemaining).toBe(LEVEL_RULES.level2.streak);
      expect(progress.message).toBe('3 more periods scoring 70+ to reach Practitioner.');
    });

    it('describes the Lv2 -> Lv3 climb for a Practitioner', () => {
      const progress = describeLevelProgress(2, [95, 95]);
      expect(progress.nextLevelName).toBe('Mentor');
      expect(progress.periodsRemaining).toBe(LEVEL_RULES.level3.streak - 2);
      expect(progress.minScore).toBe(LEVEL_RULES.level3.minScore);
    });

    it('has no next level at the ceiling', () => {
      const progress = describeLevelProgress(3, [95, 95, 95]);
      expect(progress.nextLevelName).toBeNull();
      expect(progress.periodsRemaining).toBeNull();
      expect(progress.message).toContain('highest level');
    });

    it('tells a brand-new household exactly what the first level-up takes', () => {
      const progress = describeLevelProgress(1, []);
      expect(progress.levelName).toBe('Learner');
      expect(progress.message).toBe('3 more periods scoring 70+ to reach Practitioner.');
    });
  });
});
