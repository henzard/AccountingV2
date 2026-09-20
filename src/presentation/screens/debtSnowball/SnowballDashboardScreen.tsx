import { differenceInCalendarMonths, format } from 'date-fns';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import {
  Text,
  FAB,
  ActivityIndicator,
  Surface,
  TouchableRipple,
  TextInput,
  Chip,
} from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { db } from '../../../data/local/db';
import { useAppStore } from '../../stores/appStore';
import { useDebts } from '../../hooks/useDebts';
import { SnowballPayoffProjector } from '../../../domain/debtSnowball/SnowballPayoffProjector';
import {
  getDebtTypeLabel,
  getPayoffProgressPercent,
} from '../../../domain/debtSnowball/DebtEntity';
import { getLatestDebtSnapshot } from '../../../domain/scoring/getLatestDebtSnapshot';
import type { DebtSnapshot } from '../../../domain/scoring/RecordPeriodScoreUseCase';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../../domain/shared/BudgetPeriodEngine';
import { computeDebtProgressMessage } from './debtProgressMessage';
import { DebtPayoffBar } from './components/DebtPayoffBar';
import { PayoffProjectionCard } from './components/PayoffProjectionCard';
import { ScreenHeader } from '../../components/shared/ScreenHeader';
import { RefreshingBar } from '../../components/shared/RefreshingBar';
import { EmptyState } from '../../components/shared/EmptyState';
import { formatCurrency } from '../../utils/currency';
import { parseMoneyInput } from '../../utils/parseMoneyInput';
import { logger } from '../../../infrastructure/logging/Logger';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { DebtEntity } from '../../../domain/debtSnowball/DebtEntity';
import type { SnowballDashboardScreenProps } from '../../navigation/types';

const projector = new SnowballPayoffProjector();
const periodEngine = new BudgetPeriodEngine();

export const SnowballDashboardScreen: React.FC<SnowballDashboardScreenProps> = ({ navigation }) => {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);
  const { debts, loading, refreshing, reload } = useDebts(householdId);
  const [extraPaymentRands, setExtraPaymentRands] = useState('');
  // Last recorded (device-local) debt-plan snapshot, strictly before the
  // CURRENT period — "last month's" numbers for the progress line below
  // (VAL2-10). `null` when there is none yet (new plan, or a household that
  // hasn't rolled a period since this shipped) — the progress line simply
  // doesn't render in that case.
  const [previousSnapshot, setPreviousSnapshot] = useState<DebtSnapshot | null>(null);
  const currentPeriodStart = formatPeriodDateKey(
    periodEngine.getCurrentPeriod(paydayDay).startDate,
  );

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    let cancelled = false;
    getLatestDebtSnapshot(db, householdId, currentPeriodStart)
      .then((snapshot) => {
        if (!cancelled) setPreviousSnapshot(snapshot);
      })
      .catch((err: unknown) => {
        // Best-effort, read-only — the dashboard's own numbers are unaffected.
        logger.error('SnowballDashboardScreen: failed to load previous debt snapshot', err, {
          householdId,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, currentPeriodStart]);

  const extraPaymentCents = useMemo(() => {
    if (!extraPaymentRands.trim()) return 0;
    const parsed = parseMoneyInput(extraPaymentRands);
    return parsed.ok && parsed.cents > 0 ? parsed.cents : 0;
  }, [extraPaymentRands]);

  const plan = useMemo(
    () => projector.project(debts, extraPaymentCents),
    [debts, extraPaymentCents],
  );
  const planNoExtra = useMemo(() => projector.project(debts, 0), [debts]);

  const totalDebtCents = debts.reduce((s, d) => s + d.outstandingBalanceCents, 0);
  const totalPaidCents = debts.reduce((s, d) => s + d.totalPaidCents, 0);

  // Compared against `planNoExtra` (0 extra), matching how the snapshot
  // recorded at rollover is computed (see `RolloverWizard`) — comparing
  // against `plan` here would mix in whatever extra payment happens to be
  // typed into the field above right now.
  const debtProgress = useMemo(
    () =>
      computeDebtProgressMessage(
        { totalDebtCents, debtFreeDate: planNoExtra.debtFreeDate },
        previousSnapshot,
      ),
    [totalDebtCents, planNoExtra.debtFreeDate, previousSnapshot],
  );

  // Sort debts by balance (smallest unpaid first, paid-off last)
  const sortedDebts = useMemo(() => {
    const copy = [...debts];
    return copy.sort((a, b) => {
      if (a.isPaidOff && !b.isPaidOff) return 1;
      if (!a.isPaidOff && b.isPaidOff) return -1;
      return a.outstandingBalanceCents - b.outstandingBalanceCents;
    });
  }, [debts]);

  // Find first unpaid debt (for Focus badge)
  const focusDebtId = useMemo(() => sortedDebts.find((d) => !d.isPaidOff)?.id, [sortedDebts]);

  const renderDebt = ({ item }: { item: DebtEntity }): React.JSX.Element => {
    const progress = getPayoffProgressPercent(item);
    const label = item.isPaidOff
      ? 'PAID OFF'
      : `${formatCurrency(item.outstandingBalanceCents)} remaining`;
    const isFocus = !item.isPaidOff && item.id === focusDebtId;

    return (
      <TouchableRipple
        onPress={() => navigation.navigate('DebtDetail', { debtId: item.id })}
        rippleColor={colors.primaryContainer}
      >
        <Surface style={[styles.debtRow, { backgroundColor: colors.surface }]} elevation={1}>
          <View style={styles.debtHeader}>
            <View style={styles.debtLeft}>
              <View style={styles.titleRow}>
                <Text variant="titleSmall" style={[styles.creditor, { color: colors.onSurface }]}>
                  {item.creditorName}
                </Text>
                {isFocus && (
                  <Chip
                    accessibilityLabel={`Focus debt: ${item.creditorName}`}
                    style={[styles.focusChip, { backgroundColor: colors.primaryContainer }]}
                  >
                    <Text style={{ color: colors.onPrimaryContainer, fontSize: 12 }}>Focus</Text>
                  </Chip>
                )}
              </View>
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

  const monthsDifference =
    plan.debtFreeDate && planNoExtra.debtFreeDate
      ? differenceInCalendarMonths(planNoExtra.debtFreeDate, plan.debtFreeDate)
      : 0;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Surface style={[styles.header, { backgroundColor: colors.surface }]} elevation={0}>
        <ScreenHeader
          eyebrow="Debt Snowball"
          title={
            totalPaidCents > 0
              ? `${formatCurrency(totalPaidCents)} paid off to date`
              : 'Your debt payoff plan'
          }
        />
      </Surface>
      <RefreshingBar refreshing={refreshing} />

      <FlatList
        data={sortedDebts}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          debts.length > 0 ? (
            <View style={styles.headerSection}>
              <View style={[styles.extraPaymentCard, { backgroundColor: colors.surface }]}>
                <TextInput
                  label="Extra per month (R) — optional"
                  value={extraPaymentRands}
                  onChangeText={setExtraPaymentRands}
                  keyboardType="numeric"
                  mode="outlined"
                  style={{ backgroundColor: colors.surface }}
                />
                {plan.debtFreeDate && (
                  <View style={styles.projectionInfo}>
                    <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                      {plan.debtFreeDate
                        ? `Debt-free by ${format(plan.debtFreeDate, 'MMM yyyy')}`
                        : 'Unable to calculate payoff date'}
                    </Text>
                    {monthsDifference > 0 && (
                      <Text
                        variant="bodySmall"
                        style={[
                          { color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold' },
                        ]}
                      >
                        {monthsDifference} {monthsDifference === 1 ? 'month' : 'months'} sooner
                      </Text>
                    )}
                    {debtProgress.dateMessage && (
                      <Text
                        variant="bodySmall"
                        style={{ color: colors.onSurfaceVariant }}
                        testID="debt-progress-date-message"
                      >
                        {debtProgress.dateMessage}
                      </Text>
                    )}
                    {debtProgress.paidOffMessage && (
                      <Text
                        variant="bodySmall"
                        style={{ color: colors.success }}
                        testID="debt-progress-paid-off-message"
                      >
                        {debtProgress.paidOffMessage}
                      </Text>
                    )}
                  </View>
                )}
              </View>
              <PayoffProjectionCard plan={plan} totalDebtCents={totalDebtCents} />
            </View>
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
        accessibilityLabel="Add debt"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: {},
  headerSection: { gap: spacing.base, paddingHorizontal: spacing.base, paddingTop: spacing.base },
  extraPaymentCard: {
    borderRadius: radius.md,
    padding: spacing.base,
    gap: spacing.sm,
  },
  projectionInfo: { gap: spacing.xs },
  debtRow: {
    marginHorizontal: spacing.base,
    marginVertical: spacing.xs / 2,
    borderRadius: radius.md,
    padding: spacing.base,
  },
  debtHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  debtLeft: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  creditor: { fontFamily: 'PlusJakartaSans_600SemiBold' },
  focusChip: { marginLeft: spacing.xs },
  debtType: { marginTop: 2 },
  list: { paddingBottom: 100 },
  fab: {
    position: 'absolute',
    right: spacing.base,
    bottom: spacing.xl,
  },
});
