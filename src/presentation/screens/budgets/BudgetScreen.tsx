/**
 * BudgetScreen — zero-based budget overview.
 *
 * Shows a period switcher, BudgetBalanceBanner, then envelope list grouped
 * into "Income" and "Expenses" sections (spec §Zero-based budgeting).
 *
 * VAL2-4: `useEnvelopes` already works for any period, but this screen used
 * to be pinned to the current one. A past period is browsable but READ-ONLY
 * (no FAB, no edit, a "Viewing <range>" banner) — Next is disabled at the
 * current period.
 *
 * Duplicate-EMF banner also shown at top when the reconcile flag is set.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  SectionList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { FAB, IconButton, Surface, Text } from 'react-native-paper';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { BudgetBalanceBanner } from './components/BudgetBalanceBanner';
import { DuplicateEmfBanner } from './components/DuplicateEmfBanner';
import { MonthlyIncomeCard } from './components/MonthlyIncomeCard';
import { BudgetEnvelopeRow } from './components/BudgetEnvelopeRow';
import { IncomeEnvelopeRow } from './components/IncomeEnvelopeRow';
import { RolloverWizard } from './RolloverWizard';
import { computeSpentDeltaVsPreviousPeriod } from './computeSpentDeltaVsPreviousPeriod';
import { EmptyState } from '../../components/shared/EmptyState';
import { RefreshingBar } from '../../components/shared/RefreshingBar';
import { SectionHeader } from '../../components/shared/SectionHeader';
import { EnvelopeDetailSheet } from '../dashboard/components/EnvelopeDetailSheet';
import { usePersistentEnvelopeSavings } from '../../hooks/usePersistentEnvelopeSavings';
import { useReloadOnSync } from '../../hooks/useReloadOnSync';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useAppStore } from '../../stores/appStore';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../../domain/shared/BudgetPeriodEngine';
import {
  getPreviousPeriod,
  getNextPeriod,
  isCurrentOrFuturePeriod,
} from '../transactions/periodNavigation';
import { findLatestPeriodWithEnvelopes } from '../dashboard/findLatestPeriodWithEnvelopes';
import { db } from '../../../data/local/db';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { DashboardStackParamList } from '../../navigation/types';
import { getEnvelopeScope } from '../../../domain/envelopes/EnvelopeEntity';
import type { BudgetPeriod } from '../../../domain/shared/types';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

const engine = new BudgetPeriodEngine();

/** Matches the dashboard's own persistent-envelope section heading. */
const SAVINGS_SECTION_TITLE = 'Savings & funds';

type Nav = NativeStackNavigationProp<DashboardStackParamList>;

export const BudgetScreen: React.FC = () => {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);

  const currentPeriod = engine.getCurrentPeriod(paydayDay);
  const currentPeriodStart = formatPeriodDateKey(currentPeriod.startDate);

  const [viewedPeriod, setViewedPeriod] = useState<BudgetPeriod>(currentPeriod);
  const viewedPeriodStart = formatPeriodDateKey(viewedPeriod.startDate);
  const isPastPeriod = !isCurrentOrFuturePeriod(paydayDay, viewedPeriod);
  const nextDisabled = isCurrentOrFuturePeriod(paydayDay, viewedPeriod);
  const viewedPeriodLabel = format(viewedPeriod.startDate, 'MMMM yyyy');
  const viewedPeriodRange = `${format(viewedPeriod.startDate, 'd MMM')} – ${format(viewedPeriod.endDate, 'd MMM yyyy')}`;

  const previousOfViewed = useMemo(
    () => getPreviousPeriod(paydayDay, viewedPeriod),
    [paydayDay, viewedPeriod],
  );
  const previousOfViewedStart = formatPeriodDateKey(previousOfViewed.startDate);

  const handlePreviousPeriod = useCallback((): void => {
    setViewedPeriod((current) => getPreviousPeriod(paydayDay, current));
  }, [paydayDay]);

  const handleNextPeriod = useCallback((): void => {
    setViewedPeriod((current) =>
      isCurrentOrFuturePeriod(paydayDay, current) ? current : getNextPeriod(paydayDay, current),
    );
  }, [paydayDay]);

  const { envelopes, loading, refreshing, error, reload } = useEnvelopes(
    householdId,
    viewedPeriodStart,
  );
  // "vs previous month" delta (VAL2-4) — matched by name + type, since a
  // PERIOD-scoped envelope gets a fresh id every period. Read-only lookup,
  // never mutated here.
  const { envelopes: previousEnvelopes } = useEnvelopes(householdId, previousOfViewedStart);
  const { savedCentsByEnvelopeId, reload: reloadSavings } =
    usePersistentEnvelopeSavings(householdId);

  const [showRollover, setShowRollover] = useState(false);
  const [rolloverFromPeriodStart, setRolloverFromPeriodStart] = useState(currentPeriodStart);
  const [selectedEnvelope, setSelectedEnvelope] = useState<EnvelopeEntity | null>(null);

  // The saved balances come from their own hook: reload them wherever the
  // envelopes reload (focus, pull-to-refresh) and when a sync round lands, or
  // a contribution pulled from the other phone leaves a stale "saved" figure.
  const reloadAll = useCallback(async (): Promise<void> => {
    await Promise.all([reload(), reloadSavings()]);
  }, [reload, reloadSavings]);

  useFocusEffect(
    useCallback(() => {
      void reloadAll();
    }, [reloadAll]),
  );
  useReloadOnSync(reloadSavings);

  // Looks up the latest earlier period that actually has envelopes and opens
  // the rollover wizard from it (UX-1/DOM-2/VAL-2); if none exists (brand-new
  // household), there is nothing to review/copy forward, so this goes
  // straight to creating a normal envelope instead. Always targets the
  // CURRENT period — rolling forward into a period being browsed in the past
  // would not make sense.
  const handleStartNewPeriod = useCallback((): void => {
    findLatestPeriodWithEnvelopes(db, householdId, currentPeriodStart).then((fromPeriod) => {
      if (fromPeriod) {
        setRolloverFromPeriodStart(fromPeriod);
        setShowRollover(true);
      } else {
        navigation.navigate('AddEditEnvelope', {});
      }
    });
  }, [householdId, currentPeriodStart, navigation]);

  const handleRolloverDone = useCallback((): void => {
    setShowRollover(false);
    void reload();
  }, [reload]);

  const handleCloseEnvelopeDetail = useCallback((): void => {
    setSelectedEnvelope(null);
  }, []);

  const handleAddTransactionForEnvelope = useCallback(
    (envelopeId: string): void => {
      setSelectedEnvelope(null);
      navigation.navigate('AddTransaction', { envelopeId });
    },
    [navigation],
  );

  const handleOpenTransaction = useCallback(
    (transactionId: string): void => {
      setSelectedEnvelope(null);
      navigation.navigate('AddTransaction', { transactionId });
    },
    [navigation],
  );

  const handleEditEnvelope = useCallback(
    (envelopeId: string): void => {
      setSelectedEnvelope(null);
      navigation.navigate('AddEditEnvelope', { envelopeId });
    },
    [navigation],
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

  // Group envelopes into Income / Expenses / Savings & funds sections.
  //
  // PERSISTENT envelopes (savings/sinking_fund/emergency_fund/baby_step) get
  // their own section rather than sitting among the period expenses: their
  // `spentCents` is an all-time withdrawal total and their `allocatedCents`
  // is this period's monthly contribution, so the allocated/spent/difference
  // comparison the Expenses rows show is meaningless for them (see
  // BudgetEnvelopeRow's header). This mirrors the dashboard's "Savings &
  // funds" section, which already separates them.
  const periodExpenseEnvelopes = useMemo(
    () => envelopes.filter((e) => e.envelopeType !== 'income' && getEnvelopeScope(e) === 'period'),
    [envelopes],
  );
  const persistentEnvelopes = useMemo(
    () => envelopes.filter((e) => getEnvelopeScope(e) === 'persistent'),
    [envelopes],
  );
  // Whether the period being viewed has any envelopes OF ITS OWN. Persistent
  // funds come back for EVERY period (they are never re-created), so a
  // household between periods still has a non-empty section list — which is
  // why the empty state's "Start this month's budget" CTA never appeared for
  // the one shape that needs it most: months of history, funds carried over,
  // nothing budgeted for this period yet.
  const hasPeriodScopedEnvelopes = incomeEnvelopes.length > 0 || periodExpenseEnvelopes.length > 0;
  const [earlierPeriodHasEnvelopes, setEarlierPeriodHasEnvelopes] = useState(false);

  useEffect(() => {
    if (isPastPeriod || hasPeriodScopedEnvelopes) {
      setEarlierPeriodHasEnvelopes(false);
      return;
    }
    let cancelled = false;
    findLatestPeriodWithEnvelopes(db, householdId, currentPeriodStart)
      .then((fromPeriod) => {
        if (!cancelled) setEarlierPeriodHasEnvelopes(fromPeriod !== null);
      })
      .catch(() => {
        if (!cancelled) setEarlierPeriodHasEnvelopes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isPastPeriod, hasPeriodScopedEnvelopes, householdId, currentPeriodStart]);

  const sections = useMemo(() => {
    const result = [];
    if (incomeEnvelopes.length > 0) {
      result.push({ title: 'Income', data: incomeEnvelopes });
    }
    if (periodExpenseEnvelopes.length > 0) {
      result.push({ title: 'Expenses', data: periodExpenseEnvelopes });
    }
    if (persistentEnvelopes.length > 0) {
      result.push({ title: SAVINGS_SECTION_TITLE, data: persistentEnvelopes });
    }
    return result;
  }, [incomeEnvelopes, periodExpenseEnvelopes, persistentEnvelopes]);

  if (loading && envelopes.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Surface style={[styles.periodRow, { backgroundColor: colors.surface }]} elevation={0}>
        <IconButton
          icon="chevron-left"
          onPress={handlePreviousPeriod}
          testID="budget-period-prev"
          accessibilityLabel="Previous period"
        />
        <Text
          variant="titleMedium"
          style={{ color: colors.onSurface }}
          testID="budget-period-label"
        >
          {viewedPeriodLabel}
        </Text>
        <IconButton
          icon="chevron-right"
          onPress={handleNextPeriod}
          disabled={nextDisabled}
          testID="budget-period-next"
          accessibilityLabel="Next period"
        />
      </Surface>
      <RefreshingBar refreshing={refreshing} />

      {isPastPeriod && (
        <View
          style={[styles.pastBanner, { backgroundColor: colors.surfaceVariant }]}
          testID="budget-past-period-banner"
        >
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            {`Viewing ${viewedPeriodRange}`}
          </Text>
        </View>
      )}

      {/* Duplicate-EMF banner (shown only when flag is set) */}
      <DuplicateEmfBanner />

      {/* This month's income — always visible so it can be set/updated per month */}
      <MonthlyIncomeCard
        incomeCents={incomeTotalCents}
        hasIncome={incomeEnvelopes.length > 0}
        onSetIncome={handleSetIncome}
        readOnly={isPastPeriod}
      />

      {/* Budget balance banner */}
      <BudgetBalanceBanner envelopes={envelopes} />

      {/* Between periods: this period has nothing budgeted yet, but an
          earlier one does. Offered once, inline, as a plain action — the
          RolloverWizard's own auto-open (dashboard) stays gated by the
          period-ack key and the session snooze, so this is the way back in
          after a dismissal, not a second nag. Hidden once the period has
          envelopes of its own, and when the empty state below is already
          carrying the same CTA. */}
      {earlierPeriodHasEnvelopes && sections.length > 0 && (
        <View
          style={[styles.startPeriodBanner, { backgroundColor: colors.primaryContainer }]}
          testID="budget-start-period-banner"
        >
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            {`Nothing is budgeted for ${viewedPeriodLabel} yet.`}
          </Text>
          <TouchableOpacity
            onPress={handleStartNewPeriod}
            testID="budget-start-new-period-button"
            accessibilityRole="button"
            accessibilityLabel="Start this period from last period's budget"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text variant="titleSmall" style={{ color: colors.primary }}>
              Start this period from last period&apos;s budget
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {error ? (
        <EmptyState
          title="Couldn't load your budget"
          body={error}
          testID="budget-empty-state"
          ctaLabel="Retry"
          onCta={() => void reload()}
        />
      ) : sections.length === 0 ? (
        <EmptyState
          title="No envelopes yet"
          body={
            isPastPeriod
              ? `No envelopes were set up for ${viewedPeriodLabel}.`
              : "You haven't set up this month's budget yet."
          }
          testID="budget-empty-state"
          ctaLabel={isPastPeriod ? undefined : "Start this month's budget"}
          onCta={isPastPeriod ? undefined : handleStartNewPeriod}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item, section }) =>
            section.title === SAVINGS_SECTION_TITLE ? (
              <BudgetEnvelopeRow
                envelope={item}
                deltaCents={null}
                savedCents={savedCentsByEnvelopeId.get(item.id) ?? 0}
                onPress={isPastPeriod ? undefined : () => setSelectedEnvelope(item)}
                testID={`envelope-card-${item.name}`}
              />
            ) : section.title === 'Expenses' ? (
              <BudgetEnvelopeRow
                envelope={item}
                deltaCents={computeSpentDeltaVsPreviousPeriod(item, previousEnvelopes)}
                onPress={isPastPeriod ? undefined : () => setSelectedEnvelope(item)}
                testID={`envelope-card-${item.name}`}
              />
            ) : (
              // MONEY IN: an income envelope's `spentCents` is the salary
              // that LANDED, not money spent — `EnvelopeCard` rendered that
              // as "R0,00 remaining, 0% remaining" in the error colour for a
              // household whose pay had simply arrived (see
              // IncomeEnvelopeRow). Same testID as before so the row is
              // still addressed the same way.
              <IncomeEnvelopeRow
                envelope={item}
                onPress={
                  isPastPeriod
                    ? undefined
                    : () => navigation.navigate('AddEditEnvelope', { envelopeId: item.id })
                }
                testID={`envelope-card-${item.name}`}
              />
            )
          }
          renderSectionHeader={({ section: { title } }) => (
            <SectionHeader title={title} showDivider />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            // REG-9: `loading` is first-load-only — using it here meant the
            // platform pull-to-refresh spinner stopped reflecting an
            // in-flight reload the moment the first load finished.
            <RefreshControl
              refreshing={refreshing}
              onRefresh={reloadAll}
              colors={[colors.primary]}
            />
          }
          stickySectionHeadersEnabled={false}
        />
      )}

      {sections.length > 0 && !isPastPeriod && (
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
        toPeriodStart={currentPeriodStart}
        periodLabel={format(currentPeriod.startDate, 'MMMM yyyy')}
        onDone={handleRolloverDone}
      />

      <EnvelopeDetailSheet
        visible={selectedEnvelope !== null}
        envelope={selectedEnvelope}
        householdId={householdId}
        savedCentsByEnvelopeId={savedCentsByEnvelopeId}
        currentPeriodStart={currentPeriodStart}
        onDismiss={handleCloseEnvelopeDetail}
        onAddTransaction={handleAddTransactionForEnvelope}
        onOpenTransaction={handleOpenTransaction}
        onEditEnvelope={handleEditEnvelope}
        onSavedAmountAdjusted={reloadSavings}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  list: { paddingBottom: spacing.xxl + 56 + spacing.md },
  fab: { position: 'absolute', right: spacing.base, bottom: spacing.xl },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  startPeriodBanner: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: spacing.sm,
    gap: spacing.xs,
  },
  pastBanner: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
});
