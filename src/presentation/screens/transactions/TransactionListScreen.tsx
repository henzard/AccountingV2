import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, SectionList, TouchableOpacity, RefreshControl } from 'react-native';
import {
  FAB,
  ActivityIndicator,
  Surface,
  IconButton,
  Divider,
  Text,
  Searchbar,
} from 'react-native-paper';
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
import { RefreshingBar } from '../../components/shared/RefreshingBar';
import { EmptyState } from '../../components/shared/EmptyState';
import { SectionHeader } from '../../components/shared/SectionHeader';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../../domain/shared/BudgetPeriodEngine';
import { classifyMoney, summariseMoney } from '../../../domain/transactions/moneyDirection';
import { getPreviousPeriod, getNextPeriod, isCurrentOrFuturePeriod } from './periodNavigation';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { confirm } from '../../components/shared/ConfirmDialogHost';
import { LoadingSplash } from '../../components/shared/LoadingSplash';
import { requestSyncNow } from '../../../data/sync/syncRuntime';
import { formatCurrency } from '../../utils/currency';
import { fontSize, spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import { format, parseISO } from 'date-fns';
import type { TransactionListScreenProps } from '../../navigation/types';
import type { TransactionEntity } from '../../../domain/transactions/TransactionEntity';
import type { EnvelopeType } from '../../../domain/envelopes/EnvelopeEntity';
import type { BudgetPeriod } from '../../../domain/shared/types';

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();

/** How long to wait after the last keystroke before the search filter applies. */
const SEARCH_DEBOUNCE_MS = 200;

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

/**
 * Case-insensitive substring match over payee, description, envelope name, and amount.
 * Matches against:
 * - Payee and description (as before)
 * - Envelope name (resolved from the map)
 * - Amount in multiple formats: plain value ("25", "25.00", "25,00") and formatted ("R 25", "R 25,00", etc.)
 * An empty query matches everything.
 */
export function matchesQuery(
  tx: TransactionEntity,
  normalizedQuery: string,
  envelopeNames: Map<string, string>,
): boolean {
  // Empty query matches everything
  if (!normalizedQuery) return true;

  const payee = tx.payee?.toLowerCase() ?? '';
  const description = tx.description?.toLowerCase() ?? '';
  const envelopeName = envelopeNames.get(tx.envelopeId)?.toLowerCase() ?? '';

  // Match payee or description
  if (payee.includes(normalizedQuery) || description.includes(normalizedQuery)) {
    return true;
  }

  // Match envelope name
  if (envelopeName.includes(normalizedQuery)) {
    return true;
  }

  // Match amount in various formats
  const amountCents = tx.amountCents;
  const absAmountCents = Math.abs(amountCents);

  // Plain rand values: "25", "25.00", "25,00"
  const plainValue = (absAmountCents / 100).toFixed(2);
  const plainValueDot = plainValue; // "25.00"
  const plainValueComma = plainValue.replace('.', ','); // "25,00"
  const plainValueNoDecimal = Math.floor(absAmountCents / 100).toString(); // "25"

  if (
    plainValueDot.includes(normalizedQuery) ||
    plainValueComma.includes(normalizedQuery) ||
    plainValueNoDecimal.includes(normalizedQuery)
  ) {
    return true;
  }

  // The string the row actually shows (e.g. "R 1 234,56"). Intl puts
  // non-breaking spaces in it; a typed query has ordinary ones.
  const formatted = formatCurrency(absAmountCents).replace(/[  ]/g, ' ').toLowerCase();
  const query = normalizedQuery.replace(/[  ]/g, ' ');
  if (
    formatted.includes(query) ||
    formatted.replace(/\s/g, '').includes(query.replace(/\s/g, ''))
  ) {
    return true;
  }

  return false;
}

export const TransactionListScreen: React.FC<TransactionListScreenProps> = ({ navigation }) => {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId);
  const paydayDay = useAppStore((s) => s.paydayDay);
  const enqueue = useToastStore((s) => s.enqueue);

  const [viewedPeriod, setViewedPeriod] = useState<BudgetPeriod>(() =>
    engine.getCurrentPeriod(paydayDay),
  );
  const periodStart = formatPeriodDateKey(viewedPeriod.startDate);
  const periodEnd = formatPeriodDateKey(viewedPeriod.endDate);
  const nextDisabled = isCurrentOrFuturePeriod(paydayDay, viewedPeriod);

  const handlePreviousPeriod = useCallback(() => {
    setViewedPeriod((current) => getPreviousPeriod(paydayDay, current));
  }, [paydayDay]);

  const handleNextPeriod = useCallback(() => {
    setViewedPeriod((current) =>
      isCurrentOrFuturePeriod(paydayDay, current) ? current : getNextPeriod(paydayDay, current),
    );
  }, [paydayDay]);

  const hid = householdId ?? '';
  const {
    transactions,
    loading,
    refreshing: hookRefreshing,
    error,
    reload,
  } = useTransactions(hid, { periodStart, periodEnd });
  const [envelopeNames, setEnvelopeNames] = useState<Map<string, string>>(new Map());
  // MONEY IN vs MONEY OUT: a row's envelope TYPE is what decides whether it is
  // money coming in — an imported salary deposit sits on an `income` envelope
  // and must never be summed into "Spent" (see domain/transactions/
  // moneyDirection). Loaded alongside the names, from the same one query.
  const [envelopeTypes, setEnvelopeTypes] = useState<Map<string, EnvelopeType>>(new Map());

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  const normalizedQuery = debouncedQuery.trim().toLowerCase();
  const filteredTransactions = useMemo(
    () =>
      normalizedQuery
        ? transactions.filter((tx) => matchesQuery(tx, normalizedQuery, envelopeNames))
        : transactions,
    [transactions, normalizedQuery, envelopeNames],
  );

  // Spent and Received are SEPARATE totals, never one misleading net: a
  // period where the salary landed would otherwise read as a tiny (or
  // negative) "spent" figure. Refunds still net the spent side down.
  const periodMoney = useMemo(
    () =>
      summariseMoney(
        filteredTransactions.map((tx) => ({
          amountCents: tx.amountCents,
          envelopeType: envelopeTypes.get(tx.envelopeId),
        })),
      ),
    [filteredTransactions, envelopeTypes],
  );
  const periodTotalCents = periodMoney.spentCents;

  useEffect(() => {
    db.select({
      id: envelopesTable.id,
      name: envelopesTable.name,
      envelopeType: envelopesTable.envelopeType,
    })
      .from(envelopesTable)
      .where(eq(envelopesTable.householdId, hid))
      .then((rows) => {
        setEnvelopeNames(new Map(rows.map((r) => [r.id, r.name])));
        setEnvelopeTypes(
          new Map(
            rows
              .filter((r): r is typeof r & { envelopeType: EnvelopeType } => r.envelopeType != null)
              .map((r) => [r.id, r.envelopeType]),
          ),
        );
      });
  }, [hid]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // UX2-12: pull-to-refresh — asks the sync scheduler for an immediate round
  // (best-effort; a rejection just means offline or no runtime registered,
  // which the local reload below still serves fine) before reloading from
  // local storage.
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const handleRefresh = useCallback(async (): Promise<void> => {
    setPullRefreshing(true);
    try {
      await requestSyncNow(hid);
    } catch {
      // Offline, or no sync runtime registered yet — the local reload below
      // still shows whatever this device already has.
    }
    await reload();
    setPullRefreshing(false);
  }, [hid, reload]);
  // The pull gesture's own spinner AND any background reload (a sync round
  // landing via `useReloadOnSync`, the focus refetch below) both drive the
  // same RefreshControl — REG-9: `loading` is first-load-only and must never
  // be used here, or the platform spinner would stop reflecting an in-flight
  // reload once the first load has completed.
  const refreshing = pullRefreshing || hookRefreshing;

  const handleDelete = useCallback(
    async (tx: TransactionEntity): Promise<void> => {
      const confirmed = await confirm({
        title: 'Delete transaction?',
        message: `${tx.payee ?? 'Unknown'} — ${formatCurrency(tx.amountCents)}`,
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!confirmed) return;

      try {
        const uc = new DeleteTransactionUseCase(db, audit, tx);
        const result = await uc.execute();
        if (!result.success) {
          enqueue('Failed to delete transaction', 'error');
          return;
        }
        enqueue('Transaction deleted', 'success');
        void reload();
      } catch {
        enqueue('Failed to delete transaction', 'error');
      }
    },
    [reload, enqueue],
  );

  const renderSeparator = useCallback(
    () => <Divider style={{ backgroundColor: colors.outlineVariant }} />,
    [colors.outlineVariant],
  );

  if (!householdId) return <LoadingSplash />;

  const sections = groupByDate(filteredTransactions);
  const trimmedQuery = debouncedQuery.trim();
  const isPastPeriod = !isCurrentOrFuturePeriod(paydayDay, viewedPeriod);
  // UX2-12: while searching, the total needs to say what it's a total OF
  // (the visible matches), not just repeat the unlabelled period figure.
  const totalLabel = trimmedQuery
    ? `${filteredTransactions.length} ${filteredTransactions.length === 1 ? 'match' : 'matches'} · ${formatCurrency(periodTotalCents)}`
    : `Spent this period: ${formatCurrency(periodTotalCents)}`;
  // Shown only when this period actually has money IN, so an ordinary
  // spending-only period keeps its single, unchanged line.
  const receivedLabel =
    periodMoney.incomeCount > 0
      ? `Received this period: ${formatCurrency(periodMoney.receivedCents)}`
      : null;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Surface style={[styles.header, { backgroundColor: colors.surface }]} elevation={0}>
        <View style={styles.headerRow}>
          <ScreenHeader title="Transactions" />
          <TouchableOpacity
            onPress={() => navigation.navigate('BusinessExpenseReport')}
            style={styles.bizButton}
            testID="biz-expense-header-button"
            accessibilityRole="button"
            accessibilityLabel="Business expenses"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text variant="labelMedium" style={{ color: colors.primary }}>
              Business
            </Text>
          </TouchableOpacity>
        </View>
        <RefreshingBar refreshing={refreshing} />

        <View style={styles.periodRow} testID="period-switcher">
          <IconButton
            icon="chevron-left"
            onPress={handlePreviousPeriod}
            testID="period-prev-button"
            accessibilityLabel="Previous period"
          />
          <Text variant="titleMedium" style={{ color: colors.onSurface }} testID="period-label">
            {viewedPeriod.label}
          </Text>
          <IconButton
            icon="chevron-right"
            onPress={handleNextPeriod}
            disabled={nextDisabled}
            testID="period-next-button"
            accessibilityLabel="Next period"
          />
        </View>

        <Searchbar
          placeholder="Search payee or description"
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={styles.search}
          testID="transaction-search"
        />

        <Text
          variant="bodyMedium"
          style={[styles.periodTotal, { color: colors.onSurfaceVariant }]}
          testID="period-total"
        >
          {totalLabel}
        </Text>

        {receivedLabel !== null && (
          <Text
            variant="bodyMedium"
            style={[styles.periodReceived, { color: colors.success }]}
            testID="period-received"
          >
            {receivedLabel}
          </Text>
        )}
      </Surface>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator animating color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text variant="bodyMedium" style={{ color: colors.error }} testID="error-banner">
            {typeof error === 'string' ? error : (error.message ?? 'Something went wrong')}
          </Text>
        </View>
      ) : transactions.length === 0 ? (
        <EmptyState
          title="No transactions this period"
          body={isPastPeriod ? 'Nothing was recorded in this period.' : 'Tap + to record spending'}
          testID="transaction-list-empty-state"
        />
      ) : filteredTransactions.length === 0 ? (
        <EmptyState
          title={`No matches for "${trimmedQuery}"`}
          testID="transaction-list-no-matches"
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => <SectionHeader title={section.title} filled />}
          renderItem={({ item }) => {
            // MONEY IN vs MONEY OUT — one classification drives the row's
            // word, sign, colour and accessibility label, so "Income" and
            // "Refund" can never be told apart by colour alone or drift from
            // what the period header counted (domain/transactions/
            // moneyDirection is the single source of truth).
            const kind = classifyMoney({
              amountCents: item.amountCents,
              envelopeType: envelopeTypes.get(item.envelopeId),
            });
            const isMoneyIn = kind !== 'spend';
            return (
              // UX-9: the row itself is pressable (edit), separate from the
              // delete IconButton nested in `trailing` — RN's touch responder
              // system gives the innermost touchable the tap, so pressing
              // delete does not also trigger this outer onPress.
              <TouchableOpacity
                onPress={() => navigation.navigate('AddTransaction', { transactionId: item.id })}
                accessibilityRole="button"
                accessibilityLabel={
                  kind === 'income'
                    ? `Edit income ${item.payee ?? 'Unknown'}, ${formatCurrency(Math.abs(item.amountCents))} received`
                    : kind === 'refund'
                      ? `Edit refund ${item.payee ?? 'Unknown'}, ${formatCurrency(Math.abs(item.amountCents))} back`
                      : `Edit transaction ${item.payee ?? 'Unknown'}`
                }
                testID={`tx-row-${item.id}`}
              >
                <ListRow
                  title={item.payee ?? 'Unknown'}
                  subtitle={envelopeNames.get(item.envelopeId) ?? '—'}
                  trailing={
                    <View style={styles.rowTrailing}>
                      {/* REFUNDS / INCOME: money coming in reads "+R 25,00" in
                          the success colour with an explicit word beside it —
                          never colour alone, which a colour-blind user or a
                          greyscale screenshot would lose. The two are
                          different things and say so: a salary deposit is
                          "Income", money handed back by a shop is "Refund".
                          `Math.abs` + showSign is what turns CurrencyText's
                          default "-R 25,00" into the "+" reading. */}
                      {isMoneyIn && (
                        <Text
                          variant="labelSmall"
                          style={[styles.refundLabel, { color: colors.success }]}
                          testID={
                            kind === 'income'
                              ? `tx-income-label-${item.id}`
                              : `tx-refund-label-${item.id}`
                          }
                        >
                          {kind === 'income' ? 'Income' : 'Refund'}
                        </Text>
                      )}
                      <CurrencyText
                        amountCents={Math.abs(item.amountCents)}
                        showSign={isMoneyIn}
                        style={{
                          ...styles.amount,
                          color: isMoneyIn ? colors.success : colors.error,
                        }}
                      />
                      <IconButton
                        icon="delete-outline"
                        iconColor={colors.error}
                        size={20}
                        onPress={() => handleDelete(item)}
                        testID={`delete-tx-${item.id}`}
                        accessibilityLabel={`Delete transaction ${item.payee ?? 'Unknown'}`}
                      />
                    </View>
                  }
                />
              </TouchableOpacity>
            );
          }}
          ItemSeparatorComponent={renderSeparator}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled
          refreshControl={
            <RefreshControl
              testID="transaction-list-refresh-control"
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
              colors={[colors.primary]}
            />
          }
        />
      )}

      {/* Back-dating into a past period is legitimate, so the FAB stays —
          but a past period's + is easy to mistake for "add today's spend",
          so it carries a label there instead of being a bare icon. */}
      <FAB
        icon="plus"
        label={isPastPeriod ? 'Back-date entry' : undefined}
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => navigation.navigate('AddTransaction')}
        color={colors.onPrimary}
        accessibilityLabel={isPastPeriod ? 'Back-date a transaction' : 'Add transaction'}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {},
  headerRow: { flexDirection: 'row', alignItems: 'flex-end' },
  bizButton: { paddingHorizontal: spacing.base, paddingBottom: spacing.md },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  search: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.xs,
  },
  periodTotal: {
    textAlign: 'right',
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
  },
  periodReceived: {
    textAlign: 'right',
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    marginTop: -spacing.xs,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  rowTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  amount: { fontSize: fontSize.md, fontFamily: 'PlusJakartaSans_700Bold' },
  refundLabel: { marginRight: spacing.xs },
  list: { paddingBottom: 100 },
  fab: {
    position: 'absolute',
    right: spacing.base,
    bottom: spacing.xl,
  },
});
