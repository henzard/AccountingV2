import { useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { LevelAdvancementEvaluator } from '../../domain/scoring/LevelAdvancementEvaluator';
import { getPeriodScoresAscending } from '../../domain/scoring/getPeriodScoresAscending';
import { db } from '../../data/local/db';

const evaluator = new LevelAdvancementEvaluator();

/** Ceiling of `appStore.userLevel`'s `1 | 2 | 3` type — bounds `hydrate`'s replay loop. */
const MAX_LEVEL = 3;

export interface UseLevelAdvancementResult {
  check: (recentScores: number[]) => void;
  hydrate: (householdId: string) => Promise<void>;
}

/**
 * Call `check(recentScores)` after a period score is calculated.
 * Automatically advances userLevel to 2 when three consecutive periods
 * each score >= 70 (as defined by LevelAdvancementEvaluator).
 * Level demotion is intentionally not supported — users keep earned levels.
 *
 * `hydrate(householdId)` derives the CURRENT level from durable local
 * history instead: `appStore.userLevel` is in-memory only (no persist
 * middleware — see appStore.ts), so without this every cold start shows
 * Lv1 in Settings until the next rollover happens to call `check()` again.
 * Call it once when a household becomes available (e.g. DashboardScreen on
 * `householdId` change) to hydrate the badge immediately.
 */
export function useLevelAdvancement(): UseLevelAdvancementResult {
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

  const hydrate = useCallback(
    async (householdId: string): Promise<void> => {
      const history = await getPeriodScoresAscending(db, householdId);
      const scores = history.map((row) => row.score);

      // Replay the evaluator from Lv1 across the FULL history (not just
      // `userLevel`'s current in-memory value — a different household, or a
      // history with no rows, must land wherever ITS OWN history says, even
      // if that's back down to Lv1 from whatever the previous household's
      // session state was).
      //
      // `evaluate()` only ever reports "advance ONE level from here"
      // (`shouldAdvanceToLevel2`), so this loop advances at most one level
      // per pass and repeats until nothing further advances, bounded by
      // `MAX_LEVEL` so a future evaluator bug can't spin. NOTE: there is
      // currently no Level 2 -> 3 (Mentor) rule anywhere in
      // `LevelAdvancementEvaluator` or the product spec — the PRD instead
      // describes Mentor as an invited/linked advisor role (FR-50), not one
      // reached by score — so today this loop always settles at Lv1 or Lv2.
      // It is written to advance one level at a time specifically so it
      // needs no changes if a real Lv2->Lv3 rule is ever added.
      let level: 1 | 2 | 3 = 1;
      let advanced = true;
      while (advanced && level < MAX_LEVEL) {
        advanced = false;
        const result = evaluator.evaluate(scores);
        if (level === 1 && result.shouldAdvanceToLevel2) {
          level = 2;
          advanced = true;
        }
        // else if (level === 2 && result.shouldAdvanceToLevel3) { level = 3; advanced = true; }
      }

      setUserLevel(level);
    },
    [setUserLevel],
  );

  return { check, hydrate };
}
