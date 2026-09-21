/**
 * ScoreTrendBars — an accessible bar chart of the household's last few
 * closed-period scores, built from plain Views (no charting dependency).
 *
 * NOT COLOUR-ONLY: every bar's height encodes its score, every bar carries
 * its own accessibility label naming the period and the number, and the
 * axis captions below spell out the range in text. Colour is decoration on
 * top of that, never the information itself.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { spacing, radius, fontSize } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

export interface ScoreTrendPoint {
  periodStart: string;
  score: number;
}

interface Props {
  /** Oldest period first. */
  points: ScoreTrendPoint[];
  testID?: string;
}

const CHART_HEIGHT = 72;
const MAX_SCORE = 100;

/** `2026-08-20` -> `Aug 2026`, read as plain calendar fields (never a local-tz Date). */
export function formatPeriodLabel(periodStart: string): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const [year, month] = periodStart.split('-');
  const index = Number(month) - 1;
  if (!year || Number.isNaN(index) || index < 0 || index > 11) return periodStart;
  return `${months[index]} ${year}`;
}

export function ScoreTrendBars({ points, testID }: Props): React.JSX.Element | null {
  const { colors } = useAppTheme();

  if (points.length === 0) return null;

  const summary = points.map((p) => `${formatPeriodLabel(p.periodStart)} ${p.score}`).join(', ');

  return (
    <View testID={testID}>
      <View
        style={[styles.chart, { height: CHART_HEIGHT }]}
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`Score trend over the last ${points.length} closed period${
          points.length === 1 ? '' : 's'
        }, out of 100: ${summary}.`}
      >
        {points.map((point) => {
          const clamped = Math.max(0, Math.min(MAX_SCORE, point.score));
          // A zero-score period still gets a visible sliver, so "scored 0"
          // and "no bar rendered" cannot look like the same thing.
          const barHeight = Math.max(2, Math.round((clamped / MAX_SCORE) * CHART_HEIGHT));
          return (
            <View key={point.periodStart} style={styles.barSlot}>
              <View
                testID={`score-trend-bar-${point.periodStart}`}
                accessibilityLabel={`${formatPeriodLabel(point.periodStart)}: ${point.score} out of 100`}
                style={[
                  styles.bar,
                  {
                    height: barHeight,
                    backgroundColor: colors.primary,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
      <View style={styles.axisRow}>
        <Text
          variant="bodySmall"
          style={[styles.axisLabel, { color: colors.onSurfaceVariant }]}
          testID="score-trend-axis-start"
        >
          {formatPeriodLabel(points[0].periodStart)}
        </Text>
        <Text
          variant="bodySmall"
          style={[styles.axisLabel, { color: colors.onSurfaceVariant }]}
          testID="score-trend-axis-end"
        >
          {formatPeriodLabel(points[points.length - 1].periodStart)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  barSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 1,
  },
  bar: {
    width: '100%',
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
  },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  axisLabel: {
    fontSize: fontSize.xs,
  },
});
