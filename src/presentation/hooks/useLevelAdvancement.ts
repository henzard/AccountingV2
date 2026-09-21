import { useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import {
  LevelAdvancementEvaluator,
  deriveLevelFromScores,
  MAX_LEVEL,
} from '../../domain/scoring/LevelAdvancementEvaluator';
import { getPeriodScoresAscending } from '../../domain/scoring/getPeriodScoresAscending';
import { PersistUserLevelUseCase } from '../../domain/scoring/PersistUserLevelUseCase';
import { db } from '../../data/local/db';
import { logger } from '../../infrastructure/logging/Logger';

const evaluator = new LevelAdvancementEvaluator();

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
 *
 * `hydrate` is also where the derived level is PERSISTED, through
 * `PersistUserLevelUseCase` — the one synced writer of
 * `households.user_level`, which writes only on a real increase. `check`
 * stays in-memory-only on purpose: it fires inside the rollover's
 * best-effort score block, and the very next `hydrate` (next screen focus or
 * app start) persists whatever the history now earns.
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

      // Derive from the FULL history (not `userLevel`'s current in-memory
      // value — a different household, or a history with no rows, must land
      // wherever ITS OWN history says, even if that's back down to Lv1 from
      // whatever the previous household's session state was).
      const derived = deriveLevelFromScores(scores);

      // Persist through the one synced writer, which also resolves the
      // "never demote" rule against what is actually stored: it returns the
      // STORED level whenever that already meets or beats `derived`, so a
      // level earned on another phone (and pulled in on `households`) is what
      // this device shows, and a thin local history can never take it away.
      // A failure here is never fatal — the badge still renders the derived
      // level for this session.
      let level = derived;
      const persisted = await new PersistUserLevelUseCase(db).execute({
        householdId,
        level: derived,
      });
      if (persisted.success) {
        level = Math.min(Math.max(persisted.data.level, 1), MAX_LEVEL) as 1 | 2 | 3;
      } else {
        logger.error('useLevelAdvancement: failed to persist user level', persisted.error, {
          householdId,
        });
      }

      setUserLevel(level);
    },
    [setUserLevel],
  );

  return { check, hydrate };
}
