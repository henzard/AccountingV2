import React, { useCallback, useMemo } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { Text, FAB, ActivityIndicator, Surface, TouchableRipple } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppStore } from '../../stores/appStore';
import { useDebts } from '../../hooks/useDebts';
import { SnowballPayoffProjector } from '../../../domain/debtSnowball/SnowballPayoffProjector';
import {
  getDebtTypeLabel,
  getPayoffProgressPercent,
} from '../../../domain/debtSnowball/DebtEntity';
import { DebtPayoffBar } from './components/DebtPayoffBar';
import { PayoffProjectionCard } from './components/PayoffProjectionCard';
import { colours, spacing, radius } from '../../theme/tokens';
import type { DebtEntity } from '../../../domain/debtSnowball/DebtEntity';
import type { SnowballDashboardScreenProps } from '../../navigation/types';

const projector = new SnowballPayoffProjector();

export const SnowballDashboardScreen: React.FC<SnowballDashboardScreenProps> = ({ navigation }) => {
  const householdId = useAppStore((s) => s.householdId)!;
  const { debts, loading, reload } = useDebts(householdId);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const plan = useMemo(() => projector.project(debts), [debts]);
  const totalDebtCents = debts.reduce((s, d) => s + d.outstandingBalanceCents, 0);
  const totalPaidCents = debts.reduce((s, d) => s + d.totalPaidCents, 0);

  const renderDebt = ({ item }: { item: DebtEntity }): React.JSX.Element => {
    const progress = getPayoffProgressPercent(item);
    const label = item.isPaidOff
      ? 'PAID OFF'
      : `R${(item.outstandingBalanceCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })} remaining`;

    return (
      <TouchableRipple
        onPress={() => navigation.navigate('DebtDetail', { debtId: item.id })}
        rippleColor={colours.primaryContainer}
      >
        <Surface style={styles.debtRow} elevation={1}>
          <View style={styles.debtHeader}>
            <View style={styles.debtLeft}>
              <Text variant="titleSmall" style={styles.creditor}>
                {item.creditorName}
              </Text>
              <Text variant="bodySmall" style={styles.debtType}>
                {getDebtTypeLabel(item.debtType)}
              </Text>
            </View>
            {item.isPaidOff ? (
              <MaterialCommunityIcons name="check-circle" size={22} color={colours.success} />
            ) : (
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={colours.onSurfaceVariant}
              />
            )}
          </View>
          <DebtPayoffBar progressPercent={progress} label={label} />
        </Surface>
      </TouchableRipple>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator animating color={colours.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <Surface style={styles.header} elevation={0}>
        <Text variant="labelMedium" style={styles.headerLabel}>
          DEBT SNOWBALL
        </Text>
        {totalPaidCents > 0 && (
          <Text variant="bodySmall" style={styles.paidSoFar}>
            R{(totalPaidCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })} paid off
            to date
          </Text>
        )}
      </Surface>

      <FlatList
        data={debts}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          debts.length > 0 ? (
            <PayoffProjectionCard plan={plan} totalDebtCents={totalDebtCents} />
          ) : null
        }
        renderItem={renderDebt}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.center}>
            <MaterialCommunityIcons name="snowflake" size={64} color={colours.outlineVariant} />
            <Text variant="titleMedium" style={styles.emptyTitle}>
              No debts entered
            </Text>
            <Text variant="bodyMedium" style={styles.emptyBody}>
              Tap + to add your first debt and start the snowball
            </Text>
          </View>
        }
      />

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={() => navigation.navigate('AddDebt')}
        color={colours.onPrimary}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.xl,
    paddingBottom: spacing.base,
    backgroundColor: colours.surface,
  },
  headerLabel: { color: colours.onSurfaceVariant, letterSpacing: 1.5 },
  paidSoFar: {
    color: colours.success,
    marginTop: spacing.xs,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  debtRow: {
    marginHorizontal: spacing.base,
    marginVertical: spacing.xs / 2,
    borderRadius: radius.md,
    padding: spacing.base,
    backgroundColor: colours.surface,
  },
  debtHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  debtLeft: { flex: 1 },
  creditor: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_600SemiBold' },
  debtType: { color: colours.onSurfaceVariant, marginTop: 2 },
  emptyTitle: { color: colours.onSurface, marginTop: spacing.base },
  emptyBody: { color: colours.onSurfaceVariant, textAlign: 'center', marginTop: spacing.sm },
  list: { paddingBottom: 100 },
  fab: {
    position: 'absolute',
    right: spacing.base,
    bottom: spacing.xl,
    backgroundColor: colours.primary,
  },
});
