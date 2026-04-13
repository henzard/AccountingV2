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
import { ScreenHeader } from '../../components/shared/ScreenHeader';
import { EmptyState } from '../../components/shared/EmptyState';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { DebtEntity } from '../../../domain/debtSnowball/DebtEntity';
import type { SnowballDashboardScreenProps } from '../../navigation/types';

const projector = new SnowballPayoffProjector();

export const SnowballDashboardScreen: React.FC<SnowballDashboardScreenProps> = ({ navigation }) => {
  const { colors } = useAppTheme();
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
        rippleColor={colors.primaryContainer}
      >
        <Surface style={[styles.debtRow, { backgroundColor: colors.surface }]} elevation={1}>
          <View style={styles.debtHeader}>
            <View style={styles.debtLeft}>
              <Text variant="titleSmall" style={[styles.creditor, { color: colors.onSurface }]}>
                {item.creditorName}
              </Text>
              <Text
                variant="bodySmall"
                style={[styles.debtType, { color: colors.onSurfaceVariant }]}
              >
                {getDebtTypeLabel(item.debtType)}
              </Text>
            </View>
            {item.isPaidOff ? (
              <MaterialCommunityIcons name="check-circle" size={22} color={colors.success} />
            ) : (
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={colors.onSurfaceVariant}
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
        <ActivityIndicator animating color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Surface style={[styles.header, { backgroundColor: colors.surface }]} elevation={0}>
        <ScreenHeader
          eyebrow="Debt Snowball"
          title={
            totalPaidCents > 0
              ? `R${(totalPaidCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })} paid off to date`
              : 'Your debt payoff plan'
          }
        />
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
          <EmptyState
            title="No debts entered"
            body="Tap + to add your first debt and start the snowball"
            testID="snowball-empty-state"
          />
        }
      />

      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => navigation.navigate('AddDebt')}
        color={colors.onPrimary}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: {},
  debtRow: {
    marginHorizontal: spacing.base,
    marginVertical: spacing.xs / 2,
    borderRadius: radius.md,
    padding: spacing.base,
  },
  debtHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  debtLeft: { flex: 1 },
  creditor: { fontFamily: 'PlusJakartaSans_600SemiBold' },
  debtType: { marginTop: 2 },
  list: { paddingBottom: 100 },
  fab: {
    position: 'absolute',
    right: spacing.base,
    bottom: spacing.xl,
  },
});
