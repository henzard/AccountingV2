import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, SectionList, Alert, TouchableOpacity } from 'react-native';
import { FAB, ActivityIndicator, Surface, IconButton, Divider, Text } from 'react-native-paper';
import { ListRow } from '../../components/shared/ListRow';
import { useFocusEffect } from '@react-navigation/native';
import { eq } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { envelopes as envelopesTable } from '../../../data/local/schema';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { DeleteTransactionUseCase } from '../../../domain/transactions/DeleteTransactionUseCase';
import { useTransactions } from '../../hooks/useTransactions';
import { CurrencyText } from '../../components/shared/CurrencyText';
import { ScreenHeader } from '../../components/shared/ScreenHeader';
import { EmptyState } from '../../components/shared/EmptyState';
import { SectionHeader } from '../../components/shared/SectionHeader';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { LoadingSplash } from '../../components/shared/LoadingSplash';
import { fontSize, spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import { format, parseISO } from 'date-fns';
import type { TransactionListScreenProps } from '../../navigation/types';
import type { TransactionEntity } from '../../../domain/transactions/TransactionEntity';

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();

interface Section {
  title: string;
  data: TransactionEntity[];
}

function groupByDate(txs: TransactionEntity[]): Section[] {
  const map = new Map<string, TransactionEntity[]>();
  for (const tx of txs) {
    const label = format(parseISO(tx.transactionDate), 'd MMM yyyy');
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(tx);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

export const TransactionListScreen: React.FC<TransactionListScreenProps> = ({ navigation }) => {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId);
  const paydayDay = useAppStore((s) => s.paydayDay);
  const enqueue = useToastStore((s) => s.enqueue);
  const period = engine.getCurrentPeriod(paydayDay);
  const periodStart = format(period.startDate, 'yyyy-MM-dd');

  const hid = householdId ?? '';
  const { transactions, loading, reload } = useTransactions(hid, periodStart);
  const [envelopeNames, setEnvelopeNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    db.select({ id: envelopesTable.id, name: envelopesTable.name })
      .from(envelopesTable)
      .where(eq(envelopesTable.householdId, hid))
      .then((rows) => {
        setEnvelopeNames(new Map(rows.map((r) => [r.id, r.name])));
      });
  }, [hid]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const handleDelete = useCallback(
    (tx: TransactionEntity) => {
      Alert.alert(
        'Delete transaction?',
        `${tx.payee ?? 'Unknown'} — ${(tx.amountCents / 100).toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async (): Promise<void> => {
              try {
                const uc = new DeleteTransactionUseCase(db, audit, tx);
                const result = await uc.execute();
                if (!result.success) {
                  enqueue('Failed to delete transaction', 'error');
                  return;
                }
                void reload();
              } catch {
                enqueue('Failed to delete transaction', 'error');
              }
            },
          },
        ],
      );
    },
    [reload, enqueue],
  );

  const renderSeparator = useCallback(
    () => <Divider style={{ backgroundColor: colors.outlineVariant }} />,
    [colors.outlineVariant],
  );

  if (!householdId) return <LoadingSplash />;

  const sections = groupByDate(transactions);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Surface style={[styles.header, { backgroundColor: colors.surface }]} elevation={0}>
        <View style={styles.headerRow}>
          <ScreenHeader eyebrow="Transactions" title={period.label} />
          <TouchableOpacity
            onPress={() => navigation.navigate('BusinessExpenseReport')}
            style={styles.bizButton}
            testID="biz-expense-header-button"
          >
            <Text variant="labelMedium" style={{ color: colors.primary }}>
              Business
            </Text>
          </TouchableOpacity>
        </View>
      </Surface>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator animating color={colors.primary} />
        </View>
      ) : transactions.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          body="Tap + to record spending"
          testID="transaction-list-empty-state"
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => <SectionHeader title={section.title} filled />}
          renderItem={({ item }) => (
            <ListRow
              title={item.payee ?? 'Unknown'}
              subtitle={envelopeNames.get(item.envelopeId) ?? '—'}
              trailing={
                <View style={styles.rowTrailing}>
                  <CurrencyText
                    amountCents={item.amountCents}
                    style={{ ...styles.amount, color: colors.error }}
                  />
                  <IconButton
                    icon="delete-outline"
                    iconColor={colors.error}
                    size={20}
                    onPress={() => handleDelete(item)}
                    testID={`delete-tx-${item.id}`}
                  />
                </View>
              }
              testID={`tx-row-${item.id}`}
            />
          )}
          ItemSeparatorComponent={renderSeparator}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled
        />
      )}

      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => navigation.navigate('AddTransaction')}
        color={colors.onPrimary}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {},
  headerRow: { flexDirection: 'row', alignItems: 'flex-end' },
  bizButton: { paddingHorizontal: spacing.base, paddingBottom: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  rowTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  amount: { fontSize: fontSize.md, fontFamily: 'PlusJakartaSans_700Bold' },
  list: { paddingBottom: 100 },
  fab: {
    position: 'absolute',
    right: spacing.base,
    bottom: spacing.xl,
  },
});
