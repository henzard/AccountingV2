import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useTransactions } from '../../hooks/useTransactions';
import { useAppStore } from '../../stores/appStore';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../../domain/shared/BudgetPeriodEngine';
import { CashFlowForecaster } from '../../../domain/forecasting/CashFlowForecaster';
import { formatCurrency } from '../../utils/currency';
import { LoadingSkeletonList } from '../../components/shared/LoadingSkeletonList';
import { EmptyState } from '../../components/shared/EmptyState';
import { ScreenHeader } from '../../components/shared/ScreenHeader';
import { RefreshingBar } from '../../components/shared/RefreshingBar';
import { spacing, radius, fontSize } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type {
  EnvelopeForecast,
  ForecastStatus,
} from '../../../domain/forecasting/CashFlowForecaster';

const engine = new BudgetPeriodEngine();
const forecaster = new CashFlowForecaster();

const STATUS_ORDER: Record<ForecastStatus, number> = { over_budget: 0, warning: 1, on_track: 2 };

export function ForecastScreen(): React.JSX.Element {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId) ?? '';
  const paydayDay = useAppStore((s) => s.paydayDay);
  const period = engine.getCurrentPeriod(paydayDay);
  const periodStart = formatPeriodDateKey(period.startDate);
  const periodEnd = formatPeriodDateKey(period.endDate);

  const {
    envelopes,
    loading,
    refreshing: envelopesRefreshing,
    reload,
  } = useEnvelopes(householdId, periodStart);
  const {
    transactions,
    refreshing: transactionsRefreshing,
    reload: reloadTransactions,
  } = useTransactions(householdId, {
    periodStart,
    periodEnd,
  });
  // The screen reloads both together (see the focus effect below), so
  // either one still being in flight (e.g. envelopes resolved first) must
  // keep the bar visible — tracking only `envelopesRefreshing` let it
  // disappear while transactions were still loading.
  const refreshing = envelopesRefreshing || transactionsRefreshing;

  useFocusEffect(
    useCallback(() => {
      void reload();
      void reloadTransactions();
    }, [reload, reloadTransactions]),
  );

  const forecasts = useMemo(
    () => forecaster.project({ envelopes, transactions, periodStart, periodEnd }),
    [envelopes, transactions, periodStart, periodEnd],
  );

  const sorted = useMemo(
    () => [...forecasts].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [forecasts],
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScreenHeader eyebrow={period.label} title="This period's forecast" />
      <RefreshingBar refreshing={refreshing} />

      {loading ? (
        <LoadingSkeletonList count={4} testID="forecast-loading" />
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.envelopeId}
          contentContainerStyle={styles.list}
          testID="forecast-list"
          renderItem={({ item }) => <ForecastRow item={item} />}
          ListHeaderComponent={
            sorted.length > 0 ? (
              <Text variant="bodySmall" style={[styles.hint, { color: colors.onSurfaceVariant }]}>
                Based on {sorted[0]?.daysElapsed ?? 0} days of spending.{' '}
                {sorted[0]?.daysRemaining ?? 0} days left in period.
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              title="Nothing to forecast yet"
              body="Add envelopes and log spending to see where this period is heading."
              testID="forecast-empty"
            />
          }
        />
      )}
    </View>
  );
}

function ForecastRow({ item }: { item: EnvelopeForecast }): React.JSX.Element {
  const { colors } = useAppTheme();
  const statusColor = {
    on_track: colors.success,
    warning: colors.warning,
    over_budget: colors.error,
  }[item.status];

  const barPct = Math.max(0, Math.min(100, item.projectedRemainingPct));
  // REFUNDS: an envelope cannot have more than all of its budget left, so the
  // printed figure is capped the same way the bar above is — otherwise a
  // net-refunded envelope read "180% projected left" beside a full bar. Only
  // the TOP is capped: a heavy overspend still prints its true negative
  // percentage (the bar floors at 0, the number stays honest).
  const labelPct = Math.min(100, item.projectedRemainingPct);

  return (
    <Surface style={[styles.row, { backgroundColor: colors.surface }]} elevation={0}>
      <View style={styles.rowHeader}>
        <Text variant="titleSmall" style={{ color: colors.onSurface }} numberOfLines={1}>
          {item.envelopeName}
        </Text>
        <Text variant="bodyMedium" style={{ color: statusColor }}>
          {formatCurrency(item.projectedRemainingCents)}
        </Text>
      </View>

      <View style={[styles.track, { backgroundColor: colors.surfaceVariant }]}>
        <View
          style={[
            styles.fill,
            { width: `${barPct}%` as `${number}%`, backgroundColor: statusColor },
          ]}
        />
      </View>

      <View style={styles.rowFooter}>
        <Text style={[styles.meta, { color: colors.onSurfaceVariant }]}>
          {formatCurrency(item.spentCents)} spent ·{' '}
          {item.isFixed
            ? 'Fixed bill — not projected daily'
            : `${formatCurrency(item.dailySpendCents)}/day`}
        </Text>
        <Text style={[styles.meta, { color: colors.onSurfaceVariant }]}>
          {labelPct}% projected left
        </Text>
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: spacing.base, paddingBottom: spacing.xl },
  hint: { marginBottom: spacing.base },
  row: {
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.sm,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  track: {
    height: 4,
    borderRadius: radius.full,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  fill: {
    height: 4,
    borderRadius: radius.full,
  },
  rowFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  meta: {
    fontSize: fontSize.sm,
  },
});
