/**
 * CurrentStepHero — hero card for the currently active Baby Step.
 *
 * Renders one of three sub-views:
 *   1. Auto step with progress — circular progress ring + R{current}/R{target}
 *      (or "{n} of {m} debts cleared" for Step 2).
 *   2. Manual step (4/5/7) — renders ManualStepPanel.
 *   3. No-data / blocked step — CTA card with contextual message.
 *
 * Step 3 blocked on income: CTA to add income envelope.
 * Steps 2/6 no applicable debt: CTA to add debts.
 * Steps 1/3 no EMF: CTA to add emergency fund envelope.
 *
 * Progress ring uses tabular-numeric formatting for progress digits.
 * Spec §CurrentStepHero, §Accessibility (progress ring label).
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface, Button } from 'react-native-paper';
import Svg, { Circle } from 'react-native-svg';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { ManualStepPanel } from './ManualStepPanel';
import { StepSealMark } from './StepSealMark';
import { BABY_STEP_RULES } from '../../../../domain/babySteps/BabyStepRules';
import type { BabyStepStatus } from '../../../../domain/babySteps/types';
import { colours, spacing, radius } from '../../../theme/tokens';

export interface CurrentStepHeroProps {
  status: BabyStepStatus;
  onToggleManual: (value: boolean) => void;
  onNavigateToAddEnvelope?: (preselectedType?: 'income' | 'emergency_fund') => void;
  onNavigateToAddDebt?: () => void;
  loading?: boolean;
}

const RING_SIZE = 96;
const RING_STROKE = 8;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;

function ProgressRing({ percent }: { percent: number }): React.JSX.Element {
  const clampedPct = Math.max(0, Math.min(100, percent));
  const strokeDashoffset = RING_CIRCUMFERENCE * (1 - clampedPct / 100);

  return (
    <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
      {/* Background track */}
      <Circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_R}
        fill="transparent"
        stroke={colours.outlineVariant}
        strokeWidth={RING_STROKE}
      />
      {/* Progress arc — starts at top (rotate -90deg) */}
      <Circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_R}
        fill="transparent"
        stroke={colours.primary}
        strokeWidth={RING_STROKE}
        strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
      />
    </Svg>
  );
}

function formatProgress(
  status: BabyStepStatus,
  rule: (typeof BABY_STEP_RULES)[1],
): {
  label: string;
  percent: number;
  a11y: string;
} {
  const { progress, stepNumber } = status;
  if (!progress) {
    return {
      label: '',
      percent: 0,
      a11y: `Step ${stepNumber}: ${rule.shortTitle}, no progress data`,
    };
  }

  const { current, target, unit } = progress;
  const percent = target > 0 ? Math.round((current / target) * 100) : 0;

  if (unit === 'count') {
    // Step 2 or 6 — debts cleared
    const label = `${current} of ${target} debts cleared`;
    return {
      label,
      percent,
      a11y: `Step ${stepNumber}: ${rule.shortTitle}, ${current} of ${target} debts cleared`,
    };
  }

  // Cents — format as rands
  const currentR = Math.round(current / 100).toLocaleString('en-ZA');
  const targetR = Math.round(target / 100).toLocaleString('en-ZA');
  const label = `R${currentR} of R${targetR}`;
  return {
    label,
    percent,
    a11y: `Step ${stepNumber}: ${rule.shortTitle}, ${percent}% complete, R${currentR} of R${targetR}`,
  };
}

function NoDataCTA({
  stepNumber,
  onNavigateToAddEnvelope,
  onNavigateToAddDebt,
}: {
  stepNumber: number;
  onNavigateToAddEnvelope?: (type?: 'income' | 'emergency_fund') => void;
  onNavigateToAddDebt?: () => void;
}): React.JSX.Element {
  if (stepNumber === 3) {
    return (
      <View style={styles.ctaContainer} testID="cta-no-income">
        <MaterialCommunityIcons name="cash-plus" size={40} color={colours.outlineVariant} />
        <Text variant="bodyMedium" style={styles.ctaText}>
          No income envelope yet. Add one to unlock Step 3.
        </Text>
        <Button
          mode="outlined"
          onPress={() => onNavigateToAddEnvelope?.('income')}
          style={styles.ctaButton}
        >
          Add income envelope
        </Button>
      </View>
    );
  }

  if (stepNumber === 1) {
    return (
      <View style={styles.ctaContainer} testID="cta-no-emf">
        <MaterialCommunityIcons
          name="shield-alert-outline"
          size={40}
          color={colours.outlineVariant}
        />
        <Text variant="bodyMedium" style={styles.ctaText}>
          No emergency fund envelope yet. Create one to start Step 1.
        </Text>
        <Button
          mode="outlined"
          onPress={() => onNavigateToAddEnvelope?.('emergency_fund')}
          style={styles.ctaButton}
        >
          Add emergency fund
        </Button>
      </View>
    );
  }

  if (stepNumber === 2 || stepNumber === 6) {
    return (
      <View style={styles.ctaContainer} testID="cta-no-debts">
        <MaterialCommunityIcons name="bank-outline" size={40} color={colours.outlineVariant} />
        <Text variant="bodyMedium" style={styles.ctaText}>
          No debts tracked yet. Add accounts in the Debt tracker to unlock.
        </Text>
        <Button mode="outlined" onPress={onNavigateToAddDebt} style={styles.ctaButton}>
          Add debt account
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.ctaContainer} testID="cta-generic">
      <Text variant="bodyMedium" style={styles.ctaText}>
        No data available for this step yet.
      </Text>
    </View>
  );
}

export const CurrentStepHero: React.FC<CurrentStepHeroProps> = ({
  status,
  onToggleManual,
  onNavigateToAddEnvelope,
  onNavigateToAddDebt,
  loading = false,
}) => {
  const rule = BABY_STEP_RULES[status.stepNumber];

  const sealState = status.isCompleted ? 'complete' : 'current';

  // Manual steps 4/5/7
  if (status.isManual) {
    return (
      <Surface style={styles.heroCard} elevation={1} testID="current-step-hero">
        <View style={styles.heroHeader}>
          <StepSealMark stepNumber={status.stepNumber} state={sealState} size={96} />
          <View style={styles.heroTitleBlock}>
            <Text variant="labelSmall" style={styles.stepLabel}>
              STEP {status.stepNumber}
            </Text>
            <Text variant="titleLarge" style={styles.heroTitle}>
              {rule.shortTitle}
            </Text>
            <Text variant="bodySmall" style={styles.heroDesc}>
              {rule.description}
            </Text>
          </View>
        </View>
        <ManualStepPanel
          isCompleted={status.isCompleted}
          onToggle={onToggleManual}
          loading={loading}
        />
      </Surface>
    );
  }

  // Auto step — no data / blocked
  if (!status.progress) {
    return (
      <Surface style={styles.heroCard} elevation={1} testID="current-step-hero">
        <View style={styles.heroHeader}>
          <StepSealMark stepNumber={status.stepNumber} state={sealState} size={96} />
          <View style={styles.heroTitleBlock}>
            <Text variant="labelSmall" style={styles.stepLabel}>
              STEP {status.stepNumber}
            </Text>
            <Text variant="titleLarge" style={styles.heroTitle}>
              {rule.shortTitle}
            </Text>
          </View>
        </View>
        <NoDataCTA
          stepNumber={status.stepNumber}
          onNavigateToAddEnvelope={onNavigateToAddEnvelope}
          onNavigateToAddDebt={onNavigateToAddDebt}
        />
      </Surface>
    );
  }

  // Auto step — with progress
  const { label: progressLabel, percent, a11y: progressA11y } = formatProgress(status, rule);

  return (
    <Surface style={styles.heroCard} elevation={1} testID="current-step-hero">
      <View style={styles.heroHeader}>
        <View accessible accessibilityLabel={progressA11y} style={styles.ringContainer}>
          <ProgressRing percent={percent} />
          {/* Seal mark overlaid in ring centre */}
          <View style={styles.sealOverlay}>
            <StepSealMark stepNumber={status.stepNumber} state={sealState} size={56} />
          </View>
        </View>
        <View style={styles.heroTitleBlock}>
          <Text variant="labelSmall" style={styles.stepLabel}>
            STEP {status.stepNumber}
          </Text>
          <Text variant="titleLarge" style={styles.heroTitle}>
            {rule.shortTitle}
          </Text>
          <Text variant="bodySmall" style={styles.heroDesc}>
            {rule.description}
          </Text>
        </View>
      </View>

      {/* Progress label — tabular-numeric (no accessibilityLabel: a11y is on the wrapping ringContainer View) */}
      <Text variant="titleMedium" style={styles.progressLabel}>
        {progressLabel}
      </Text>
    </Surface>
  );
};

const styles = StyleSheet.create({
  heroCard: {
    backgroundColor: colours.primaryContainer,
    borderRadius: radius.xl,
    padding: spacing.base,
    gap: spacing.base,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
  },
  heroTitleBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  stepLabel: {
    color: colours.onPrimaryContainer,
    letterSpacing: 1.2,
    opacity: 0.7,
  },
  heroTitle: {
    color: colours.onPrimaryContainer,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  heroDesc: {
    color: colours.onPrimaryContainer,
    opacity: 0.8,
  },
  ringContainer: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  sealOverlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressLabel: {
    color: colours.onPrimaryContainer,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  ctaContainer: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  ctaText: {
    color: colours.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 22,
  },
  ctaButton: {
    marginTop: spacing.xs,
  },
});
