/**
 * BabyStepsScreen — three-tier Baby Steps progress screen.
 *
 * Three tiers (spec §BabyStepsScreen: three-tier layout):
 *   1. Completed chips row — horizontal scroll; seal + step number + date.
 *      Manual steps also show a "Manual" chip badge.
 *   2. Current step hero — CurrentStepHero with progress or ManualStepPanel.
 *   3. Future steps list — dimmed monochrome cards; accessibilityElementsHidden.
 *
 * Empty-state CTAs handled inside CurrentStepHero when progress is null.
 *
 * Spec §BabyStepsScreen, §Data flow.
 */

import React, { useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Text, Surface, Chip } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { format, parseISO } from 'date-fns';
import { CurrentStepHero } from './components/CurrentStepHero';
import { StepSealMark } from './components/StepSealMark';
import { useBabySteps } from '../../hooks/useBabySteps';
import { useAppStore } from '../../stores/appStore';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { BABY_STEP_RULES } from '../../../domain/babySteps/BabyStepRules';
import type { BabyStepStatus } from '../../../domain/babySteps/types';
import { colours, spacing, radius } from '../../theme/tokens';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DashboardStackParamList } from '../../navigation/types';

export type BabyStepsScreenProps = NativeStackScreenProps<DashboardStackParamList, 'BabySteps'>;

const engine = new BudgetPeriodEngine();

export const BabyStepsScreen: React.FC<BabyStepsScreenProps> = ({ navigation }) => {
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);
  const periodStart = useMemo(() => {
    const period = engine.getCurrentPeriod(paydayDay);
    return format(period.startDate, 'yyyy-MM-dd');
  }, [paydayDay]);

  const { statuses, loading, reconcile, toggleManualStep } = useBabySteps(
    householdId,
    periodStart,
  );

  useFocusEffect(
    useCallback(() => {
      void reconcile();
    }, [reconcile]),
  );

  const completedSteps = useMemo(
    () => statuses.filter((s) => s.isCompleted),
    [statuses],
  );

  const currentStep = useMemo(
    () => statuses.find((s) => !s.isCompleted) ?? null,
    [statuses],
  );

  const futureSteps = useMemo(() => {
    if (!currentStep) return [];
    const currentIdx = statuses.findIndex((s) => s.stepNumber === currentStep.stepNumber);
    return statuses.slice(currentIdx + 1);
  }, [statuses, currentStep]);

  const handleToggleManual = useCallback(
    (value: boolean) => {
      if (currentStep) {
        void toggleManualStep(currentStep.stepNumber, value);
      }
    },
    [currentStep, toggleManualStep],
  );

  const handleNavigateToAddEnvelope = useCallback(
    (preselectedType?: 'income' | 'emergency_fund') => {
      navigation.navigate('AddEditEnvelope', {
        preselectedType: preselectedType ?? 'spending',
      });
    },
    [navigation],
  );

  if (loading && statuses.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={reconcile}
          colors={[colours.primary]}
        />
      }
    >
      {/* ── Tier 1: Completed chips ────────────────────────────────── */}
      {completedSteps.length > 0 && (
        <View style={styles.section}>
          <Text variant="labelSmall" style={styles.sectionLabel}>
            COMPLETED
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            {completedSteps.map((s) => (
              <CompletedChip key={s.stepNumber} status={s} />
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Tier 2: Current step hero ──────────────────────────────── */}
      {currentStep ? (
        <View style={styles.section}>
          <Text variant="labelSmall" style={styles.sectionLabel}>
            CURRENT STEP
          </Text>
          <CurrentStepHero
            status={currentStep}
            onToggleManual={handleToggleManual}
            onNavigateToAddEnvelope={handleNavigateToAddEnvelope}
            loading={loading}
          />
        </View>
      ) : (
        <View style={styles.allDoneContainer}>
          <StepSealMark stepNumber={7} state="complete" size={96} />
          <Text variant="headlineSmall" style={styles.allDoneTitle}>
            All 7 Baby Steps complete!
          </Text>
          <Text variant="bodyMedium" style={styles.allDoneBody}>
            You have built wealth and live generously. Remarkable.
          </Text>
        </View>
      )}

      {/* ── Tier 3: Future steps ───────────────────────────────────── */}
      {futureSteps.length > 0 && (
        <View
          style={styles.section}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="future-steps-section"
        >
          <Text variant="labelSmall" style={styles.sectionLabel}>
            COMING UP
          </Text>
          {futureSteps.map((s) => (
            <FutureStepCard key={s.stepNumber} status={s} />
          ))}
        </View>
      )}
    </ScrollView>
  );
};

// ─── Completed chip ──────────────────────────────────────────────────────────

function CompletedChip({ status }: { status: BabyStepStatus }): React.JSX.Element {
  const rule = BABY_STEP_RULES[status.stepNumber];
  const dateLabel = status.completedAt
    ? format(parseISO(status.completedAt), 'd MMM yyyy')
    : '';

  return (
    <View style={chipStyles.container}>
      <StepSealMark stepNumber={status.stepNumber} state="complete" size={24} />
      <View style={chipStyles.textBlock}>
        <Text variant="labelSmall" style={chipStyles.title}>
          {`${status.stepNumber}. ${rule.shortTitle}`}
        </Text>
        {dateLabel ? (
          <Text variant="bodySmall" style={chipStyles.date}>
            {dateLabel}
          </Text>
        ) : null}
      </View>
      {status.isManual && (
        <Chip compact style={chipStyles.manualChip} textStyle={chipStyles.manualChipText}>
          Manual
        </Chip>
      )}
    </View>
  );
}

const chipStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colours.primaryContainer,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
    gap: spacing.xs,
  },
  textBlock: {
    gap: 2,
  },
  title: {
    color: colours.onPrimaryContainer,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  date: {
    color: colours.onPrimaryContainer,
    opacity: 0.7,
    // 5.7: tabular-numeric so completion dates align in the horizontal chip row
    fontVariant: ['tabular-nums'],
  },
  manualChip: {
    backgroundColor: colours.secondaryContainer,
    height: 20,
  },
  manualChipText: {
    fontSize: 10,
    color: colours.onSecondaryContainer,
  },
});

// ─── Future step card ─────────────────────────────────────────────────────────

function FutureStepCard({ status }: { status: BabyStepStatus }): React.JSX.Element {
  const rule = BABY_STEP_RULES[status.stepNumber];

  return (
    <Surface style={futureStyles.card} elevation={0}>
      <StepSealMark stepNumber={status.stepNumber} state="future" size={40} />
      <View style={futureStyles.textBlock}>
        <Text variant="labelSmall" style={futureStyles.stepNum}>
          {`STEP ${status.stepNumber}`}
          {status.isManual ? ' · MANUAL' : ''}
        </Text>
        <Text variant="titleSmall" style={futureStyles.title}>
          {rule.shortTitle}
        </Text>
        <Text variant="bodySmall" style={futureStyles.desc} numberOfLines={2}>
          {rule.description}
        </Text>
      </View>
    </Surface>
  );
}

const futureStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colours.surfaceVariant,
    opacity: 0.6,
    marginBottom: spacing.sm,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  stepNum: {
    color: colours.onSurfaceVariant,
    letterSpacing: 0.8,
  },
  title: {
    color: colours.onSurface,
    opacity: 0.7,
  },
  desc: {
    color: colours.onSurfaceVariant,
    opacity: 0.7,
  },
});

// ─── Screen styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  content: { padding: spacing.base, paddingBottom: spacing.xl, gap: spacing.base },
  section: { gap: spacing.sm },
  sectionLabel: {
    color: colours.onSurfaceVariant,
    letterSpacing: 1.2,
    marginBottom: spacing.xs,
  },
  chipsRow: {
    paddingVertical: spacing.xs,
  },
  allDoneContainer: {
    alignItems: 'center',
    gap: spacing.base,
    padding: spacing.xl,
  },
  allDoneTitle: {
    color: colours.primary,
    fontFamily: 'PlusJakartaSans_700Bold',
    textAlign: 'center',
  },
  allDoneBody: {
    color: colours.onSurfaceVariant,
    textAlign: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
