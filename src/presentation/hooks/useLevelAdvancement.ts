import { useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { LevelAdvancementEvaluator } from '../../domain/scoring/LevelAdvancementEvaluator';

const evaluator = new LevelAdvancementEvaluator();

/**
 * Call `check(recentScores)` after a period score is calculated.
 * Automatically advances userLevel to 2 when three consecutive periods
 * each score >= 70 (as defined by LevelAdvancementEvaluator).
 * Level demotion is intentionally not supported — users keep earned levels.
 */
export function useLevelAdvancement(): { check: (recentScores: number[]) => void } {
  const userLevel = useAppStore((s) => s.userLevel);
  const setUserLevel = useAppStore((s) => s.setUserLevel);

  const check = useCallback(
    (recentScores: number[]): void => {
      if (userLevel >= 2) return;
      const { shouldAdvanceToLevel2 } = evaluator.evaluate(recentScores);
      if (shouldAdvanceToLevel2) {
        setUserLevel(2);
      }
    },
    [userLevel, setUserLevel],
  );

  return { check };
}
