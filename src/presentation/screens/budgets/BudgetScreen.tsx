/**
 * BudgetScreen — zero-based budget overview.
 *
 * Shows BudgetBalanceBanner at top, then envelope list grouped into
 * "Income" and "Expenses" sections (spec §Zero-based budgeting).
 *
 * Duplicate-EMF banner also shown at top when the reconcile flag is set.
 */

import React, { useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  SectionList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Text, Divider } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import { BudgetBalanceBanner } from './components/BudgetBalanceBanner';
import { DuplicateEmfBanner } from './components/DuplicateEmfBanner';
import { EnvelopeCard } from '../../components/envelopes/EnvelopeCard';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useAppStore } from '../../stores/appStore';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { colours, spacing } from '../../theme/tokens';

const engine = new BudgetPeriodEngine();

export const BudgetScreen: React.FC = () => {
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
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      {/* Duplicate-EMF banner (shown only when flag is set) */}
      <DuplicateEmfBanner />

      {/* Budget balance banner */}
      <BudgetBalanceBanner envelopes={envelopes} />

      {sections.length === 0 ? (
        <View style={styles.center}>
          <Text variant="bodyMedium" style={styles.emptyText}>
            No envelopes yet for this period.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <EnvelopeCard envelope={item} />}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Text variant="labelSmall" style={styles.sectionTitle}>
                {title.toUpperCase()}
              </Text>
              <Divider style={styles.divider} />
            </View>
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={reload}
              colors={[colours.primary]}
            />
          }
          stickySectionHeadersEnabled={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { color: colours.onSurfaceVariant, textAlign: 'center' },
  list: { paddingBottom: spacing.xxl },
  sectionHeader: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.xs,
    backgroundColor: colours.background,
  },
  sectionTitle: {
    color: colours.onSurfaceVariant,
    letterSpacing: 1.2,
    marginBottom: spacing.xs,
  },
  divider: {
    backgroundColor: colours.outlineVariant,
  },
});
