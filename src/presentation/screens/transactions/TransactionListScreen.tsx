import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  SectionList,
  Alert,
} from 'react-native';
import { Text, FAB, ActivityIndicator, Surface, TouchableRipple } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { eq } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { envelopes as envelopesTable } from '../../../data/local/schema';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { DeleteTransactionUseCase } from '../../../domain/transactions/DeleteTransactionUseCase';
import { useTransactions } from '../../hooks/useTransactions';
import { CurrencyText } from '../../components/shared/CurrencyText';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing, radius } from '../../theme/tokens';
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
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);
  const period = engine.getCurrentPeriod(paydayDay);
  const periodStart = format(period.startDate, 'yyyy-MM-dd');

  const { transactions, loading, reload } = useTransactions(householdId, periodStart);
  const [envelopeNames, setEnvelopeNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    db.select({ id: envelopesTable.id, name: envelopesTable.name })
      .from(envelopesTable)
      .where(eq(envelopesTable.householdId, householdId))
      .then((rows) => {
        setEnvelopeNames(new Map(rows.map((r) => [r.id, r.name])));
      });
  }, [householdId]);

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
            onPress: async () => {
              const uc = new DeleteTransactionUseCase(db, audit, tx);
              await uc.execute();
              void reload();
            },
          },
        ],
      );
    },
    [reload],
  );

  const sections = groupByDate(transactions);

  return (
    <View style={styles.flex}>
      <Surface style={styles.header} elevation={0}>
        <Text variant="labelMedium" style={styles.periodLabel}>TRANSACTIONS</Text>
        <Text variant="headlineSmall" style={styles.periodTitle}>{period.label}</Text>
      </Surface>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator animating color={colours.primary} />
        </View>
      ) : transactions.length === 0 ? (
        <View style={styles.center}>
          <Text variant="titleMedium" style={styles.emptyTitle}>No transactions yet</Text>
          <Text variant="bodyMedium" style={styles.emptyBody}>Tap + to record spending</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text variant="labelMedium" style={styles.sectionTitle}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TouchableRipple onLongPress={() => handleDelete(item)} rippleColor={colours.errorContainer}>
              <Surface style={styles.row} elevation={1}>
                <View style={styles.rowLeft}>
                  <Text variant="bodyLarge" style={styles.payee} numberOfLines={1}>
                    {item.payee ?? 'Unknown'}
                  </Text>
                  <Text variant="bodySmall" style={styles.envelopeName}>
                    {envelopeNames.get(item.envelopeId) ?? '—'}
                  </Text>
                </View>
                <CurrencyText amountCents={item.amountCents} style={styles.amount} />
              </Surface>
            </TouchableRipple>
          )}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled
        />
      )}

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={() => navigation.navigate('AddTransaction')}
        color={colours.onPrimary}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  header: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.xl,
    paddingBottom: spacing.base,
    backgroundColor: colours.surface,
  },
  periodLabel: { color: colours.onSurfaceVariant, letterSpacing: 1.5, marginBottom: spacing.xs },
  periodTitle: { color: colours.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyTitle: { color: colours.onSurface, marginTop: spacing.base },
  emptyBody: { color: colours.onSurfaceVariant, textAlign: 'center', marginTop: spacing.sm },
  sectionHeader: {
    backgroundColor: colours.surfaceVariant,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
  },
  sectionTitle: { color: colours.onSurfaceVariant, letterSpacing: 0.8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.base,
    marginVertical: spacing.xs / 2,
    borderRadius: radius.md,
    padding: spacing.base,
    backgroundColor: colours.surface,
  },
  rowLeft: { flex: 1, marginRight: spacing.base },
  payee: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_600SemiBold' },
  envelopeName: { color: colours.onSurfaceVariant, marginTop: 2 },
  amount: { color: colours.error, fontSize: 14, fontFamily: 'PlusJakartaSans_700Bold' },
  list: { paddingBottom: 100 },
  fab: { position: 'absolute', right: spacing.base, bottom: spacing.xl, backgroundColor: colours.primary },
});
