import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { colours, spacing, radius } from '../../../theme/tokens';

interface DebtPayoffBarProps {
  progressPercent: number; // 0–100
  label: string;
}

function getFillColour(progress: number): string {
  if (progress >= 100) return colours.debtBarPaid; // green — paid off
  if (progress >= 50) return colours.secondary; // amber — making good progress
  return colours.debtBar; // red — just getting started
}

export function DebtPayoffBar({ progressPercent, label }: DebtPayoffBarProps): React.JSX.Element {
  const clamped = Math.min(100, Math.max(0, progressPercent));
  const fillColour = getFillColour(clamped);

  return (
    <View style={styles.container}>
      <View
        style={styles.track}
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
        <Text variant="labelSmall" style={styles.label}>
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
    backgroundColor: colours.surfaceVariant,
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
  label: { color: colours.onSurfaceVariant },
  percent: { fontFamily: 'PlusJakartaSans_600SemiBold' },
});
