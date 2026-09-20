/**
 * BudgetScreen — zero-based budget overview.
 *
 * Shows BudgetBalanceBanner at top, then envelope list grouped into
 * "Income" and "Expenses" sections (spec §Zero-based budgeting).
 *
 * Duplicate-EMF banner also shown at top when the reconcile flag is set.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, SectionList, RefreshControl, ActivityIndicator } from 'react-native';
import { FAB } from 'react-native-paper';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { BudgetBalanceBanner } from './components/BudgetBalanceBanner';
import { DuplicateEmfBanner } from './components/DuplicateEmfBanner';
import { MonthlyIncomeCard } from './components/MonthlyIncomeCard';
import { RolloverWizard } from './RolloverWizard';
import { EnvelopeCard } from '../../components/envelopes/EnvelopeCard';
import { EmptyState } from '../../components/shared/EmptyState';
import { SectionHeader } from '../../components/shared/SectionHeader';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useAppStore } from '../../stores/appStore';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../../domain/shared/BudgetPeriodEngine';
import { findLatestPeriodWithEnvelopes } from '../dashboard/findLatestPeriodWithEnvelopes';
import { db } from '../../../data/local/db';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { DashboardStackParamList } from '../../navigation/types';

const engine = new BudgetPeriodEngine();

type Nav = NativeStackNavigationProp<DashboardStackParamList>;

export const BudgetScreen: React.FC = () => {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);

  const period = engine.getCurrentPeriod(paydayDay);
  const periodStart = formatPeriodDateKey(period.startDate);
  const periodLabel = format(period.startDate, 'MMMM yyyy');

  const { envelopes, loading, reload } = useEnvelopes(householdId, periodStart);

  const [showRollover, setShowRollover] = useState(false);
  const [rolloverFromPeriodStart, setRolloverFromPeriodStart] = useState(periodStart);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // Looks up the latest earlier period that actually has envelopes and opens
  // the rollover wizard from it (UX-1/DOM-2/VAL-2); if none exists (brand-new
  // household), there is nothing to review/copy forward, so this goes
  // straight to creating a normal envelope instead.
  const handleStartNewPeriod = useCallback((): void => {
    findLatestPeriodWithEnvelopes(db, householdId, periodStart).then((fromPeriod) => {
      if (fromPeriod) {
        setRolloverFromPeriodStart(fromPeriod);
        setShowRollover(true);
      } else {
        navigation.navigate('AddEditEnvelope', {});
      }
    });
  }, [householdId, periodStart, navigation]);

  const handleRolloverDone = useCallback((): void => {
    setShowRollover(false);
    void reload();
  }, [reload]);

  const incomeEnvelopes = useMemo(
    () => envelopes.filter((e) => e.envelopeType === 'income'),
    [envelopes],
  );
  const incomeTotalCents = useMemo(
    () => incomeEnvelopes.reduce((sum, e) => sum + e.allocatedCents, 0),
    [incomeEnvelopes],
  );

  // Set / update this month's income. When exactly one income envelope exists we
  // edit it directly; with none we open the editor pre-set to the income type;
  // with several (multiple income sources) we edit the first — the rest stay
  // tappable in the Income section below.
  const handleSetIncome = useCallback(() => {
    if (incomeEnvelopes.length === 0) {
      navigation.navigate('AddEditEnvelope', { preselectedType: 'income' });
    } else {
      navigation.navigate('AddEditEnvelope', { envelopeId: incomeEnvelopes[0].id });
    }
  }, [incomeEnvelopes, navigation]);

  // Group envelopes into Income / Expenses sections
  const sections = useMemo(() => {
    const expenses = envelopes.filter((e) => e.envelopeType !== 'income');
    const result = [];
    if (incomeEnvelopes.length > 0) {
      result.push({ title: 'Income', data: incomeEnvelopes });
    }
    if (expenses.length > 0) {
      result.push({ title: 'Expenses', data: expenses });
    }
    return result;
  }, [envelopes, incomeEnvelopes]);

  if (loading && envelopes.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {/* Duplicate-EMF banner (shown only when flag is set) */}
      <DuplicateEmfBanner />

      {/* This month's income — always visible so it can be set/updated per month */}
      <MonthlyIncomeCard
        incomeCents={incomeTotalCents}
        hasIncome={incomeEnvelopes.length > 0}
        onSetIncome={handleSetIncome}
      />

      {/* Budget balance banner */}
      <BudgetBalanceBanner envelopes={envelopes} />

      {sections.length === 0 ? (
        <EmptyState
          title="No envelopes yet"
          body="No envelopes configured for this period."
          testID="budget-empty-state"
          ctaLabel="Start this month's budget"
          onCta={handleStartNewPeriod}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <EnvelopeCard
              envelope={item}
              onPress={() => navigation.navigate('AddEditEnvelope', { envelopeId: item.id })}
            />
          )}
          renderSectionHeader={({ section: { title } }) => (
            <SectionHeader title={title} showDivider />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} colors={[colors.primary]} />
          }
          stickySectionHeadersEnabled={false}
        />
      )}

      {sections.length > 0 && (
        <FAB
          icon="plus"
          style={[styles.fab, { backgroundColor: colors.primary }]}
          color={colors.onPrimary}
          onPress={() => navigation.navigate('AddEditEnvelope', {})}
          testID="add-envelope-fab"
          accessibilityLabel="Add envelope"
        />
      )}

      <RolloverWizard
        visible={showRollover}
        householdId={householdId}
        fromPeriodStart={rolloverFromPeriodStart}
        toPeriodStart={periodStart}
        periodLabel={periodLabel}
        onDone={handleRolloverDone}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  list: { paddingBottom: spacing.xxl + 56 + spacing.md },
  fab: { position: 'absolute', right: spacing.base, bottom: spacing.xl },
});
