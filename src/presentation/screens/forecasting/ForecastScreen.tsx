import React, { useCallback } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useAppStore } from '../../stores/appStore';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { CashFlowForecaster } from '../../../domain/forecasting/CashFlowForecaster';
import { formatCurrency } from '../../utils/currency';
import { LoadingSkeletonList } from '../../components/shared/LoadingSkeletonList';
import { ScreenHeader } from '../../components/shared/ScreenHeader';
import { spacing, radius, fontSize } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { EnvelopeForecast } from '../../../domain/forecasting/CashFlowForecaster';

const engine = new BudgetPeriodEngine();
const forecaster = new CashFlowForecaster();

const STATUS_ORDER: Record<string, number> = { over_budget: 0, warning: 1, on_track: 2 };

export function ForecastScreen(): React.JSX.Element {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId) ?? '';
  const paydayDay = useAppStore((s) => s.paydayDay);
  const period = engine.getCurrentPeriod(paydayDay);
  const periodStart = format(period.startDate, 'yyyy-MM-dd');
  const periodEnd = format(period.endDate, 'yyyy-MM-dd');

  const { envelopes, loading, reload } = useEnvelopes(householdId, periodStart);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const forecasts = forecaster.project({
    envelopes,
    transactions: [], // spentCents already aggregated on envelope
    periodStart,
    periodEnd,
  });

  const sorted = [...forecasts].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScreenHeader eyebrow={period.label} title="90-Day Forecast" />

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
            <Text variant="bodySmall" style={[styles.hint, { color: colors.onSurfaceVariant }]}>
              Based on {sorted[0]?.daysElapsed ?? 0} days of spending.{' '}
              {sorted[0]?.daysRemaining ?? 0} days left in period.
            </Text>
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
          {formatCurrency(item.spentCents)} spent · {formatCurrency(item.dailySpendCents)}/day
        </Text>
        <Text style={[styles.meta, { color: colors.onSurfaceVariant }]}>
          {item.projectedRemainingPct}% projected left
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
