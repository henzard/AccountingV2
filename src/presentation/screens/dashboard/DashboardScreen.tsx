import React, { useCallback, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { RamseyScoreCalculator } from '../../../domain/scoring/RamseyScoreCalculator';
import { RamseyScoreBadge } from './components/RamseyScoreBadge';
import { BabyStepsCard } from './BabyStepsCard';
import { Text, FAB, Surface, Button } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAppStore } from '../../stores/appStore';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useBabySteps } from '../../hooks/useBabySteps';
import { EnvelopeCard } from '../../components/envelopes/EnvelopeCard';
import { CurrencyText } from '../../components/shared/CurrencyText';
import { ScreenHeader } from '../../components/shared/ScreenHeader';
import { EmptyState } from '../../components/shared/EmptyState';
import { LoadingSkeletonList } from '../../components/shared/LoadingSkeletonList';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import { format } from 'date-fns';
import type { DashboardScreenProps } from '../../navigation/types';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';
import { resolveBabyStepIsActive } from '../../../domain/shared/resolveBabyStepIsActive';
import { resolveLoggingDays } from '../../../domain/scoring/resolveLoggingDays';
import { db } from '../../../data/local/db';

const engine = new BudgetPeriodEngine();
const scoreCalculator = new RamseyScoreCalculator();

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigation }) => {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);

  const period = engine.getCurrentPeriod(paydayDay);
  const periodStart = format(period.startDate, 'yyyy-MM-dd');

  const { envelopes, loading, reload } = useEnvelopes(householdId, periodStart);
  const { statuses: babyStepStatuses } = useBabySteps(householdId, periodStart);
  const [babyStepIsActive, setBabyStepIsActive] = useState(false);
  const [loggingDaysCount, setLoggingDaysCount] = useState(0);

  useFocusEffect(
    useCallback((): (() => void) => {
      let cancelled = false;
      void reload();
      resolveBabyStepIsActive(db, householdId).then((isActive) => {
        if (!cancelled) setBabyStepIsActive(isActive);
      });
      const periodEnd = format(period.endDate, 'yyyy-MM-dd');
      resolveLoggingDays(db, householdId, periodStart, periodEnd).then((days) => {
        if (!cancelled) setLoggingDaysCount(days);
      });
      return () => {
        cancelled = true;
      };
    }, [reload, householdId, period.endDate, periodStart]),
  );

  const totalAllocated = envelopes.reduce((s, e) => s + e.allocatedCents, 0);
  const totalSpent = envelopes.reduce((s, e) => s + e.spentCents, 0);
  const totalRemaining = totalAllocated - totalSpent;

  const envelopesOnBudget = envelopes.filter((e) => e.spentCents <= e.allocatedCents).length;
  const scoreResult = scoreCalculator.calculate({
    loggingDaysCount,
    totalDaysInPeriod: 30,
    envelopesOnBudget,
    totalEnvelopes: envelopes.length,
    meterReadingsLoggedThisPeriod: false,
    babyStepIsActive,
  });

  const handleEditEnvelope = (envelope: EnvelopeEntity): void => {
    navigation.navigate('AddEditEnvelope', { envelopeId: envelope.id });
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Surface style={[styles.header, { backgroundColor: colors.surface }]} elevation={0}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <ScreenHeader eyebrow="Budget Period" title={period.label} />
          </View>
          <RamseyScoreBadge score={scoreResult.score} />
        </View>
      </Surface>

      {envelopes.length > 0 && (
        <Surface
          style={[styles.summary, { backgroundColor: colors.primaryContainer }]}
          elevation={1}
        >
          <View style={styles.summaryItem}>
            <Text
              variant="labelSmall"
              style={[styles.summaryLabel, { color: colors.onPrimaryContainer }]}
            >
              ALLOCATED
            </Text>
            <CurrencyText
              amountCents={totalAllocated}
              style={{ ...styles.summaryValue, color: colors.onPrimaryContainer }}
            />
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.outlineVariant }]} />
          <View style={styles.summaryItem}>
            <Text
              variant="labelSmall"
              style={[styles.summaryLabel, { color: colors.onPrimaryContainer }]}
            >
              SPENT
            </Text>
            <CurrencyText
              amountCents={totalSpent}
              style={{ ...styles.summaryValue, color: colors.onPrimaryContainer }}
            />
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.outlineVariant }]} />
          <View style={styles.summaryItem}>
            <Text
              variant="labelSmall"
              style={[styles.summaryLabel, { color: colors.onPrimaryContainer }]}
            >
              REMAINING
            </Text>
            <CurrencyText
              amountCents={totalRemaining}
              style={{
                ...styles.summaryValue,
                color: totalRemaining < 0 ? colors.error : colors.onPrimaryContainer,
              }}
            />
          </View>
        </Surface>
      )}

      {/* Baby Steps card — shown when statuses are loaded */}
      {babyStepStatuses.length > 0 && (
        <BabyStepsCard
          statuses={babyStepStatuses}
          onPress={() => navigation.navigate('BabySteps')}
        />
      )}

      {loading ? (
        <LoadingSkeletonList count={4} testID="dashboard-loading" />
      ) : envelopes.length === 0 ? (
        <>
          <EmptyState
            title="No envelopes yet"
            body="Add your first envelope to get started"
            testID="dashboard-empty-state"
          />
          <Button mode="text" onPress={() => navigation.navigate('AddEditEnvelope', {})}>
            + New envelope
          </Button>
        </>
      ) : (
        <FlatList
          data={envelopes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <EnvelopeCard envelope={item} onPress={() => handleEditEnvelope(item)} />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} colors={[colors.primary]} />
          }
        />
      )}

      <FAB
        icon="plus"
        label="Add transaction"
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => navigation.navigate('AddTransaction')}
        color={colors.onPrimary}
        testID="add-transaction-fab"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flex: 1 },
  summary: {
    flexDirection: 'row',
    marginHorizontal: spacing.base,
    marginTop: spacing.base,
    borderRadius: radius.lg,
    padding: spacing.base,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryLabel: {
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  summaryValue: {
    fontSize: 24,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontVariant: ['tabular-nums'],
  },
  summaryDivider: {
    width: 1,
    marginVertical: spacing.xs,
  },
  list: {
    padding: spacing.base,
    paddingBottom: 100,
  },
  fab: {
    position: 'absolute',
    right: spacing.base,
    bottom: spacing.xl,
  },
});
