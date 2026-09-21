import { useCallback, useEffect, useState } from 'react';
import { db } from '../../data/local/db';
import { getPeriodScoreHistory } from '../../domain/scoring/getPeriodScoreHistory';
import type { PeriodScoreHistoryEntry } from '../../domain/scoring/getPeriodScoreHistory';
import { describeLevelProgress } from '../../domain/scoring/LevelAdvancementEvaluator';
import type { LevelProgress } from '../../domain/scoring/LevelAdvancementEvaluator';
import { logger } from '../../infrastructure/logging/Logger';
import { useAppStore } from '../stores/appStore';
import { onPeriodScoresBackfilled } from './useBackfillPeriodScores';
import { useReloadOnSync } from './useReloadOnSync';

/** How many closed periods the trend shows. */
export const TREND_PERIOD_COUNT = 12;

export interface ScoreProgress {
  loading: boolean;
  /** Oldest first, at most `TREND_PERIOD_COUNT` entries. */
  trend: PeriodScoreHistoryEntry[];
  /** The most recently closed period that has a score, or null for a new household. */
  latest: PeriodScoreHistoryEntry | null;
  /** Total recorded periods, which can exceed `trend.length`. */
  recordedPeriodCount: number;
  level: LevelProgress;
}

/**
 * The score/level surface's data: the latest closed period's score and its
 * breakdown, the trend behind it, and the level with what is still needed to
 * reach the next one.
 *
 * Reloads when a sync round lands (new history can mean new periods to show)
 * and when a backfill pass records scores, so a household whose eighteen
 * periods were scored moments after boot sees them without a navigation
 * round trip.
 */
export function useScoreProgress(): ScoreProgress {
  const householdId = useAppStore((s) => s.householdId);
  const userLevel = useAppStore((s) => s.userLevel);

  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<PeriodScoreHistoryEntry[]>([]);

  const reload = useCallback(async (): Promise<void> => {
    if (!householdId) {
      setHistory([]);
      setLoading(false);
      return;
    }
    try {
      const rows = await getPeriodScoreHistory(db, householdId);
      setHistory(rows);
    } catch (err) {
      logger.error('useScoreProgress: failed to read score history', err, { householdId });
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  useEffect(() => onPeriodScoresBackfilled(() => void reload()), [reload]);

  useReloadOnSync(reload);

  return {
    loading,
    trend: history.slice(-TREND_PERIOD_COUNT),
    latest: history.length > 0 ? history[history.length - 1] : null,
    recordedPeriodCount: history.length,
    level: describeLevelProgress(
      userLevel,
      history.map((row) => row.score),
    ),
  };
}
