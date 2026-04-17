/**
 * BabyStepsBar — compact segmented-bar version of the Baby Steps progress
 * for the PULSE dashboard. 7 equal segments replace the full SevenDotPath card.
 * Tap → navigate to BabyStepsScreen.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, useColorScheme } from 'react-native';
import { BABY_STEP_RULES } from '../../../../domain/babySteps/BabyStepRules';
import type { BabyStepStatus } from '../../../../domain/babySteps/types';
import { P } from './HeroSummaryCard';
import { radius, spacing, fontSize } from '../../../theme/tokens';

interface Props {
  statuses: BabyStepStatus[];
  onPress: () => void;
}

export function BabyStepsBar({ statuses, onPress }: Props): React.JSX.Element {
  const isDark = useColorScheme() === 'dark';
  const completedCount = statuses.filter((s) => s.isCompleted).length;
  const currentStep = useMemo(() => statuses.find((s) => !s.isCompleted) ?? null, [statuses]);

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

  const cardStyle = isDark
    ? { backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.06)' }
    : { backgroundColor: P.tileBgLight, borderColor: P.tileBorderLight };

  const titleColor = isDark ? 'rgba(160,210,190,0.38)' : '#8AA898';
  const countColor = isDark ? 'rgba(160,210,190,0.28)' : '#B0C8BE';
  const stepNameColor = isDark ? 'rgba(160,210,190,0.55)' : '#3D5A50';
  const detailColor = isDark ? P.accentDim : '#00695C';

  const segDone = isDark ? P.accent : '#00B478';
  const segCurrent = isDark ? 'rgba(0,214,143,0.28)' : 'rgba(0,180,120,0.25)';
  const segFuture = isDark ? 'rgba(255,255,255,0.06)' : '#E2EBE8';

  return (
    <TouchableOpacity
      style={[styles.card, cardStyle]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Baby steps progress: ${completedCount} of 7 complete. Tap to view details.`}
    >
      {/* Header */}
      <View style={styles.head}>
        <Text style={[styles.title, { color: titleColor }]}>BABY STEPS</Text>
        <Text style={[styles.count, { color: countColor }]}>{`${completedCount} / 7`}</Text>
      </View>

      {/* Segmented bar */}
      <View style={styles.segs}>
        {statuses.map((s, i) => {
          const isCompleted = s.isCompleted;
          const isCurrent = !isCompleted && i === completedCount;
          const bg = isCompleted ? segDone : isCurrent ? segCurrent : segFuture;
          return <View key={s.stepNumber} style={[styles.seg, { backgroundColor: bg }]} />;
        })}
      </View>

      {/* Current step */}
      {currentStep && (
        <>
          <Text style={[styles.stepName, { color: stepNameColor }]} numberOfLines={1}>
            {`Step ${currentStep.stepNumber}: ${BABY_STEP_RULES[currentStep.stepNumber].shortTitle}`}
          </Text>
          <Text style={[styles.detail, { color: detailColor }]}>{progressLine}</Text>
        </>
      )}
      {!currentStep && (
        <Text style={[styles.stepName, { color: detailColor }]}>All Baby Steps complete! 🎉</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.base,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.base,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: fontSize.xs,
    letterSpacing: 1.5,
  },
  count: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.xs,
  },
  segs: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: spacing.sm,
  },
  seg: {
    flex: 1,
    height: 4,
    borderRadius: radius.full,
  },
  stepName: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: fontSize.sm,
    marginBottom: 2,
  },
  detail: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.sm,
  },
});
