import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Text,
  useColorScheme,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { PeriodRolloverModal } from './PeriodRolloverModal';
import { useAppStore } from '../../stores/appStore';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useBabySteps } from '../../hooks/useBabySteps';
import { EmptyState } from '../../components/shared/EmptyState';
import { LoadingSkeletonList } from '../../components/shared/LoadingSkeletonList';
import { LoadingSplash } from '../../components/shared/LoadingSplash';
import { BudgetRingCard } from './components/BudgetRingCard';
import { BabyStepsBar } from './components/BabyStepsBar';
import { P } from './components/HeroSummaryCard';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { HabitScoreCalculator } from '../../../domain/scoring/RamseyScoreCalculator';
import { resolveBabyStepIsActive } from '../../../domain/shared/resolveBabyStepIsActive';
import { resolveLoggingDays } from '../../../domain/scoring/resolveLoggingDays';
import { formatCurrency } from '../../utils/currency';
import { spacing, radius, fontSize } from '../../theme/tokens';
import { format, differenceInDays } from 'date-fns';
import { db } from '../../../data/local/db';
import type { DashboardScreenProps } from '../../navigation/types';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

const engine = new BudgetPeriodEngine();
const scoreCalculator = new HabitScoreCalculator();

const GRAD_DARK = ['#071A16', '#0C1D2B', '#081420'] as const;

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigation }) => {
  const isDark = useColorScheme() === 'dark';
  const householdId = useAppStore((s) => s.householdId);
  const paydayDay = useAppStore((s) => s.paydayDay);

  const period = engine.getCurrentPeriod(paydayDay);
  const periodStart = format(period.startDate, 'yyyy-MM-dd');
  const periodLabel = format(period.startDate, 'MMMM yyyy');

  const hid = householdId ?? '';
  const { envelopes, loading, reload } = useEnvelopes(hid, periodStart);
  const { statuses: babyStepStatuses } = useBabySteps(hid, periodStart);

  const [babyStepIsActive, setBabyStepIsActive] = useState(false);
  const [loggingDaysCount, setLoggingDaysCount] = useState(0);
  const [showRollover, setShowRollover] = useState(false);

  useFocusEffect(
    useCallback((): (() => void) => {
      let cancelled = false;
      void reload();
      resolveBabyStepIsActive(db, hid).then((isActive) => {
        if (!cancelled) setBabyStepIsActive(isActive);
      });
      const periodEnd = format(period.endDate, 'yyyy-MM-dd');
      resolveLoggingDays(db, hid, periodStart, periodEnd).then((days) => {
        if (!cancelled) setLoggingDaysCount(days);
      });
      // Show rollover prompt once at the start of each new period (within 2 days of payday).
      const rolloverKey = `period_ack_${periodStart}`;
      if (engine.isNewPeriodWithin(paydayDay, 2)) {
        AsyncStorage.getItem(rolloverKey).then((val) => {
          if (!cancelled && val === null) setShowRollover(true);
        });
      }
      return () => {
        cancelled = true;
      };
    }, [reload, hid, period.endDate, periodStart, paydayDay]),
  );

  const handleRolloverAcknowledge = useCallback((): void => {
    setShowRollover(false);
    void AsyncStorage.setItem(`period_ack_${periodStart}`, 'true');
  }, [periodStart]);

  // ── Derived values ────────────────────────────────────────────────────────
  const totalAllocated = envelopes.reduce((s, e) => s + e.allocatedCents, 0);
  const totalSpent = envelopes.reduce((s, e) => s + e.spentCents, 0);
  const daysRemaining = Math.max(0, differenceInDays(period.endDate, new Date()));

  const envelopesOnBudget = envelopes.filter((e) => e.spentCents <= e.allocatedCents).length;
  const scoreResult = scoreCalculator.calculate({
    loggingDaysCount,
    totalDaysInPeriod: 30,
    envelopesOnBudget,
    totalEnvelopes: envelopes.length,
    meterReadingsLoggedThisPeriod: false,
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

        {/* Budget ring — only when envelopes exist */}
        {envelopes.length > 0 && (
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
              <View style={styles.stat}>
                <Text style={[styles.statLabel, { color: labelColor }]}>Score</Text>
                <Text style={[styles.statValue, { color: accentColor }]}>{scoreResult.score}</Text>
              </View>
            </View>
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
        {envelopes.length > 0 && (
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>Envelopes</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('Budget')}
              testID="view-budget-link"
              accessibilityRole="link"
              accessibilityLabel="View full budget"
            >
              <Text style={[styles.sectionSub, { color: accentColor }]}>
                {envelopes.length} active ›
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      envelopes.length,
      totalAllocated,
      totalSpent,
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
        {/* Primary FAB */}
        <View style={styles.fabRow}>
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: fabBg }]}
            onPress={() => navigation.navigate('AddTransaction')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Add transaction"
            testID="add-transaction-fab"
          >
            <Text style={styles.fabText}>＋ Add Transaction</Text>
          </TouchableOpacity>
        </View>

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDark],
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
        </View>
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, isDark],
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
        onPress={() => navigation.navigate('AddEditEnvelope', { envelopeId: item.id })}
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
      data={loading ? [] : envelopes}
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
          onRefresh={reload}
          tintColor={P.accent}
          colors={[P.accent]}
        />
      }
    />
  );

  const rolloverModal = (
    <PeriodRolloverModal
      visible={showRollover}
      periodLabel={periodLabel}
      onAcknowledge={handleRolloverAcknowledge}
    />
  );

  if (isDark) {
    return (
      <LinearGradient colors={GRAD_DARK} locations={[0, 0.55, 1]} style={styles.flex}>
        {list}
        {rolloverModal}
      </LinearGradient>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: P.screenBgLight }]}>
      {list}
      {rolloverModal}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingBottom: spacing.lg },

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

  // Section header
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
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

  // FAB + secondary actions
  fabRow: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.base,
  },
  fab: {
    width: 220,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  fabText: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: fontSize.base,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
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
