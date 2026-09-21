/**
 * ScoreProgressCard — the household's real score and level history.
 *
 * Before this existed, the only score anywhere in the app was the
 * DASHBOARD's LIVE score for the CURRENT period, and the only level was a
 * static "Lv1 Learner" badge in Settings backed by in-memory state. A
 * household whose history arrived by sync (no rollover ever ran, so no
 * `score_history` row was ever written) therefore saw no score at all, and a
 * household with no envelopes YET for the current period saw the dashboard
 * hide its score stat entirely.
 *
 * This reads the durable, backfilled history instead: the most recently
 * CLOSED period's score with its breakdown in plain language, the trend
 * across the last periods, the level, and exactly what is still needed to
 * reach the next one.
 *
 * Accessibility: every figure carries its own label, and no meaning is
 * carried by colour alone — the breakdown rows are read as "x out of y" and
 * the trend bars encode their value as height plus a per-bar label.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
// Paper's `Text` only (for its `variant` type scale). Deliberately NOT
// `Surface`: this card is mounted on several screens whose tests stub
// react-native-paper down to the handful of components they need, and an
// elevation-0 Surface is a plain background-coloured View anyway — taking
// the dependency bought nothing and broke a host screen's smoke test.
import { Text } from 'react-native-paper';
import type { HabitScoreResult } from '../../../domain/scoring/RamseyScoreCalculator';
import { spacing, radius, fontSize } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import { useScoreProgress } from '../../hooks/useScoreProgress';
import { ScoreTrendBars, formatPeriodLabel } from './ScoreTrendBars';

interface BreakdownRow {
  key: keyof Omit<HabitScoreResult, 'score'>;
  label: string;
  max: number;
}

/** Shown in place of "0 / 20" for a component the household has never used. */
const NOT_APPLICABLE_TEXT = 'not used, not counted';

/** Mirrors `ScoreBreakdownDialog`'s rows — one vocabulary for one score. */
const BREAKDOWN_ROWS: BreakdownRow[] = [
  { key: 'loggingPoints', label: 'Logging transactions', max: 30 },
  { key: 'disciplinePoints', label: 'Staying on budget', max: 30 },
  { key: 'metersPoints', label: 'Meter readings logged', max: 20 },
  { key: 'babyStepPoints', label: 'Active baby step', max: 20 },
];

export function ScoreProgressCard(): React.JSX.Element {
  const { colors } = useAppTheme();
  const { loading, trend, latest, recordedPeriodCount, level } = useScoreProgress();

  const levelLine = `Lv${level.level} ${level.levelName}`;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]} testID="score-progress-card">
      <View style={styles.headerRow}>
        <Text variant="titleMedium" style={{ color: colors.onSurface }}>
          Your progress
        </Text>
        <View style={[styles.levelBadge, { backgroundColor: colors.primaryContainer }]}>
          <Text
            style={[styles.levelBadgeText, { color: colors.onPrimaryContainer }]}
            testID="score-progress-level"
            accessibilityLabel={`Current level: ${level.level}, ${level.levelName}.`}
          >
            {levelLine}
          </Text>
        </View>
      </View>

      <Text
        variant="bodySmall"
        style={[styles.levelProgress, { color: colors.onSurfaceVariant }]}
        testID="score-progress-next-level"
        accessibilityLabel={level.message}
      >
        {level.message}
      </Text>

      {loading ? (
        <Text
          variant="bodyMedium"
          style={{ color: colors.onSurfaceVariant }}
          testID="score-progress-loading"
        >
          Loading your score history…
        </Text>
      ) : latest === null ? (
        <View testID="score-progress-empty">
          <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
            No closed budget periods yet.
          </Text>
          <Text
            variant="bodySmall"
            style={[styles.emptyHint, { color: colors.onSurfaceVariant }]}
            accessibilityLabel="Your first score appears once your first budget period ends. Logging transactions and keeping envelopes on budget is what earns it."
          >
            Your first score appears once your first budget period ends. Logging your spending and
            keeping envelopes on budget is what earns it.
          </Text>
        </View>
      ) : (
        <View>
          <View style={styles.latestRow}>
            <View style={styles.latestTextBlock}>
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                {`Last closed period — ${formatPeriodLabel(latest.periodStart)}`}
              </Text>
              <Text
                variant="bodySmall"
                style={{ color: colors.onSurfaceVariant }}
                testID="score-progress-period-count"
              >
                {`${recordedPeriodCount} period${recordedPeriodCount === 1 ? '' : 's'} scored`}
              </Text>
            </View>
            <Text
              style={[styles.latestScore, { color: colors.primary }]}
              testID="score-progress-latest-score"
              accessibilityLabel={`${formatPeriodLabel(latest.periodStart)} scored ${latest.score} out of 100.`}
            >
              {`${latest.score}`}
              <Text style={[styles.latestScoreMax, { color: colors.onSurfaceVariant }]}>
                {' / 100'}
              </Text>
            </Text>
          </View>

          {latest.breakdown !== null && (
            <View style={styles.breakdown} testID="score-progress-breakdown">
              {BREAKDOWN_ROWS.map((row) => {
                // NOT `?? 0` — `null` here is the "component did not apply"
                // marker, and coalescing it away would print the "0 / 20"
                // this exists to stop.
                const raw = latest.breakdown === null ? 0 : latest.breakdown[row.key];
                // A component the household has never used is EXCLUDED and
                // the rest re-normalised to 100 (see HabitScoreCalculator),
                // so saying "0 / 20" here would be a lie about a number that
                // did not count either way.
                const notApplicable = raw === null;
                const value = notApplicable ? NOT_APPLICABLE_TEXT : `${raw as number} / ${row.max}`;
                return (
                  <View
                    key={row.key}
                    style={styles.breakdownRow}
                    testID={`score-progress-breakdown-${row.key}`}
                    accessible
                    accessibilityLabel={
                      notApplicable
                        ? `${row.label}: not used, not counted towards this score.`
                        : `${row.label}: ${raw as number} out of ${row.max} points.`
                    }
                  >
                    <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
                      {row.label}
                    </Text>
                    <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                      {value}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.trend}>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              {`Last ${trend.length} period${trend.length === 1 ? '' : 's'}`}
            </Text>
            <ScoreTrendBars
              points={trend.map((row) => ({ periodStart: row.periodStart, score: row.score }))}
              testID="score-progress-trend"
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: spacing.base,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  levelBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  levelBadgeText: {
    fontSize: fontSize.sm,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  levelProgress: {
    marginBottom: spacing.xs,
  },
  emptyHint: {
    marginTop: spacing.xs,
  },
  latestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  latestTextBlock: {
    flexShrink: 1,
    paddingRight: spacing.sm,
  },
  latestScore: {
    fontSize: fontSize.xl,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  latestScoreMax: {
    fontSize: fontSize.md,
    fontFamily: 'PlusJakartaSans_400Regular',
  },
  breakdown: {
    marginTop: spacing.sm,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  trend: {
    marginTop: spacing.md,
  },
});
