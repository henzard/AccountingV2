import React, { useCallback, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Surface, Button, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { eq } from 'drizzle-orm';
import { format } from 'date-fns';
import { db } from '../../../data/local/db';
import { debts as debtsTable } from '../../../data/local/schema';
import { SnowballPayoffProjector } from '../../../domain/debtSnowball/SnowballPayoffProjector';
import { getDebtTypeLabel, getPayoffProgressPercent } from '../../../domain/debtSnowball/DebtEntity';
import { DebtPayoffBar } from './components/DebtPayoffBar';
import { colours, spacing, radius } from '../../theme/tokens';
import type { DebtEntity } from '../../../domain/debtSnowball/DebtEntity';
import type { DebtDetailScreenProps } from '../../navigation/types';

const projector = new SnowballPayoffProjector();

export const DebtDetailScreen: React.FC<DebtDetailScreenProps> = ({ navigation, route }) => {
  const { debtId } = route.params;
  const [debt, setDebt] = useState<DebtEntity | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await db.select().from(debtsTable).where(eq(debtsTable.id, debtId));
    setDebt((rows[0] as DebtEntity) ?? null);
    setLoading(false);
  }, [debtId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading || !debt) {
    return <View style={styles.center}><ActivityIndicator animating color={colours.primary} /></View>;
  }

  const plan = projector.project([debt]);
  const projection = plan.projections[0];
  const progress = getPayoffProgressPercent(debt);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Surface style={styles.card} elevation={1}>
        <Text variant="titleLarge" style={styles.creditor}>{debt.creditorName}</Text>
        <Text variant="bodyMedium" style={styles.type}>{getDebtTypeLabel(debt.debtType)}</Text>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text variant="labelSmall" style={styles.statLabel}>OUTSTANDING</Text>
            <Text variant="titleMedium" style={styles.statValue}>
              R{(debt.outstandingBalanceCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text variant="labelSmall" style={styles.statLabel}>PAID TO DATE</Text>
            <Text variant="titleMedium" style={[styles.statValue, { color: colours.success }]}>
              R{(debt.totalPaidCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
            </Text>
          </View>
        </View>

        <DebtPayoffBar progressPercent={progress} label={`${progress}% paid off`} />

        <View style={styles.detailsRow}>
          <Text variant="bodySmall" style={styles.detail}>
            Min payment: R{(debt.minimumPaymentCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}/month
          </Text>
          <Text variant="bodySmall" style={styles.detail}>
            Rate: {debt.interestRatePercent}% p.a.
          </Text>
        </View>

        {projection && projection.monthsToPayoff > 0 && (
          <Text variant="bodyMedium" style={styles.payoffDate}>
            Projected payoff: {format(projection.payoffDate, 'MMMM yyyy')} ({projection.monthsToPayoff} months)
          </Text>
        )}
      </Surface>

      {!debt.isPaidOff && (
        <Button
          mode="contained"
          icon="cash"
          onPress={() => navigation.navigate('LogPayment', { debtId: debt.id })}
          style={styles.payButton}
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
  card: { borderRadius: radius.lg, padding: spacing.base, backgroundColor: colours.surface },
  creditor: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_700Bold' },
  type: { color: colours.onSurfaceVariant, marginTop: 2, marginBottom: spacing.base },
  statsRow: { flexDirection: 'row', marginBottom: spacing.base },
  stat: { flex: 1 },
  statLabel: { color: colours.onSurfaceVariant, letterSpacing: 0.8 },
  statValue: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_700Bold', marginTop: spacing.xs / 2 },
  detailsRow: { marginTop: spacing.sm, gap: spacing.xs },
  detail: { color: colours.onSurfaceVariant },
  payoffDate: { color: colours.primary, marginTop: spacing.sm, fontFamily: 'PlusJakartaSans_600SemiBold' },
  payButton: { marginTop: spacing.base, backgroundColor: colours.primary },
});
