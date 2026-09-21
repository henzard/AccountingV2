import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Surface, Button } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useTransactions } from '../../hooks/useTransactions';
import { useAppStore } from '../../stores/appStore';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../../domain/shared/BudgetPeriodEngine';
import { CashFlowForecaster } from '../../../domain/forecasting/CashFlowForecaster';
import { getPeriodDayCounts } from '../../../domain/forecasting/ForecastBlend';
import {
  buildEnvelopeInsight,
  buildPeriodSummaryCopy,
  summarisePeriodForecast,
} from '../../../domain/forecasting/ForecastInsight';
import { spendingBaselines } from '../../../domain/forecasting/CategoryBaseline';
import { useForecastHistory } from './useForecastHistory';
import { db } from '../../../data/local/db';
import { findLatestPeriodWithEnvelopes } from '../dashboard/findLatestPeriodWithEnvelopes';
import { RolloverWizard } from '../budgets/RolloverWizard';
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
import type { CategoryBaseline } from '../../../domain/forecasting/CategoryBaseline';

const engine = new BudgetPeriodEngine();
const forecaster = new CashFlowForecaster();

const STATUS_ORDER: Record<ForecastStatus, number> = { over_budget: 0, warning: 1, on_track: 2 };

/**
 * A row is either this period's forecast for a real envelope, or — when the
 * current period has no budget yet — what history says a typical period looks
 * like for that category.
 */
type ForecastListItem =
  | { kind: 'forecast'; forecast: EnvelopeForecast }
  | { kind: 'baseline'; baseline: CategoryBaseline };

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

  // History is cut at the SAME day-of-period the projection is blended at, so
  // "by day 9 you usually had spent R x" lines up with this period's day 9.
  const dayOfPeriod = useMemo(
    () => getPeriodDayCounts(periodStart, periodEnd).daysElapsed,
    [periodStart, periodEnd],
  );
  const {
    baselines,
    refreshing: historyRefreshing,
    reload: reloadHistory,
  } = useForecastHistory(householdId, periodStart, dayOfPeriod);

  // The screen reloads all three together (see the focus effect below), so
  // any one still being in flight (e.g. envelopes resolved first) must
  // keep the bar visible — tracking only `envelopesRefreshing` let it
  // disappear while transactions were still loading.
  const refreshing = envelopesRefreshing || transactionsRefreshing || historyRefreshing;

  useFocusEffect(
    useCallback(() => {
      void reload();
      void reloadTransactions();
      void reloadHistory();
    }, [reload, reloadTransactions, reloadHistory]),
  );

  const forecasts = useMemo(
    () => forecaster.project({ envelopes, transactions, baselines, periodStart, periodEnd }),
    [envelopes, transactions, baselines, periodStart, periodEnd],
  );

  const sorted = useMemo(
    () => [...forecasts].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [forecasts],
  );

  // INCOME envelopes are never forecast as spending (the forecaster drops
  // them outright — money in is not a burn rate), so the period summary can
  // only learn what was allocated as income from the envelope list itself.
  const incomeAllocatedCents = useMemo(
    () =>
      envelopes
        .filter((e) => e.envelopeType === 'income' && !e.isArchived)
        .reduce((total, e) => total + e.allocatedCents, 0),
    [envelopes],
  );

  const summary = useMemo(
    () => summarisePeriodForecast(sorted, incomeAllocatedCents),
    [sorted, incomeAllocatedCents],
  );

  const typicalCategories = useMemo(() => spendingBaselines(baselines), [baselines]);

  // NO BUDGET YET, but 18 periods of history: the screen must not be blank.
  // Show what a typical period looks like per category, and offer to start
  // this period from the last one that had envelopes.
  const hasBudget = sorted.length > 0;
  const showTypicalPeriod = !hasBudget && typicalCategories.length > 0;

  const items: ForecastListItem[] = useMemo(
    () =>
      showTypicalPeriod
        ? typicalCategories.map((baseline) => ({ kind: 'baseline' as const, baseline }))
        : sorted.map((forecast) => ({ kind: 'forecast' as const, forecast })),
    [showTypicalPeriod, typicalCategories, sorted],
  );

  const [rolloverFromPeriodStart, setRolloverFromPeriodStart] = useState<string | null>(null);
  const [showRollover, setShowRollover] = useState(false);

  // Which earlier period the rollover would copy forward, resolved once the
  // "no budget yet" state is actually on screen. Guarded with a cancel flag
  // so a resolve landing after unmount (or after the period changed) cannot
  // set state — and its failure is swallowed, since a missing source period
  // only means the CTA stays hidden.
  useEffect(() => {
    if (!showTypicalPeriod || householdId === '') return undefined;
    let cancelled = false;
    findLatestPeriodWithEnvelopes(db, householdId, periodStart)
      .then((fromPeriod) => {
        if (!cancelled) setRolloverFromPeriodStart(fromPeriod);
      })
      .catch(() => {
        if (!cancelled) setRolloverFromPeriodStart(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showTypicalPeriod, householdId, periodStart]);

  // Opens the SHARED rollover wizard — the exact entry point the dashboard
  // and budget screens use. Nothing about rollover is re-implemented here.
  const handleStartPeriod = useCallback(() => setShowRollover(true), []);
  const handleRolloverDone = useCallback(() => {
    setShowRollover(false);
    void reload();
    void reloadTransactions();
    void reloadHistory();
  }, [reload, reloadTransactions, reloadHistory]);

  const typicalTotalCents = useMemo(
    () => typicalCategories.reduce((total, b) => total + b.typicalPeriodSpendCents, 0),
    [typicalCategories],
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScreenHeader eyebrow={period.label} title="This period's forecast" />
      <RefreshingBar refreshing={refreshing} />

      {loading ? (
        <LoadingSkeletonList count={4} testID="forecast-loading" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) =>
            item.kind === 'forecast'
              ? item.forecast.envelopeId
              : `baseline:${item.baseline.envelopeType}:${item.baseline.categoryKey}`
          }
          contentContainerStyle={styles.list}
          testID="forecast-list"
          renderItem={({ item }) =>
            item.kind === 'forecast' ? (
              <ForecastRow item={item.forecast} />
            ) : (
              <TypicalCategoryRow baseline={item.baseline} />
            )
          }
          ListHeaderComponent={
            showTypicalPeriod ? (
              <TypicalPeriodHeader
                categoryCount={typicalCategories.length}
                periodsObserved={typicalCategories[0]?.periodsObserved ?? 0}
                typicalTotalCents={typicalTotalCents}
                canRollover={rolloverFromPeriodStart !== null}
                onStartPeriod={handleStartPeriod}
              />
            ) : hasBudget ? (
              <PeriodSummaryHeader
                summary={summary}
                daysElapsed={sorted[0]?.daysElapsed ?? 0}
                daysRemaining={sorted[0]?.daysRemaining ?? 0}
              />
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

      {rolloverFromPeriodStart !== null ? (
        <RolloverWizard
          visible={showRollover}
          householdId={householdId}
          fromPeriodStart={rolloverFromPeriodStart}
          toPeriodStart={periodStart}
          periodLabel={period.label}
          onDone={handleRolloverDone}
        />
      ) : null}
    </View>
  );
}

function PeriodSummaryHeader({
  summary,
  daysElapsed,
  daysRemaining,
}: {
  summary: ReturnType<typeof summarisePeriodForecast>;
  daysElapsed: number;
  daysRemaining: number;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const copy = buildPeriodSummaryCopy(summary, formatCurrency);
  const incomeLine = `${formatCurrency(summary.incomeAllocatedCents)} allocated as income this period.`;

  return (
    <Surface
      style={[styles.summary, { backgroundColor: colors.surface }]}
      elevation={0}
      testID="forecast-period-summary"
    >
      <Text
        variant="bodyMedium"
        style={{ color: colors.onSurface }}
        accessibilityRole="text"
        accessibilityLabel={copy.headline}
        testID="forecast-summary-headline"
      >
        {copy.headline}
      </Text>
      {summary.incomeAllocatedCents > 0 ? (
        <Text
          style={[styles.meta, styles.summaryLine, { color: colors.onSurfaceVariant }]}
          accessibilityRole="text"
          accessibilityLabel={incomeLine}
          testID="forecast-summary-income"
        >
          {incomeLine}
        </Text>
      ) : null}
      {copy.atRisk !== null ? (
        <Text
          style={[styles.meta, styles.summaryLine, { color: colors.onSurfaceVariant }]}
          accessibilityRole="text"
          accessibilityLabel={copy.atRisk}
          testID="forecast-summary-at-risk"
        >
          {copy.atRisk}
        </Text>
      ) : null}
      <Text
        style={[styles.meta, styles.summaryLine, { color: colors.onSurfaceVariant }]}
        accessibilityRole="text"
        accessibilityLabel={`Based on ${daysElapsed} days of spending. ${daysRemaining} days left in period.`}
      >
        Based on {daysElapsed} days of spending. {daysRemaining} days left in period.
      </Text>
    </Surface>
  );
}

function TypicalPeriodHeader({
  categoryCount,
  periodsObserved,
  typicalTotalCents,
  canRollover,
  onStartPeriod,
}: {
  categoryCount: number;
  periodsObserved: number;
  typicalTotalCents: number;
  canRollover: boolean;
  onStartPeriod: () => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const headline = `No budget for this period yet. Across your last ${periodsObserved} periods you typically spend ${formatCurrency(typicalTotalCents)} across ${categoryCount} categories.`;

  return (
    <Surface
      style={[styles.summary, { backgroundColor: colors.surface }]}
      elevation={0}
      testID="forecast-typical-period"
    >
      <Text
        variant="bodyMedium"
        style={{ color: colors.onSurface }}
        accessibilityRole="text"
        accessibilityLabel={headline}
        testID="forecast-typical-headline"
      >
        {headline}
      </Text>
      {canRollover ? (
        <Button
          mode="contained"
          onPress={onStartPeriod}
          style={styles.cta}
          testID="forecast-start-period-cta"
          accessibilityRole="button"
          accessibilityLabel="Start this period from the last one"
        >
          Start this period from the last one
        </Button>
      ) : null}
    </Surface>
  );
}

function TypicalCategoryRow({ baseline }: { baseline: CategoryBaseline }): React.JSX.Element {
  const { colors } = useAppTheme();
  const typical = formatCurrency(baseline.typicalPeriodSpendCents);
  const range = `${formatCurrency(baseline.lowestPeriodSpendCents)} to ${formatCurrency(baseline.highestPeriodSpendCents)}`;
  const detail = `Usually ${typical} a period, ranging ${range}, over ${baseline.periodsObserved} periods.`;

  return (
    <Surface style={[styles.row, { backgroundColor: colors.surface }]} elevation={0}>
      <View style={styles.rowHeader}>
        <Text variant="titleSmall" style={{ color: colors.onSurface }} numberOfLines={1}>
          {baseline.displayName}
        </Text>
        <Text
          variant="bodyMedium"
          style={{ color: colors.onSurface }}
          accessibilityRole="text"
          accessibilityLabel={`${baseline.displayName}: typically ${typical} a period`}
        >
          {typical}
        </Text>
      </View>
      <Text
        style={[styles.meta, { color: colors.onSurfaceVariant }]}
        accessibilityRole="text"
        accessibilityLabel={detail}
      >
        {detail}
      </Text>
    </Surface>
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
  // NO COLOUR-ONLY MEANING: the status is spelled out in words beside the
  // figure, so "likely over budget" survives a greyscale screen.
  const insight = buildEnvelopeInsight(item, formatCurrency);

  return (
    <Surface style={[styles.row, { backgroundColor: colors.surface }]} elevation={0}>
      <View style={styles.rowHeader}>
        <Text variant="titleSmall" style={{ color: colors.onSurface }} numberOfLines={1}>
          {item.envelopeName}
        </Text>
        <Text
          variant="bodyMedium"
          style={{ color: statusColor }}
          accessibilityRole="text"
          accessibilityLabel={`${item.envelopeName}: ${formatCurrency(item.projectedRemainingCents)} projected to be left`}
        >
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

      <Text
        style={[styles.insight, { color: colors.onSurface }]}
        accessibilityRole="text"
        accessibilityLabel={insight.accessibilityLabel}
        testID={`forecast-insight-${item.envelopeId}`}
      >
        {insight.headline}
      </Text>
      {insight.pace !== null ? (
        <Text
          style={[styles.meta, { color: colors.onSurfaceVariant }]}
          accessibilityRole="text"
          accessibilityLabel={insight.pace}
          testID={`forecast-pace-${item.envelopeId}`}
        >
          {insight.pace}
        </Text>
      ) : null}

      <View style={styles.rowFooter}>
        <Text
          style={[styles.meta, { color: colors.onSurfaceVariant }]}
          accessibilityRole="text"
          accessibilityLabel={`${formatCurrency(item.spentCents)} spent so far`}
        >
          {formatCurrency(item.spentCents)} spent ·{' '}
          {item.isFixed
            ? 'Fixed bill — not projected daily'
            : `${formatCurrency(item.dailySpendCents)}/day`}
        </Text>
        <Text
          style={[styles.meta, { color: colors.onSurfaceVariant }]}
          accessibilityRole="text"
          accessibilityLabel={`${labelPct} percent of the budget projected to be left`}
        >
          {labelPct}% projected left
        </Text>
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: spacing.base, paddingBottom: spacing.xl },
  summary: {
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.base,
  },
  summaryLine: {
    marginTop: spacing.xs,
  },
  cta: {
    marginTop: spacing.md,
  },
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
  insight: {
    fontSize: fontSize.sm,
    marginBottom: spacing.xs,
  },
  rowFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  meta: {
    fontSize: fontSize.sm,
  },
});
