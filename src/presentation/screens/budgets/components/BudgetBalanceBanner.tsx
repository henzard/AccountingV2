/**
 * BudgetBalanceBanner — zero-based budget status banner for the Budget screen.
 *
 * States (spec §Zero-based budgeting):
 *   toAssign == 0 → "Every rand assigned ✓"   (success colour)
 *   toAssign > 0  → "R{n} left to assign"      (info / primary)
 *   toAssign < 0  → "-R{abs} overcommitted"    (warning colour)
 *
 * Shows incomeTotal / expenseAllocationTotal / toAssign breakdown.
 *
 * Uses useBudgetBalance() which wraps BudgetBalanceCalculator.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import type { EnvelopeEntity } from '../../../../domain/envelopes/EnvelopeEntity';
import { useBudgetBalance } from '../../../hooks/useBudgetBalance';
import { spacing, radius } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';

export interface BudgetBalanceBannerProps {
  envelopes: EnvelopeEntity[];
}

function formatRand(cents: number): string {
  return `R${Math.abs(Math.round(cents / 100)).toLocaleString('en-ZA')}`;
}

export const BudgetBalanceBanner: React.FC<BudgetBalanceBannerProps> = ({ envelopes }) => {
  const { colors } = useAppTheme();
  const { incomeTotal, expenseAllocationTotal, toAssign, isBalanced } = useBudgetBalance(envelopes);

  const isOver = toAssign < 0;

  const bannerBg = isBalanced
    ? colors.successContainer
    : isOver
      ? colors.warningContainer
      : colors.primaryContainer;

  const bannerFg = isBalanced ? colors.success : isOver ? colors.warning : colors.primary;

  const iconName = isBalanced ? 'check-circle-outline' : isOver ? 'alert-outline' : 'cash-clock';

  const mainLabel = isBalanced
    ? 'Every rand assigned \u2713'
    : isOver
      ? `-${formatRand(Math.abs(toAssign))} overcommitted`
      : `${formatRand(toAssign)} left to assign`;

  return (
    <Surface
      style={[styles.banner, { backgroundColor: bannerBg }]}
      elevation={0}
      testID="budget-balance-banner"
    >
      {/* Main status row */}
      <View style={styles.mainRow}>
        <MaterialCommunityIcons name={iconName} size={22} color={bannerFg} />
        <Text
          variant="titleSmall"
          style={[styles.mainLabel, { color: bannerFg }]}
          testID="banner-main-label"
        >
          {mainLabel}
        </Text>
      </View>

      {/* Breakdown row */}
      <View style={styles.breakdownRow}>
        <BreakdownItem
          label="INCOME"
          value={formatRand(incomeTotal)}
          colour={colors.onSurfaceVariant}
          labelColour={colors.onSurfaceVariant}
          testID="banner-income"
        />
        <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
        <BreakdownItem
          label="EXPENSES"
          value={formatRand(expenseAllocationTotal)}
          colour={colors.onSurfaceVariant}
          labelColour={colors.onSurfaceVariant}
          testID="banner-expenses"
        />
        <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
        <BreakdownItem
          label="TO ASSIGN"
          labelColour={colors.onSurfaceVariant}
          value={toAssign < 0 ? `-${formatRand(Math.abs(toAssign))}` : formatRand(toAssign)}
          colour={bannerFg}
          testID="banner-to-assign"
        />
      </View>
    </Surface>
  );
};

function BreakdownItem({
  label,
  value,
  colour,
  labelColour,
  testID,
}: {
  label: string;
  value: string;
  colour: string;
  labelColour: string;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.breakdownItem}>
      <Text variant="labelSmall" style={[styles.breakdownLabel, { color: labelColour }]}>
        {label}
      </Text>
      <Text
        variant="labelMedium"
        style={[styles.breakdownValue, { color: colour }]}
        testID={testID}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  mainLabel: {
    fontFamily: 'PlusJakartaSans_700Bold',
    flex: 1,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breakdownItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  breakdownLabel: {
    letterSpacing: 0.6,
  },
  breakdownValue: {
    fontVariant: ['tabular-nums'],
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  divider: {
    width: 1,
    height: 28,
  },
});
