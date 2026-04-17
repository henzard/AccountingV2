import React, { useState, useCallback } from 'react';
import { View, StyleSheet, SectionList } from 'react-native';
import { Text, Surface, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { transactions as txTable } from '../../../data/local/schema';
import { groupBusinessExpenses } from '../../../domain/transactions/BusinessExpenseReport';
import { formatCurrency } from '../../utils/currency';
import { EmptyState } from '../../components/shared/EmptyState';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import { useAppStore } from '../../stores/appStore';
import type { TransactionEntity } from '../../../domain/transactions/TransactionEntity';

export function BusinessExpenseReportScreen(): React.JSX.Element {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId) ?? '';
  const [groups, setGroups] = useState<ReturnType<typeof groupBusinessExpenses>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    const rows = await db
      .select()
      .from(txTable)
      .where(and(eq(txTable.householdId, householdId), eq(txTable.isBusinessExpense, true)));
    const entities: TransactionEntity[] = rows.map((r) => ({
      id: r.id,
      householdId: r.householdId,
      envelopeId: r.envelopeId,
      amountCents: r.amountCents,
      payee: r.payee ?? null,
      description: r.description ?? null,
      transactionDate: r.transactionDate,
      isBusinessExpense: Boolean(r.isBusinessExpense),
      spendingTriggerNote: r.spendingTriggerNote ?? null,
      slipId: r.slipId ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    setGroups(groupBusinessExpenses(entities));
    setLoading(false);
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        title="No business expenses"
        body="Toggle 'Business expense' when logging a transaction to track it here."
        testID="biz-expense-empty"
      />
    );
  }

  const sections = groups.map((g) => ({
    title: g.monthLabel,
    total: g.totalCents,
    data: g.transactions,
  }));

  return (
    <SectionList
      style={[styles.flex, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      sections={sections}
      keyExtractor={(item) => item.id}
      renderSectionHeader={({ section }) => (
        <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
          <Text variant="titleSmall" style={{ color: colors.onSurface }}>
            {section.title}
          </Text>
          <Text variant="titleSmall" style={{ color: colors.primary }}>
            {formatCurrency(section.total)}
          </Text>
        </View>
      )}
      renderItem={({ item }) => (
        <Surface style={[styles.row, { backgroundColor: colors.surface }]} elevation={0}>
          <View style={styles.rowMain}>
            <Text variant="bodyMedium" style={{ color: colors.onSurface }} numberOfLines={1}>
              {item.payee ?? 'Unknown payee'}
            </Text>
            {item.spendingTriggerNote ? (
              <Text
                variant="bodySmall"
                style={{ color: colors.onSurfaceVariant }}
                numberOfLines={1}
              >
                {item.spendingTriggerNote}
              </Text>
            ) : null}
          </View>
          <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
            {formatCurrency(item.amountCents)}
          </Text>
        </Surface>
      )}
      testID="biz-expense-list"
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingBottom: spacing.xl },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.base,
    marginBottom: spacing.xs,
    borderRadius: radius.md,
  },
  rowMain: { flex: 1, marginRight: spacing.sm },
});
