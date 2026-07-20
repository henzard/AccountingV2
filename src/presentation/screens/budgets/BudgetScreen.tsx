/**
 * BudgetScreen — zero-based budget overview.
 *
 * Shows BudgetBalanceBanner at top, then envelope list grouped into
 * "Income" and "Expenses" sections (spec §Zero-based budgeting).
 *
 * Duplicate-EMF banner also shown at top when the reconcile flag is set.
 */

import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, SectionList, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BudgetBalanceBanner } from './components/BudgetBalanceBanner';
import { DuplicateEmfBanner } from './components/DuplicateEmfBanner';
import { MonthlyIncomeCard } from './components/MonthlyIncomeCard';
import { EnvelopeCard } from '../../components/envelopes/EnvelopeCard';
import { EmptyState } from '../../components/shared/EmptyState';
import { SectionHeader } from '../../components/shared/SectionHeader';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useAppStore } from '../../stores/appStore';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../../domain/shared/BudgetPeriodEngine';
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

  const { envelopes, loading, reload } = useEnvelopes(householdId, periodStart);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

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
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item, section }) => (
            <EnvelopeCard
              envelope={item}
              onPress={
                section.title === 'Income'
                  ? () => navigation.navigate('AddEditEnvelope', { envelopeId: item.id })
                  : undefined
              }
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
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  list: { paddingBottom: spacing.xxl },
});
