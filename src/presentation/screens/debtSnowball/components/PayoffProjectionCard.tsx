import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Surface, Text } from 'react-native-paper';
import { format } from 'date-fns';
import { colours, spacing, radius } from '../../../theme/tokens';
import type { SnowballPlan } from '../../../../domain/debtSnowball/SnowballPayoffProjector';

interface PayoffProjectionCardProps {
  plan: SnowballPlan;
  totalDebtCents: number;
}

export function PayoffProjectionCard({ plan, totalDebtCents }: PayoffProjectionCardProps): React.JSX.Element | null {
  if (plan.projections.length === 0) return null;

  return (
    <Surface style={styles.card} elevation={1}>
      <Text variant="labelMedium" style={styles.label}>DEBT-FREE DATE</Text>
      {plan.debtFreeDate ? (
        <Text variant="headlineMedium" style={styles.date}>
          {format(plan.debtFreeDate, 'MMM yyyy')}
        </Text>
      ) : (
        <Text variant="bodyMedium" style={styles.unknown}>Increase payments to project</Text>
      )}
      <View style={styles.divider} />
      <View style={styles.row}>
        <View style={styles.stat}>
          <Text variant="labelSmall" style={styles.statLabel}>TOTAL DEBT</Text>
          <Text variant="titleMedium" style={styles.statValue}>
            R{(totalDebtCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text variant="labelSmall" style={styles.statLabel}>DEBTS TO CLEAR</Text>
          <Text variant="titleMedium" style={styles.statValue}>
            {plan.projections.filter((p) => p.monthsToPayoff > 0).length}
          </Text>
        </View>
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: spacing.base,
    borderRadius: radius.lg,
    padding: spacing.base,
    backgroundColor: colours.primaryContainer,
  },
  label: { color: colours.onPrimaryContainer, letterSpacing: 1.2, marginBottom: spacing.xs },
  date: { color: colours.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  unknown: { color: colours.onSurfaceVariant, marginTop: spacing.xs },
  divider: { height: 1, backgroundColor: colours.outlineVariant, marginVertical: spacing.base },
  row: { flexDirection: 'row' },
  stat: { flex: 1 },
  statLabel: { color: colours.onPrimaryContainer, letterSpacing: 0.8 },
  statValue: { color: colours.onPrimaryContainer, fontFamily: 'PlusJakartaSans_700Bold', marginTop: spacing.xs / 2 },
});
