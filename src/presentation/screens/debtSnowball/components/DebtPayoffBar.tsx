import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { spacing, radius } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';

interface DebtPayoffBarProps {
  progressPercent: number; // 0–100
  label: string;
}

export function DebtPayoffBar({ progressPercent, label }: DebtPayoffBarProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const clamped = Math.min(100, Math.max(0, progressPercent));

  function getFillColour(progress: number): string {
    if (progress >= 100) return colors.debtBarPaid; // green — paid off
    if (progress >= 50) return colors.secondary; // amber — making good progress
    return colors.debtBar; // red — just getting started
  }

  const fillColour = getFillColour(clamped);

  return (
    <View style={styles.container}>
      <View
        style={[styles.track, { backgroundColor: colors.surfaceVariant }]}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
        accessibilityLabel={`${label}: ${Math.round(clamped)}% paid off`}
      >
        <View
          style={[
            styles.fill,
            {
              width: `${clamped}%`,
              backgroundColor: fillColour,
            },
          ]}
        />
      </View>
      <View style={styles.labelRow}>
        <Text variant="labelSmall" style={[styles.label, { color: colors.onSurfaceVariant }]}>
          {label}
        </Text>
        <Text variant="labelSmall" style={[styles.percent, { color: fillColour }]}>
          {Math.round(clamped)}%
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: spacing.xs },
  track: {
    height: 12,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.full,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs / 2,
  },
  label: {},
  percent: { fontFamily: 'PlusJakartaSans_600SemiBold' },
});
