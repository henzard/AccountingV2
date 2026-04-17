import React, { useCallback, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Surface, Button, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { eq } from 'drizzle-orm';
import { format } from 'date-fns';
import { db } from '../../../data/local/db';
import { debts as debtsTable } from '../../../data/local/schema';
import { SnowballPayoffProjector } from '../../../domain/debtSnowball/SnowballPayoffProjector';
import {
  getDebtTypeLabel,
  getPayoffProgressPercent,
} from '../../../domain/debtSnowball/DebtEntity';
import { DebtPayoffBar } from './components/DebtPayoffBar';
import { StatCard } from '../../components/shared/StatCard';
import { formatCurrency } from '../../utils/currency';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { DebtEntity } from '../../../domain/debtSnowball/DebtEntity';
import type { DebtDetailScreenProps } from '../../navigation/types';

const projector = new SnowballPayoffProjector();

export const DebtDetailScreen: React.FC<DebtDetailScreenProps> = ({ navigation, route }) => {
  const { colors } = useAppTheme();
  const { debtId } = route.params;
  const [debt, setDebt] = useState<DebtEntity | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await db.select().from(debtsTable).where(eq(debtsTable.id, debtId));
    setDebt((rows[0] as DebtEntity) ?? null);
    setLoading(false);
  }, [debtId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading || !debt) {
    return (
      <View style={styles.center}>
        <ActivityIndicator animating color={colors.primary} />
      </View>
    );
  }

  const plan = projector.project([debt]);
  const projection = plan.projections[0];
  const progress = getPayoffProgressPercent(debt);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Surface style={[styles.card, { backgroundColor: colors.surface }]} elevation={1}>
        <Text variant="titleLarge" style={[styles.creditor, { color: colors.onSurface }]}>
          {debt.creditorName}
        </Text>
        <Text variant="bodyMedium" style={[styles.type, { color: colors.onSurfaceVariant }]}>
          {getDebtTypeLabel(debt.debtType)}
        </Text>

        <View style={styles.statsRow}>
          <StatCard
            label="Outstanding"
            value={formatCurrency(debt.outstandingBalanceCents)}
            testID="stat-outstanding"
          />
          <StatCard
            label="Paid to Date"
            value={formatCurrency(debt.totalPaidCents)}
            valueColor={colors.success}
            testID="stat-paid-to-date"
          />
        </View>

        <DebtPayoffBar progressPercent={progress} label={`${progress}% paid off`} />

        <View style={styles.detailsRow}>
          <Text variant="bodySmall" style={[styles.detail, { color: colors.onSurfaceVariant }]}>
            {`Min payment: ${formatCurrency(debt.minimumPaymentCents)}/month`}
          </Text>
          <Text variant="bodySmall" style={[styles.detail, { color: colors.onSurfaceVariant }]}>
            Rate: {debt.interestRatePercent}% p.a.
          </Text>
        </View>

        {projection && projection.monthsToPayoff > 0 && (
          <Text variant="bodyMedium" style={[styles.payoffDate, { color: colors.primary }]}>
            Projected payoff: {format(projection.payoffDate, 'MMMM yyyy')} (
            {projection.monthsToPayoff} months)
          </Text>
        )}
      </Surface>

      {!debt.isPaidOff && (
        <Button
          mode="contained"
          icon="cash"
          onPress={() => navigation.navigate('LogPayment', { debtId: debt.id })}
          style={[styles.payButton, { backgroundColor: colors.primary }]}
        >
          Log Payment
        </Button>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: spacing.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, padding: spacing.base },
  creditor: { fontFamily: 'PlusJakartaSans_700Bold' },
  type: { marginTop: 2, marginBottom: spacing.base },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.base },
  detailsRow: { marginTop: spacing.sm, gap: spacing.xs },
  detail: {},
  payoffDate: {
    marginTop: spacing.sm,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  payButton: { marginTop: spacing.base },
});
