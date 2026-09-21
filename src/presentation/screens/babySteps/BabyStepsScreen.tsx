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
import { View, StyleSheet, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { Text, Surface, Chip } from 'react-native-paper';
import { SectionHeader } from '../../components/shared/SectionHeader';
import { useFocusEffect } from '@react-navigation/native';
import { format, parseISO } from 'date-fns';
import { CurrentStepHero } from './components/CurrentStepHero';
import { StepSealMark } from './components/StepSealMark';
import { useBabySteps } from '../../hooks/useBabySteps';
import { useAppStore } from '../../stores/appStore';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../../domain/shared/BudgetPeriodEngine';
import { BABY_STEP_RULES } from '../../../domain/babySteps/BabyStepRules';
import { inferBabyStepSkips } from '../../../domain/babySteps/BabyStepEvaluator';
import type { BabyStepStatus } from '../../../domain/babySteps/types';
import { fontSize, spacing, radius } from '../../theme/tokens';
import { LoadingSplash } from '../../components/shared/LoadingSplash';
import { useAppTheme } from '../../theme/useAppTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DashboardStackParamList } from '../../navigation/types';

export type BabyStepsScreenProps = NativeStackScreenProps<DashboardStackParamList, 'BabySteps'>;

const engine = new BudgetPeriodEngine();

export const BabyStepsScreen: React.FC<BabyStepsScreenProps> = ({ navigation }) => {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId);
  const paydayDay = useAppStore((s) => s.paydayDay);
  const periodStart = useMemo(() => {
    const period = engine.getCurrentPeriod(paydayDay);
    return formatPeriodDateKey(period.startDate);
  }, [paydayDay]);

  const { statuses, loading, reconcile, toggleManualStep } = useBabySteps(
    householdId ?? '',
    periodStart,
  );

  useFocusEffect(
    useCallback(() => {
      void reconcile();
    }, [reconcile]),
  );

  // C-1 (reworked): `statuses[i].isCompleted` is deliberately FALSE for a
  // Step 2/6 "no applicable debts" skip — see BabyStepEvaluator's "Steps 2
  // and 6" note (baby_steps is a SYNCED table; nothing about the skip may be
  // persisted). `inferBabyStepSkips` re-derives the skip PURELY from these
  // already-returned statuses so the household still visibly advances past
  // it, without this screen ever writing or requiring a new persisted field.
  const { skippedStepNumbers, isEffectivelyDone } = useMemo(
    () => inferBabyStepSkips(statuses),
    [statuses],
  );

  const completedSteps = useMemo(() => statuses.filter((s) => s.isCompleted), [statuses]);

  const skippedSteps = useMemo(
    () => statuses.filter((s) => skippedStepNumbers.has(s.stepNumber)),
    [statuses, skippedStepNumbers],
  );

  const currentStep = useMemo(
    () => statuses.find((s) => !isEffectivelyDone(s.stepNumber)) ?? null,
    [statuses, isEffectivelyDone],
  );

  const futureSteps = useMemo(() => {
    if (!currentStep) return [];
    const currentIdx = statuses.findIndex((s) => s.stepNumber === currentStep.stepNumber);
    // Exclude anything effectively done past currentIdx — genuinely completed
    // OR skipped — so a step never shows both as a completed chip / skipped
    // notice AND a dimmed future card.
    return statuses.slice(currentIdx + 1).filter((s) => !isEffectivelyDone(s.stepNumber));
  }, [statuses, currentStep, isEffectivelyDone]);

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

  if (!householdId) return <LoadingSplash />;

  if (loading && statuses.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={reconcile} colors={[colors.primary]} />
      }
    >
      {/* ── Tier 1: Completed chips ────────────────────────────────── */}
      {completedSteps.length > 0 && (
        <View style={styles.section} testID="completed-steps-section">
          <SectionHeader title="COMPLETED" />
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

      {/* ── Skipped steps notice — Step 2/6 "no applicable debts" ────── */}
      {skippedSteps.length > 0 && (
        <View style={styles.section} testID="skipped-steps-section">
          {skippedSteps.map((s) => (
            <SkippedStepNotice key={s.stepNumber} status={s} />
          ))}
        </View>
      )}

      {/* ── Tier 2: Current step hero ──────────────────────────────── */}
      {currentStep ? (
        <View style={styles.section}>
          <SectionHeader title="CURRENT STEP" />
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
          <Text variant="headlineSmall" style={[styles.allDoneTitle, { color: colors.primary }]}>
            All 7 Baby Steps complete!
          </Text>
          <Text
            variant="bodyMedium"
            style={[styles.allDoneBody, { color: colors.onSurfaceVariant }]}
          >
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
          <SectionHeader title="Coming Up" />
          {futureSteps.map((s) => (
            <FutureStepCard key={s.stepNumber} status={s} />
          ))}
        </View>
      )}
    </ScrollView>
  );
};

// ─── Skipped step notice ──────────────────────────────────────────────────────

/**
 * C-1 (reworked): a Step 2/6 vacuous skip is never `isCompleted` (see
 * BabyStepEvaluator's "Steps 2 and 6" note), so it never reaches
 * `CompletedChip` — it gets its own distinct, muted notice instead: no
 * completion date (there isn't a real one), no "add a debt" CTA blocking the
 * current step, and not listed in "Coming Up" either.
 */
function SkippedStepNotice({ status }: { status: BabyStepStatus }): React.JSX.Element {
  const { colors } = useAppTheme();
  const rule = BABY_STEP_RULES[status.stepNumber];

  return (
    <View
      style={[skippedStyles.container, { backgroundColor: colors.surfaceVariant }]}
      testID={`skipped-step-${status.stepNumber}`}
    >
      <StepSealMark stepNumber={status.stepNumber} state="future" size={28} />
      <View style={skippedStyles.textBlock}>
        <Text
          variant="labelSmall"
          style={[skippedStyles.title, { color: colors.onSurfaceVariant }]}
        >
          {`${status.stepNumber}. ${rule.shortTitle}`}
        </Text>
        <Text variant="bodySmall" style={[skippedStyles.note, { color: colors.onSurfaceVariant }]}>
          No debts recorded — skipped
        </Text>
      </View>
    </View>
  );
}

const skippedStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
  },
  textBlock: {
    gap: 2,
  },
  title: {
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  note: {
    opacity: 0.7,
  },
});

// ─── Completed chip ──────────────────────────────────────────────────────────

function CompletedChip({ status }: { status: BabyStepStatus }): React.JSX.Element {
  const { colors } = useAppTheme();
  const rule = BABY_STEP_RULES[status.stepNumber];
  const dateLabel = status.completedAt ? format(parseISO(status.completedAt), 'd MMM yyyy') : '';

  return (
    <View style={[chipStyles.container, { backgroundColor: colors.primaryContainer }]}>
      <StepSealMark stepNumber={status.stepNumber} state="complete" size={24} />
      <View style={chipStyles.textBlock}>
        <Text variant="labelSmall" style={[chipStyles.title, { color: colors.onPrimaryContainer }]}>
          {`${status.stepNumber}. ${rule.shortTitle}`}
        </Text>
        {dateLabel ? (
          <Text variant="bodySmall" style={[chipStyles.date, { color: colors.onPrimaryContainer }]}>
            {dateLabel}
          </Text>
        ) : null}
      </View>
      {status.isManual && (
        <Chip
          compact
          style={[chipStyles.manualChip, { backgroundColor: colors.secondaryContainer }]}
          textStyle={[chipStyles.manualChipText, { color: colors.onSecondaryContainer }]}
        >
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
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  date: {
    opacity: 0.7,
    // 5.7: tabular-numeric so completion dates align in the horizontal chip row
    fontVariant: ['tabular-nums'],
  },
  manualChip: {
    height: 20,
  },
  manualChipText: {
    fontSize: fontSize.xs,
  },
});

// ─── Future step card ─────────────────────────────────────────────────────────

function FutureStepCard({ status }: { status: BabyStepStatus }): React.JSX.Element {
  const { colors } = useAppTheme();
  const rule = BABY_STEP_RULES[status.stepNumber];

  return (
    <Surface style={[futureStyles.card, { backgroundColor: colors.surfaceVariant }]} elevation={0}>
      <StepSealMark stepNumber={status.stepNumber} state="future" size={40} />
      <View style={futureStyles.textBlock}>
        <Text
          variant="labelSmall"
          style={[futureStyles.stepNum, { color: colors.onSurfaceVariant }]}
        >
          {`STEP ${status.stepNumber}`}
          {status.isManual ? ' · MANUAL' : ''}
        </Text>
        <Text variant="titleSmall" style={[futureStyles.title, { color: colors.onSurface }]}>
          {rule.shortTitle}
        </Text>
        <Text
          variant="bodySmall"
          style={[futureStyles.desc, { color: colors.onSurfaceVariant }]}
          numberOfLines={2}
        >
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
    opacity: 0.6,
    marginBottom: spacing.sm,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  stepNum: {
    letterSpacing: 0.8,
  },
  title: {
    opacity: 0.7,
  },
  desc: {
    opacity: 0.7,
  },
});

// ─── Screen styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.base, paddingBottom: spacing.xl, gap: spacing.base },
  section: { gap: spacing.sm },
  chipsRow: {
    paddingVertical: spacing.xs,
  },
  allDoneContainer: {
    alignItems: 'center',
    gap: spacing.base,
    padding: spacing.xl,
  },
  allDoneTitle: {
    fontFamily: 'PlusJakartaSans_700Bold',
    textAlign: 'center',
  },
  allDoneBody: {
    textAlign: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
