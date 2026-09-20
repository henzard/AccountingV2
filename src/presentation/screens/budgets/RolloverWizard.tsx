import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Modal,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, Button, TextInput, ActivityIndicator, Surface } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { envelopes as envelopesTable } from '../../../data/local/schema';
import {
  envelopeScopeCondition,
  getEnvelopeSpentCents,
} from '../../../data/local/balances/EnvelopeBalanceQuery';
import type { EnvelopeType } from '../../../domain/envelopes/EnvelopeEntity';
import {
  StartNewPeriodUseCase,
  isRolloverSource,
  rolloverEnvelopeId,
} from '../../../domain/budgets/StartNewPeriodUseCase';
import {
  confirmMonthlyContribution,
  loadPersistentContributionState,
} from '../../../domain/budgets/PersistentContributions';
import type { PersistentEnvelopeContributionState } from '../../../domain/budgets/PersistentContributions';
import { calculateBudgetBalance } from '../../../domain/budgets/BudgetBalanceCalculator';
import type { BudgetBalanceInput } from '../../../domain/budgets/BudgetBalanceCalculator';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../../../domain/shared/syncWrite';
import type { SyncWriteDeps } from '../../../domain/shared/syncWrite';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../../domain/shared/BudgetPeriodEngine';
import { HabitScoreCalculator } from '../../../domain/scoring/RamseyScoreCalculator';
import { resolvePeriodHabitScoreInput } from '../../../domain/scoring/resolvePeriodHabitScoreInput';
import { RecordPeriodScoreUseCase } from '../../../domain/scoring/RecordPeriodScoreUseCase';
import { getPeriodScoresAscending } from '../../../domain/scoring/getPeriodScoresAscending';
import { useLevelAdvancement } from '../../hooks/useLevelAdvancement';
import { useAppStore } from '../../stores/appStore';
import { logger } from '../../../infrastructure/logging/Logger';
import { formatCurrency } from '../../utils/currency';
import { useAppTheme } from '../../theme/useAppTheme';
import { spacing, radius, fontSize } from '../../theme/tokens';
import { parseMoneyInput } from '../../utils/parseMoneyInput';
import type { ParseMoneyResult } from '../../utils/parseMoneyInput';

export interface RolloverWizardProps {
  visible: boolean;
  householdId: string;
  /** ISO date (YYYY-MM-DD) of the period being reviewed/rolled FROM. */
  fromPeriodStart: string;
  /** ISO date (YYYY-MM-DD) of the period being rolled TO (the one that just started). */
  toPeriodStart: string;
  /** Human label of the NEW period, e.g. "July 2026". */
  periodLabel: string;
  /** Called once the wizard should close — either after a successful commit, or the user dismissed it. */
  onDone: () => void;
  /** Test/DI seam for the synced-repo write — see `SyncWriteDeps`. */
  syncDeps?: SyncWriteDeps;
}

interface EnvelopeSummary {
  id: string;
  name: string;
  envelopeType: EnvelopeType;
  allocatedCents: number;
  spentCents: number;
}

/** The single method the return-key chain needs from a mounted text input. */
interface FocusableInput {
  focus: () => void;
}

type StepName = 'review' | 'adjust' | 'commit';

const STEP_ORDER: StepName[] = ['review', 'adjust', 'commit'];
const STEP_TITLES: Record<StepName, string> = {
  review: 'Review last period',
  adjust: 'Set this month',
  commit: 'Confirm',
};

/** The exact period-scoped, non-archived envelope set `StartNewPeriodUseCase` will copy forward. */
async function loadPeriodScopedEnvelopes(
  householdId: string,
  periodStart: string,
): Promise<EnvelopeSummary[]> {
  const rows = await db
    .select()
    .from(envelopesTable)
    .where(
      and(
        eq(envelopesTable.householdId, householdId),
        isNull(envelopesTable.deletedAt),
        envelopeScopeCondition(periodStart),
      ),
    );

  const periodScoped = rows.filter((row) =>
    isRolloverSource({ envelopeType: row.envelopeType, isArchived: row.isArchived }),
  );

  const spentByEnvelope = await getEnvelopeSpentCents(db, householdId, periodStart);

  return periodScoped.map((row) => ({
    id: row.id,
    name: row.name,
    envelopeType: row.envelopeType as EnvelopeType,
    allocatedCents: row.allocatedCents,
    spentCents: spentByEnvelope.get(row.id) ?? 0,
  }));
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

const periodEngine = new BudgetPeriodEngine();

/** A `yyyy-MM-dd` period key as the UTC instant `BudgetPeriodEngine` builds its boundaries at. */
function periodKeyToUtcDate(periodKey: string): Date {
  const [year, month, day] = periodKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * The last calendar day of the CLOSING period — read from
 * `BudgetPeriodEngine`, which is the only thing that knows where a period
 * actually ends.
 *
 * This used to be `toPeriodStart − 1 day`, on the assumption that the period
 * being closed runs right up to the one being opened. That holds only when
 * every period in between was rolled over. A household that last rolled over
 * in June and opens the wizard in September scores its JUNE envelopes over a
 * 92-day window: `resolvePeriodHabitScoreInput` divides logging days by the
 * period length, so June's habit score collapses to roughly a third of what
 * it earned (REG-14). Asking the engine for June's OWN end date scores June
 * over June, and the skipped periods simply get no score row — we have no
 * rollover, and therefore no reviewed budget, to score them against.
 */
function closingPeriodEnd(fromPeriodStart: string, paydayDay: number): string {
  const period = periodEngine.getPeriodForDate(paydayDay, periodKeyToUtcDate(fromPeriodStart));
  return formatPeriodDateKey(period.endDate);
}

const scoreCalculator = new HabitScoreCalculator();

/** Mirrors SettingsScreen's level-name mapping, for the success block's "Level up" line. */
const LEVEL_LABELS: Record<number, string> = { 1: 'Learner', 2: 'Practitioner', 3: 'Mentor' };

/**
 * RolloverWizard — replaces the old `PeriodRolloverModal`, whose copy falsely
 * implied envelopes had already been cleared out when nothing had actually
 * happened. This wizard actually runs `StartNewPeriodUseCase`: (1) review the
 * previous period's envelopes, (2) let the user tweak this period's starting
 * allocations, then (3) commit — copy the envelopes forward, apply any
 * allocation edits, and acknowledge the period so this doesn't fire again
 * until the next one.
 */
export function RolloverWizard({
  visible,
  householdId,
  fromPeriodStart,
  toPeriodStart,
  periodLabel,
  onDone,
  syncDeps,
}: RolloverWizardProps): React.JSX.Element | null {
  const { colors } = useAppTheme();

  const [step, setStep] = useState<StepName>('review');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastPeriod, setLastPeriod] = useState<EnvelopeSummary[]>([]);
  const [allocationStr, setAllocationStr] = useState<Record<string, string>>({});
  // Every non-archived PERSISTENT envelope with its monthly contribution and
  // whether we still have to ask what that amount is (see the savings section
  // in the adjust step).
  const [savings, setSavings] = useState<PersistentEnvelopeContributionState[]>([]);
  const [savingsStr, setSavingsStr] = useState<Record<string, string>>({});
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [committedCount, setCommittedCount] = useState<number | null>(null);
  // `contributedCents` from `StartNewPeriodUseCase`'s result — money actually
  // moved into persistent envelopes' (savings/emergency fund/sinking
  // fund/baby step) saved balance by this rollover, surfaced below so the
  // user sees where that money went instead of it silently updating a
  // balance they'd only notice on another screen.
  const [contributedCents, setContributedCents] = useState<number | null>(null);
  // The most recently recorded `score_history` entry for this household, if
  // any exists yet (a brand-new household, or one that has never rolled over
  // before, has none) — shown in the review step as "Last period's score".
  const [previousScore, setPreviousScore] = useState<number | null>(null);
  // Set to the new level (2) when this commit's level check advances it —
  // rendered as a "Level up" line in the success block below.
  const [leveledUpTo, setLeveledUpTo] = useState<number | null>(null);

  const { check: checkLevelAdvancement } = useLevelAdvancement();
  // The closing period's real length comes from the engine, which needs the
  // household's payday day — see `closingPeriodEnd` (REG-14).
  const paydayDay = useAppStore((s) => s.paydayDay);

  // Mirrors the load effect's local `cancelled` flag, but at component scope:
  // guards setState calls made after `handleCommit`'s awaits so a commit that
  // resolves after the wizard has been unmounted (e.g. the screen navigated
  // away mid-write) never touches state on an unmounted component.
  const mountedRef = useRef(true);
  useEffect(
    () => (): void => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      loadPeriodScopedEnvelopes(householdId, fromPeriodStart),
      loadPersistentContributionState(db, householdId),
    ])
      .then(([rows, funds]) => {
        if (cancelled) return;
        setLastPeriod(rows);
        setAllocationStr((prev) => {
          const next = { ...prev };
          rows.forEach((row) => {
            if (next[row.id] === undefined) next[row.id] = fromCents(row.allocatedCents);
          });
          return next;
        });
        setSavings(funds);
        setSavingsStr((prev) => {
          const next = { ...prev };
          funds.forEach((fund) => {
            if (next[fund.id] !== undefined) return;
            // A legacy fund's monthly amount is genuinely UNKNOWN — its old
            // `allocatedCents` was the balance, and has already been moved
            // into the ledger. Pre-filling 0.00 would invite the user to tap
            // past the question; an empty field with the helper text asks it.
            next[fund.id] = fund.needsMonthlyConfirmation ? '' : fromCents(fund.monthlyCents);
          });
          return next;
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not load last period');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, householdId, fromPeriodStart]);

  // Best-effort read of the household's score history for the review step's
  // "Last period's score" line — swallows its own errors (stays `null`,
  // simply hiding the line) rather than surfacing a load error for a
  // display-only nicety unrelated to the rollover itself.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    getPeriodScoresAscending(db, householdId)
      .then((history) => {
        if (cancelled) return;
        setPreviousScore(history.length > 0 ? history[history.length - 1].score : null);
      })
      .catch(() => {
        if (!cancelled) setPreviousScore(null);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, householdId, fromPeriodStart]);

  // Reset transient wizard state each time it is (re)opened for a new period.
  // Clearing `allocationStr` here (not just step/commit state) matters because
  // it's keyed by envelope id, and a different period generally has a
  // different envelope id set — without this reset, a previous period's
  // edited-string entries would linger in state (harmless for a truly new id,
  // but wrong if a later period ever reused an id, and just dead memory
  // otherwise). The load effect below repopulates fresh defaults once
  // `loadPeriodScopedEnvelopes` resolves for the new `fromPeriodStart`.
  useEffect(() => {
    if (visible) {
      setStep('review');
      setCommitError(null);
      setCommittedCount(null);
      setContributedCents(null);
      setLeveledUpTo(null);
      setAllocationStr({});
      setSavingsStr({});
    }
  }, [visible, toPeriodStart]);

  const totals = useMemo(() => {
    const totalAllocated = lastPeriod.reduce((sum, e) => sum + e.allocatedCents, 0);
    const totalSpent = lastPeriod.reduce((sum, e) => sum + e.spentCents, 0);
    const overspent = lastPeriod.filter((e) => e.spentCents > e.allocatedCents);
    const onBudget = lastPeriod.filter((e) => e.spentCents <= e.allocatedCents);
    return { totalAllocated, totalSpent, overspent, onBudget };
  }, [lastPeriod]);

  // Each envelope's raw allocation string parsed through the locale-safe
  // parser — empty/garbage/ambiguous input is REJECTED (not coerced to 0),
  // and the 'adjust' step's Next button is blocked while any entry is
  // invalid (see `hasAllocationErrors` below), rather than silently writing
  // a wrong or zeroed allocated_cents on commit.
  const allocationResults = useMemo<Record<string, ParseMoneyResult>>(() => {
    const out: Record<string, ParseMoneyResult> = {};
    lastPeriod.forEach((e) => {
      out[e.id] = parseMoneyInput(allocationStr[e.id] ?? fromCents(e.allocatedCents));
    });
    return out;
  }, [lastPeriod, allocationStr]);

  /**
   * The savings inputs, parsed. An EMPTY field is deliberately not an error:
   * it is the resting state of a legacy fund whose monthly amount we are
   * asking about for the first time, and a user who does not want to answer
   * yet must still be able to start their month. Empty simply means "no
   * change" — the fund stays at whatever it carries and contributes that.
   */
  const savingsResults = useMemo<Record<string, ParseMoneyResult | null>>(() => {
    const out: Record<string, ParseMoneyResult | null> = {};
    savings.forEach((fund) => {
      const raw = savingsStr[fund.id] ?? '';
      out[fund.id] = raw.trim() === '' ? null : parseMoneyInput(raw);
    });
    return out;
  }, [savings, savingsStr]);

  const hasAllocationErrors =
    lastPeriod.some((e) => !allocationResults[e.id]?.ok) ||
    savings.some((fund) => savingsResults[fund.id]?.ok === false);

  /**
   * The monthly contribution each fund will actually carry once this wizard
   * commits — the typed answer where there is one, otherwise what is on the
   * row today.
   */
  const savingsCentsById = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    savings.forEach((fund) => {
      const parsed = savingsResults[fund.id];
      out[fund.id] = parsed?.ok === true ? parsed.cents : fund.monthlyCents;
    });
    return out;
  }, [savings, savingsResults]);

  /**
   * The sticky zero-based-budget summary above the adjust step, computed from
   * what is CURRENTLY TYPED rather than what is stored — the whole point of
   * the step is deciding where this month's income goes, and a user cannot do
   * that while "To assign" still reflects last month's numbers. Persistent
   * envelopes count by their monthly contribution, exactly as
   * `calculateBudgetBalance` documents.
   */
  const budgetBalance = useMemo(() => {
    const rows: BudgetBalanceInput[] = [
      ...lastPeriod.map((e) => {
        const parsed = allocationResults[e.id];
        return {
          allocatedCents: parsed?.ok === true ? parsed.cents : e.allocatedCents,
          envelopeType: e.envelopeType,
          isArchived: false,
        };
      }),
      ...savings.map((fund) => ({
        allocatedCents: savingsCentsById[fund.id] ?? fund.monthlyCents,
        envelopeType: fund.envelopeType,
        isArchived: false,
      })),
    ];
    return calculateBudgetBalance(rows);
  }, [lastPeriod, allocationResults, savings, savingsCentsById]);

  // Keyboard "next" chain across both sections, in visual order, so the user
  // can run down the whole adjust step without reaching for the screen.
  const inputOrder = useMemo(
    () => [...lastPeriod.map((e) => `alloc:${e.id}`), ...savings.map((f) => `savings:${f.id}`)],
    [lastPeriod, savings],
  );
  const inputRefs = useRef<Record<string, FocusableInput | null>>({});
  const focusNext = useCallback(
    (key: string): void => {
      const next = inputOrder[inputOrder.indexOf(key) + 1];
      if (next) inputRefs.current[next]?.focus();
    },
    [inputOrder],
  );
  const isLastInput = (key: string): boolean => inputOrder[inputOrder.length - 1] === key;

  const edits = useMemo(
    () =>
      lastPeriod
        .map((e) => {
          const result = allocationResults[e.id];
          return { envelope: e, result };
        })
        .filter(
          (entry): entry is { envelope: EnvelopeSummary; result: { ok: true; cents: number } } =>
            entry.result?.ok === true,
        )
        .map(({ envelope, result }) => ({ envelope, editedCents: result.cents }))
        .filter(({ envelope, editedCents }) => editedCents !== envelope.allocatedCents),
    [lastPeriod, allocationResults],
  );

  const stepIndex = STEP_ORDER.indexOf(step) + 1;

  const handleNext = useCallback((): void => {
    setStep((s) => {
      // Authoritative block (not just the Next button's `disabled` prop):
      // refuse to leave the 'adjust' step while any allocation is invalid,
      // so an invalid entry can never reach `edits`/commit.
      if (s === 'adjust' && hasAllocationErrors) return s;
      const idx = STEP_ORDER.indexOf(s);
      return STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)];
    });
  }, [hasAllocationErrors]);

  const handleBack = useCallback((): void => {
    setStep((s) => {
      const idx = STEP_ORDER.indexOf(s);
      return STEP_ORDER[Math.max(idx - 1, 0)];
    });
  }, []);

  const handleDismiss = useCallback((): void => {
    // Guard against the close button, Android back button (onRequestClose)
    // and any other dismiss path firing while a commit is in flight —
    // dismissing mid-commit would call onDone() (typically unmounting/hiding
    // this component) while handleCommit's awaited writes are still pending,
    // racing its own post-await setState calls below.
    if (committing) return;
    onDone();
  }, [committing, onDone]);

  const handleCommit = useCallback(async (): Promise<void> => {
    setCommitting(true);
    setCommitError(null);
    try {
      // The savings answers are written BEFORE the rollover, not after: the
      // rollover is the moment each fund's monthly contribution actually
      // becomes money in it, so an amount confirmed here has to be on the
      // envelope row by the time `StartNewPeriodUseCase` reads it — otherwise
      // the user reviews a number that only takes effect NEXT month. It is
      // also what unblocks a legacy fund: until its amount is confirmed it
      // sits at 0 and is deliberately not funded (REG-4).
      for (const fund of savings) {
        const parsed = savingsResults[fund.id];
        if (parsed?.ok !== true) continue;
        if (parsed.cents === fund.monthlyCents && !fund.needsMonthlyConfirmation) continue;
        const confirmed = await confirmMonthlyContribution(
          db,
          {
            householdId,
            envelopeId: fund.id,
            monthlyCents: parsed.cents,
            periodStart: toPeriodStart,
            currentMonthlyCents: fund.monthlyCents,
          },
          syncDeps ?? {},
        );
        if (!confirmed.success) {
          if (mountedRef.current) setCommitError(confirmed.error.message);
          return;
        }
      }

      const useCase = new StartNewPeriodUseCase(db, syncDeps ?? {});
      const result = await useCase.execute({ householdId, fromPeriodStart, toPeriodStart });
      if (!mountedRef.current) return;
      if (!result.success) {
        setCommitError(result.error.message);
        return;
      }

      if (edits.length > 0) {
        const repo = resolveSyncedRepo(db, 'envelopes', syncDeps ?? {});
        const ctx = resolveSyncedRepoCtx(syncDeps ?? {});
        edits.forEach(({ envelope, editedCents }) => {
          const targetId = rolloverEnvelopeId(householdId, toPeriodStart, envelope.id);
          repo.update(targetId, householdId, { allocated_cents: editedCents }, ctx);
        });
      }

      await AsyncStorage.setItem(`period_ack_${toPeriodStart}`, 'true');
      if (!mountedRef.current) return;
      setCommittedCount(result.data.count);
      setContributedCents(result.data.contributedCents);

      // Score/level bookkeeping is best-effort: the rollover above already
      // committed successfully, so nothing in this block may ever surface an
      // error to the user or be treated as a rollover failure — it only ever
      // logs to the console and leaves the success block's score/level lines
      // blank on failure (see RecordPeriodScoreUseCase's doc comment).
      try {
        const fromPeriodEnd = closingPeriodEnd(fromPeriodStart, paydayDay);
        const scoreInput = await resolvePeriodHabitScoreInput(
          db,
          householdId,
          fromPeriodStart,
          fromPeriodEnd,
          lastPeriod,
        );
        const scoreResult = scoreCalculator.calculate(scoreInput);
        await new RecordPeriodScoreUseCase(db).execute({
          householdId,
          periodStart: fromPeriodStart,
          periodEnd: fromPeriodEnd,
          score: scoreResult,
        });

        const levelBefore = useAppStore.getState().userLevel;
        const history = await getPeriodScoresAscending(db, householdId);
        checkLevelAdvancement(history.map((h) => h.score));
        const levelAfter = useAppStore.getState().userLevel;
        if (mountedRef.current && levelAfter > levelBefore) {
          setLeveledUpTo(levelAfter);
        }
      } catch (scoreErr) {
        logger.error('RolloverWizard: failed to record period score/level', scoreErr, {
          householdId,
          periodStart: fromPeriodStart,
        });
      }
    } catch (err) {
      if (mountedRef.current) {
        setCommitError(err instanceof Error ? err.message : 'Failed to start new period');
      }
    } finally {
      if (mountedRef.current) setCommitting(false);
    }
  }, [
    householdId,
    fromPeriodStart,
    toPeriodStart,
    edits,
    lastPeriod,
    savings,
    savingsResults,
    paydayDay,
    syncDeps,
    checkLevelAdvancement,
  ]);

  if (!visible) return null;

  const committed = committedCount !== null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={handleDismiss}
      testID="rollover-wizard"
    >
      <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Text
            variant="labelLarge"
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            testID="rollover-step-indicator"
            style={{ color: colors.onSurfaceVariant }}
          >
            {committed ? 'Done' : `Step ${stepIndex} of ${STEP_ORDER.length}: ${STEP_TITLES[step]}`}
          </Text>
          <TouchableOpacity
            onPress={handleDismiss}
            disabled={committing}
            accessibilityRole="button"
            accessibilityLabel="Close rollover wizard"
            accessibilityState={{ disabled: committing }}
            testID="rollover-dismiss"
            style={[styles.closeBtn, committing && styles.closeBtnDisabled]}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={{ color: colors.onSurfaceVariant, fontSize: fontSize.lg }}>✕</Text>
          </TouchableOpacity>
        </View>

        {!loading && !loadError && !committed && step === 'adjust' && (
          <Surface
            style={[styles.summaryBar, { backgroundColor: colors.surfaceVariant }]}
            elevation={0}
            testID="rollover-adjust-summary"
          >
            <Text style={{ color: colors.onSurfaceVariant }}>
              {`Income ${formatCurrency(budgetBalance.incomeTotal)} · Allocated ${formatCurrency(
                budgetBalance.expenseAllocationTotal,
              )} · To assign ${formatCurrency(budgetBalance.toAssign)}`}
            </Text>
          </Surface>
        )}

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
            {loading && (
              <View style={styles.loadingRow} testID="rollover-loading">
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ color: colors.onSurfaceVariant }}>Loading last period…</Text>
              </View>
            )}

            {!loading && loadError && (
              <Text testID="rollover-load-error" style={{ color: colors.error }}>
                {loadError}
              </Text>
            )}

            {!loading && !loadError && committed && (
              <View style={styles.successBlock} testID="rollover-success">
                <Text style={styles.successIcon}>🎉</Text>
                <Text variant="titleLarge" style={{ color: colors.onSurface, textAlign: 'center' }}>
                  {`${periodLabel} has started`}
                </Text>
                <Text style={{ color: colors.onSurfaceVariant, textAlign: 'center' }}>
                  {committedCount === 0
                    ? 'No envelopes needed copying forward.'
                    : `${committedCount} envelope${committedCount === 1 ? '' : 's'} carried forward with your allocations.`}
                </Text>
                {!!contributedCents && contributedCents > 0 && (
                  <Text
                    testID="rollover-contributed-cents"
                    style={{ color: colors.success, textAlign: 'center' }}
                  >
                    {`Moved ${formatCurrency(contributedCents)} into your savings funds`}
                  </Text>
                )}
                {leveledUpTo !== null && (
                  <Text
                    testID="rollover-level-up"
                    style={{ color: colors.success, textAlign: 'center' }}
                  >
                    {`Level up — Lv${leveledUpTo} ${LEVEL_LABELS[leveledUpTo] ?? ''}`}
                  </Text>
                )}
              </View>
            )}

            {!loading && !loadError && !committed && step === 'review' && (
              <View testID="rollover-step-review">
                <Text variant="titleMedium" style={{ color: colors.onSurface }}>
                  Here&apos;s how last period went
                </Text>
                {previousScore !== null && (
                  <Text
                    testID="rollover-previous-score"
                    style={{ color: colors.onSurfaceVariant, marginTop: spacing.xs }}
                  >
                    {`Last period's score: ${previousScore}`}
                  </Text>
                )}
                {lastPeriod.length === 0 ? (
                  <Text style={{ color: colors.onSurfaceVariant, marginTop: spacing.sm }}>
                    No envelopes to review for last period.
                  </Text>
                ) : (
                  <>
                    <Text testID="rollover-wins" style={[styles.wins, { color: colors.success }]}>
                      {`${totals.onBudget.length} of ${lastPeriod.length} envelopes stayed on budget`}
                    </Text>
                    <View style={styles.totalsRow}>
                      <Text style={{ color: colors.onSurfaceVariant }}>
                        {`Allocated ${formatCurrency(totals.totalAllocated)} · Spent ${formatCurrency(totals.totalSpent)}`}
                      </Text>
                    </View>
                    {lastPeriod.map((e) => {
                      const over = e.spentCents > e.allocatedCents;
                      return (
                        <Surface
                          key={e.id}
                          style={[styles.row, { backgroundColor: colors.surface }]}
                          elevation={0}
                        >
                          <View style={styles.rowHeader}>
                            <Text style={{ color: colors.onSurface, flex: 1 }} numberOfLines={1}>
                              {e.name}
                            </Text>
                            <Text style={{ color: over ? colors.error : colors.onSurfaceVariant }}>
                              {`${formatCurrency(e.spentCents)} / ${formatCurrency(e.allocatedCents)}`}
                            </Text>
                          </View>
                          {over && (
                            <Text
                              testID={`rollover-overspent-${e.id}`}
                              style={[styles.overspentTag, { color: colors.error }]}
                              accessibilityLabel={`${e.name} is over budget`}
                            >
                              {'⚠ Over budget'}
                            </Text>
                          )}
                        </Surface>
                      );
                    })}
                  </>
                )}
              </View>
            )}

            {!loading && !loadError && !committed && step === 'adjust' && (
              <View testID="rollover-step-adjust">
                <Text variant="titleMedium" style={{ color: colors.onSurface }}>
                  {`Set allocations for ${periodLabel}`}
                </Text>
                <Text style={{ color: colors.onSurfaceVariant, marginTop: spacing.xs }}>
                  These carry forward from last period — adjust anything before we start.
                </Text>
                {lastPeriod.map((e) => {
                  const result = allocationResults[e.id];
                  const key = `alloc:${e.id}`;
                  return (
                    <View key={e.id}>
                      <View style={styles.allocRow}>
                        <View style={styles.allocLabel}>
                          <Text style={{ color: colors.onSurface }} numberOfLines={1}>
                            {e.name}
                          </Text>
                          {/* The figure the user needs to set this number well,
                            already loaded for the review step — making them
                            page back to see it is the reason allocations get
                            copied forward unexamined. */}
                          <Text
                            testID={`rollover-alloc-spent-${e.id}`}
                            style={[styles.hint, { color: colors.onSurfaceVariant }]}
                          >
                            {`spent ${formatCurrency(e.spentCents)} last month`}
                          </Text>
                        </View>
                        <TextInput
                          ref={(instance: FocusableInput | null): void => {
                            inputRefs.current[key] = instance;
                          }}
                          mode="outlined"
                          value={allocationStr[e.id] ?? fromCents(e.allocatedCents)}
                          onChangeText={(v): void =>
                            setAllocationStr((prev) => ({ ...prev, [e.id]: v }))
                          }
                          keyboardType="decimal-pad"
                          returnKeyType={isLastInput(key) ? 'done' : 'next'}
                          onSubmitEditing={(): void => focusNext(key)}
                          left={<TextInput.Affix text="R" />}
                          testID={`rollover-alloc-input-${e.id}`}
                          accessibilityLabel={`Allocation for ${e.name}`}
                          style={styles.allocInput}
                        />
                      </View>
                      {result && !result.ok && (
                        <Text
                          testID={`rollover-alloc-error-${e.id}`}
                          style={{ color: colors.error, marginTop: spacing.xs }}
                        >
                          {result.error}
                        </Text>
                      )}
                    </View>
                  );
                })}

                {savings.length > 0 && (
                  <View testID="rollover-savings-section" style={styles.savingsSection}>
                    <Text variant="titleSmall" style={{ color: colors.onSurface }}>
                      Savings contributions
                    </Text>
                    <Text style={{ color: colors.onSurfaceVariant, marginTop: spacing.xs }}>
                      This is what moves into each fund when {periodLabel} starts.
                    </Text>
                    {savings.map((fund) => {
                      const result = savingsResults[fund.id];
                      const key = `savings:${fund.id}`;
                      return (
                        <View key={fund.id}>
                          <View style={styles.allocRow}>
                            <View style={styles.allocLabel}>
                              <Text style={{ color: colors.onSurface }} numberOfLines={1}>
                                {fund.name}
                              </Text>
                              {fund.needsMonthlyConfirmation && (
                                <Text
                                  testID={`rollover-savings-helper-${fund.id}`}
                                  style={[styles.hint, { color: colors.onSurfaceVariant }]}
                                >
                                  How much do you put in each month?
                                </Text>
                              )}
                            </View>
                            <TextInput
                              ref={(instance: FocusableInput | null): void => {
                                inputRefs.current[key] = instance;
                              }}
                              mode="outlined"
                              value={savingsStr[fund.id] ?? ''}
                              onChangeText={(v): void =>
                                setSavingsStr((prev) => ({ ...prev, [fund.id]: v }))
                              }
                              keyboardType="decimal-pad"
                              returnKeyType={isLastInput(key) ? 'done' : 'next'}
                              onSubmitEditing={(): void => focusNext(key)}
                              left={<TextInput.Affix text="R" />}
                              testID={`rollover-savings-input-${fund.id}`}
                              accessibilityLabel={`Monthly contribution for ${fund.name}`}
                              style={styles.allocInput}
                            />
                          </View>
                          {result && !result.ok && (
                            <Text
                              testID={`rollover-savings-error-${fund.id}`}
                              style={{ color: colors.error, marginTop: spacing.xs }}
                            >
                              {result.error}
                            </Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {!loading && !loadError && !committed && step === 'commit' && (
              <View testID="rollover-step-commit">
                <Text variant="titleMedium" style={{ color: colors.onSurface }}>
                  {`Ready to start ${periodLabel}?`}
                </Text>
                <Text style={{ color: colors.onSurfaceVariant, marginTop: spacing.xs }}>
                  {edits.length === 0
                    ? "We'll copy last period's envelopes forward with the same allocations."
                    : `We'll copy last period's envelopes forward with ${edits.length} allocation change${edits.length === 1 ? '' : 's'}:`}
                </Text>
                {edits.map(({ envelope, editedCents }) => (
                  <Text
                    key={envelope.id}
                    style={{ color: colors.onSurface, marginTop: spacing.xs }}
                  >
                    {`${envelope.name}: ${formatCurrency(envelope.allocatedCents)} → ${formatCurrency(editedCents)}`}
                  </Text>
                ))}
                {commitError && (
                  <Text
                    testID="rollover-commit-error"
                    style={{ color: colors.error, marginTop: spacing.sm }}
                  >
                    {commitError}
                  </Text>
                )}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        <View style={styles.footer}>
          {committed ? (
            <Button
              mode="contained"
              onPress={onDone}
              style={styles.footerBtn}
              contentStyle={styles.footerBtnContent}
              testID="rollover-done"
              accessibilityLabel="Finish and return to dashboard"
            >
              Done
            </Button>
          ) : (
            <>
              {step !== 'review' && (
                <Button
                  mode="outlined"
                  onPress={handleBack}
                  style={styles.footerBtnHalf}
                  contentStyle={styles.footerBtnContent}
                  testID="rollover-back"
                  accessibilityLabel="Go back a step"
                  disabled={committing}
                >
                  Back
                </Button>
              )}
              {step !== 'commit' && (
                <Button
                  mode="contained"
                  onPress={handleNext}
                  style={step === 'review' ? styles.footerBtn : styles.footerBtnHalf}
                  contentStyle={styles.footerBtnContent}
                  testID="rollover-next"
                  accessibilityLabel="Continue to next step"
                  disabled={loading || !!loadError || (step === 'adjust' && hasAllocationErrors)}
                >
                  Next
                </Button>
              )}
              {step === 'commit' && (
                <Button
                  mode="contained"
                  onPress={handleCommit}
                  loading={committing}
                  disabled={committing}
                  style={styles.footerBtnHalf}
                  contentStyle={styles.footerBtnContent}
                  testID="rollover-commit"
                  accessibilityLabel={`Start ${periodLabel}`}
                >
                  {`Start ${periodLabel}`}
                </Button>
              )}
            </>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    minHeight: 48,
  },
  closeBtn: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnDisabled: {
    opacity: 0.4,
  },
  container: { padding: spacing.base, paddingBottom: spacing.xxl, gap: spacing.sm },
  loadingRow: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  successBlock: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  successIcon: { fontSize: 40, textAlign: 'center' },
  wins: { fontFamily: 'PlusJakartaSans_600SemiBold', marginTop: spacing.sm },
  totalsRow: { marginTop: spacing.xs, marginBottom: spacing.sm },
  row: {
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  overspentTag: { marginTop: spacing.xs, fontSize: fontSize.sm },
  allocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    minHeight: 48,
  },
  allocLabel: { flex: 1 },
  allocInput: { flex: 1, maxWidth: 140 },
  hint: { fontSize: fontSize.sm, marginTop: 2 },
  savingsSection: { marginTop: spacing.lg, gap: spacing.xs },
  summaryBar: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.base,
  },
  footerBtn: { flex: 1 },
  footerBtnHalf: { flex: 1 },
  footerBtnContent: { paddingVertical: spacing.xs, minHeight: 48 },
});
