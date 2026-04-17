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
import { useFocusEffect } from '@react-navigation/native';
import { useAppStore } from '../../stores/appStore';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useBabySteps } from '../../hooks/useBabySteps';
import { EmptyState } from '../../components/shared/EmptyState';
import { LoadingSkeletonList } from '../../components/shared/LoadingSkeletonList';
import { LoadingSplash } from '../../components/shared/LoadingSplash';
import { HeroSummaryCard, P } from './components/HeroSummaryCard';
import { EnvelopeTile } from './components/EnvelopeTile';
import { BabyStepsBar } from './components/BabyStepsBar';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { HabitScoreCalculator } from '../../../domain/scoring/RamseyScoreCalculator';
import { resolveBabyStepIsActive } from '../../../domain/shared/resolveBabyStepIsActive';
import { resolveLoggingDays } from '../../../domain/scoring/resolveLoggingDays';
import { spacing, radius, fontSize } from '../../theme/tokens';
import { format, differenceInDays } from 'date-fns';
import { db } from '../../../data/local/db';
import type { DashboardScreenProps } from '../../navigation/types';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

const engine = new BudgetPeriodEngine();
const scoreCalculator = new HabitScoreCalculator();

// Dark gradient stops
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
      return () => {
        cancelled = true;
      };
    }, [reload, hid, period.endDate, periodStart]),
  );

  // ── Derived values (safe to compute even when householdId is null) ────────
  const totalAllocated = envelopes.reduce((s, e) => s + e.allocatedCents, 0);
  const totalSpent = envelopes.reduce((s, e) => s + e.spentCents, 0);
  const totalRemaining = totalAllocated - totalSpent;
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

  // ── Theme-derived colors ───────────────────────────────────────────────────
  const actionBg = isDark ? P.tileBgDark : '#FFFFFF';
  const actionBorder = isDark ? P.tileBorderDark : P.tileBorderLight;
  const actionLbl = isDark ? P.statLabel : '#5A7A6E';
  const sectionTitleColor = isDark ? 'rgba(180,225,210,0.65)' : '#1A2E28';
  const sectionSubColor = isDark ? 'rgba(0,214,143,0.55)' : '#00695C';
  const greetingColor = isDark ? 'rgba(160,210,190,0.45)' : '#8AA898';
  const periodColor = isDark ? 'rgba(220,245,235,0.90)' : '#1A2E28';
  const fabBg = isDark ? '#00895A' : '#00695C';

  // ── List header — all content above the envelope tile grid ────────────────
  const ListHeader = useMemo(
    () => (
      <View>
        {/* Greeting */}
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.greeting, { color: greetingColor }]}>Good morning</Text>
            <Text style={[styles.periodLabel, { color: periodColor }]}>{periodLabel}</Text>
          </View>
        </View>

        {/* Hero card — only when envelopes exist */}
        {envelopes.length > 0 && (
          <HeroSummaryCard
            totalAllocatedCents={totalAllocated}
            totalSpentCents={totalSpent}
            totalRemainingCents={totalRemaining}
            daysRemaining={daysRemaining}
            score={scoreResult.score}
            testID="dashboard-kpi-row"
          />
        )}

        {/* Quick actions */}
        <View style={styles.actionsRow}>
          {[
            {
              icon: '＋',
              label: 'Add Txn',
              onPress: () => navigation.navigate('AddTransaction'),
              testID: 'add-transaction-fab',
            },
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
          ].map((btn) => (
            <TouchableOpacity
              key={btn.label}
              style={[styles.actionBtn, { backgroundColor: actionBg, borderColor: actionBorder }]}
              onPress={btn.onPress}
              activeOpacity={0.7}
              testID={btn.testID}
              accessibilityRole="button"
              accessibilityLabel={btn.label}
            >
              <Text style={styles.actionIcon}>{btn.icon}</Text>
              <Text style={[styles.actionLbl, { color: actionLbl }]}>{btn.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

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
              <Text style={[styles.sectionSub, { color: sectionSubColor }]}>
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
      totalRemaining,
      daysRemaining,
      scoreResult.score,
      isDark,
      periodLabel,
    ],
  );

  // ── List footer — baby steps bar + pill FAB ───────────────────────────────
  const ListFooter = useMemo(
    () => (
      <View>
        {babyStepStatuses.length > 0 && (
          <BabyStepsBar
            statuses={babyStepStatuses}
            onPress={() => navigation.navigate('BabySteps')}
          />
        )}
        <View style={styles.fabRow}>
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: fabBg }]}
            onPress={() => navigation.navigate('AddTransaction')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Add transaction"
          >
            <Text style={styles.fabText}>＋ Add Transaction</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.bottomPad} />
      </View>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [babyStepStatuses, isDark],
  );

  // ── Empty / loading content ────────────────────────────────────────────────
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
            style={[styles.newEnvBtn, { borderColor: actionBorder }]}
            onPress={() => navigation.navigate('AddEditEnvelope', {})}
            testID="new-envelope-button"
            accessibilityRole="button"
          >
            <Text style={[styles.newEnvBtnText, { color: sectionSubColor }]}>+ New envelope</Text>
          </TouchableOpacity>
        </View>
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, isDark],
  );

  // ── Early return: no household yet ────────────────────────────────────────
  if (!householdId) return <LoadingSplash />;

  // ── Main list ─────────────────────────────────────────────────────────────
  const list = (
    <FlatList<EnvelopeEntity>
      style={styles.list}
      numColumns={2}
      data={loading ? [] : envelopes}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <EnvelopeTile
          envelope={item}
          onPress={() => navigation.navigate('AddEditEnvelope', { envelopeId: item.id })}
        />
      )}
      columnWrapperStyle={styles.columnWrapper}
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

  if (isDark) {
    return (
      <LinearGradient colors={GRAD_DARK} locations={[0, 0.55, 1]} style={styles.flex}>
        {list}
      </LinearGradient>
    );
  }

  return <View style={[styles.flex, { backgroundColor: P.screenBgLight }]}>{list}</View>;
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.base,
  },
  greeting: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.sm,
    marginBottom: 2,
  },
  periodLabel: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 20,
    letterSpacing: -0.3,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    marginBottom: spacing.base,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.xl,
    alignItems: 'center',
    gap: 5,
  },
  actionIcon: {
    fontSize: 18,
    lineHeight: 20,
  },
  actionLbl: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: fontSize.xs,
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: fontSize.base,
  },
  sectionSub: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.sm,
  },
  columnWrapper: {
    paddingHorizontal: spacing.base,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  fabRow: {
    alignItems: 'center',
    paddingVertical: spacing.base,
  },
  fab: {
    width: 200,
    height: 48,
    borderRadius: 24,
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
  bottomPad: { height: spacing.xl },
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
