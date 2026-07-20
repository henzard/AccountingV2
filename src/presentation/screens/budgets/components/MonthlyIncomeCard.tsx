/**
 * MonthlyIncomeCard — top-of-Budget entry point for the current period's income.
 *
 * Income is stored as one (or more) period-scoped 'income' envelope(s), so it is
 * never a fixed value: each budget month carries the previous month's figure
 * forward as a starting point, but the user can change it here at any time. This
 * card surfaces that total prominently and gives a single tap to set it (when no
 * income envelope exists yet) or update it (when one does).
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface, Button } from 'react-native-paper';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { spacing, radius } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';

export interface MonthlyIncomeCardProps {
  incomeCents: number;
  hasIncome: boolean;
  onSetIncome: () => void;
}

function formatRand(cents: number): string {
  return `R${Math.abs(Math.round(cents / 100)).toLocaleString('en-ZA')}`;
}

export const MonthlyIncomeCard: React.FC<MonthlyIncomeCardProps> = ({
  incomeCents,
  hasIncome,
  onSetIncome,
}) => {
  const { colors } = useAppTheme();

  return (
    <Surface
      style={[styles.card, { backgroundColor: colors.surface }]}
      elevation={1}
      testID="monthly-income-card"
    >
      <View style={styles.row}>
        <MaterialCommunityIcons name="cash-multiple" size={24} color={colors.primary} />
        <View style={styles.textCol}>
          <Text variant="labelSmall" style={[styles.label, { color: colors.onSurfaceVariant }]}>
            MONTHLY INCOME
          </Text>
          <Text
            variant="titleLarge"
            style={[styles.amount, { color: colors.onSurface }]}
            testID="monthly-income-amount"
          >
            {hasIncome ? formatRand(incomeCents) : 'Not set'}
          </Text>
        </View>
        <Button
          mode={hasIncome ? 'text' : 'contained'}
          onPress={onSetIncome}
          compact
          testID="monthly-income-action"
        >
          {hasIncome ? 'Update' : 'Set income'}
        </Button>
      </View>
      <Text variant="bodySmall" style={[styles.hint, { color: colors.onSurfaceVariant }]}>
        Enter what you actually earned this month — you can change it every month.
      </Text>
    </Surface>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: spacing.base,
    marginHorizontal: spacing.base,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  textCol: { flex: 1 },
  label: { letterSpacing: 0.6 },
  amount: { fontFamily: 'PlusJakartaSans_700Bold', fontVariant: ['tabular-nums'] },
  hint: {},
});
