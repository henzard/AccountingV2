/**
 * AdjustSavedAmountDialog — the one place a user can correct a persistent
 * envelope's SAVED balance by hand.
 *
 * A fund's balance is derived from the contribution ledger, so it only ever
 * knew about money the app itself moved. Money that was already in an
 * emergency fund before the household started budgeting here, or cash taken
 * out without a transaction being logged, had no way in or out — and the only
 * workaround was to type the figure into the monthly-contribution field,
 * which is exactly the confusion the ledger exists to end. This writes a real
 * `adjustment` row instead (see `AdjustSavedBalanceUseCase`).
 *
 * The reason is required but stays on this device — the synced row carries
 * only the source and the signed amount, because a new column on a
 * contribution row would break pulls on already-shipped clients.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { db } from '../../../data/local/db';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { AdjustSavedBalanceUseCase } from '../../../domain/budgets/AdjustSavedBalanceUseCase';
import { useToastStore } from '../../stores/toastStore';
import { formatCurrency } from '../../utils/currency';
import { parseMoneyInput } from '../../utils/parseMoneyInput';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

const audit = new AuditLogger(db);

export interface AdjustSavedAmountDialogProps {
  visible: boolean;
  householdId: string;
  envelopeId: string;
  envelopeName: string;
  /** The fund's current saved balance, shown so the user can see what they are changing. */
  savedCents: number;
  /** ISO date (YYYY-MM-DD) of the period the adjustment is recorded against. */
  periodStart: string;
  /** Closes the dialog. `adjusted` is true only when a row was actually written. */
  onDone: (adjusted: boolean) => void;
}

type Direction = 'add' | 'remove';

export function AdjustSavedAmountDialog({
  visible,
  householdId,
  envelopeId,
  envelopeName,
  savedCents,
  periodStart,
  onDone,
}: AdjustSavedAmountDialogProps): React.JSX.Element | null {
  const { colors } = useAppTheme();
  const enqueue = useToastStore((s) => s.enqueue);

  const [direction, setDirection] = useState<Direction>('add');
  const [amountStr, setAmountStr] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Each opening starts clean: a half-typed correction left behind from last
  // time is the kind of thing that gets committed against the wrong fund.
  useEffect(() => {
    if (visible) {
      setDirection('add');
      setAmountStr('');
      setNote('');
      setError(null);
    }
  }, [visible, envelopeId]);

  const handleSave = useCallback(async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const parsed = parseMoneyInput(amountStr);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      if (parsed.cents === 0) {
        setError('Enter an amount to add or take out');
        return;
      }

      const result = await new AdjustSavedBalanceUseCase(db, audit).execute({
        householdId,
        envelopeId,
        deltaCents: direction === 'add' ? parsed.cents : -parsed.cents,
        note,
        periodStart,
      });

      if (!result.success) {
        setError(result.error.message);
        return;
      }
      enqueue(`Saved balance is now ${formatCurrency(result.data.savedCentsAfter)}`, 'success');
      onDone(true);
    } finally {
      setSaving(false);
    }
  }, [amountStr, direction, note, householdId, envelopeId, periodStart, enqueue, onDone]);

  if (!visible) return null;

  return (
    <Portal>
      <Dialog
        visible
        onDismiss={(): void => {
          if (!saving) onDone(false);
        }}
        testID="adjust-saved-dialog"
      >
        <Dialog.Title>{`Adjust ${envelopeName}`}</Dialog.Title>
        <Dialog.Content>
          <Text style={{ color: colors.onSurfaceVariant }}>
            {`Saved right now: ${formatCurrency(savedCents)}`}
          </Text>

          <SegmentedButtons
            value={direction}
            onValueChange={(v): void => setDirection(v as Direction)}
            buttons={[
              { value: 'add', label: 'Add' },
              { value: 'remove', label: 'Take out' },
            ]}
            style={styles.segmented}
          />

          <TextInput
            label="Amount (R)"
            value={amountStr}
            onChangeText={setAmountStr}
            mode="outlined"
            keyboardType="decimal-pad"
            disabled={saving}
            left={<TextInput.Affix text="R" />}
            testID="adjust-saved-amount"
            style={styles.input}
          />

          {/* Required, but kept on this device only — a synced reason would
              need a new column on the contribution row, which older clients
              cannot apply (see AdjustSavedBalanceUseCase). The label says so
              rather than implying the household will see it. */}
          <TextInput
            label="Why? (kept in this device's history)"
            value={note}
            onChangeText={setNote}
            mode="outlined"
            disabled={saving}
            placeholder="e.g. Moved in from the old savings account"
            testID="adjust-saved-note"
            style={styles.input}
          />

          {error !== null && (
            <View style={styles.errorRow}>
              <Text testID="adjust-saved-error" style={{ color: colors.error }}>
                {error}
              </Text>
            </View>
          )}
        </Dialog.Content>
        <Dialog.Actions>
          <Button
            onPress={(): void => onDone(false)}
            disabled={saving}
            testID="adjust-saved-cancel"
          >
            Cancel
          </Button>
          <Button
            onPress={handleSave}
            loading={saving}
            disabled={saving}
            testID="adjust-saved-confirm"
          >
            Save
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  segmented: { marginTop: spacing.sm },
  input: { marginTop: spacing.sm },
  errorRow: { marginTop: spacing.sm },
});
