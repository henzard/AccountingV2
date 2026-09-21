import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, SegmentedButtons, Snackbar } from 'react-native-paper';
import { eq } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { envelopes as envelopesTable } from '../../../data/local/schema';
import {
  getEnvelopeSpentCents,
  getPersistentEnvelopeSavedCents,
} from '../../../data/local/balances/EnvelopeBalanceQuery';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { CreateEnvelopeUseCase } from '../../../domain/envelopes/CreateEnvelopeUseCase';
import { UpdateEnvelopeUseCase } from '../../../domain/envelopes/UpdateEnvelopeUseCase';
import { ArchiveEnvelopeUseCase } from '../../../domain/envelopes/ArchiveEnvelopeUseCase';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../../domain/shared/BudgetPeriodEngine';
import { getEnvelopeScope } from '../../../domain/envelopes/EnvelopeEntity';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { confirm } from '../../components/shared/ConfirmDialogHost';
import { AdjustSavedAmountDialog } from '../../components/envelopes/AdjustSavedAmountDialog';
import { DateField } from '../../components/shared/DateField';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { AddEditEnvelopeScreenProps } from '../../navigation/types';
import type { EnvelopeEntity, EnvelopeType } from '../../../domain/envelopes/EnvelopeEntity';
import { parseMoneyInput } from '../../utils/parseMoneyInput';
import { formatCurrency } from '../../utils/currency';

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();

const ENVELOPE_TYPE_LABELS: Record<EnvelopeType, string> = {
  income: 'Income',
  spending: 'Spending',
  savings: 'Savings',
  utility: 'Utility',
  sinking_fund: 'Sinking Fund',
  emergency_fund: 'Emergency Fund',
  baby_step: 'Baby Step',
};

function toRandString(cents: number): string {
  if (cents === 0) return '';
  return (cents / 100).toFixed(2);
}

/**
 * F2: the confirm dialog used to always say "Historical transactions will
 * keep their envelope name. You cannot undo this." — true, but silent about
 * the bigger effect: `calculateBudgetBalance` (BudgetBalanceCalculator.ts)
 * skips archived envelopes entirely, so an envelope's WHOLE `allocatedCents`
 * — its allocation for this period, or a persistent envelope's monthly
 * contribution, both counted identically toward `totalAllocated` — stops
 * being counted the moment it archives. For every type except 'income' that
 * makes `toAssign` (= incomeTotal - expenseAllocationTotal) go UP by exactly
 * that amount; for 'income' it makes `toAssign` go DOWN by that amount
 * instead, since removing an income row lowers `incomeTotal` too. This
 * builds copy that actually says which of those happens, so a household
 * archiving "Car Repairs" is told its R2,000 is about to land back in "To
 * assign" instead of finding out from a number changing with no
 * explanation.
 */
function buildArchiveConfirmMessage(envelope: EnvelopeEntity): string {
  const { name, allocatedCents, spentCents, envelopeType } = envelope;

  if (allocatedCents === 0) {
    return 'Historical transactions will keep their envelope name. You can not undo this.';
  }

  if (envelopeType === 'income') {
    return (
      `Archiving "${name}" removes ${formatCurrency(allocatedCents)} of income from this ` +
      `period, so your To assign total goes down by that amount. You can not undo this.`
    );
  }

  const spentNote =
    spentCents > 0
      ? ` The ${formatCurrency(spentCents)} already spent from it stays in your transaction history.`
      : '';

  return (
    `Archiving "${name}" returns its ${formatCurrency(allocatedCents)} allocation to your ` +
    `To assign total.${spentNote} You can not undo this.`
  );
}

export const AddEditEnvelopeScreen: React.FC<AddEditEnvelopeScreenProps> = ({
  route,
  navigation,
}) => {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);
  const enqueue = useToastStore((s) => s.enqueue);
  const envelopeId = route.params?.envelopeId;

  const [existing, setExisting] = useState<EnvelopeEntity | null>(null);
  const [name, setName] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [envelopeType, setEnvelopeType] = useState<EnvelopeType>('spending');
  const [targetAmountStr, setTargetAmountStr] = useState('');
  const [targetDateStr, setTargetDateStr] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only meaningful for a PERSISTENT envelope: the money actually in the
  // fund, derived from the contribution ledger. `allocatedCents` (the field
  // above) is the MONTHLY contribution, which is exactly why correcting the
  // balance needs its own path instead of being typed over that field.
  const [savedCents, setSavedCents] = useState(0);
  const [adjusting, setAdjusting] = useState(false);

  // Apply preselectedType param on mount (only for new envelopes)
  const preselectedType = route.params?.preselectedType;
  useEffect(() => {
    if (!envelopeId && preselectedType) {
      setEnvelopeType(preselectedType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    navigation.setOptions({ title: envelopeId ? 'Edit Envelope' : 'Add Envelope' });
    if (envelopeId) {
      db.select()
        .from(envelopesTable)
        .where(eq(envelopesTable.id, envelopeId))
        .limit(1)
        .then(async ([row]) => {
          if (row) {
            // spentCents is derived from the transaction ledger, not a stored column.
            const spentByEnvelope = await getEnvelopeSpentCents(
              db,
              row.householdId,
              row.periodStart,
            );
            setExisting({
              ...row,
              spentCents: spentByEnvelope.get(row.id) ?? 0,
            } as EnvelopeEntity);
            if (
              getEnvelopeScope({ envelopeType: row.envelopeType as EnvelopeType }) === 'persistent'
            ) {
              const saved = await getPersistentEnvelopeSavedCents(db, row.householdId);
              setSavedCents(saved.get(row.id) ?? 0);
            }
            setName(row.name);
            setAmountStr(toRandString(row.allocatedCents));
            setEnvelopeType(row.envelopeType as EnvelopeType);
            if (row.envelopeType === 'sinking_fund') {
              if (row.targetAmountCents != null) {
                setTargetAmountStr(toRandString(row.targetAmountCents));
              }
              if (row.targetDate != null) {
                setTargetDateStr(row.targetDate);
              }
            }
          }
        });
    }
  }, [envelopeId, navigation]);

  const handleSave = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const parsedAmount = parseMoneyInput(amountStr);
      if (!parsedAmount.ok) {
        setError(parsedAmount.error);
        return;
      }
      const allocatedCents = parsedAmount.cents;
      const period = engine.getCurrentPeriod(paydayDay);
      const periodStart = formatPeriodDateKey(period.startDate);

      let targetAmountCents: number | null = null;
      // Trim before the truthiness check so a whitespace-only entry counts as
      // "no target set" (skip parsing), matching how "" behaves — otherwise
      // "   " would hit parseMoneyInput's ERR_EMPTY and wrongly block save.
      const trimmedTargetAmount = targetAmountStr.trim();
      if (envelopeType === 'sinking_fund' && trimmedTargetAmount) {
        const parsedTarget = parseMoneyInput(trimmedTargetAmount);
        if (!parsedTarget.ok) {
          setError(parsedTarget.error);
          return;
        }
        targetAmountCents = parsedTarget.cents;
      }
      const targetDate =
        envelopeType === 'sinking_fund' && targetDateStr.trim() ? targetDateStr.trim() : null;

      let result;
      try {
        if (existing) {
          const uc = new UpdateEnvelopeUseCase(db, audit, existing, {
            name,
            allocatedCents,
            envelopeType,
            targetAmountCents,
            targetDate,
          });
          result = await uc.execute();
        } else {
          const uc = new CreateEnvelopeUseCase(db, audit, {
            householdId,
            name,
            allocatedCents,
            envelopeType,
            periodStart,
            targetAmountCents,
            targetDate,
          });
          result = await uc.execute();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save envelope');
        return;
      }

      if (result.success) {
        enqueue('Envelope saved', 'success');
        navigation.goBack();
      } else {
        setError(result.error.message);
      }
    } finally {
      setLoading(false);
    }
  }, [
    name,
    amountStr,
    envelopeType,
    targetAmountStr,
    targetDateStr,
    existing,
    householdId,
    paydayDay,
    navigation,
    enqueue,
  ]);

  const handleArchive = useCallback(async (): Promise<void> => {
    if (!existing) return;

    const scope = getEnvelopeScope({ envelopeType: existing.envelopeType });

    // A persistent envelope's SAVED balance
    // (`getPersistentEnvelopeSavedCents`) is untouched by archiving — it is
    // still sitting in the contribution ledger — but every screen that
    // shows it (BudgetScreen, SinkingFundsScreen, DashboardScreen) reads it
    // through `useEnvelopes`, which filters `is_archived = 0`. So an
    // archived fund's saved money silently stops appearing ANYWHERE in the
    // household's picture, even though it is not gone. That is worse than a
    // copy problem, so block instead of just warning: send the household to
    // the existing "Adjust saved amount" flow to move/withdraw it first.
    if (scope === 'persistent' && savedCents !== 0) {
      await confirm({
        title: 'Move the saved balance first',
        message:
          `"${existing.name}" still has ${formatCurrency(savedCents)} saved. ` +
          `That money stays in the ledger, but archiving would stop every screen from showing ` +
          `it — nowhere in the app would account for it anymore. Use "Adjust saved amount" to ` +
          `move or withdraw the balance before archiving.`,
        confirmLabel: 'Got it',
        destructive: false,
      });
      return;
    }

    const confirmed = await confirm({
      title: 'Archive envelope?',
      message: buildArchiveConfirmMessage(existing),
      confirmLabel: 'Archive',
      destructive: true,
    });
    if (!confirmed) return;

    const uc = new ArchiveEnvelopeUseCase(db, audit, existing);
    const result = await uc.execute();
    if (result.success) {
      enqueue('Envelope archived', 'success');
      navigation.goBack();
    } else {
      setError('Failed to archive envelope');
    }
  }, [existing, savedCents, navigation, enqueue]);

  const reloadSavedCents = useCallback(async (): Promise<void> => {
    if (!existing) return;
    const saved = await getPersistentEnvelopeSavedCents(db, existing.householdId);
    setSavedCents(saved.get(existing.id) ?? 0);
  }, [existing]);

  const handleAdjustDone = useCallback(
    (adjusted: boolean): void => {
      setAdjusting(false);
      if (adjusted) void reloadSavedCents();
    },
    [reloadSavedCents],
  );

  const isPersistent = getEnvelopeScope({ envelopeType }) === 'persistent';

  const amountLabel =
    getEnvelopeScope({ envelopeType }) === 'persistent'
      ? 'Monthly contribution (R)'
      : 'Monthly budget (R)';

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <TextInput
          label="Envelope name"
          value={name}
          onChangeText={setName}
          mode="outlined"
          testID="envelope-name"
          style={[styles.input, { backgroundColor: colors.surface }]}
          disabled={loading}
          placeholder="e.g. Groceries"
        />

        <TextInput
          label={amountLabel}
          value={amountStr}
          onChangeText={setAmountStr}
          mode="outlined"
          testID="envelope-amount"
          style={[styles.input, { backgroundColor: colors.surface }]}
          keyboardType="decimal-pad"
          disabled={loading}
          placeholder="0.00"
          left={<TextInput.Affix text="R" />}
        />

        <Text variant="labelLarge" style={[styles.typeLabel, { color: colors.onSurface }]}>
          Type
        </Text>
        {existing ? (
          // Locked in edit mode: SegmentedButtons only lists 4 of the 7
          // EnvelopeTypes, so editing a sinking_fund/emergency_fund/baby_step
          // envelope previously showed nothing selected, and one tap silently
          // converted it to whichever button was pressed (UX-10). Changing
          // type after creation is also constrained by UpdateEnvelopeUseCase
          // (scope lock, income-with-spend guard) — showing it read-only
          // here avoids surfacing a control that can't safely be used anyway.
          <Text
            variant="bodyLarge"
            style={[styles.typeReadOnly, { color: colors.onSurfaceVariant }]}
            testID="envelope-type-readonly"
          >
            {ENVELOPE_TYPE_LABELS[envelopeType]}
          </Text>
        ) : (
          <SegmentedButtons
            value={envelopeType}
            onValueChange={(v) => setEnvelopeType(v as EnvelopeType)}
            buttons={[
              { value: 'income', label: 'Income' },
              { value: 'spending', label: 'Spending' },
              { value: 'savings', label: 'Savings' },
              { value: 'utility', label: 'Utility' },
            ]}
            style={styles.segmented}
          />
        )}

        {envelopeType === 'sinking_fund' && (
          <>
            <TextInput
              label="Target amount (R)"
              value={targetAmountStr}
              onChangeText={setTargetAmountStr}
              keyboardType="decimal-pad"
              mode="outlined"
              testID="target-amount-input"
              style={[styles.input, { backgroundColor: colors.surface }]}
              disabled={loading}
            />
            <DateField
              label="Target date"
              placeholder="Select a target date"
              value={targetDateStr || null}
              onChange={setTargetDateStr}
              maximumDate={null}
              disabled={loading}
              testID="target-date-input"
            />
          </>
        )}

        <Button
          mode="contained"
          onPress={handleSave}
          loading={loading}
          disabled={loading}
          style={styles.button}
          contentStyle={styles.buttonContent}
          testID="envelope-save"
        >
          {existing ? 'Save Changes' : 'Add Envelope'}
        </Button>

        {existing && isPersistent && (
          <Button
            mode="outlined"
            icon="cash-plus"
            onPress={() => setAdjusting(true)}
            style={styles.adjustButton}
            contentStyle={styles.buttonContent}
            testID="adjust-saved-amount-button"
          >
            {`Adjust saved amount (${formatCurrency(savedCents)})`}
          </Button>
        )}

        {existing && (
          <Button
            mode="outlined"
            icon="archive-outline"
            onPress={handleArchive}
            textColor={colors.error}
            style={[styles.archiveButton, { borderColor: colors.error }]}
            contentStyle={styles.buttonContent}
            testID="archive-envelope-button"
          >
            Archive Envelope
          </Button>
        )}
      </ScrollView>

      {existing && isPersistent && (
        <AdjustSavedAmountDialog
          visible={adjusting}
          householdId={existing.householdId}
          envelopeId={existing.id}
          envelopeName={existing.name}
          savedCents={savedCents}
          periodStart={existing.periodStart}
          onDone={handleAdjustDone}
        />
      )}

      <Snackbar
        visible={error !== null}
        onDismiss={() => setError(null)}
        duration={4000}
        action={{ label: 'OK', onPress: () => setError(null) }}
        accessibilityLiveRegion="polite"
      >
        {error}
      </Snackbar>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: spacing.base, gap: spacing.sm },
  input: {},
  typeLabel: { marginTop: spacing.sm },
  typeReadOnly: { marginTop: spacing.xs },
  segmented: { marginTop: spacing.xs },
  button: { marginTop: spacing.lg },
  adjustButton: { marginTop: spacing.sm },
  archiveButton: { marginTop: spacing.sm },
  buttonContent: { paddingVertical: spacing.xs },
});
