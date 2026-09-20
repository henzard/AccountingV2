import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { StyleSheet, ScrollView, KeyboardAvoidingView, Platform, View, Switch } from 'react-native';
import { Text, TextInput, Button, Snackbar } from 'react-native-paper';
import { and, eq, ne } from 'drizzle-orm';
import { format } from 'date-fns';
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
import type { TransactionEntity } from '../../../domain/transactions/TransactionEntity';
import { getEnvelopeScope } from '../../../domain/envelopes/EnvelopeEntity';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../../domain/shared/BudgetPeriodEngine';
import { useToastStore } from '../../stores/toastStore';
import { useAppStore } from '../../stores/appStore';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { AddTransactionScreenProps } from '../../navigation/types';
import { EnvelopePickerSheet } from '../../screens/slipScanning/components/EnvelopePickerSheet';
import type { EnvelopeOption } from '../../screens/slipScanning/components/EnvelopePickerSheet';
import { PickerField } from '../../components/shared/PickerField';
import { DateField } from '../../components/shared/DateField';
import { formatCurrency } from '../../utils/currency';
import { SpendingCoach } from '../../../domain/coaching/SpendingCoach';
import { CoachingModal } from '../../components/shared/CoachingModal';
import type { CoachingResult } from '../../../domain/coaching/SpendingCoach';
import { parseMoneyInput } from '../../utils/parseMoneyInput';
import { detectThresholdCrossing, buildThresholdToastMessage } from './envelopeUsageThreshold';
import { householdNotifier } from '../../../infrastructure/notifications/HouseholdNotifier';

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();
const coach = new SpendingCoach();

function formatBalance(env: EnvelopeOption): string {
  return formatCurrency(env.allocatedCents - env.spentCents);
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

  const [isBusinessExpense, setIsBusinessExpense] = useState(false);
  const [spendingTriggerNote, setSpendingTriggerNote] = useState('');

  // Date picker — held as a 'yyyy-MM-dd' local-date string (DateField's
  // value/onChange contract), not a Date object, so no timezone conversion
  // happens between what's shown, stored, and saved.
  const [transactionDate, setTransactionDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  // Non-null only in edit mode: the row loaded for `transactionId`. Passed as
  // UpdateTransactionUseCase's `current` and used to compute this envelope's
  // usage BEFORE this save (VAL-13) net of this transaction's own old amount.
  const [existingTransaction, setExistingTransaction] = useState<TransactionEntity | null>(null);

  const [coachingResult, setCoachingResult] = useState<CoachingResult | null>(null);
  const pendingAmountCents = useRef<number>(0);
  const isSaving = useRef(false);

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

  useEffect(() => {
    navigation.setOptions({ title: transactionId ? 'Edit transaction' : 'Add Transaction' });
  }, [transactionId, navigation]);

  // Fetches one envelope by id (regardless of the picker list's current-period
  // filter) for prefill purposes — the edited transaction's envelope, or a
  // create-mode preselected one, may not be in that filtered list.
  const loadEnvelopeOption = useCallback(
    async (envelopeId: string): Promise<EnvelopeOption | null> => {
      const [row] = await db
        .select({
          id: envelopesTable.id,
          name: envelopesTable.name,
          allocatedCents: envelopesTable.allocatedCents,
          envelopeType: envelopesTable.envelopeType,
        })
        .from(envelopesTable)
        .where(and(eq(envelopesTable.id, envelopeId), eq(envelopesTable.householdId, householdId)))
        .limit(1);
      if (!row) return null;
      const spentByEnvelope = await getEnvelopeSpentCents(db, householdId, periodStart);
      return { ...row, spentCents: spentByEnvelope.get(row.id) ?? 0 } as EnvelopeOption;
    },
    [householdId, periodStart],
  );

  // Edit mode: load the transaction row and prefill every field.
  useEffect(() => {
    if (!transactionId || !householdId) return;
    let cancelled = false;
    db.select()
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.id, transactionId),
          eq(transactionsTable.householdId, householdId),
        ),
      )
      .limit(1)
      .then(async ([row]) => {
        if (cancelled || !row) return;
        const tx = row as TransactionEntity;
        setExistingTransaction(tx);
        setAmountStr(centsToInputString(tx.amountCents));
        setPayee(tx.payee ?? '');
        setDescription(tx.description ?? '');
        setTransactionDate(tx.transactionDate);
        setIsBusinessExpense(tx.isBusinessExpense);
        const envOption = await loadEnvelopeOption(tx.envelopeId);
        if (!cancelled && envOption) setSelectedEnvelope(envOption);
      })
      .catch(() => {
        if (!cancelled) enqueue('Failed to load transaction', 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [transactionId, householdId, loadEnvelopeOption, enqueue]);

  // VAL-9: create mode only — preselect the envelope passed via route params.
  useEffect(() => {
    if (transactionId || !presetEnvelopeId || !householdId) return;
    let cancelled = false;
    loadEnvelopeOption(presetEnvelopeId).then((envOption) => {
      if (!cancelled && envOption) setSelectedEnvelope(envOption);
    });
    return () => {
      cancelled = true;
    };
  }, [transactionId, presetEnvelopeId, householdId, loadEnvelopeOption]);

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
        if (withSpent.length === 1) setSelectedEnvelope(withSpent[0]);
      })
      .catch(() => {
        enqueue('Failed to load envelopes', 'error');
      });
  }, [householdId, periodStart, enqueue]);

  const doSave = useCallback(
    async (amountCents: number): Promise<void> => {
      if (isSaving.current) return; // guard against double-tap race
      isSaving.current = true;
      setLoading(true);
      setError(null);
      try {
        const envelope = selectedEnvelope!;
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
            householdNotifier.notifyHousehold({
              kind: 'transaction_created',
              householdId,
              senderId,
              title: (payee.trim() || envelope.name).slice(0, 120),
              body: `${payee.trim() || envelope.name} · ${formatCurrency(amountCents)} from ${envelope.name}`,
            });
          }

          // VAL-13: only for period-scoped envelopes, and only when THIS
          // save is the one that crosses 80%/100% (not every save above it).
          if (getEnvelopeScope({ envelopeType: envelope.envelopeType }) === 'period') {
            const newSpentCents = previousSpentCents + amountCents;
            const crossing = detectThresholdCrossing(
              previousSpentCents,
              newSpentCents,
              envelope.allocatedCents,
            );
            if (crossing) {
              enqueue(
                buildThresholdToastMessage(
                  crossing,
                  envelope.name,
                  envelope.allocatedCents,
                  newSpentCents,
                ),
                crossing === 100 ? 'error' : 'regression',
              );
              // VAL-6/DB-7: only the 100% ("over budget") crossing wakes the
              // household — the 80% heads-up is a solo nudge, not shared news.
              if (crossing === 100) {
                householdNotifier.notifyHousehold({
                  kind: 'envelope_over_budget',
                  householdId,
                  senderId,
                  title: envelope.name.slice(0, 120),
                  body: buildThresholdToastMessage(
                    crossing,
                    envelope.name,
                    envelope.allocatedCents,
                    newSpentCents,
                  ),
                });
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

    const coaching = coach.evaluate({
      amountCents,
      allocatedCents: selectedEnvelope.allocatedCents,
      spentCents: previousSpentCentsForSelectedEnvelope,
    });

    if (coaching) {
      pendingAmountCents.current = amountCents;
      setCoachingResult(coaching);
      return;
    }

    void doSave(amountCents);
  }, [selectedEnvelope, amountStr, previousSpentCentsForSelectedEnvelope, doSave]);

  const handleCoachingProceed = useCallback((): void => {
    setCoachingResult(null);
    void doSave(pendingAmountCents.current);
  }, [doSave]);

  const handleCoachingCancel = useCallback((): void => {
    setCoachingResult(null);
  }, []);

  const balanceColor = (env: EnvelopeOption): string => {
    const balance = env.allocatedCents - env.spentCents;
    return balance < 0 ? colors.error : colors.onSurfaceVariant;
  };

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
          trailing={selectedEnvelope ? `${formatBalance(selectedEnvelope)} left` : undefined}
          trailingColor={selectedEnvelope ? balanceColor(selectedEnvelope) : undefined}
          showChevron
          onPress={() => setShowPicker(true)}
          testID="envelope-picker-trigger"
        />

        <TextInput
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
        />

        <TextInput
          label="Payee (optional)"
          value={payee}
          onChangeText={setPayee}
          mode="outlined"
          testID="payee-input"
          style={[styles.input, { backgroundColor: colors.surface }]}
          disabled={loading}
          placeholder="e.g. Checkers"
        />

        <TextInput
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          mode="outlined"
          testID="description-input"
          style={[styles.input, { backgroundColor: colors.surface }]}
          disabled={loading}
          placeholder="e.g. Weekly groceries"
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
            label="Trigger note (optional)"
            value={spendingTriggerNote}
            onChangeText={setSpendingTriggerNote}
            mode="outlined"
            placeholder="e.g. Client lunch, travel reimbursement"
            testID="trigger-note-input"
            style={styles.input}
            disabled={loading}
          />
        )}

        {/* Date picker row */}
        <DateField
          label="Date"
          value={transactionDate}
          onChange={setTransactionDate}
          testID="date-picker-trigger"
        />

        <Button
          mode="contained"
          onPress={handleSave}
          loading={loading}
          disabled={loading}
          style={styles.button}
          contentStyle={styles.buttonContent}
          testID="record-transaction-submit"
        >
          {existingTransaction ? 'Save Changes' : 'Record Transaction'}
        </Button>

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
      </ScrollView>

      {/* Envelope picker — extracted to shared component */}
      <EnvelopePickerSheet
        visible={showPicker}
        envelopes={envelopes}
        selectedId={selectedEnvelope?.id}
        onSelect={(env) => setSelectedEnvelope(env)}
        onClose={() => setShowPicker(false)}
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
          onProceed={handleCoachingProceed}
          onCancel={handleCoachingCancel}
        />
      )}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: spacing.base, gap: spacing.sm },
  label: { marginTop: spacing.xs },
  input: {},
  button: { marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.xs },
  center: { padding: spacing.base },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
});
