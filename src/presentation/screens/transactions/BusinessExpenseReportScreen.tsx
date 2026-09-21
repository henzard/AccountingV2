import React, { useState, useCallback } from 'react';
import { View, StyleSheet, SectionList, Share, TouchableOpacity } from 'react-native';
import { Text, Surface, ActivityIndicator, IconButton, Menu } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { and, eq, gte, lte, isNull } from 'drizzle-orm';
import { format } from 'date-fns';
import { db } from '../../../data/local/db';
import { transactions as txTable } from '../../../data/local/schema';
import { groupBusinessExpenses } from '../../../domain/transactions/BusinessExpenseReport';
import {
  getTaxYearOptions,
  currentTaxYearKey,
  ALL_TIME_KEY,
  type TaxYearOption,
} from '../../../domain/transactions/southAfricanTaxYear';
import { formatCurrency } from '../../utils/currency';
import { EmptyState } from '../../components/shared/EmptyState';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { buildBusinessExpenseCsv, transactionsToCsvRows } from './buildBusinessExpenseCsv';
import type { TransactionEntity } from '../../../domain/transactions/TransactionEntity';

export function BusinessExpenseReportScreen(): React.JSX.Element {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId) ?? '';
  const enqueue = useToastStore((s) => s.enqueue);
  const [groups, setGroups] = useState<ReturnType<typeof groupBusinessExpenses>>([]);
  const [transactions, setTransactions] = useState<TransactionEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taxYearOptions, setTaxYearOptions] = useState<TaxYearOption[]>([]);
  const [selectedTaxYearKey, setSelectedTaxYearKey] = useState<string>(() =>
    currentTaxYearKey(format(new Date(), 'yyyy-MM-dd')),
  );
  const [menuVisible, setMenuVisible] = useState(false);

  const selectedOption = taxYearOptions.find((o) => o.key === selectedTaxYearKey);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const baseConditions = [
        eq(txTable.householdId, householdId),
        eq(txTable.isBusinessExpense, true),
        isNull(txTable.deletedAt),
      ];

      // Every business-expense date (no tax-year filter) — needed only to
      // build the picker's list of tax years that actually have data.
      const dateRows = await db
        .select({ transactionDate: txTable.transactionDate })
        .from(txTable)
        .where(and(...baseConditions));
      const allDates: string[] = dateRows.map(
        (r: { transactionDate: string }) => r.transactionDate,
      );
      const options = getTaxYearOptions(allDates, format(new Date(), 'yyyy-MM-dd'));
      setTaxYearOptions(options);

      let selected = options.find((o) => o.key === selectedTaxYearKey);
      if (!selected) {
        // The chosen tax year no longer has data (its last expense was deleted
        // or un-flagged): fall back to "All time" AND move the selector with
        // it, so the label never disagrees with the rows on screen.
        selected = options[options.length - 1];
        setSelectedTaxYearKey(selected.key);
      }

      const conditions =
        selected.startDate && selected.endDate
          ? [
              ...baseConditions,
              gte(txTable.transactionDate, selected.startDate),
              lte(txTable.transactionDate, selected.endDate),
            ]
          : baseConditions;

      const rows = await db
        .select()
        .from(txTable)
        .where(and(...conditions));
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
      setTransactions(entities);
      setGroups(groupBusinessExpenses(entities));
    } catch (err: unknown) {
      setGroups([]);
      setError(err instanceof Error ? err.message : 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  }, [householdId, selectedTaxYearKey]);

  const handleSelectTaxYear = useCallback((key: string): void => {
    setSelectedTaxYearKey(key);
    setMenuVisible(false);
  }, []);

  const handleShareCsv = useCallback(async (): Promise<void> => {
    try {
      const csvRows = transactionsToCsvRows(transactions);
      const csv = buildBusinessExpenseCsv(csvRows);
      const fileName =
        selectedOption && selectedOption.key !== ALL_TIME_KEY && selectedOption.startDate
          ? `business-expenses-${selectedOption.startDate}_to_${selectedOption.endDate}.csv`
          : 'business-expenses-all-time.csv';
      await Share.share({
        title: fileName,
        message: csv,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to share CSV';
      enqueue(message, 'error');
    }
  }, [transactions, enqueue, selectedOption]);

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

  if (error) {
    return (
      <View style={styles.center}>
        <Text variant="bodyMedium" style={{ color: colors.error }} testID="error-banner">
          {error}
        </Text>
      </View>
    );
  }

  const sections = groups.map((g) => ({
    title: g.monthLabel,
    total: g.totalCents,
    data: g.transactions,
  }));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Menu
          visible={menuVisible}
          onDismiss={() => setMenuVisible(false)}
          anchor={
            <TouchableOpacity
              onPress={() => setMenuVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Select tax year"
              testID="tax-year-selector-button"
            >
              <Text variant="titleSmall" style={{ color: colors.onSurface }}>
                {selectedOption?.label ?? 'Select tax year'}
              </Text>
            </TouchableOpacity>
          }
        >
          {taxYearOptions.map((option) => (
            <Menu.Item
              key={option.key}
              title={option.label}
              onPress={() => handleSelectTaxYear(option.key)}
              testID={`tax-year-option-${option.key}`}
            />
          ))}
        </Menu>
        <IconButton
          icon="share-variant"
          size={28}
          disabled={transactions.length === 0}
          onPress={handleShareCsv}
          accessibilityLabel="Share business expenses as CSV"
          testID="share-csv-button"
        />
      </View>
      {groups.length === 0 ? (
        <EmptyState
          title="No business expenses"
          body="Toggle 'Business expense' when logging a transaction to track it here."
          testID="biz-expense-empty"
        />
      ) : (
        <SectionList
          style={styles.flex}
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
                <Text variant="bodyMedium" style={{ color: colors.onSurface }} numberOfLines={2}>
                  {item.payee ?? 'Unknown payee'}
                </Text>
                {item.spendingTriggerNote ? (
                  <Text
                    variant="bodySmall"
                    style={{ color: colors.onSurfaceVariant }}
                    numberOfLines={2}
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
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
