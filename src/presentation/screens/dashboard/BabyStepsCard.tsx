/**
 * BabyStepsCard — compact dashboard card for Baby Steps progress.
 *
 * Renders SevenDotPath + current step title + progress line.
 * Tap → navigate to BabyStepsScreen.
 *
 * Spec §Dashboard card: seven-dot path + compact fallback.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { SevenDotPath } from '../babySteps/components/SevenDotPath';
import { BABY_STEP_RULES } from '../../../domain/babySteps/BabyStepRules';
import type { BabyStepStatus } from '../../../domain/babySteps/types';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

export interface BabyStepsCardProps {
  statuses: BabyStepStatus[];
  onPress: () => void;
}

export const BabyStepsCard: React.FC<BabyStepsCardProps> = ({ statuses, onPress }) => {
  const { colors } = useAppTheme();
  const currentStep = useMemo(() => statuses.find((s) => !s.isCompleted) ?? null, [statuses]);

  const completedCount = statuses.filter((s) => s.isCompleted).length;

  const progressLine = useMemo(() => {
    if (!currentStep) return 'All 7 steps complete!';
    const rule = BABY_STEP_RULES[currentStep.stepNumber];
    const p = currentStep.progress;
    if (!p) return rule.description;
    if (p.unit === 'count') return `${p.current} of ${p.target} debts cleared`;
    const cur = Math.round(p.current / 100).toLocaleString('en-ZA');
    const tgt = Math.round(p.target / 100).toLocaleString('en-ZA');
    return `R${cur} of R${tgt}`;
  }, [currentStep]);

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open Baby Steps tracker"
      activeOpacity={0.85}
    >
      <Surface style={[styles.card, { backgroundColor: colors.surface }]} elevation={1}>
        <View style={styles.header}>
          <Text variant="labelSmall" style={[styles.cardLabel, { color: colors.onSurfaceVariant }]}>
            BABY STEPS
          </Text>
          <Text variant="labelSmall" style={[styles.count, { color: colors.primary }]}>
            {`${completedCount} / 7`}
          </Text>
        </View>

        <SevenDotPath statuses={statuses} />

        {currentStep && (
          <View style={styles.footer}>
            <Text
              variant="titleSmall"
              style={[styles.stepTitle, { color: colors.onSurface }]}
              numberOfLines={1}
            >
              {`Step ${currentStep.stepNumber}: ${BABY_STEP_RULES[currentStep.stepNumber].shortTitle}`}
            </Text>
            <Text
              variant="bodySmall"
              style={[styles.progress, { color: colors.onSurfaceVariant }]}
              numberOfLines={1}
            >
              {progressLine}
            </Text>
          </View>
        )}

        {!currentStep && (
          <Text variant="bodySmall" style={[styles.allDone, { color: colors.primary }]}>
            All Baby Steps complete!
          </Text>
        )}
      </Surface>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    padding: spacing.base,
    gap: spacing.sm,
    marginHorizontal: spacing.base,
    marginBottom: spacing.base,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLabel: {
    letterSpacing: 1.2,
  },
  count: {
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  footer: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  stepTitle: {
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  progress: {
    fontVariant: ['tabular-nums'],
  },
  allDone: {
    textAlign: 'center',
    fontFamily: 'PlusJakartaSans_700Bold',
  },
});
