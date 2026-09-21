import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  View,
  Switch,
  TextInput as RNTextInput,
} from 'react-native';
import { Text, TextInput, Button, Snackbar } from 'react-native-paper';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { format, differenceInCalendarDays } from 'date-fns';
import { db } from '../../../data/local/db';
import {
  envelopes as envelopesTable,
  transactions as transactionsTable,
} from '../../../data/local/schema';
import {
  envelopeScopeCondition,
  getEnvelopeSpentCents,
} from '../../../data/local/balances/EnvelopeBalanceQuery';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { CreateTransactionUseCase } from '../../../domain/transactions/CreateTransactionUseCase';
import { UpdateTransactionUseCase } from '../../../domain/transactions/UpdateTransactionUseCase';
import { DeleteTransactionUseCase } from '../../../domain/transactions/DeleteTransactionUseCase';
import type { TransactionEntity } from '../../../domain/transactions/TransactionEntity';
import { getEnvelopeScope } from '../../../domain/envelopes/EnvelopeEntity';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../../domain/shared/BudgetPeriodEngine';
import { useToastStore } from '../../stores/toastStore';
import { useAppStore } from '../../stores/appStore';
import { usePersistentEnvelopeSavings } from '../../hooks/usePersistentEnvelopeSavings';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { AddTransactionScreenProps } from '../../navigation/types';
import { EnvelopePickerSheet } from '../../screens/slipScanning/components/EnvelopePickerSheet';
import type { EnvelopeOption } from '../../screens/slipScanning/components/EnvelopePickerSheet';
import { PickerField } from '../../components/shared/PickerField';
import { DateField } from '../../components/shared/DateField';
import { LoadingSplash } from '../../components/shared/LoadingSplash';
import { confirm } from '../../components/shared/ConfirmDialogHost';
import { formatCurrency } from '../../utils/currency';
import { SpendingCoach } from '../../../domain/coaching/SpendingCoach';
import { CoachingModal } from '../../components/shared/CoachingModal';
import type { CoachingResult } from '../../../domain/coaching/SpendingCoach';
import { MoveAllocationUseCase } from '../../../domain/envelopes/MoveAllocationUseCase';
import { parseMoneyInput } from '../../utils/parseMoneyInput';
import { detectThresholdCrossing, buildThresholdToastMessage } from './envelopeUsageThreshold';
import { computeAfterThisPreview } from './afterThisPreview';
import { householdNotifier } from '../../../infrastructure/notifications/HouseholdNotifier';
import { rearmBudgetNudges, rearmEveningLogPrompt } from '../../boot/eveningLogPrompt';

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();
const coach = new SpendingCoach();

/**
 * REG-8/VAL2-2: `allocatedCents - spentCents` is only a real balance for a
 * PERIOD-scoped envelope. For a PERSISTENT one (savings / emergency_fund /
 * sinking_fund / baby_step), `allocatedCents` is the monthly contribution
 * and `spentCents` is its all-time spend — the difference is meaningless
 * (a Holiday fund with R6 000 saved and a R500/month contribution would
 * read "R500 left"). The real balance for a persistent envelope is its
 * saved-so-far total from the contribution ledger
 * (`getPersistentEnvelopeSavedCents`, read via `savedCentsByEnvelopeId`).
 */
function envelopeTrailingText(
  env: EnvelopeOption,
  savedCentsByEnvelopeId: ReadonlyMap<string, number>,
): string {
  if (getEnvelopeScope({ envelopeType: env.envelopeType }) === 'persistent') {
    return `${formatCurrency(savedCentsByEnvelopeId.get(env.id) ?? 0)} saved`;
  }
  return `${formatCurrency(env.allocatedCents - env.spentCents)} left`;
}

/** Cents -> a plain "12.34" string for prefilling the amount input, mirroring AddEditEnvelopeScreen's toRandString. */
function centsToInputString(cents: number): string {
  return (cents / 100).toFixed(2);
}

export const AddTransactionScreen: React.FC<AddTransactionScreenProps> = ({
  navigation,
  route,
}) => {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId) ?? '';
  const paydayDay = useAppStore((s) => s.paydayDay);
  const senderId = useAppStore((s) => s.session?.user?.id) ?? '';
  const enqueue = useToastStore((s) => s.enqueue);

  const period = engine.getCurrentPeriod(paydayDay);
  const periodStart = formatPeriodDateKey(period.startDate);

  // Whole days left in the period, including today — clamped to at least 1
  // so the live "after this" preview's per-day rate never divides by zero
  // or a negative count on the period's last day.
  const daysRemaining = Math.max(1, differenceInCalendarDays(period.endDate, new Date()) + 1);

  // REG-8/VAL2-2: a persistent envelope's real balance, read from the
  // contribution ledger rather than derived from allocatedCents/spentCents.
  const { savedCentsByEnvelopeId } = usePersistentEnvelopeSavings(householdId);

  // UX-9: editing an existing transaction (route param) vs. VAL-9: preselecting
  // an envelope when creating a new one. transactionId, when present, always
  // wins — envelopeId is only consulted in create mode.
  const transactionId = route.params?.transactionId;
  const presetEnvelopeId = route.params?.envelopeId;

  const [envelopes, setEnvelopes] = useState<EnvelopeOption[]>([]);
  const [selectedEnvelope, setSelectedEnvelope] = useState<EnvelopeOption | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [amountStr, setAmountStr] = useState('');
  const [payee, setPayee] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UX2-10: while a transactionId's row is being resolved, the form must not
  // render — otherwise a transactionId that no longer exists briefly (or
  // permanently, before this fix) looked exactly like an empty CREATE form
  // while still titled "Edit transaction".
  const [loadingExisting, setLoadingExisting] = useState(!!transactionId);

  const [isBusinessExpense, setIsBusinessExpense] = useState(false);
  const [spendingTriggerNote, setSpendingTriggerNote] = useState('');

  // REFUNDS: the Amount field always holds a POSITIVE number; this toggle is
  // what decides the sign written to the ledger. A refund / reversal / store
  // credit is stored as a negative `amount_cents` row, which every derived
  // SUM nets out — so a household can record it without falsifying history
  // by editing or deleting the original purchase.
  const [isRefund, setIsRefund] = useState(false);

  // Date picker — held as a 'yyyy-MM-dd' local-date string (DateField's
  // value/onChange contract), not a Date object, so no timezone conversion
  // happens between what's shown, stored, and saved.
  const [transactionDate, setTransactionDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  // Non-null only in edit mode: the row loaded for `transactionId`. Passed as
  // UpdateTransactionUseCase's `current` and used to compute this envelope's
  // usage BEFORE this save (VAL-13) net of this transaction's own old amount.
  const [existingTransaction, setExistingTransaction] = useState<TransactionEntity | null>(null);

  // E-1: in EDIT mode the row being edited can belong to a PAST period's
  // envelope, whose balances do NOT live in the current period. This holds
  // the period every balance/preview/threshold on this screen must be read
  // against for the currently selected envelope. Null means "the current
  // period", which is always right in create mode, for a persistent-type
  // envelope (it has no period), and after the user re-picks an envelope
  // from the current period's picker list.
  const [editedEnvelopePeriodStart, setEditedEnvelopePeriodStart] = useState<string | null>(null);

  // A household "over budget" push about a period that has already closed is
  // noise, so it is suppressed for a past-period edit; current-period edits
  // keep it.
  const isEditingPastPeriodEnvelope =
    editedEnvelopePeriodStart !== null && editedEnvelopePeriodStart !== periodStart;

  const [coachingResult, setCoachingResult] = useState<CoachingResult | null>(null);
  // VAL2-9: "cover it from another envelope" — the sheet listing PERIOD
  // envelopes with enough unspent money to cover the current shortfall.
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const pendingAmountCents = useRef<number>(0);
  const isSaving = useRef(false);

  // UX2-5: keyboard flow refs — Amount -> Payee -> Description chained via
  // returnKeyType/onSubmitEditing, plus the two "walk up to the amount
  // field for me" cases (a preselected/only envelope, or the picker sheet
  // closing) below.
  const amountInputRef = useRef<RNTextInput>(null);
  const payeeInputRef = useRef<RNTextInput>(null);
  const descriptionInputRef = useRef<RNTextInput>(null);
  const focusAmount = useCallback((): void => {
    amountInputRef.current?.focus();
  }, []);

  // This envelope's spend BEFORE this save — see the matching comment in
  // doSave (VAL-13) for why an edit of a transaction already on this
  // envelope must subtract its own old amount back out first.
  const previousSpentCentsForSelectedEnvelope = useMemo(() => {
    if (!selectedEnvelope) return 0;
    const oldAmountOnThisEnvelope =
      existingTransaction && existingTransaction.envelopeId === selectedEnvelope.id
        ? existingTransaction.amountCents
        : 0;
    return selectedEnvelope.spentCents - oldAmountOnThisEnvelope;
  }, [selectedEnvelope, existingTransaction]);

  // REG-8/VAL2-2: the persistent-envelope equivalent of the above — the
  // fund's saved balance BEFORE this save, net of this transaction's own
  // old amount when editing one already logged against this fund.
  const previousSavedCentsForSelectedEnvelope = useMemo(() => {
    if (!selectedEnvelope) return 0;
    const saved = savedCentsByEnvelopeId.get(selectedEnvelope.id) ?? 0;
    const oldAmountOnThisEnvelope =
      existingTransaction && existingTransaction.envelopeId === selectedEnvelope.id
        ? existingTransaction.amountCents
        : 0;
    return saved + oldAmountOnThisEnvelope;
  }, [selectedEnvelope, existingTransaction, savedCentsByEnvelopeId]);

  useEffect(() => {
    navigation.setOptions({
      title: transactionId ? 'Edit transaction' : isRefund ? 'Record Refund' : 'Add Transaction',
    });
  }, [transactionId, isRefund, navigation]);

  // Fetches one envelope by id (regardless of the picker list's current-period
  // filter) for prefill purposes — the edited transaction's envelope, or a
  // create-mode preselected one, may not be in that filtered list.
  //
  // E-1: `getEnvelopeSpentCents` only returns envelopes that are in scope for
  // the period it is asked about, so a PAST period's spending envelope looked
  // up under the CURRENT period came back absent and its spend read as 0 —
  // a wrong "left after this" preview and a bogus over-budget threshold on
  // every edit of an older transaction. `useEnvelopeOwnPeriod` (edit mode
  // only) reads it under the period its own `period_start` names instead.
  // Persistent types have no period, so the current one stays correct for
  // them, and create mode is unchanged.
  const loadEnvelopeOption = useCallback(
    async (
      envelopeId: string,
      options?: { useEnvelopeOwnPeriod?: boolean },
    ): Promise<{ option: EnvelopeOption; balancePeriodStart: string } | null> => {
      const [row] = await db
        .select({
          id: envelopesTable.id,
          name: envelopesTable.name,
          allocatedCents: envelopesTable.allocatedCents,
          envelopeType: envelopesTable.envelopeType,
          periodStart: envelopesTable.periodStart,
        })
        .from(envelopesTable)
        .where(and(eq(envelopesTable.id, envelopeId), eq(envelopesTable.householdId, householdId)))
        .limit(1);
      if (!row) return null;
      const { periodStart: envelopePeriodStart, ...envelopeRow } = row;
      // The schema column is plain `text`; every other read of it on this
      // screen goes through EnvelopeOption's narrowed union.
      const envelopeType = envelopeRow.envelopeType as EnvelopeOption['envelopeType'];
      const balancePeriodStart =
        options?.useEnvelopeOwnPeriod &&
        envelopePeriodStart &&
        getEnvelopeScope({ envelopeType }) === 'period'
          ? envelopePeriodStart
          : periodStart;
      const spentByEnvelope = await getEnvelopeSpentCents(db, householdId, balancePeriodStart);
      let spentCents = spentByEnvelope.get(envelopeRow.id);
      if (spentCents === undefined) {
        // The ledger query only covers live envelopes. An edit can still load
        // a SOFT-DELETED one (UpdateTransactionUseCase allows it while the
        // envelope is unchanged); reading its spend as 0 would give the save
        // path a false baseline and a bogus threshold toast / over-budget
        // push. Sum its live transactions directly instead.
        try {
          const rows = await db
            .select({ amountCents: transactionsTable.amountCents })
            .from(transactionsTable)
            .where(
              and(
                eq(transactionsTable.householdId, householdId),
                eq(transactionsTable.envelopeId, envelopeRow.id),
                isNull(transactionsTable.deletedAt),
              ),
            );
          spentCents = rows.reduce((sum, r) => sum + r.amountCents, 0);
        } catch {
          spentCents = 0;
        }
      }
      return {
        option: {
          ...envelopeRow,
          spentCents,
        } as EnvelopeOption,
        balancePeriodStart,
      };
    },
    [householdId, periodStart],
  );

  // Edit mode: load the transaction row and prefill every field. UX2-10: a
  // transactionId that no longer exists (deleted, or never existed) must
  // not silently fall through to an empty CREATE form — it toasts and
  // leaves the screen instead.
  useEffect(() => {
    if (!transactionId || !householdId) return;
    let cancelled = false;
    setLoadingExisting(true);
    db.select()
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.id, transactionId),
          eq(transactionsTable.householdId, householdId),
          isNull(transactionsTable.deletedAt),
        ),
      )
      .limit(1)
      .then(async ([row]) => {
        if (cancelled) return;
        if (!row) {
          enqueue('That transaction no longer exists', 'error');
          navigation.goBack();
          return;
        }
        const tx = row as TransactionEntity;
        setExistingTransaction(tx);
        // REFUNDS: a negative row loads as "Refund ON" with its ABSOLUTE
        // amount in the (always-positive) Amount field — the sign lives in
        // the toggle, never in the text input.
        setIsRefund(tx.amountCents < 0);
        setAmountStr(centsToInputString(Math.abs(tx.amountCents)));
        setPayee(tx.payee ?? '');
        setDescription(tx.description ?? '');
        setTransactionDate(tx.transactionDate);
        setIsBusinessExpense(tx.isBusinessExpense);
        const loaded = await loadEnvelopeOption(tx.envelopeId, { useEnvelopeOwnPeriod: true });
        if (cancelled) return;
        if (loaded) {
          setSelectedEnvelope(loaded.option);
          setEditedEnvelopePeriodStart(loaded.balancePeriodStart);
        }
        setLoadingExisting(false);
      })
      .catch(() => {
        if (!cancelled) {
          enqueue('Failed to load transaction', 'error');
          setLoadingExisting(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [transactionId, householdId, loadEnvelopeOption, enqueue, navigation]);

  // VAL-9: create mode only — preselect the envelope passed via route params.
  // UX2-5: a preselected envelope means the user is straight into an amount,
  // so autofocus it — this is the whole reason the create-mode form exists.
  useEffect(() => {
    if (transactionId || !presetEnvelopeId || !householdId) return;
    let cancelled = false;
    loadEnvelopeOption(presetEnvelopeId).then((loaded) => {
      if (!cancelled && loaded) {
        setSelectedEnvelope(loaded.option);
        focusAmount();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [transactionId, presetEnvelopeId, householdId, loadEnvelopeOption, focusAmount]);

  useEffect(() => {
    db.select({
      id: envelopesTable.id,
      name: envelopesTable.name,
      allocatedCents: envelopesTable.allocatedCents,
      envelopeType: envelopesTable.envelopeType,
    })
      .from(envelopesTable)
      .where(
        and(
          eq(envelopesTable.householdId, householdId),
          // envelopeScopeCondition (not a raw period_start equality) so
          // PERSISTENT envelope types (sinking_fund, emergency_fund, savings,
          // baby_step) still show up in the picker after the period has
          // rolled forward past their creation period — see C3 in the
          // 2026-07-05 exhaustive audit; same fix already applied to
          // useEnvelopes.
          envelopeScopeCondition(periodStart),
          eq(envelopesTable.isArchived, false),
          // Exclude income-type envelopes per domain rule
          ne(envelopesTable.envelopeType, 'income'),
        ),
      )
      .then(async (rows) => {
        // spentCents is derived from the transaction ledger, not a stored column.
        const spentByEnvelope = await getEnvelopeSpentCents(db, householdId, periodStart);
        const withSpent = rows.map((row) => ({
          ...row,
          spentCents: spentByEnvelope.get(row.id) ?? 0,
        })) as EnvelopeOption[];
        setEnvelopes(withSpent);
        // UX2-5: the only envelope there is — no picker decision to make,
        // so land straight in the amount field.
        if (withSpent.length === 1) {
          setSelectedEnvelope(withSpent[0]);
          focusAmount();
        }
      })
      .catch(() => {
        enqueue('Failed to load envelopes', 'error');
      });
  }, [householdId, periodStart, enqueue, focusAmount]);

  const doSave = useCallback(
    async (
      amountCents: number,
      options?: {
        /**
         * VAL2-9 cover-flow fix (round-3 review, item 1): `selectedEnvelope`
         * state was updated by `handleCoverEnvelopeSelected` just before
         * calling `doSave`, but `doSave` is the memoized closure from the
         * render BEFORE that state update landed — it still captures the
         * PRE-move `allocatedCents` (via the `selectedEnvelope` dependency
         * this `useCallback` closed over), so threshold detection and
         * `overByCents` below would silently use the wrong (smaller,
         * pre-cover) allocation. Passing the post-move envelope explicitly
         * bypasses the stale closure instead of trusting React to have
         * re-rendered in time.
         */
        envelopeOverride?: EnvelopeOption;
        /**
         * Set only by the cover flow: a save that follows a cover landing
         * the envelope at EXACTLY its (now larger) allocation is fully
         * spent, not over budget — suppresses the 100%-crossing toast/push
         * for that exact-cap case only, leaving the ordinary (non-cover)
         * exact-100% convention elsewhere in this screen unchanged.
         */
        suppressExactCapOverBudget?: boolean;
      },
    ): Promise<void> => {
      if (isSaving.current) return; // guard against double-tap race
      isSaving.current = true;
      setLoading(true);
      setError(null);
      try {
        const envelope = options?.envelopeOverride ?? selectedEnvelope!;
        const previousSpentCents = previousSpentCentsForSelectedEnvelope;

        const result = existingTransaction
          ? await new UpdateTransactionUseCase(db, audit, existingTransaction, {
              envelopeId: envelope.id,
              amountCents,
              payee: payee.trim() || null,
              description: description.trim() || null,
              transactionDate,
              isBusinessExpense,
            }).execute()
          : await new CreateTransactionUseCase(db, audit, {
              householdId,
              envelopeId: envelope.id,
              amountCents,
              payee: payee.trim() || null,
              description: description.trim() || null,
              transactionDate,
              isBusinessExpense,
              spendingTriggerNote: isBusinessExpense ? spendingTriggerNote.trim() || null : null,
            }).execute();

        if (result.success) {
          enqueue(existingTransaction ? 'Transaction updated' : 'Transaction saved', 'success');

          // VAL-6/DB-7: only a genuine CREATE wakes the partner's device —
          // an edit is not a new spend and must not re-notify.
          if (!existingTransaction) {
            // Logged today, so tonight's "log your spending" reminder is moot.
            // (Amount-blind existence check — a refund counts as having
            // logged, which is right.)
            void rearmEveningLogPrompt().catch(() => undefined);
            // SEC2-12: typed fields only — notify-event writes the words.
            //
            // REFUNDS: `IHouseholdNotifier`'s `transaction_created` contract
            // is "integer cents, GREATER THAN ZERO", and notify-event
            // validates it that way, so posting a negative amount here would
            // just be rejected server-side — a guaranteed-dropped event, not
            // a notification. A refund instead gets its OWN event kind below
            // with the POSITIVE magnitude of the refund, so partners still
            // hear about money coming back.
            if (amountCents > 0) {
              householdNotifier.notifyHousehold({
                kind: 'transaction_created',
                householdId,
                senderId,
                amountCents,
                envelopeName: envelope.name,
                payee: payee.trim() || undefined,
              });
            } else if (amountCents < 0) {
              householdNotifier.notifyHousehold({
                kind: 'refund_recorded',
                householdId,
                senderId,
                amountCents: Math.abs(amountCents),
                envelopeName: envelope.name,
                payee: payee.trim() || undefined,
              });
            }
          }

          // Round-3 review item 4: unlike the evening-log rearm and the
          // household "new transaction" push above (both create-only — an
          // edit isn't a new spend), the payday-countdown/weekly-check-in
          // NUMBERS change on every save that moves money, including an
          // edit and the cover flow's resumed save — so this runs
          // unconditionally, not just for `!existingTransaction`.
          void rearmBudgetNudges().catch(() => undefined);

          // VAL-13: only for period-scoped envelopes, and only when THIS
          // save is the one that crosses 80%/100% (not every save above it).
          //
          // REFUNDS: a negative amount can only ever LOWER usage, so it can
          // never cross a threshold upwards — but `detectThresholdCrossing`
          // is a pure before/after comparison that knows nothing about
          // refunds, and an edit that flips a purchase into a refund moves
          // `previousSpentCents` too. Gating on the sign here is the single
          // place that keeps a refund out of the threshold toast AND out of
          // the `envelope_over_budget` household push below.
          if (
            amountCents > 0 &&
            getEnvelopeScope({ envelopeType: envelope.envelopeType }) === 'period'
          ) {
            const newSpentCents = previousSpentCents + amountCents;
            const crossing = detectThresholdCrossing(
              previousSpentCents,
              newSpentCents,
              envelope.allocatedCents,
            );
            if (crossing) {
              // VAL-6/DB-7: only the 100% ("over budget") crossing wakes the
              // household — the 80% heads-up is a solo nudge, not shared news.
              // Landing exactly ON the allocation is "fully spent", not over,
              // and notify-event requires a positive overByCents.
              const overByCents = newSpentCents - envelope.allocatedCents;
              // Round-3 review item 1: a save that follows a cover landing
              // EXACTLY at the (new, larger) allocation is fully spent, not
              // over — suppress the toast+push for that specific case only,
              // so this never touches the ordinary (non-cover) exact-100%
              // convention used everywhere else in this screen.
              const suppressExactCap =
                options?.suppressExactCapOverBudget && crossing === 100 && overByCents <= 0;
              if (!suppressExactCap) {
                enqueue(
                  buildThresholdToastMessage(
                    crossing,
                    envelope.name,
                    envelope.allocatedCents,
                    newSpentCents,
                  ),
                  crossing === 100 ? 'error' : 'regression',
                );
                // E-1: ...but never for an edit of a PAST period's envelope —
                // waking the household about a period that has already
                // closed is noise, not news.
                if (crossing === 100 && overByCents > 0 && !isEditingPastPeriodEnvelope) {
                  householdNotifier.notifyHousehold({
                    kind: 'envelope_over_budget',
                    householdId,
                    senderId,
                    envelopeName: envelope.name,
                    overByCents,
                  });
                }
              }
            }
          }

          navigation.goBack();
        } else {
          setError(result.error.message);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred';
        setError(message);
        enqueue(
          existingTransaction ? 'Failed to update transaction' : 'Failed to save transaction',
          'error',
        );
      } finally {
        setLoading(false);
        isSaving.current = false;
      }
    },
    [
      selectedEnvelope,
      existingTransaction,
      previousSpentCentsForSelectedEnvelope,
      isEditingPastPeriodEnvelope,
      payee,
      description,
      householdId,
      senderId,
      transactionDate,
      isBusinessExpense,
      spendingTriggerNote,
      enqueue,
      navigation,
    ],
  );

  const handleSave = useCallback((): void => {
    if (!selectedEnvelope) {
      setError('Please select an envelope');
      return;
    }
    const parsedAmount = parseMoneyInput(amountStr);
    if (!parsedAmount.ok) {
      setError(parsedAmount.error);
      return;
    }
    const amountCents = parsedAmount.cents;
    if (amountCents <= 0) {
      setError('Amount must be greater than R0');
      return;
    }

    // REFUNDS: money coming BACK cannot overspend anything, so a refund
    // never runs the coach — which also means it can never reach the
    // "cover it from another envelope" flow or the `envelopeOverride` /
    // `suppressExactCapOverBudget` options, both of which are only ever set
    // from `handleCoverEnvelopeSelected` (reachable only via a
    // `coachingResult`). It saves straight through with a negative amount.
    if (isRefund) {
      void doSave(-amountCents);
      return;
    }

    // REG-8/VAL2-2: a persistent envelope's coaching check compares against
    // its SAVED balance, never allocatedCents (the monthly contribution) —
    // otherwise the coach blocks a legitimate withdrawal from a fully-funded
    // fund as "overspending".
    const scope = getEnvelopeScope({ envelopeType: selectedEnvelope.envelopeType });
    const availableCents =
      scope === 'persistent'
        ? previousSavedCentsForSelectedEnvelope
        : selectedEnvelope.allocatedCents - previousSpentCentsForSelectedEnvelope;

    const coaching = coach.evaluate({ amountCents, availableCents, scope });

    if (coaching) {
      pendingAmountCents.current = amountCents;
      setCoachingResult(coaching);
      return;
    }

    void doSave(amountCents);
  }, [
    selectedEnvelope,
    amountStr,
    isRefund,
    previousSpentCentsForSelectedEnvelope,
    previousSavedCentsForSelectedEnvelope,
    doSave,
  ]);

  const handleCoachingProceed = useCallback((): void => {
    setCoachingResult(null);
    void doSave(pendingAmountCents.current);
  }, [doSave]);

  const handleCoachingCancel = useCallback((): void => {
    setCoachingResult(null);
  }, []);

  // VAL2-9: PERIOD envelopes (other than the one being overspent) that hold
  // enough UNSPENT allocation to cover the current shortfall — the list the
  // "cover it from another envelope" picker offers. Never offered for a
  // persistent-scope (fund) overspend: a fund's "over budget" reading is
  // against its own saved balance, which no sibling allocation can fix.
  const coverCandidates = useMemo((): EnvelopeOption[] => {
    if (!coachingResult || coachingResult.scope !== 'period' || !selectedEnvelope) return [];
    return envelopes.filter((env) => {
      if (env.id === selectedEnvelope.id) return false;
      if (getEnvelopeScope({ envelopeType: env.envelopeType }) !== 'period') return false;
      const unspentCents = env.allocatedCents - env.spentCents;
      return unspentCents >= coachingResult.overspendCents;
    });
  }, [coachingResult, selectedEnvelope, envelopes]);

  // E-1: picking from the picker replaces the edited row's envelope with one
  // from the CURRENT period's list, so the past-period balance scope derived
  // when the row loaded no longer applies.
  const handleEnvelopeSelected = useCallback((env: EnvelopeOption): void => {
    setSelectedEnvelope(env);
    setEditedEnvelopePeriodStart(null);
  }, []);

  const handleCoverFromAnotherEnvelope = useCallback((): void => {
    setShowCoverPicker(true);
  }, []);

  const handleCoverEnvelopeSelected = useCallback(
    (fromEnvelope: EnvelopeOption): void => {
      if (!coachingResult || !selectedEnvelope) return;
      const amountToMoveCents = coachingResult.overspendCents;
      void (async (): Promise<void> => {
        const result = await new MoveAllocationUseCase(db, audit).execute({
          householdId,
          periodStart,
          fromEnvelopeId: fromEnvelope.id,
          toEnvelopeId: selectedEnvelope.id,
          amountCents: amountToMoveCents,
        });
        if (!result.success) {
          enqueue(result.error.message, 'error');
          return;
        }
        // Round-3 review item 1: the envelope this save must use, with the
        // move already applied. Passed explicitly into `doSave` below —
        // NOT read back from `selectedEnvelope` state, which `doSave`'s
        // memoized closure (captured at the LAST render, before this state
        // update lands) would still see as the pre-move allocation.
        const updatedSelectedEnvelope: EnvelopeOption = {
          ...selectedEnvelope,
          allocatedCents: result.data.toAllocatedCents,
        };
        // Keep local envelope state in step with the move it just committed.
        setEnvelopes((prev) =>
          prev.map((env) => {
            if (env.id === result.data.fromEnvelopeId) {
              return { ...env, allocatedCents: result.data.fromAllocatedCents };
            }
            if (env.id === result.data.toEnvelopeId) {
              return { ...env, allocatedCents: result.data.toAllocatedCents };
            }
            return env;
          }),
        );
        setSelectedEnvelope(updatedSelectedEnvelope);
        enqueue(`Moved ${formatCurrency(amountToMoveCents)} from ${fromEnvelope.name}`, 'success');
        setCoachingResult(null);
        void doSave(pendingAmountCents.current, {
          envelopeOverride: updatedSelectedEnvelope,
          suppressExactCapOverBudget: true,
        });
      })();
    },
    [coachingResult, selectedEnvelope, householdId, periodStart, enqueue, doSave],
  );

  // UX2-10: an explicit way out of a transaction, from inside edit mode.
  const handleDelete = useCallback(async (): Promise<void> => {
    if (!existingTransaction) return;
    const confirmed = await confirm({
      title: 'Delete transaction?',
      message: `${existingTransaction.payee ?? 'Unknown'} — ${formatCurrency(existingTransaction.amountCents)}`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      const result = await new DeleteTransactionUseCase(db, audit, existingTransaction).execute();
      if (!result.success) {
        enqueue('Failed to delete transaction', 'error');
        return;
      }
      enqueue('Transaction deleted', 'success');
      navigation.goBack();
    } catch {
      enqueue('Failed to delete transaction', 'error');
    }
  }, [existingTransaction, enqueue, navigation]);

  const balanceColor = (env: EnvelopeOption): string => {
    const balance =
      getEnvelopeScope({ envelopeType: env.envelopeType }) === 'persistent'
        ? (savedCentsByEnvelopeId.get(env.id) ?? 0)
        : env.allocatedCents - env.spentCents;
    return balance < 0 ? colors.error : colors.onSurfaceVariant;
  };

  // New live line under the Amount field: what this envelope/fund will look
  // like immediately after the amount currently being typed, computed
  // before Save is even pressed.
  // REFUNDS: signed exactly like the amount that will be saved, so the
  // preview line goes UP (more left / more saved) for a refund instead of
  // down — `computeAfterThisPreview` subtracts this from the before-balance.
  const previewAmountCents = useMemo(() => {
    const parsed = parseMoneyInput(amountStr);
    if (!parsed.ok) return 0;
    return isRefund ? -parsed.cents : parsed.cents;
  }, [amountStr, isRefund]);

  const afterThisPreview = useMemo(() => {
    if (!selectedEnvelope) return null;
    return computeAfterThisPreview({
      scope: getEnvelopeScope({ envelopeType: selectedEnvelope.envelopeType }),
      envelopeName: selectedEnvelope.name,
      amountCents: previewAmountCents,
      remainingBeforeCents: selectedEnvelope.allocatedCents - previousSpentCentsForSelectedEnvelope,
      savedBeforeCents: previousSavedCentsForSelectedEnvelope,
      daysRemaining,
    });
  }, [
    selectedEnvelope,
    previewAmountCents,
    previousSpentCentsForSelectedEnvelope,
    previousSavedCentsForSelectedEnvelope,
    daysRemaining,
  ]);

  if (loadingExisting) {
    return <LoadingSplash />;
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text variant="labelLarge" style={[styles.label, { color: colors.onSurface }]}>
          Envelope
        </Text>
        <PickerField
          placeholder="Select envelope…"
          value={selectedEnvelope?.name}
          trailing={
            selectedEnvelope
              ? envelopeTrailingText(selectedEnvelope, savedCentsByEnvelopeId)
              : undefined
          }
          trailingColor={selectedEnvelope ? balanceColor(selectedEnvelope) : undefined}
          showChevron
          onPress={() => setShowPicker(true)}
          testID="envelope-picker-trigger"
        />

        <TextInput
          ref={amountInputRef}
          label="Amount (R)"
          value={amountStr}
          onChangeText={setAmountStr}
          mode="outlined"
          testID="amount-input"
          style={[styles.input, { backgroundColor: colors.surface }]}
          keyboardType="decimal-pad"
          disabled={loading}
          placeholder="0.00"
          left={<TextInput.Affix text="R" />}
          returnKeyType="next"
          onSubmitEditing={() => payeeInputRef.current?.focus()}
        />

        {/* REFUNDS: the sign lives here, not in the Amount field — the field
            stays a plain positive number in every mode. Sits directly under
            Amount so the live preview below it already reflects the toggle. */}
        <View style={styles.toggleRow}>
          <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
            Refund (money back)
          </Text>
          <Switch
            value={isRefund}
            onValueChange={setIsRefund}
            disabled={loading}
            testID="refund-toggle"
            accessibilityLabel="Refund — record this as money coming back, not money spent"
            trackColor={{ true: colors.success, false: colors.surfaceVariant }}
            thumbColor={colors.onPrimary}
          />
        </View>

        {afterThisPreview && (
          <Text
            variant="bodySmall"
            style={[
              styles.afterThis,
              { color: afterThisPreview.isNegative ? colors.error : colors.onSurfaceVariant },
            ]}
            testID="after-this-preview"
          >
            {afterThisPreview.text}
          </Text>
        )}

        {/* UX2-5: Date moved above Payee/Description so the keyboard-return
            chain below (Amount -> Payee -> Description) is uninterrupted by
            a field that isn't part of it. */}
        <DateField
          label="Date"
          value={transactionDate}
          onChange={setTransactionDate}
          testID="date-picker-trigger"
        />

        <TextInput
          ref={payeeInputRef}
          label="Payee (optional)"
          value={payee}
          onChangeText={setPayee}
          mode="outlined"
          testID="payee-input"
          style={[styles.input, { backgroundColor: colors.surface }]}
          disabled={loading}
          placeholder="e.g. Checkers"
          returnKeyType="next"
          onSubmitEditing={() => descriptionInputRef.current?.focus()}
        />

        <TextInput
          ref={descriptionInputRef}
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          mode="outlined"
          testID="description-input"
          style={[styles.input, { backgroundColor: colors.surface }]}
          disabled={loading}
          placeholder="e.g. Weekly groceries"
          returnKeyType="done"
          onSubmitEditing={handleSave}
        />

        {/* Business expense toggle */}
        <View style={styles.toggleRow}>
          <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
            Business expense
          </Text>
          <Switch
            value={isBusinessExpense}
            onValueChange={(v) => {
              setIsBusinessExpense(v);
              if (!v) setSpendingTriggerNote('');
            }}
            testID="business-expense-toggle"
            trackColor={{ true: colors.primary, false: colors.surfaceVariant }}
            thumbColor={colors.onPrimary}
          />
        </View>

        {/* UpdateTransactionUseCase does not accept spendingTriggerNote (not
            an editable field on an existing transaction), so this only makes
            sense in create mode — showing it in edit mode would silently
            discard whatever the user typed. */}
        {isBusinessExpense && !existingTransaction && (
          <TextInput
            label="What was it for? (optional)"
            value={spendingTriggerNote}
            onChangeText={setSpendingTriggerNote}
            mode="outlined"
            placeholder="e.g. Client lunch, travel reimbursement"
            testID="trigger-note-input"
            style={styles.input}
            disabled={loading}
          />
        )}

        {!existingTransaction && (
          <Button
            mode="outlined"
            onPress={() => navigation.navigate('SlipScanning' as never)}
            style={styles.button}
            contentStyle={styles.buttonContent}
            testID="scan-slip-button"
          >
            Scan slip
          </Button>
        )}

        {/* UX2-10: an explicit way to remove a transaction from edit mode,
            instead of only being reachable from the list screen. */}
        {existingTransaction && (
          <Button
            mode="outlined"
            onPress={() => void handleDelete()}
            textColor={colors.error}
            style={styles.button}
            contentStyle={styles.buttonContent}
            testID="delete-transaction-button"
          >
            Delete transaction
          </Button>
        )}
      </ScrollView>

      {/* UX2-5: Save is a sticky footer outside the ScrollView, sitting above
          the keyboard via the KeyboardAvoidingView that already wraps this
          screen, instead of scrolling out of reach with the rest of the
          form. */}
      <View style={[styles.footer, { backgroundColor: colors.surface }]}>
        <Button
          mode="contained"
          onPress={handleSave}
          loading={loading}
          disabled={loading}
          style={styles.button}
          contentStyle={styles.buttonContent}
          testID="record-transaction-submit"
        >
          {existingTransaction ? 'Save Changes' : isRefund ? 'Record Refund' : 'Record Transaction'}
        </Button>
      </View>

      {/* Envelope picker — extracted to shared component */}
      <EnvelopePickerSheet
        visible={showPicker}
        envelopes={envelopes}
        selectedId={selectedEnvelope?.id}
        onSelect={handleEnvelopeSelected}
        onClose={() => {
          setShowPicker(false);
          // UX2-5: land back in the amount field once an envelope has been
          // picked, instead of leaving the user to tap into it themselves.
          focusAmount();
        }}
      />

      <Snackbar
        visible={error !== null}
        onDismiss={() => setError(null)}
        duration={4000}
        action={{ label: 'OK', onPress: () => setError(null) }}
        accessibilityLiveRegion="polite"
      >
        {error}
      </Snackbar>

      {coachingResult && (
        <CoachingModal
          visible={true}
          message={coachingResult.message}
          overspendCents={coachingResult.overspendCents}
          scope={coachingResult.scope}
          onProceed={handleCoachingProceed}
          onCancel={handleCoachingCancel}
          onCoverFromAnotherEnvelope={
            coverCandidates.length > 0 ? handleCoverFromAnotherEnvelope : undefined
          }
        />
      )}

      {/* VAL2-9: "cover it from another envelope" — reuses the same picker
          sheet as envelope selection, scoped to envelopes with enough
          unspent money to cover the current shortfall. */}
      <EnvelopePickerSheet
        visible={showCoverPicker}
        envelopes={coverCandidates}
        onSelect={handleCoverEnvelopeSelected}
        onClose={() => setShowCoverPicker(false)}
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: spacing.base, gap: spacing.sm },
  label: { marginTop: spacing.xs },
  input: {},
  afterThis: { marginTop: -spacing.xs },
  button: { marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.xs },
  center: { padding: spacing.base },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  footer: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
  },
});
