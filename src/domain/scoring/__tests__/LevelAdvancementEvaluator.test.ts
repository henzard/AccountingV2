import { LevelAdvancementEvaluator } from '../LevelAdvancementEvaluator';

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
});
