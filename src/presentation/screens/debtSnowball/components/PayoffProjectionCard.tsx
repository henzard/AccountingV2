import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { format, differenceInMonths } from 'date-fns';
import { colours, spacing, radius } from '../../../theme/tokens';
import type { SnowballPlan } from '../../../../domain/debtSnowball/SnowballPayoffProjector';

interface PayoffProjectionCardProps {
  plan: SnowballPlan;
  totalDebtCents: number;
}

export function PayoffProjectionCard({
  plan,
  totalDebtCents,
}: PayoffProjectionCardProps): React.JSX.Element | null {
  if (plan.projections.length === 0) return null;

  const monthsRemaining = plan.debtFreeDate
    ? differenceInMonths(plan.debtFreeDate, new Date())
    : null;

  const debtsToPayoff = plan.projections.filter((p) => p.monthsToPayoff !== -1).length;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>DEBT-FREE DATE</Text>
      {plan.debtFreeDate ? (
        <>
          <Text style={styles.date}>{format(plan.debtFreeDate, 'MMM yyyy')}</Text>
          {monthsRemaining !== null && (
            <Text style={styles.months}>
              {monthsRemaining} month{monthsRemaining !== 1 ? 's' : ''} away
            </Text>
          )}
        </>
      ) : (
        <Text style={styles.unknown}>Increase payments to project a date</Text>
      )}

      <View style={styles.divider} />

      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>TOTAL DEBT</Text>
          <Text style={styles.statValue}>
            R{(totalDebtCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>DEBTS TO CLEAR</Text>
          <Text style={styles.statValue}>{debtsToPayoff}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: spacing.base,
    borderRadius: radius.xl,
    padding: spacing.lg,
    backgroundColor: colours.primary,
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    letterSpacing: 1.4,
    marginBottom: spacing.xs,
  },
  date: {
    color: '#FFFFFF',
    fontSize: 36,
    fontFamily: 'PlusJakartaSans_700Bold',
    lineHeight: 42,
  },
  months: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    marginTop: spacing.xs / 2,
  },
  unknown: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 14,
    marginTop: spacing.xs,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginVertical: spacing.base,
  },
  row: { flexDirection: 'row' },
  stat: { flex: 1 },
  statLabel: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    letterSpacing: 0.8,
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'PlusJakartaSans_700Bold',
    marginTop: spacing.xs / 2,
  },
});
