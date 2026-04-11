import React from 'react';
import { StyleSheet } from 'react-native';
import { Surface, Text } from 'react-native-paper';
import { colours, spacing, radius } from '../../../theme/tokens';

interface RamseyScoreBadgeProps {
  score: number; // 0–100
}

function getScoreColour(score: number): string {
  if (score >= 80) return colours.scoreExcellent;
  if (score >= 60) return colours.scoreGood;
  if (score >= 40) return colours.scoreFair;
  return colours.scorePoor;
}

function getScoreLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Keep going';
}

export function RamseyScoreBadge({ score }: RamseyScoreBadgeProps): React.JSX.Element {
  const colour = getScoreColour(score);
  return (
    <Surface style={[styles.badge, { borderColor: colour }]} elevation={0}>
      <Text variant="headlineMedium" style={[styles.score, { color: colour }]}>
        {score}
      </Text>
      <Text variant="labelSmall" style={[styles.label, { color: colour }]}>
        {getScoreLabel(score)}
      </Text>
      <Text variant="bodySmall" style={styles.sub}>Ramsey Score</Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderRadius: radius.xl,
    borderWidth: 2,
    backgroundColor: colours.surface,
  },
  score: { fontFamily: 'PlusJakartaSans_700Bold' },
  label: { fontFamily: 'PlusJakartaSans_600SemiBold' },
  sub: { color: colours.onSurfaceVariant, marginTop: 2 },
});
