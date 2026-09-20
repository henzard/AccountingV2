import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { RolloverWizard } from '../budgets/RolloverWizard';
import { useAppStore } from '../../stores/appStore';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useBabySteps } from '../../hooks/useBabySteps';
import { usePersistentEnvelopeSavings } from '../../hooks/usePersistentEnvelopeSavings';
import { useSyncEngineStore } from '../../stores/syncEngineStore';
import { useReloadOnSync } from '../../hooks/useReloadOnSync';
import { EmptyState } from '../../components/shared/EmptyState';
import { LoadingSkeletonList } from '../../components/shared/LoadingSkeletonList';
import { LoadingSplash } from '../../components/shared/LoadingSplash';
import { BudgetRingCard } from './components/BudgetRingCard';
import { BabyStepsBar } from './components/BabyStepsBar';
import { ScoreBreakdownDialog } from './components/ScoreBreakdownDialog';
import { P } from './components/HeroSummaryCard';
import { selectSpendEnvelopes } from './selectSpendEnvelopes';
import { findLatestPeriodWithEnvelopes } from './findLatestPeriodWithEnvelopes';
import { resolveMeterReadingsLogged } from './resolveMeterReadingsLogged';
import { calculateSafeToSpendToday } from './calculateSafeToSpendToday';
import { EnvelopeDetailSheet } from './components/EnvelopeDetailSheet';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../../domain/shared/BudgetPeriodEngine';
import { HabitScoreCalculator } from '../../../domain/scoring/RamseyScoreCalculator';
import { resolveBabyStepIsActive } from '../../../domain/shared/resolveBabyStepIsActive';
import { resolveLoggingDays } from '../../../domain/scoring/resolveLoggingDays';
import { calculateBudgetBalance } from '../../../domain/budgets/BudgetBalanceCalculator';
import { getEnvelopeScope } from '../../../domain/envelopes/EnvelopeEntity';
import { formatCurrency } from '../../utils/currency';
import { useAppTheme } from '../../theme/useAppTheme';
import { spacing, radius, fontSize } from '../../theme/tokens';
import { format, differenceInDays } from 'date-fns';
import { db } from '../../../data/local/db';
import type { DashboardScreenProps } from '../../navigation/types';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

const engine = new BudgetPeriodEngine();
const scoreCalculator = new HabitScoreCalculator();

const GRAD_DARK = ['#071A16', '#0C1D2B', '#081420'] as const;

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigation }) => {
  // Uses the app's in-app Light/Dark preference (`useAppTheme`), not the raw
  // OS scheme — otherwise the home screen ignores a user override of the
  // system setting (UX-11).
  const { dark: isDark } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId);
  const paydayDay = useAppStore((s) => s.paydayDay);

  const period = engine.getCurrentPeriod(paydayDay);
  // `periodStart`/`previousPeriodStart`/`periodEnd` (below) are SCOPE KEYS —
  // exact-match query params and the seed for the deterministic rollover id
  // — so they must read `period.startDate`'s UTC calendar fields, matching
  // how `BudgetPeriodEngine` built the Date via `Date.UTC(...)`.
  // `date-fns format()` reads the HOST's LOCAL calendar fields instead, which
  // is off by one day on UTC-negative devices and silently misses the
  // period's own rows (L7, 2026-07-05 audit). `periodLabel` below is a pure
  // DISPLAY string (not a key), so it correctly keeps using local `format()`.
  const periodStart = formatPeriodDateKey(period.startDate);
  const periodEnd = formatPeriodDateKey(period.endDate);
  const periodLabel = format(period.startDate, 'MMMM yyyy');

  const hid = householdId ?? '';
  const { envelopes, loading, reload } = useEnvelopes(hid, periodStart);
  const { statuses: babyStepStatuses } = useBabySteps(hid, periodStart);
  // Persistent envelopes' (savings/emergency_fund/sinking_fund/baby_step)
  // real saved balance — never `allocatedCents - spentCents`, since
  // `allocatedCents` on those rows is this period's MONTHLY CONTRIBUTION and
  // `spentCents` is their ALL-TIME spend, not this period's. This hook's own
  // reload also runs the idempotent legacy opening-balance backfill
  // (`ensureOpeningBalances`), so calling it on focus below is what gets a
  // legacy household its opening balance without opening Baby Steps first.
  const { savedCentsByEnvelopeId, reload: reloadSavings } = usePersistentEnvelopeSavings(hid);

  const scheduler = useSyncEngineStore((s) => s.scheduler);

  const [babyStepIsActive, setBabyStepIsActive] = useState(false);
  const [loggingDaysCount, setLoggingDaysCount] = useState(0);
  const [meterReadingsLoggedThisPeriod, setMeterReadingsLoggedThisPeriod] = useState(false);
  const [showRollover, setShowRollover] = useState(false);
  const [rolloverFromPeriodStart, setRolloverFromPeriodStart] = useState(periodStart);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
  // Envelope tapped from the dashboard list — opens `EnvelopeDetailSheet`
  // instead of navigating straight to the edit form (VAL-9): the everyday
  // need is "what did we spend here / add a transaction here".
  const [selectedEnvelope, setSelectedEnvelope] = useState<EnvelopeEntity | null>(null);

  useFocusEffect(
    useCallback((): (() => void) => {
      let cancelled = false;
      void reload();
      // Idempotent (deterministic contribution ids) and swallows its own
      // errors into its `error` state — safe to call once per focus.
      void reloadSavings();
      resolveBabyStepIsActive(db, hid).then((isActive) => {
        if (!cancelled) setBabyStepIsActive(isActive);
      });
      resolveLoggingDays(db, hid, periodStart, periodEnd).then((days) => {
        if (!cancelled) setLoggingDaysCount(days);
      });
      resolveMeterReadingsLogged(db, hid, periodStart, periodEnd).then((logged) => {
        if (!cancelled) setMeterReadingsLoggedThisPeriod(logged);
      });
      return () => {
        cancelled = true;
      };
    }, [reload, reloadSavings, hid, periodStart, periodEnd]),
  );

  // Show the rollover wizard once the current period is confirmed to have no
  // period-scoped envelopes of its own (spending/income/utility — persistent
  // envelopes like savings/baby-step always carry over and don't count here),
  // some earlier period actually has some to roll forward, and the user
  // hasn't already acknowledged this period. Runs off the loaded envelope
  // list (not a payday-proximity window), so it stays reachable no matter how
  // long it's been since payday or how many periods were skipped.
  useEffect(() => {
    if (!hid || loading) return;
    const periodScopedCount = envelopes.filter((e) => getEnvelopeScope(e) === 'period').length;
    if (periodScopedCount > 0) return;

    let cancelled = false;
    const rolloverKey = `period_ack_${periodStart}`;
    AsyncStorage.getItem(rolloverKey).then((ack) => {
      if (cancelled || ack !== null) return;
      findLatestPeriodWithEnvelopes(db, hid, periodStart).then((fromPeriod) => {
        if (cancelled || !fromPeriod) return;
        setRolloverFromPeriodStart(fromPeriod);
        setShowRollover(true);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [hid, loading, envelopes, periodStart]);

  // The wizard itself writes the `period_ack_${toPeriodStart}` key on commit (see
  // RolloverWizard) — this only needs to close the wizard and refresh the envelope
  // list so any newly-copied-forward envelopes show up immediately.
  const handleRolloverDone = useCallback((): void => {
    setShowRollover(false);
    void reload();
  }, [reload]);

  // Manually opens the rollover wizard from the empty-state "Start this
  // month's budget" button, looking up the correct fromPeriodStart on demand
  // rather than relying on the auto-detect effect above having already run.
  const handleStartNewPeriod = useCallback((): void => {
    if (!hid) return;
    findLatestPeriodWithEnvelopes(db, hid, periodStart).then((fromPeriod) => {
      if (fromPeriod) {
        setRolloverFromPeriodStart(fromPeriod);
        setShowRollover(true);
      } else {
        // No earlier period ever had envelopes (brand-new household) —
        // nothing to review/copy forward, so go straight to creating one.
        navigation.navigate('AddEditEnvelope', {});
      }
    });
  }, [hid, periodStart, navigation]);

  // Reloads after a manual pull-to-refresh AND after the background sync
  // scheduler actually completes a round (VAL-5) — consumed read-only via
  // the shared sync stores/engine, never mutated here.
  const handleRefresh = useCallback((): void => {
    if (hid) scheduler?.requestSync(hid, { immediate: true });
    void reload();
  }, [scheduler, hid, reload]);

  const handleCloseEnvelopeDetail = useCallback((): void => {
    setSelectedEnvelope(null);
  }, []);

  const handleAddTransactionForEnvelope = useCallback(
    (envelopeId: string): void => {
      setSelectedEnvelope(null);
      navigation.navigate('AddTransaction', { envelopeId });
    },
    [navigation],
  );

  const handleEditEnvelope = useCallback(
    (envelopeId: string): void => {
      setSelectedEnvelope(null);
      navigation.navigate('AddEditEnvelope', { envelopeId });
    },
    [navigation],
  );

  // Envelopes already reload on sync inside `useEnvelopes`; the savings ledger
  // does not, so a partner's rollover contribution would otherwise stay stale.
  useReloadOnSync(reloadSavings);

  // ── Derived values ────────────────────────────────────────────────────────
  // Spend-side envelopes only (excludes 'income') — see selectSpendEnvelopes
  // for why mixing income allocations into these totals double-counts money
  // coming IN as if it were budgeted OUT (DOM-5/UX-4/VAL-1).
  const spendEnvelopes = useMemo(() => selectSpendEnvelopes(envelopes), [envelopes]);
  // Split further into this-PERIOD spend envelopes (spending/utility) and
  // PERSISTENT envelopes (savings/emergency_fund/sinking_fund/baby_step).
  // Persistent envelopes' `spentCents` (from `useEnvelopes`) is an ALL-TIME
  // figure, not this period's — mixing it into "Spent" would make the ring
  // count years of a fund's spend as if it happened this period. They still
  // contribute their monthly `allocatedCents` to "Budget" (money assigned out
  // of this period's income), and get their own "Savings & funds" section
  // below the main envelope list, showing their real SAVED balance.
  const budgetSpendEnvelopes = useMemo(
    () => spendEnvelopes.filter((e) => getEnvelopeScope(e) === 'period'),
    [spendEnvelopes],
  );
  const persistentEnvelopes = useMemo(
    () => spendEnvelopes.filter((e) => getEnvelopeScope(e) === 'persistent'),
    [spendEnvelopes],
  );
  const budgetBalance = useMemo(() => calculateBudgetBalance(envelopes), [envelopes]);
  const hasIncome = envelopes.some((e) => e.envelopeType === 'income');

  const totalAllocated = spendEnvelopes.reduce((s, e) => s + e.allocatedCents, 0);
  const totalSpent = budgetSpendEnvelopes.reduce((s, e) => s + e.spentCents, 0);
  const daysRemaining = Math.max(0, differenceInDays(period.endDate, new Date()));
  const totalDaysInPeriod = differenceInDays(period.endDate, period.startDate) + 1;

  // "Safe to spend today" — period-scoped spend envelopes only (persistent
  // envelopes' monthly contribution isn't money left to spend day-to-day).
  const periodSpendRemainingCents = budgetSpendEnvelopes.reduce(
    (s, e) => s + (e.allocatedCents - e.spentCents),
    0,
  );
  const safeToSpendTodayCents = calculateSafeToSpendToday(periodSpendRemainingCents, daysRemaining);

  const envelopesOnBudget = budgetSpendEnvelopes.filter(
    (e) => e.spentCents <= e.allocatedCents,
  ).length;
  const scoreResult = scoreCalculator.calculate({
    loggingDaysCount,
    totalDaysInPeriod,
    envelopesOnBudget,
    totalEnvelopes: budgetSpendEnvelopes.length,
    meterReadingsLoggedThisPeriod,
    babyStepIsActive,
  });

  // ── Theme-derived colors ──────────────────────────────────────────────────
  const cardBg = isDark ? P.tileBgDark : '#FFFFFF';
  const cardBorder = isDark ? P.tileBorderDark : P.tileBorderLight;
  const labelColor = isDark ? P.statLabel : '#5A7A6E';
  const valueColor = isDark ? 'rgba(220,245,235,0.90)' : '#1A2E28';
  const accentColor = isDark ? P.accent : '#00695C';
  const fabBg = isDark ? '#00895A' : '#00695C';
  const sectionTitleColor = isDark ? 'rgba(180,225,210,0.65)' : '#1A2E28';

  // ── List header ───────────────────────────────────────────────────────────
  const ListHeader = useMemo(
    () => (
      <View>
        {/* Period + days row */}
        <View style={styles.periodRow}>
          <Text style={[styles.periodLabel, { color: valueColor }]}>{periodLabel}</Text>
          <Text style={[styles.daysTag, { color: labelColor }]}>{daysRemaining}d remaining</Text>
        </View>

        {/* Budget ring — only when spend envelopes exist */}
        {spendEnvelopes.length > 0 && (
          <View style={styles.ringSection}>
            <BudgetRingCard
              totalAllocatedCents={totalAllocated}
              totalSpentCents={totalSpent}
              daysRemaining={daysRemaining}
              score={scoreResult.score}
              testID="dashboard-kpi-row"
            />

            {/* Spent / Budget / Score stat row */}
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={[styles.statLabel, { color: labelColor }]}>Spent</Text>
                <Text style={[styles.statValue, { color: valueColor }]}>
                  {formatCurrency(totalSpent)}
                </Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: cardBorder }]} />
              <View style={styles.stat}>
                <Text style={[styles.statLabel, { color: labelColor }]}>Budget</Text>
                <Text style={[styles.statValue, { color: valueColor }]}>
                  {formatCurrency(totalAllocated)}
                </Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: cardBorder }]} />
              <TouchableOpacity
                style={styles.stat}
                onPress={() => setShowScoreBreakdown(true)}
                testID="score-stat"
                accessibilityRole="button"
                accessibilityLabel={`Habit score ${scoreResult.score} out of 100. Tap for a breakdown.`}
              >
                <Text style={[styles.statLabel, { color: labelColor }]}>Score</Text>
                <Text style={[styles.statValue, { color: accentColor }]}>{scoreResult.score}</Text>
              </TouchableOpacity>
            </View>

            {/* "Safe to spend today" — the period-scoped spend envelopes'
                remaining budget spread over the days left, so the household
                sees one daily number instead of doing the division
                themselves against "Remaining" and days-left. */}
            <Text
              style={[styles.safeToSpend, { color: labelColor }]}
              testID="dashboard-safe-to-spend"
            >
              {`Safe to spend today: ${formatCurrency(safeToSpendTodayCents)}`}
            </Text>

            {/* Income / To assign — shown separately from the spend totals
                above (DOM-5/UX-4/VAL-1): income funds the budget, it isn't
                part of it. */}
            {hasIncome && (
              <View style={styles.incomeRow} testID="dashboard-income-row">
                <View style={styles.stat}>
                  <Text style={[styles.statLabel, { color: labelColor }]}>Income</Text>
                  <Text style={[styles.statValue, { color: valueColor }]}>
                    {formatCurrency(budgetBalance.incomeTotal)}
                  </Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: cardBorder }]} />
                <View style={styles.stat}>
                  <Text style={[styles.statLabel, { color: labelColor }]}>To assign</Text>
                  <Text
                    style={[
                      styles.statValue,
                      { color: budgetBalance.toAssign < 0 ? '#EF4444' : valueColor },
                    ]}
                  >
                    {formatCurrency(budgetBalance.toAssign)}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Baby steps bar */}
        {babyStepStatuses.length > 0 && (
          <BabyStepsBar
            statuses={babyStepStatuses}
            onPress={() => navigation.navigate('BabySteps')}
          />
        )}

        {/* Envelope section header */}
        {budgetSpendEnvelopes.length > 0 && (
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>Envelopes</Text>
            <View style={styles.sectionHeadActions}>
              <TouchableOpacity
                onPress={() => navigation.navigate('AddEditEnvelope', {})}
                testID="add-envelope-header-button"
                accessibilityRole="button"
                accessibilityLabel="Add envelope"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.sectionSub, { color: accentColor }]}>+ Add</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => navigation.navigate('Budget')}
                testID="view-budget-link"
                accessibilityRole="link"
                accessibilityLabel="View full budget"
              >
                <Text style={[styles.sectionSub, { color: accentColor }]}>
                  {budgetSpendEnvelopes.length} active ›
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      spendEnvelopes.length,
      budgetSpendEnvelopes.length,
      hasIncome,
      budgetBalance,
      totalAllocated,
      totalSpent,
      safeToSpendTodayCents,
      daysRemaining,
      scoreResult.score,
      isDark,
      periodLabel,
      babyStepStatuses,
    ],
  );

  // ── List footer ───────────────────────────────────────────────────────────
  const ListFooter = useMemo(
    () => (
      <View>
        {/* Savings & funds — persistent envelopes (savings/emergency fund/
            sinking fund/baby step), shown under the main spending envelopes
            with their real SAVED balance (contribution ledger), never
            allocatedCents - spentCents (see usePersistentEnvelopeSavings). */}
        {persistentEnvelopes.length > 0 && (
          <View>
            <View style={styles.sectionHead}>
              <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>
                Savings & funds
              </Text>
            </View>
            <View style={styles.savingsList}>
              {persistentEnvelopes.map((env) => (
                <TouchableOpacity
                  key={env.id}
                  style={[styles.envelopeRow, { backgroundColor: cardBg, borderColor: cardBorder }]}
                  onPress={() => setSelectedEnvelope(env)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  testID={`persistent-envelope-${env.id}`}
                >
                  <View style={styles.envelopeInfo}>
                    <Text style={[styles.envelopeName, { color: valueColor }]} numberOfLines={1}>
                      {env.name}
                    </Text>
                    <Text style={[styles.envelopeAmt, { color: labelColor }]}>
                      {formatCurrency(savedCentsByEnvelopeId.get(env.id) ?? 0)} saved
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Secondary actions */}
        <View style={styles.secondaryRow}>
          {[
            {
              icon: '💰',
              label: 'Sinking',
              onPress: () => navigation.navigate('SinkingFunds'),
              testID: 'sinking-funds-entry',
            },
            {
              icon: '📈',
              label: 'Forecast',
              onPress: () => navigation.navigate('Forecast'),
              testID: 'forecast-entry',
            },
            { icon: '🎯', label: 'Steps', onPress: () => navigation.navigate('BabySteps') },
            { icon: '📊', label: 'Budget', onPress: () => navigation.navigate('Budget') },
          ].map((btn) => (
            <TouchableOpacity
              key={btn.label}
              style={[styles.secondaryBtn, { backgroundColor: cardBg, borderColor: cardBorder }]}
              onPress={btn.onPress}
              activeOpacity={0.7}
              testID={btn.testID}
              accessibilityRole="button"
              accessibilityLabel={btn.label}
            >
              <Text style={styles.secondaryIcon}>{btn.icon}</Text>
              <Text style={[styles.secondaryLbl, { color: labelColor }]}>{btn.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.bottomPad} />
      </View>
    ),
    [
      persistentEnvelopes,
      savedCentsByEnvelopeId,
      cardBg,
      cardBorder,
      valueColor,
      labelColor,
      sectionTitleColor,
      navigation,
    ],
  );

  // ── Empty / loading ───────────────────────────────────────────────────────
  const EmptyContent = useMemo(
    () =>
      loading ? (
        <LoadingSkeletonList count={4} testID="dashboard-loading" />
      ) : (
        <View>
          <EmptyState
            title="No envelopes yet"
            body="Add your first envelope to get started"
            testID="dashboard-empty-state"
          />
          <TouchableOpacity
            style={[styles.newEnvBtn, { borderColor: cardBorder }]}
            onPress={() => navigation.navigate('AddEditEnvelope', {})}
            testID="new-envelope-button"
            accessibilityRole="button"
          >
            <Text style={[styles.newEnvBtnText, { color: accentColor }]}>+ New envelope</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.newEnvBtn, { borderColor: cardBorder }]}
            onPress={handleStartNewPeriod}
            testID="start-new-period-button"
            accessibilityRole="button"
          >
            <Text style={[styles.newEnvBtnText, { color: accentColor }]}>
              Start this month&apos;s budget
            </Text>
          </TouchableOpacity>
        </View>
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, isDark, handleStartNewPeriod],
  );

  // ── Early return: no household ────────────────────────────────────────────
  if (!householdId) return <LoadingSplash />;

  // ── Envelope row renderer ─────────────────────────────────────────────────
  const renderItem = ({ item }: { item: EnvelopeEntity }): React.JSX.Element => {
    const remaining = item.allocatedCents - item.spentCents;
    const pct =
      item.allocatedCents > 0 ? Math.round((item.spentCents / item.allocatedCents) * 100) : 0;
    const isOver = item.spentCents > item.allocatedCents;

    return (
      <TouchableOpacity
        style={[styles.envelopeRow, { backgroundColor: cardBg, borderColor: cardBorder }]}
        onPress={() => setSelectedEnvelope(item)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${formatCurrency(Math.abs(remaining))} ${isOver ? 'over budget' : 'remaining'}, ${pct}% used`}
      >
        <View style={styles.envelopeInfo}>
          <Text style={[styles.envelopeName, { color: valueColor }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.envelopeAmt, { color: isOver ? '#EF4444' : labelColor }]}>
            {isOver ? `−${formatCurrency(Math.abs(remaining))}` : formatCurrency(remaining)} left
          </Text>
        </View>

        <View style={styles.progressRow}>
          <View style={[styles.progressTrack, { backgroundColor: cardBorder }]}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.min(100, pct)}%` as `${number}%`,
                  backgroundColor: isOver ? '#EF4444' : accentColor,
                },
              ]}
            />
          </View>
          <Text style={[styles.pctLabel, { color: labelColor }]}>{pct}%</Text>
        </View>
      </TouchableOpacity>
    );
  };

  // ── Main list ─────────────────────────────────────────────────────────────
  const list = (
    <FlatList<EnvelopeEntity>
      testID="dashboard-root"
      style={styles.list}
      data={loading ? [] : budgetSpendEnvelopes}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={ListHeader}
      ListFooterComponent={ListFooter}
      ListEmptyComponent={EmptyContent}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={handleRefresh}
          tintColor={P.accent}
          colors={[P.accent]}
        />
      }
    />
  );

  // Rendered as a sibling of the FlatList (not inside ListFooterComponent) so
  // it stays fixed above the tab bar instead of scrolling away with the list
  // content (UX-16).
  const floatingFab = (
    <TouchableOpacity
      style={[styles.floatingFab, { backgroundColor: fabBg }]}
      onPress={() => navigation.navigate('AddTransaction')}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Add transaction"
      testID="add-transaction-fab"
    >
      <Text style={styles.floatingFabText}>＋</Text>
    </TouchableOpacity>
  );

  const rolloverModal = (
    <RolloverWizard
      visible={showRollover}
      householdId={hid}
      fromPeriodStart={rolloverFromPeriodStart}
      toPeriodStart={periodStart}
      periodLabel={periodLabel}
      onDone={handleRolloverDone}
    />
  );

  const scoreBreakdownDialog = (
    <ScoreBreakdownDialog
      visible={showScoreBreakdown}
      onDismiss={() => setShowScoreBreakdown(false)}
      result={scoreResult}
    />
  );

  const envelopeDetailSheet = (
    <EnvelopeDetailSheet
      visible={selectedEnvelope !== null}
      envelope={selectedEnvelope}
      householdId={hid}
      savedCentsByEnvelopeId={savedCentsByEnvelopeId}
      onDismiss={handleCloseEnvelopeDetail}
      onAddTransaction={handleAddTransactionForEnvelope}
      onEditEnvelope={handleEditEnvelope}
    />
  );

  if (isDark) {
    return (
      <LinearGradient colors={GRAD_DARK} locations={[0, 0.55, 1]} style={styles.flex}>
        {list}
        {floatingFab}
        {rolloverModal}
        {scoreBreakdownDialog}
        {envelopeDetailSheet}
      </LinearGradient>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: P.screenBgLight }]}>
      {list}
      {floatingFab}
      {rolloverModal}
      {scoreBreakdownDialog}
      {envelopeDetailSheet}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { flex: 1 },
  // Extra bottom padding keeps the last row clear of the floating FAB, which
  // is rendered outside the FlatList so it stays fixed above the tab bar
  // instead of scrolling away with the list content (UX-16).
  listContent: { paddingBottom: spacing.xxxl + spacing.xl },

  // Period header
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
  },
  periodLabel: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 22,
    letterSpacing: -0.4,
  },
  daysTag: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.sm,
  },

  // Budget ring section
  ringSection: {
    alignItems: 'center',
    paddingVertical: spacing.base,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.base,
    paddingHorizontal: spacing.lg,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statLabel: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.xs,
  },
  statValue: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: fontSize.sm,
  },
  statDivider: { width: 1, height: 28, marginHorizontal: spacing.sm },

  // Income / To assign row
  incomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  safeToSpend: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.base,
  },

  // Section header
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
  },
  sectionHeadActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
  },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: fontSize.base,
  },
  sectionSub: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.sm,
  },

  // Envelope list rows
  envelopeRow: {
    marginHorizontal: spacing.base,
    padding: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
  },
  envelopeInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  envelopeName: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: fontSize.base,
    flex: 1,
    marginRight: spacing.sm,
  },
  envelopeAmt: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.sm,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  pctLabel: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.xs,
    minWidth: 32,
    textAlign: 'right',
  },
  separator: { height: spacing.sm },
  savingsList: { gap: spacing.sm, marginBottom: spacing.sm },

  // Floating "Add transaction" FAB — rendered as a sibling of the FlatList,
  // fixed bottom-right above the tab bar (UX-16), not inside its footer.
  floatingFab: {
    position: 'absolute',
    right: spacing.base,
    bottom: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  floatingFabText: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 28,
    lineHeight: 30,
    color: '#FFFFFF',
  },

  // Secondary actions
  secondaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: radius.xl,
    alignItems: 'center',
    gap: 4,
  },
  secondaryIcon: { fontSize: 18, lineHeight: 20 },
  secondaryLbl: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: fontSize.xs,
  },
  bottomPad: { height: spacing.xl },

  // Empty state
  newEnvBtn: {
    alignSelf: 'center',
    marginTop: spacing.base,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.full,
  },
  newEnvBtnText: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: fontSize.base,
  },
});
