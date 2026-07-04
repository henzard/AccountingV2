import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Modal, TouchableOpacity } from 'react-native';
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
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../../../domain/shared/syncWrite';
import type { SyncWriteDeps } from '../../../domain/shared/syncWrite';
import { formatCurrency } from '../../utils/currency';
import { useAppTheme } from '../../theme/useAppTheme';
import { spacing, radius, fontSize } from '../../theme/tokens';

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

function toCents(str: string): number {
  const n = parseFloat(String(str).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

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
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [committedCount, setCommittedCount] = useState<number | null>(null);

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
    loadPeriodScopedEnvelopes(householdId, fromPeriodStart)
      .then((rows) => {
        if (cancelled) return;
        setLastPeriod(rows);
        setAllocationStr((prev) => {
          const next = { ...prev };
          rows.forEach((row) => {
            if (next[row.id] === undefined) next[row.id] = fromCents(row.allocatedCents);
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
      setAllocationStr({});
    }
  }, [visible, toPeriodStart]);

  const totals = useMemo(() => {
    const totalAllocated = lastPeriod.reduce((sum, e) => sum + e.allocatedCents, 0);
    const totalSpent = lastPeriod.reduce((sum, e) => sum + e.spentCents, 0);
    const overspent = lastPeriod.filter((e) => e.spentCents > e.allocatedCents);
    const onBudget = lastPeriod.filter((e) => e.spentCents <= e.allocatedCents);
    return { totalAllocated, totalSpent, overspent, onBudget };
  }, [lastPeriod]);

  const edits = useMemo(
    () =>
      lastPeriod
        .map((e) => ({ envelope: e, editedCents: toCents(allocationStr[e.id] ?? '0') }))
        .filter(({ envelope, editedCents }) => editedCents !== envelope.allocatedCents),
    [lastPeriod, allocationStr],
  );

  const stepIndex = STEP_ORDER.indexOf(step) + 1;

  const handleNext = useCallback((): void => {
    setStep((s) => {
      const idx = STEP_ORDER.indexOf(s);
      return STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)];
    });
  }, []);

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
    } catch (err) {
      if (mountedRef.current) {
        setCommitError(err instanceof Error ? err.message : 'Failed to start new period');
      }
    } finally {
      if (mountedRef.current) setCommitting(false);
    }
  }, [householdId, fromPeriodStart, toPeriodStart, edits, syncDeps]);

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

        <ScrollView contentContainerStyle={styles.container}>
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
            </View>
          )}

          {!loading && !loadError && !committed && step === 'review' && (
            <View testID="rollover-step-review">
              <Text variant="titleMedium" style={{ color: colors.onSurface }}>
                Here&apos;s how last period went
              </Text>
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
              {lastPeriod.map((e) => (
                <View key={e.id} style={styles.allocRow}>
                  <Text style={[styles.allocLabel, { color: colors.onSurface }]} numberOfLines={1}>
                    {e.name}
                  </Text>
                  <TextInput
                    mode="outlined"
                    value={allocationStr[e.id] ?? fromCents(e.allocatedCents)}
                    onChangeText={(v): void => setAllocationStr((prev) => ({ ...prev, [e.id]: v }))}
                    keyboardType="decimal-pad"
                    left={<TextInput.Affix text="R" />}
                    testID={`rollover-alloc-input-${e.id}`}
                    accessibilityLabel={`Allocation for ${e.name}`}
                    style={styles.allocInput}
                  />
                </View>
              ))}
              <Text style={{ color: colors.onSurfaceVariant, marginTop: spacing.base }}>
                Savings, sinking fund, emergency fund and baby step envelopes carry over
                automatically and aren&apos;t shown here.
              </Text>
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
                <Text key={envelope.id} style={{ color: colors.onSurface, marginTop: spacing.xs }}>
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
                  disabled={loading || !!loadError}
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
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.base,
  },
  footerBtn: { flex: 1 },
  footerBtnHalf: { flex: 1 },
  footerBtnContent: { paddingVertical: spacing.xs, minHeight: 48 },
});
