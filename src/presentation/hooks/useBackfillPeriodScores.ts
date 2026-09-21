import { useCallback, useEffect } from 'react';
import { db } from '../../data/local/db';
import { BackfillPeriodScoresUseCase } from '../../domain/scoring/BackfillPeriodScoresUseCase';
import { getPeriodScoresAscending } from '../../domain/scoring/getPeriodScoresAscending';
import { deriveLevelFromScores } from '../../domain/scoring/LevelAdvancementEvaluator';
import { PersistUserLevelUseCase } from '../../domain/scoring/PersistUserLevelUseCase';
import { logger } from '../../infrastructure/logging/Logger';
import { useAppStore } from '../stores/appStore';
import { useReloadOnSync } from './useReloadOnSync';

/**
 * In-flight guard, module-level rather than per-hook: two mounted callers
 * (and a sync round landing while a boot pass is still running) must never
 * score the same periods concurrently. The second caller simply returns —
 * the pass already running reads the same tables and will see the same rows.
 */
let inFlight = false;

/** Broadcast so a mounted score surface can refresh once a pass has written rows. */
type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to "a backfill pass just recorded new scores". Returns an unsubscribe. */
export function onPeriodScoresBackfilled(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * One backfill pass: record any missing closed-period scores, then persist
 * whatever level the (now complete) history earns.
 *
 * Exported for tests and for any caller that needs a pass outside React.
 * NEVER THROWS — every failure is logged and swallowed, because both of its
 * triggers (app start and a landed sync round) must survive it untouched.
 */
export async function runPeriodScoreBackfill(
  householdId: string,
  paydayDay: number,
): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const result = await new BackfillPeriodScoresUseCase(db).execute({ householdId, paydayDay });
    if (!result.success) {
      logger.error('useBackfillPeriodScores: backfill failed', result.error, { householdId });
      return;
    }

    // A rewritten old-formula row changes the scores just as a new row does,
    // so both must re-derive the level and refresh any mounted progress card.
    if (result.data.recorded > 0 || result.data.recomputed > 0) {
      const history = await getPeriodScoresAscending(db, householdId);
      const level = deriveLevelFromScores(history.map((row) => row.score));
      const persisted = await new PersistUserLevelUseCase(db).execute({ householdId, level });
      if (!persisted.success) {
        logger.error('useBackfillPeriodScores: level persist failed', persisted.error, {
          householdId,
        });
      } else if (persisted.data.changed) {
        useAppStore.getState().setUserLevel(persisted.data.level as 1 | 2 | 3);
      }

      for (const listener of listeners) {
        try {
          listener();
        } catch (listenerErr) {
          logger.error('useBackfillPeriodScores: listener threw', listenerErr, { householdId });
        }
      }
    }
  } catch (err) {
    // Defensive: the use case already returns failures as Results, so this
    // only catches something genuinely unexpected. It must still not escape
    // — this runs on the boot path.
    logger.error('useBackfillPeriodScores: unexpected error', err, { householdId });
  } finally {
    inFlight = false;
  }
}

/**
 * Keeps `score_history` complete for the active household.
 *
 * Scores are otherwise only ever written by the in-app rollover, so a
 * household whose history arrived through SYNC or a RESTORE has envelopes and
 * transactions but no scores at all, and its score/level feature shows
 * nothing and can never progress (see `BackfillPeriodScoresUseCase`).
 *
 * Runs at the three moments that can leave history unscored:
 *  - APP START / household change — a plain effect, so it is queued after the
 *    first render commits and never blocks first paint. Nothing awaits it.
 *  - AFTER A SYNC ROUND LANDS — via `useReloadOnSync`, the same
 *    `lastSyncAt`-change trigger the screens reload on, which fires only for
 *    a round that actually reached the server.
 *  - AFTER A RESTORE — `RestoreService` runs during boot, before the
 *    household reaches `appStore`, so the mount pass above IS the post-restore
 *    pass; the scheduler's first successful round afterwards covers the rest.
 *
 * Never concurrent with itself (module-level `inFlight`), and never fatal:
 * `runPeriodScoreBackfill` swallows and logs everything, so neither boot nor
 * a sync round can be broken by a failure inside it.
 */
export function useBackfillPeriodScores(): void {
  const householdId = useAppStore((s) => s.householdId);
  const paydayDay = useAppStore((s) => s.paydayDay);

  const run = useCallback(async (): Promise<void> => {
    if (!householdId) return;
    await runPeriodScoreBackfill(householdId, paydayDay);
  }, [householdId, paydayDay]);

  useEffect(() => {
    void run();
  }, [run]);

  useReloadOnSync(run);
}
