import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { FAB } from 'react-native-paper';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { RolloverWizard } from '../budgets/RolloverWizard';
import { useAppStore } from '../../stores/appStore';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useBabySteps } from '../../hooks/useBabySteps';
import { useDebts } from '../../hooks/useDebts';
import { usePersistentEnvelopeSavings } from '../../hooks/usePersistentEnvelopeSavings';
import { useSyncEngineStore } from '../../stores/syncEngineStore';
import { useReloadOnSync } from '../../hooks/useReloadOnSync';
import { EmptyState } from '../../components/shared/EmptyState';
import { RefreshingBar } from '../../components/shared/RefreshingBar';
import { LoadingSkeletonList } from '../../components/shared/LoadingSkeletonList';
import { LoadingSplash } from '../../components/shared/LoadingSplash';
import { BudgetRingCard } from './components/BudgetRingCard';
import { BabyStepsBar } from './components/BabyStepsBar';
import { ScoreBreakdownDialog } from './components/ScoreBreakdownDialog';
import { PreviousPeriodSummaryCard } from './components/PreviousPeriodSummaryCard';
import { ScoreProgressCard } from '../../components/scoreProgress/ScoreProgressCard';
import { P } from './palette';
import { selectSpendEnvelopes } from './selectSpendEnvelopes';
import {
  findLatestPeriodWithEnvelopes,
  hasPeriodScopedEnvelopeAfter,
} from './findLatestPeriodWithEnvelopes';
import { resolveMeterReadingsLogged } from './resolveMeterReadingsLogged';
import { resolveMetersApplicable } from '../../../domain/scoring/resolveMetersApplicable';
import { calculateSafeToSpendToday } from './calculateSafeToSpendToday';
import { sortEnvelopesByUsageDescending } from './sortEnvelopesByUsageDescending';
import { EnvelopeDetailSheet } from './components/EnvelopeDetailSheet';
import { getPreviousPeriod } from '../transactions/periodNavigation';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../../domain/shared/BudgetPeriodEngine';
import { HabitScoreCalculator } from '../../../domain/scoring/RamseyScoreCalculator';
import { buildHabitScoreInput } from '../../../domain/scoring/buildHabitScoreInput';
import { resolveBabyStepIsActive } from '../../../domain/shared/resolveBabyStepIsActive';
import { resolveLoggingDays } from '../../../domain/scoring/resolveLoggingDays';
import { calculateBudgetBalance } from '../../../domain/budgets/BudgetBalanceCalculator';
import { summariseEnvelopePeriodMoney } from '../../../domain/transactions/moneyDirection';
import { getEnvelopeScope } from '../../../domain/envelopes/EnvelopeEntity';
import { SnowballPayoffProjector } from '../../../domain/debtSnowball/SnowballPayoffProjector';
import { formatCurrency } from '../../utils/currency';
import { useAppTheme } from '../../theme/useAppTheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, radius, fontSize } from '../../theme/tokens';
import { format, differenceInDays, parseISO } from 'date-fns';
import { db } from '../../../data/local/db';
import { useLevelAdvancement } from '../../hooks/useLevelAdvancement';
import { logger } from '../../../infrastructure/logging/Logger';
import type { DashboardScreenProps } from '../../navigation/types';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

const engine = new BudgetPeriodEngine();
const scoreCalculator = new HabitScoreCalculator();
const debtProjector = new SnowballPayoffProjector();

const GRAD_DARK = ['#071A16', '#0C1D2B', '#081420'] as const;

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigation }) => {
  // Uses the app's in-app Light/Dark preference (`useAppTheme`), not the raw
  // OS scheme — otherwise the home screen ignores a user override of the
  // system setting (UX-11).
  const { dark: isDark, colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const householdId = useAppStore((s) => s.householdId);
  const paydayDay = useAppStore((s) => s.paydayDay);

  const period = engine.getCurrentPeriod(paydayDay);
  // `periodStart`/`previousPeriodStart`/`periodEnd` (below) are SCOPE KEYS —
  // exact-match query params and the seed for the deterministic rollover id
  // — so they must read `period.startDate`'s UTC calendar fields, matching
  // how `BudgetPeriodEngine` built the Date via `Date.UTC(...)`.
  // `date-fns format()` reads the HOST's LOCAL calendar fields instead, which
  // is off by one day on UTC-negative devices and silently misses the
  // period's own rows (L7, 2026-07-05 audit). `periodLabel` below is a pure
  // DISPLAY string (not a key), so it correctly keeps using local `format()`.
  const periodStart = formatPeriodDateKey(period.startDate);
  const periodEnd = formatPeriodDateKey(period.endDate);
  const periodLabel = format(period.startDate, 'MMMM yyyy');

  const hid = householdId ?? '';
  const envelopesResult = useEnvelopes(hid, periodStart);
  const { envelopes, loading, error, reload } = envelopesResult;
  // `refreshing` (reload-in-flight over data already on screen, vs `loading`
  // = first-load-only) is a newer field on `useEnvelopes` — read it
  // optionally so this keeps working against an older shape of the hook too.
  const refreshing =
    ('refreshing' in envelopesResult ? envelopesResult.refreshing : undefined) ?? loading;
  const { statuses: babyStepStatuses } = useBabySteps(hid, periodStart);
  // Compact "Debt-free by …" header line (VAL2-10) — household-level, not
  // period-scoped, so this is the same live debt list the Snowball tab
  // shows. Projected with 0 extra payment, matching the plan the dashboard
  // has no input for.
  const { debts } = useDebts(hid);
  const unpaidDebtsCount = useMemo(() => debts.filter((d) => !d.isPaidOff).length, [debts]);
  const debtFreeDate = useMemo(() => debtProjector.project(debts, 0).debtFreeDate, [debts]);
  const handleDebtLinePress = useCallback((): void => {
    navigation.navigate('Snowball');
  }, [navigation]);
  // Persistent envelopes' (savings/emergency_fund/sinking_fund/baby_step)
  // real saved balance — never `allocatedCents - spentCents`, since
  // `allocatedCents` on those rows is this period's MONTHLY CONTRIBUTION and
  // `spentCents` is their ALL-TIME spend, not this period's. This hook's own
  // reload also runs the idempotent legacy opening-balance backfill
  // (`ensureOpeningBalances`), so calling it on focus below is what gets a
  // legacy household its opening balance without opening Baby Steps first.
  const { savedCentsByEnvelopeId, reload: reloadSavings } = usePersistentEnvelopeSavings(hid);

  const scheduler = useSyncEngineStore((s) => s.scheduler);

  const { hydrate: hydrateLevel } = useLevelAdvancement();
  // Derives the current level from `hid`'s durable local score_history on
  // every household change (including the initial cold-start mount) —
  // `appStore.userLevel` is in-memory only, so without this Settings shows a
  // stale/default Lv1 badge until the next rollover happens to call
  // `check()` again. Best-effort: a read failure here must never break the
  // dashboard, so it's swallowed to the app logger, not surfaced to the user.
  useEffect(() => {
    if (!hid) return;
    let cancelled = false;
    hydrateLevel(hid).catch((err: unknown) => {
      if (!cancelled) logger.error('DashboardScreen: failed to hydrate user level', err, { hid });
    });
    return () => {
      cancelled = true;
    };
  }, [hid, hydrateLevel]);

  const [babyStepIsActive, setBabyStepIsActive] = useState(false);
  const [loggingDaysCount, setLoggingDaysCount] = useState(0);
  const [meterReadingsLoggedThisPeriod, setMeterReadingsLoggedThisPeriod] = useState(false);
  // Whether the meters part of the score applies at all: a household that has
  // never logged a reading is scored on the rest, re-normalised — the same rule
  // every CLOSED period is scored by, so the live number and the trend agree.
  const [metersApplicable, setMetersApplicable] = useState(true);
  const [showRollover, setShowRollover] = useState(false);
  const [rolloverFromPeriodStart, setRolloverFromPeriodStart] = useState(periodStart);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
  // Envelope tapped from the dashboard list — opens `EnvelopeDetailSheet`
  // instead of navigating straight to the edit form (VAL-9): the everyday
  // need is "what did we spend here / add a transaction here".
  const [selectedEnvelope, setSelectedEnvelope] = useState<EnvelopeEntity | null>(null);
  // Whether an EARLIER period actually has envelopes to roll forward — drives
  // the empty state's copy/CTA (UX2-8) independently of whether the wizard
  // auto-opened (it may not have, e.g. this period was already dismissed
  // this session). Recomputed whenever the current period has no spend
  // envelopes of its own.
  const [earlierPeriodHasEnvelopes, setEarlierPeriodHasEnvelopes] = useState(false);
  // WHICH earlier period that is. A household with 18 months of history whose
  // current period has no envelopes yet (opened the app after payday, before
  // rolling over) must not see a blank dashboard: this is what lets the
  // empty state show LAST period's headline numbers beside the "start this
  // period" action, instead of nothing at all. Null whenever the current
  // period has envelopes of its own — the second `useEnvelopes` below is
  // then a no-op read.
  const [earlierPeriodStart, setEarlierPeriodStart] = useState<string | null>(null);
  // Last budgeted period's rows — loaded ONLY once `earlierPeriodStart` is
  // known, i.e. only in the state this card exists for. Passing an empty
  // household id otherwise keeps this a no-op rather than a wasted query on
  // every ordinary dashboard load.
  const { envelopes: previousPeriodEnvelopes } = useEnvelopes(
    earlierPeriodStart ? hid : '',
    earlierPeriodStart ?? '',
  );
  const previousPeriodMoney = useMemo(
    () => summariseEnvelopePeriodMoney(previousPeriodEnvelopes),
    [previousPeriodEnvelopes],
  );
  // A period label is a pure DISPLAY string, so local `format` is right here
  // (unlike the scope KEYS above, which must read UTC calendar fields).
  const previousPeriodLabel = earlierPeriodStart
    ? format(parseISO(earlierPeriodStart), 'MMMM yyyy')
    : '';
  // Session-level "don't reopen the rollover wizard for this period" snooze
  // (UX2-2). Deliberately a ref, NOT AsyncStorage: it must come back on the
  // next app launch, when a fresh look at an unacknowledged period is right
  // again. `RolloverWizard`'s `onDone` fires identically whether the user
  // actually committed a rollover or just dismissed without doing anything —
  // if a rollover WAS committed, the `periodScopedCount > 0` check below
  // already keeps the wizard closed on its own; this is what stops it
  // reopening on the very next reload/focus/sync round when it wasn't.
  const dismissedRolloverPeriodsRef = useRef<Set<string>>(new Set());

  useFocusEffect(
    useCallback((): (() => void) => {
      let cancelled = false;
      void reload();
      // Idempotent (deterministic contribution ids) and swallows its own
      // errors into its `error` state — safe to call once per focus.
      void reloadSavings();
      resolveBabyStepIsActive(db, hid).then((isActive) => {
        if (!cancelled) setBabyStepIsActive(isActive);
      });
      resolveLoggingDays(db, hid, periodStart, periodEnd).then((days) => {
        if (!cancelled) setLoggingDaysCount(days);
      });
      resolveMeterReadingsLogged(db, hid, periodStart, periodEnd).then((logged) => {
        if (!cancelled) setMeterReadingsLoggedThisPeriod(logged);
      });
      resolveMetersApplicable(db, hid, periodEnd)
        .then((applicable) => {
          if (!cancelled) setMetersApplicable(applicable);
        })
        .catch(() => {
          // Keep the last known answer; the score still renders.
        });
      return () => {
        cancelled = true;
      };
    }, [reload, reloadSavings, hid, periodStart, periodEnd]),
  );

  // Show the rollover wizard once the current period is confirmed to have no
  // period-scoped envelopes of its own (spending/income/utility — persistent
  // envelopes like savings/baby-step always carry over and don't count here),
  // some earlier period actually has some to roll forward, and the user
  // hasn't already acknowledged this period. Runs off the loaded envelope
  // list (not a payday-proximity window), so it stays reachable no matter how
  // long it's been since payday or how many periods were skipped.
  useEffect(() => {
    if (!hid || loading) return;
    const periodScopedCount = envelopes.filter((e) => getEnvelopeScope(e) === 'period').length;
    if (periodScopedCount > 0) {
      setEarlierPeriodHasEnvelopes(false);
      setEarlierPeriodStart(null);
      return;
    }

    let cancelled = false;

    // Independent of the ack/snooze/stale-payday gates below: the empty
    // state (UX2-8) needs to know whether an earlier period has envelopes at
    // all, regardless of whether the wizard is ALLOWED to auto-open right
    // now.
    findLatestPeriodWithEnvelopes(db, hid, periodStart).then((fromPeriod) => {
      if (cancelled) return;
      setEarlierPeriodHasEnvelopes(fromPeriod !== null);
      setEarlierPeriodStart(fromPeriod);
    });

    if (dismissedRolloverPeriodsRef.current.has(periodStart)) return;

    const rolloverKey = `period_ack_${periodStart}`;
    AsyncStorage.getItem(rolloverKey).then((ack) => {
      if (cancelled || ack !== null || dismissedRolloverPeriodsRef.current.has(periodStart)) {
        return;
      }
      // Belt: a stale payday can leave `periodStart` pointing at the wrong,
      // empty period even though the household already has period-scoped
      // envelopes for something LATER than the period right before it —
      // that's a mis-keyed read, not a genuine new empty period, so don't
      // auto-open on top of it (the source is being fixed elsewhere).
      const currentPeriod = engine.getCurrentPeriod(paydayDay);
      const previousPeriodStart = formatPeriodDateKey(
        getPreviousPeriod(paydayDay, currentPeriod).startDate,
      );
      hasPeriodScopedEnvelopeAfter(db, hid, previousPeriodStart).then((staleGuardTripped) => {
        if (cancelled || staleGuardTripped) return;
        findLatestPeriodWithEnvelopes(db, hid, periodStart).then((fromPeriod) => {
          if (cancelled || !fromPeriod) return;
          setRolloverFromPeriodStart(fromPeriod);
          setShowRollover(true);
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [hid, loading, envelopes, periodStart, paydayDay]);

  // The wizard itself writes the `period_ack_${toPeriodStart}` key on commit
  // (see RolloverWizard) — this closes the wizard, refreshes the envelope
  // list so any newly-copied-forward envelopes show up immediately, and
  // snoozes re-opening for this period for the rest of the session (UX2-2).
  // Runs on a plain dismiss too — `RolloverWizard` calls the same `onDone`
  // either way — which is exactly what the snooze is for.
  const handleRolloverDone = useCallback((): void => {
    dismissedRolloverPeriodsRef.current.add(periodStart);
    setShowRollover(false);
    void reload();
  }, [reload, periodStart]);

  // Manually opens the rollover wizard from the empty-state "Start this
  // month's budget" button, looking up the correct fromPeriodStart on demand
  // rather than relying on the auto-detect effect above having already run.
  const handleStartNewPeriod = useCallback((): void => {
    if (!hid) return;
    findLatestPeriodWithEnvelopes(db, hid, periodStart).then((fromPeriod) => {
      if (fromPeriod) {
        setRolloverFromPeriodStart(fromPeriod);
        setShowRollover(true);
      } else {
        // No earlier period ever had envelopes (brand-new household) —
        // nothing to review/copy forward, so go straight to creating one.
        navigation.navigate('AddEditEnvelope', {});
      }
    });
  }, [hid, periodStart, navigation]);

  // Reloads after a manual pull-to-refresh AND after the background sync
  // scheduler actually completes a round (VAL-5) — consumed read-only via
  // the shared sync stores/engine, never mutated here.
  const handleRefresh = useCallback((): void => {
    if (hid) scheduler?.requestSync(hid, { immediate: true });
    void reload();
  }, [scheduler, hid, reload]);

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

  const handleEditEnvelope = useCallback(
    (envelopeId: string): void => {
      setSelectedEnvelope(null);
      navigation.navigate('AddEditEnvelope', { envelopeId });
    },
    [navigation],
  );

  // A transaction row tapped inside the detail sheet (UX2-7) — opens it for
  // editing, then closes the sheet.
  const handleOpenTransaction = useCallback(
    (transactionId: string): void => {
      setSelectedEnvelope(null);
      navigation.navigate('AddTransaction', { transactionId });
    },
    [navigation],
  );

  // Envelopes already reload on sync inside `useEnvelopes`; the savings ledger
  // does not, so a partner's rollover contribution would otherwise stay stale.
  useReloadOnSync(reloadSavings);

  // ── Derived values ────────────────────────────────────────────────────────
  // Spend-side envelopes only (excludes 'income') — see selectSpendEnvelopes
  // for why mixing income allocations into these totals double-counts money
  // coming IN as if it were budgeted OUT (DOM-5/UX-4/VAL-1).
  const spendEnvelopes = useMemo(() => selectSpendEnvelopes(envelopes), [envelopes]);
  // Split further into this-PERIOD spend envelopes (spending/utility) and
  // PERSISTENT envelopes (savings/emergency_fund/sinking_fund/baby_step).
  // Persistent envelopes' `spentCents` (from `useEnvelopes`) is an ALL-TIME
  // figure, not this period's — mixing it into "Spent" would make the ring
  // count years of a fund's spend as if it happened this period. They still
  // contribute their monthly `allocatedCents` to "Budget" (money assigned out
  // of this period's income), and get their own "Savings & funds" section
  // below the main envelope list, showing their real SAVED balance.
  const budgetSpendEnvelopes = useMemo(
    () => spendEnvelopes.filter((e) => getEnvelopeScope(e) === 'period'),
    [spendEnvelopes],
  );
  const persistentEnvelopes = useMemo(
    () => spendEnvelopes.filter((e) => getEnvelopeScope(e) === 'persistent'),
    [spendEnvelopes],
  );
  // UX2-17: overspent-first ordering for the visible list, kept separate
  // from `budgetSpendEnvelopes` (which still feeds totals/score input, where
  // order doesn't matter) so this is a pure display concern.
  const sortedBudgetSpendEnvelopes = useMemo(
    () => sortEnvelopesByUsageDescending(budgetSpendEnvelopes),
    [budgetSpendEnvelopes],
  );
  const budgetBalance = useMemo(() => calculateBudgetBalance(envelopes), [envelopes]);
  const hasIncome = envelopes.some((e) => e.envelopeType === 'income');

  const totalAllocated = spendEnvelopes.reduce((s, e) => s + e.allocatedCents, 0);
  const totalSpent = budgetSpendEnvelopes.reduce((s, e) => s + e.spentCents, 0);
  const daysRemaining = Math.max(0, differenceInDays(period.endDate, new Date()));
  const totalDaysInPeriod = differenceInDays(period.endDate, period.startDate) + 1;

  // "Safe to spend today" — period-scoped spend envelopes only (persistent
  // envelopes' monthly contribution isn't money left to spend day-to-day).
  const periodSpendRemainingCents = budgetSpendEnvelopes.reduce(
    (s, e) => s + (e.allocatedCents - e.spentCents),
    0,
  );
  const safeToSpendTodayCents = calculateSafeToSpendToday(periodSpendRemainingCents, daysRemaining);

  // Assembly extracted to `buildHabitScoreInput` (VAL-14/DOM-13) so the
  // dashboard's LIVE score and `RecordPeriodScoreUseCase`'s CLOSING-period
  // score (computed in RolloverWizard on commit) share the exact same "on
  // budget" rule instead of two copies that could silently drift apart.
  const scoreResult = scoreCalculator.calculate(
    buildHabitScoreInput({
      loggingDaysCount,
      totalDaysInPeriod,
      envelopes: budgetSpendEnvelopes,
      meterReadingsLoggedThisPeriod,
      metersApplicable,
      babyStepIsActive,
    }),
  );

  // ── Theme-derived colors ──────────────────────────────────────────────────
  const cardBg = isDark ? P.tileBgDark : '#FFFFFF';
  const cardBorder = isDark ? P.tileBorderDark : P.tileBorderLight;
  // UX2-6: secondary labels ("Spent"/"Budget"/"X left"/"%"/the safe-to-spend
  // caption) used to hard-code `P.statLabel` in dark mode — rgba(160,210,190,
  // 0.40) on #071A16 is ~2.7:1, well under the ~4.5:1 body-text contrast
  // floor. `colors.onSurfaceVariant` is the theme's own secondary-text token
  // and is tuned for contrast in both modes.
  const labelColor = colors.onSurfaceVariant;
  const valueColor = isDark ? 'rgba(220,245,235,0.90)' : '#1A2E28';
  const accentColor = isDark ? P.accent : '#00695C';
  const fabBg = isDark ? '#00895A' : '#00695C';
  const sectionTitleColor = isDark ? 'rgba(180,225,210,0.65)' : '#1A2E28';

  // ── List header ───────────────────────────────────────────────────────────
  const ListHeader = useMemo(
    () => (
      <View>
        {/* Period + days row */}
        <View style={styles.periodRow}>
          <Text style={[styles.periodLabel, { color: valueColor }]}>{periodLabel}</Text>
          <Text style={[styles.daysTag, { color: labelColor }]}>{daysRemaining}d remaining</Text>
        </View>

        {/* Compact debt-free line (VAL2-10) — only while there is at least
            one unpaid debt; tapping it jumps to the Snowball tab. */}
        {unpaidDebtsCount > 0 && debtFreeDate && (
          <TouchableOpacity
            style={styles.debtLineRow}
            onPress={handleDebtLinePress}
            testID="dashboard-debt-line"
            accessibilityRole="button"
            accessibilityLabel={`Debt-free by ${format(debtFreeDate, 'MMMM yyyy')}. View debt payoff plan.`}
          >
            <MaterialCommunityIcons name="snowflake" size={16} color={accentColor} />
            <Text style={[styles.debtLineText, { color: labelColor }]}>
              {`Debt-free by ${format(debtFreeDate, 'MMM yyyy')}`}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={16} color={labelColor} />
          </TouchableOpacity>
        )}

        {/* Budget ring — only when THIS PERIOD's spend envelopes exist.
            Gating on `spendEnvelopes` (which also counts persistent
            savings/funds) put a ring, a Spent/Budget stat row and a
            safe-to-spend card directly above the "you haven't set up this
            month's spending yet" empty state, for a household whose only
            envelopes are funds. That empty state is driven by
            `budgetSpendEnvelopes`, so this gate must be too. The "Savings &
            funds" section lives in ListFooter and is unaffected. */}
        {budgetSpendEnvelopes.length > 0 && (
          <View style={styles.ringSection}>
            <BudgetRingCard
              totalAllocatedCents={totalAllocated}
              totalSpentCents={totalSpent}
              daysRemaining={daysRemaining}
              score={scoreResult.score}
              testID="dashboard-kpi-row"
            />

            {/* Spent / Budget / Score stat row */}
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={[styles.statLabel, { color: labelColor }]}>Spent</Text>
                <Text
                  style={[styles.statValue, { color: valueColor }]}
                  testID="dashboard-stat-spent-value"
                >
                  {formatCurrency(totalSpent)}
                </Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: cardBorder }]} />
              <View style={styles.stat}>
                <Text style={[styles.statLabel, { color: labelColor }]}>Budget</Text>
                <Text
                  style={[styles.statValue, { color: valueColor }]}
                  testID="dashboard-stat-budget-value"
                >
                  {formatCurrency(totalAllocated)}
                </Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: cardBorder }]} />
              <TouchableOpacity
                style={styles.stat}
                onPress={() => setShowScoreBreakdown(true)}
                testID="score-stat"
                accessibilityRole="button"
                accessibilityLabel={`Habit score ${scoreResult.score} out of 100. Tap for a breakdown.`}
              >
                <Text style={[styles.statLabel, { color: labelColor }]}>Score</Text>
                <Text style={[styles.statValue, { color: accentColor }]}>{scoreResult.score}</Text>
              </TouchableOpacity>
            </View>

            {/* "Safe to spend today" — the period-scoped spend envelopes'
                remaining budget spread over the days left, so the household
                sees one daily number instead of doing the division
                themselves against "Remaining" and days-left. Its own small
                card directly under the ring (UX2-6), not a caption-sized
                line lost among the stat row above it. */}
            <View
              style={[styles.safeToSpendCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
              testID="dashboard-safe-to-spend"
            >
              <Text style={[styles.safeToSpendLabel, { color: labelColor }]}>
                Safe to spend today
              </Text>
              <Text style={[styles.safeToSpendValue, { color: colors.primary }]}>
                {formatCurrency(safeToSpendTodayCents)}
              </Text>
              <Text style={[styles.safeToSpendCaption, { color: labelColor }]}>
                {`${formatCurrency(periodSpendRemainingCents)} left across ${budgetSpendEnvelopes.length} envelope${budgetSpendEnvelopes.length === 1 ? '' : 's'} · ${daysRemaining}d to payday`}
              </Text>
            </View>

            {/* Income / To assign — shown separately from the spend totals
                above (DOM-5/UX-4/VAL-1): income funds the budget, it isn't
                part of it. */}
            {hasIncome && (
              <View style={styles.incomeRow} testID="dashboard-income-row">
                <View style={styles.stat}>
                  <Text style={[styles.statLabel, { color: labelColor }]}>Income</Text>
                  <Text style={[styles.statValue, { color: valueColor }]}>
                    {formatCurrency(budgetBalance.incomeTotal)}
                  </Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: cardBorder }]} />
                <View style={styles.stat}>
                  <Text style={[styles.statLabel, { color: labelColor }]}>To assign</Text>
                  <Text
                    style={[
                      styles.statValue,
                      { color: budgetBalance.toAssign < 0 ? colors.error : valueColor },
                    ]}
                  >
                    {formatCurrency(budgetBalance.toAssign)}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Shortcut row — directly under the ring + safe-to-spend card
            (UX2-17), not buried below the full envelope list. */}
        <View style={styles.secondaryRow}>
          {[
            {
              icon: 'chart-line',
              label: 'Forecast',
              onPress: () => navigation.navigate('Forecast'),
              testID: 'forecast-entry',
            },
            {
              icon: 'piggy-bank-outline',
              label: 'Savings goals',
              onPress: () => navigation.navigate('SinkingFunds'),
              testID: 'sinking-funds-entry',
            },
            {
              icon: 'shoe-print',
              label: 'Baby steps',
              onPress: () => navigation.navigate('BabySteps'),
              testID: 'baby-steps-entry',
            },
            {
              icon: 'chart-donut',
              label: 'Budget',
              onPress: () => navigation.navigate('Budget'),
              testID: 'budget-entry',
            },
          ].map((btn) => (
            <TouchableOpacity
              key={btn.label}
              style={[styles.secondaryBtn, { backgroundColor: cardBg, borderColor: cardBorder }]}
              onPress={btn.onPress}
              activeOpacity={0.7}
              testID={btn.testID}
              accessibilityRole="button"
              accessibilityLabel={btn.label}
            >
              <MaterialCommunityIcons name={btn.icon} size={20} color={accentColor} />
              <Text style={[styles.secondaryLbl, { color: labelColor }]}>{btn.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Baby steps bar */}
        {babyStepStatuses.length > 0 && (
          <BabyStepsBar
            statuses={babyStepStatuses}
            onPress={() => navigation.navigate('BabySteps')}
          />
        )}

        {/* Envelope section header */}
        {budgetSpendEnvelopes.length > 0 && (
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>Envelopes</Text>
            <View style={styles.sectionHeadActions}>
              <TouchableOpacity
                onPress={() => navigation.navigate('AddEditEnvelope', {})}
                testID="add-envelope-header-button"
                accessibilityRole="button"
                accessibilityLabel="Add envelope"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.sectionSub, { color: accentColor }]}>+ Add</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => navigation.navigate('Budget')}
                testID="view-budget-link"
                accessibilityRole="link"
                accessibilityLabel="View full budget"
              >
                <Text style={[styles.sectionSub, { color: accentColor }]}>
                  {budgetSpendEnvelopes.length} active ›
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      budgetSpendEnvelopes.length,
      hasIncome,
      budgetBalance,
      totalAllocated,
      totalSpent,
      safeToSpendTodayCents,
      periodSpendRemainingCents,
      daysRemaining,
      scoreResult.score,
      isDark,
      colors,
      accentColor,
      cardBg,
      cardBorder,
      labelColor,
      periodLabel,
      babyStepStatuses,
      unpaidDebtsCount,
      debtFreeDate,
      handleDebtLinePress,
    ],
  );

  // ── List footer ───────────────────────────────────────────────────────────
  const ListFooter = useMemo(
    () => (
      <View>
        {/* Savings & funds — persistent envelopes (savings/emergency fund/
            sinking fund/baby step), shown under the main spending envelopes
            with their real SAVED balance (contribution ledger), never
            allocatedCents - spentCents (see usePersistentEnvelopeSavings). */}
        {persistentEnvelopes.length > 0 && (
          <View>
            <View style={styles.sectionHead}>
              <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>
                Savings & funds
              </Text>
            </View>
            <View style={styles.savingsList}>
              {persistentEnvelopes.map((env) => (
                <TouchableOpacity
                  key={env.id}
                  style={[styles.envelopeRow, { backgroundColor: cardBg, borderColor: cardBorder }]}
                  onPress={() => setSelectedEnvelope(env)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  testID={`persistent-envelope-${env.id}`}
                >
                  <View style={styles.envelopeInfo}>
                    <Text style={[styles.envelopeName, { color: valueColor }]} numberOfLines={1}>
                      {env.name}
                    </Text>
                    <Text style={[styles.envelopeAmt, { color: labelColor }]}>
                      {formatCurrency(savedCentsByEnvelopeId.get(env.id) ?? 0)} saved
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Habit score + level from CLOSED periods. In the footer, outside the
            ring gate above, on purpose: the ring's live score is hidden when
            the current period has no budget yet, which is exactly when a
            household with history most needs to see that it has any. */}
        <View style={styles.scoreProgress}>
          <ScoreProgressCard />
        </View>

        <View style={styles.bottomPad} />
      </View>
    ),
    [
      persistentEnvelopes,
      savedCentsByEnvelopeId,
      cardBg,
      cardBorder,
      valueColor,
      labelColor,
      sectionTitleColor,
    ],
  );

  // ── Empty / loading ───────────────────────────────────────────────────────
  const EmptyContent = useMemo(() => {
    if (loading) {
      return <LoadingSkeletonList count={4} testID="dashboard-loading" />;
    }

    // UX2-8: a load failure must read as a load failure, not "no envelopes" —
    // dropping `error` here used to make the two indistinguishable.
    if (error) {
      return (
        <View>
          <EmptyState
            title="Couldn't load your envelopes"
            body={error}
            testID="dashboard-error-state"
          />
          <TouchableOpacity
            style={[styles.newEnvBtn, { borderColor: cardBorder }]}
            onPress={() => void reload()}
            testID="dashboard-retry-button"
            accessibilityRole="button"
          >
            <Text style={[styles.newEnvBtnText, { color: accentColor }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Last period's headline numbers, so a household with months of history
    // never sees a screen with no figures on it at all while its new period
    // is unstarted. `receivedCents` is what the ledger actually recorded
    // against income envelopes; with no such rows it falls back to the
    // income the household BUDGETED, which is the only "money in" figure
    // that period has.
    const previousPeriodSummary =
      earlierPeriodStart === null ? null : (
        <PreviousPeriodSummaryCard
          periodLabel={previousPeriodLabel}
          spentCents={previousPeriodMoney.spentCents}
          allocatedCents={previousPeriodMoney.allocatedCents}
          receivedCents={
            previousPeriodMoney.receivedCents || previousPeriodMoney.expectedIncomeCents
          }
          backgroundColor={cardBg}
          borderColor={cardBorder}
          labelColor={labelColor}
          valueColor={valueColor}
          receivedColor={colors.success}
        />
      );

    // The rollover CTA, offered wherever an earlier period actually has
    // envelopes to carry forward. A button, not a nag: the wizard's
    // auto-open is separately gated by the period-ack key and the
    // session snooze, and dismissing it must still leave a visible way back
    // in — which, for a household whose only current-period rows are funds,
    // there previously was not.
    const startPeriodCta = (
      <TouchableOpacity
        style={[styles.newEnvBtn, { borderColor: cardBorder }]}
        onPress={handleStartNewPeriod}
        testID="start-new-period-button"
        accessibilityRole="button"
        accessibilityLabel="Start this period from last period's budget"
      >
        <Text style={[styles.newEnvBtnText, { color: accentColor }]}>
          Start this period from last period&apos;s budget
        </Text>
      </TouchableOpacity>
    );

    const addEnvelopeDemoted = (
      <TouchableOpacity
        onPress={() => navigation.navigate('AddEditEnvelope', {})}
        testID="new-envelope-button"
        accessibilityRole="button"
      >
        <Text style={[styles.newEnvBtnTextDemoted, { color: accentColor }]}>+ New envelope</Text>
      </TouchableOpacity>
    );

    // Savings/income exist this period but no spend envelopes — this is NOT
    // the "brand-new household" empty state, so it must not say "No
    // envelopes yet / Add your first envelope".
    if (envelopes.length > 0) {
      // …and when an earlier period DOES have envelopes, this household is
      // not "setting up" anything: it is between periods. Rolling forward is
      // the primary action, "+ New envelope" the demoted one. Without this
      // branch the one household shape that most needs the rollover — 18
      // months of history, funds carried over, no envelopes this period —
      // was offered only "+ New envelope".
      if (earlierPeriodHasEnvelopes) {
        return (
          <View>
            <EmptyState
              title="You haven't set up this month's spending yet"
              body="Copy last period's envelopes forward to get started."
              testID="dashboard-empty-state"
            />
            {startPeriodCta}
            {addEnvelopeDemoted}
            {previousPeriodSummary}
          </View>
        );
      }
      return (
        <View>
          <EmptyState
            title="You haven't set up this month's spending yet"
            testID="dashboard-empty-state"
          />
          <TouchableOpacity
            style={[styles.newEnvBtn, { borderColor: cardBorder }]}
            onPress={() => navigation.navigate('AddEditEnvelope', {})}
            testID="new-envelope-button"
            accessibilityRole="button"
          >
            <Text style={[styles.newEnvBtnText, { color: accentColor }]}>+ New envelope</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (earlierPeriodHasEnvelopes) {
      // A SINGLE contained CTA ("Start this period…"); "+ New envelope" is
      // demoted to a plain text button underneath it.
      return (
        <View>
          <EmptyState
            title="No envelopes yet"
            body="Copy last period's envelopes forward to get started."
            testID="dashboard-empty-state"
          />
          {startPeriodCta}
          {addEnvelopeDemoted}
          {previousPeriodSummary}
        </View>
      );
    }

    // Brand-new household — nothing to roll forward, so "+ New envelope" is
    // the single contained CTA.
    return (
      <View>
        <EmptyState
          title="No envelopes yet"
          body="Add your first envelope to get started"
          testID="dashboard-empty-state"
        />
        <TouchableOpacity
          style={[styles.newEnvBtn, { borderColor: cardBorder }]}
          onPress={() => navigation.navigate('AddEditEnvelope', {})}
          testID="new-envelope-button"
          accessibilityRole="button"
        >
          <Text style={[styles.newEnvBtnText, { color: accentColor }]}>+ New envelope</Text>
        </TouchableOpacity>
      </View>
    );
  }, [
    loading,
    error,
    reload,
    envelopes.length,
    earlierPeriodHasEnvelopes,
    earlierPeriodStart,
    previousPeriodLabel,
    previousPeriodMoney,
    handleStartNewPeriod,
    navigation,
    cardBg,
    cardBorder,
    accentColor,
    labelColor,
    valueColor,
    colors.success,
  ]);

  // ── Early return: no household ────────────────────────────────────────────
  if (!householdId) return <LoadingSplash />;

  // ── Envelope row renderer ─────────────────────────────────────────────────
  const renderItem = ({ item }: { item: EnvelopeEntity }): React.JSX.Element => {
    const remaining = item.allocatedCents - item.spentCents;
    const pct =
      item.allocatedCents > 0 ? Math.round((item.spentCents / item.allocatedCents) * 100) : 0;
    // REFUNDS: `spentCents` is a derived signed SUM, so a net-refunded
    // envelope (refunds exceeding purchases) makes `pct` NEGATIVE. The bar
    // below interpolates this straight into a `width: '<n>%'` style, and a
    // negative width percentage is an invalid RN style — so the BAR gets a
    // [0, 100] clamp while the text/accessibility figure stays the true one.
    const barPct = Math.min(100, Math.max(0, pct));
    const isOver = item.spentCents > item.allocatedCents;

    return (
      <TouchableOpacity
        style={[styles.envelopeRow, { backgroundColor: cardBg, borderColor: cardBorder }]}
        onPress={() => setSelectedEnvelope(item)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${formatCurrency(Math.abs(remaining))} ${isOver ? 'over budget' : 'remaining'}, ${pct}% used`}
      >
        <View style={styles.envelopeInfo}>
          <Text style={[styles.envelopeName, { color: valueColor }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.envelopeAmt, { color: isOver ? colors.error : labelColor }]}>
            {isOver ? `−${formatCurrency(Math.abs(remaining))}` : formatCurrency(remaining)} left
          </Text>
        </View>

        <View style={styles.progressRow}>
          <View style={[styles.progressTrack, { backgroundColor: cardBorder }]}>
            <View
              testID={`envelope-progress-fill-${item.id}`}
              style={[
                styles.progressFill,
                {
                  width: `${barPct}%` as `${number}%`,
                  backgroundColor: isOver ? colors.error : accentColor,
                },
              ]}
            />
          </View>
          <Text style={[styles.pctLabel, { color: labelColor }]}>{pct}%</Text>
        </View>
      </TouchableOpacity>
    );
  };

  // REG-9: a thin, non-blanking indicator for a background reload (sync
  // round, focus refetch, …) already in flight over data on screen — the
  // FlatList below keeps rendering that data throughout.
  const refreshingBar = <RefreshingBar refreshing={refreshing} />;

  // ── Main list ─────────────────────────────────────────────────────────────
  const list = (
    <FlatList<EnvelopeEntity>
      testID="dashboard-root"
      style={styles.list}
      data={loading ? [] : sortedBudgetSpendEnvelopes}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={ListHeader}
      ListFooterComponent={ListFooter}
      ListEmptyComponent={EmptyContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={P.accent}
          colors={[P.accent]}
        />
      }
    />
  );

  // Rendered as a sibling of the FlatList (not inside ListFooterComponent) so
  // it stays fixed above the tab bar instead of scrolling away with the list
  // content (UX-16).
  const floatingFab = (
    <FAB
      icon="plus"
      label="Add"
      style={[styles.floatingFab, { backgroundColor: fabBg, bottom: spacing.xl + insets.bottom }]}
      color="#FFFFFF"
      onPress={() => navigation.navigate('AddTransaction')}
      accessibilityLabel="Add transaction"
      testID="add-transaction-fab"
    />
  );

  const rolloverModal = (
    <RolloverWizard
      visible={showRollover}
      householdId={hid}
      fromPeriodStart={rolloverFromPeriodStart}
      toPeriodStart={periodStart}
      periodLabel={periodLabel}
      onDone={handleRolloverDone}
    />
  );

  const scoreBreakdownDialog = (
    <ScoreBreakdownDialog
      visible={showScoreBreakdown}
      onDismiss={() => setShowScoreBreakdown(false)}
      result={scoreResult}
    />
  );

  const envelopeDetailSheet = (
    <EnvelopeDetailSheet
      visible={selectedEnvelope !== null}
      envelope={selectedEnvelope}
      householdId={hid}
      savedCentsByEnvelopeId={savedCentsByEnvelopeId}
      currentPeriodStart={periodStart}
      onDismiss={handleCloseEnvelopeDetail}
      onAddTransaction={handleAddTransactionForEnvelope}
      onOpenTransaction={handleOpenTransaction}
      onEditEnvelope={handleEditEnvelope}
      onSavedAmountAdjusted={reloadSavings}
    />
  );

  if (isDark) {
    return (
      <LinearGradient colors={GRAD_DARK} locations={[0, 0.55, 1]} style={styles.flex}>
        {refreshingBar}
        {list}
        {floatingFab}
        {rolloverModal}
        {scoreBreakdownDialog}
        {envelopeDetailSheet}
      </LinearGradient>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: P.screenBgLight }]}>
      {refreshingBar}
      {list}
      {floatingFab}
      {rolloverModal}
      {scoreBreakdownDialog}
      {envelopeDetailSheet}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { flex: 1 },
  // Extra bottom padding keeps the last row clear of the floating FAB, which
  // is rendered outside the FlatList so it stays fixed above the tab bar
  // instead of scrolling away with the list content (UX-16).
  listContent: { paddingBottom: spacing.xxxl + spacing.xl },

  // Period header
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
  },
  periodLabel: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 22,
    letterSpacing: -0.4,
  },
  daysTag: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.sm,
  },
  debtLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
  },
  debtLineText: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: fontSize.sm,
  },

  // Budget ring section
  ringSection: {
    alignItems: 'center',
    paddingVertical: spacing.base,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.base,
    paddingHorizontal: spacing.lg,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statLabel: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.xs,
  },
  statValue: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: fontSize.sm,
  },
  statDivider: { width: 1, height: 28, marginHorizontal: spacing.sm },

  // Income / To assign row
  incomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  safeToSpendCard: {
    alignItems: 'center',
    marginTop: spacing.base,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  safeToSpendLabel: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: fontSize.xs,
  },
  safeToSpendValue: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 20,
    marginTop: 2,
  },
  safeToSpendCaption: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.xs,
    textAlign: 'center',
    marginTop: 4,
  },

  // Section header
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
  },
  sectionHeadActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
  },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: fontSize.base,
  },
  sectionSub: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.sm,
  },

  // Envelope list rows
  envelopeRow: {
    marginHorizontal: spacing.base,
    padding: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
  },
  envelopeInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  envelopeName: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: fontSize.base,
    flex: 1,
    marginRight: spacing.sm,
  },
  envelopeAmt: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.sm,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  pctLabel: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.xs,
    minWidth: 32,
    textAlign: 'right',
  },
  separator: { height: spacing.sm },
  savingsList: { gap: spacing.sm, marginBottom: spacing.sm },
  scoreProgress: { marginTop: spacing.base },

  // Floating "Add transaction" FAB — rendered as a sibling of the FlatList,
  // fixed bottom-right above the tab bar (UX-16), not inside its footer.
  floatingFab: {
    position: 'absolute',
    right: spacing.base,
    bottom: spacing.xl,
  },

  // Secondary actions
  secondaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: radius.xl,
    alignItems: 'center',
    gap: 4,
  },
  secondaryLbl: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: fontSize.xs,
  },
  bottomPad: { height: spacing.xl },

  // Empty state
  newEnvBtn: {
    alignSelf: 'center',
    marginTop: spacing.base,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.full,
  },
  newEnvBtnText: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: fontSize.base,
  },
  // Demoted "+ New envelope" text button (UX2-8) — used when "Start this
  // month's budget" is the single CONTAINED empty-state CTA.
  newEnvBtnTextDemoted: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.base,
  },
});
