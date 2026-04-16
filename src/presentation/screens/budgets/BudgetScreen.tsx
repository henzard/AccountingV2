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
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import { BudgetBalanceBanner } from './components/BudgetBalanceBanner';
import { DuplicateEmfBanner } from './components/DuplicateEmfBanner';
import { EnvelopeCard } from '../../components/envelopes/EnvelopeCard';
import { EmptyState } from '../../components/shared/EmptyState';
import { SectionHeader } from '../../components/shared/SectionHeader';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useAppStore } from '../../stores/appStore';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

const engine = new BudgetPeriodEngine();

export const BudgetScreen: React.FC = () => {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);

  const period = engine.getCurrentPeriod(paydayDay);
  const periodStart = format(period.startDate, 'yyyy-MM-dd');

  const { envelopes, loading, reload } = useEnvelopes(householdId, periodStart);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // Group envelopes into Income / Expenses sections
  const sections = useMemo(() => {
    const income = envelopes.filter((e) => e.envelopeType === 'income');
    const expenses = envelopes.filter((e) => e.envelopeType !== 'income');
    const result = [];
    if (income.length > 0) {
      result.push({ title: 'Income', data: income });
    }
    if (expenses.length > 0) {
      result.push({ title: 'Expenses', data: expenses });
    }
    return result;
  }, [envelopes]);

  if (loading && envelopes.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {/* Duplicate-EMF banner (shown only when flag is set) */}
      <DuplicateEmfBanner />

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
          renderItem={({ item }) => <EnvelopeCard envelope={item} />}
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
