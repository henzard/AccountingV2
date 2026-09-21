import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, ScrollView, View, Switch } from 'react-native';
import { TextInput, Button, HelperText, Text } from 'react-native-paper';
import { and, eq, ne } from 'drizzle-orm';
import { format } from 'date-fns';
import { db } from '../../../data/local/db';
import { debts as debtsTable, envelopes as envelopesTable } from '../../../data/local/schema';
import {
  envelopeScopeCondition,
  getEnvelopeSpentCents,
} from '../../../data/local/balances/EnvelopeBalanceQuery';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { LogDebtPaymentUseCase } from '../../../domain/debtSnowball/LogDebtPaymentUseCase';
import { CreateTransactionUseCase } from '../../../domain/transactions/CreateTransactionUseCase';
import { DeleteTransactionUseCase } from '../../../domain/transactions/DeleteTransactionUseCase';
import type { TransactionEntity } from '../../../domain/transactions/TransactionEntity';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../../domain/shared/BudgetPeriodEngine';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { formatCurrency } from '../../utils/currency';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { DebtEntity } from '../../../domain/debtSnowball/DebtEntity';
import type { LogPaymentScreenProps } from '../../navigation/types';
import { parseMoneyInput } from '../../utils/parseMoneyInput';
import { PickerField } from '../../components/shared/PickerField';
import { EnvelopePickerSheet } from '../slipScanning/components/EnvelopePickerSheet';
import type { EnvelopeOption } from '../slipScanning/components/EnvelopePickerSheet';

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();

export const LogPaymentScreen: React.FC<LogPaymentScreenProps> = ({ navigation, route }) => {
  const { colors } = useAppTheme();
  const { debtId } = route.params;
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);
  const enqueue = useToastStore((s) => s.enqueue);
  const [debt, setDebt] = useState<DebtEntity | null>(null);
  const [amountRands, setAmountRands] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // VAL2-7: a debt payment only ever wrote to `debts` — the household then
  // had to enter the SAME spend a second time against an envelope for it to
  // show up in the budget. This lets that envelope transaction be created
  // in the same flow, optionally.
  const [takeFromEnvelope, setTakeFromEnvelope] = useState(false);
  const [envelopes, setEnvelopes] = useState<EnvelopeOption[]>([]);
  const [selectedEnvelope, setSelectedEnvelope] = useState<EnvelopeOption | null>(null);
  const [showEnvelopePicker, setShowEnvelopePicker] = useState(false);

  useEffect(() => {
    db.select()
      .from(debtsTable)
      .where(eq(debtsTable.id, debtId))
      .then((rows) => {
        const row = rows[0] as DebtEntity | undefined;
        if (row) setAmountRands((row.minimumPaymentCents / 100).toFixed(2));
        setDebt(row ?? null);
      })
      .catch(() => {
        setError('Failed to load debt details');
      });
  }, [debtId]);

  useEffect(() => {
    if (!householdId) return;
    const period = engine.getCurrentPeriod(paydayDay);
    const periodStart = formatPeriodDateKey(period.startDate);
    db.select({
      id: envelopesTable.id,
      name: envelopesTable.name,
      allocatedCents: envelopesTable.allocatedCents,
      envelopeType: envelopesTable.envelopeType,
      createdAt: envelopesTable.createdAt,
    })
      .from(envelopesTable)
      .where(
        and(
          eq(envelopesTable.householdId, householdId),
          envelopeScopeCondition(periodStart),
          eq(envelopesTable.isArchived, false),
          ne(envelopesTable.envelopeType, 'income'),
        ),
      )
      .then(async (rows) => {
        const spentByEnvelope = await getEnvelopeSpentCents(db, householdId, periodStart);
        setEnvelopes(
          rows.map((row) => ({
            ...row,
            spentCents: spentByEnvelope.get(row.id) ?? 0,
          })) as EnvelopeOption[],
        );
      })
      .catch(() => {
        enqueue('Failed to load envelopes', 'error');
      });
  }, [householdId, paydayDay, enqueue]);

  const handleSave = async (): Promise<void> => {
    if (!debt) return;
    const parsedAmount = parseMoneyInput(amountRands);
    if (!parsedAmount.ok) {
      setError(parsedAmount.error);
      return;
    }
    const amountCents = parsedAmount.cents;
    if (amountCents <= 0) {
      setError('Enter a valid payment amount');
      return;
    }
    if (takeFromEnvelope && !selectedEnvelope) {
      setError('Select an envelope, or turn off "Also take it from an envelope"');
      return;
    }

    setSaving(true);
    setError(null);

    // Non-null only once the envelope transaction has been created — used
    // to roll it back if the debt-payment write that must follow it fails.
    let createdTransaction: TransactionEntity | null = null;

    try {
      if (takeFromEnvelope && selectedEnvelope) {
        const txResult = await new CreateTransactionUseCase(db, audit, {
          householdId,
          envelopeId: selectedEnvelope.id,
          amountCents,
          payee: debt.creditorName,
          description: 'Debt payment',
          transactionDate: format(new Date(), 'yyyy-MM-dd'),
        }).execute();
        if (!txResult.success) {
          // Transaction failed — nothing has been logged at all.
          setError(txResult.error.message);
          return;
        }
        createdTransaction = txResult.data;
      }

      const uc = new LogDebtPaymentUseCase(db, audit, {
        householdId,
        debtId,
        paymentAmountCents: amountCents,
        currentDebt: debt,
      });
      const result = await uc.execute();
      if (result.success) {
        enqueue(
          result.data.isPaidOff ? `${debt.creditorName} is paid off! 🎉` : 'Payment logged',
          'success',
        );
        navigation.goBack();
        return;
      }

      // The debt payment failed AFTER the envelope transaction succeeded —
      // undo the transaction so the two ledgers don't drift apart.
      if (createdTransaction) {
        try {
          await new DeleteTransactionUseCase(db, audit, createdTransaction).execute();
        } catch {
          // Best-effort rollback; the surfaced error below still tells the
          // household the payment did not go through.
        }
      }
      setError(result.error.message);
    } catch (err) {
      if (createdTransaction) {
        try {
          await new DeleteTransactionUseCase(db, audit, createdTransaction).execute();
        } catch {
          // Best-effort rollback.
        }
      }
      setError(err instanceof Error ? err.message : 'Failed to log payment');
    } finally {
      setSaving(false);
    }
  };

  const envelopeTrailing = useCallback((env: EnvelopeOption): string => {
    return `${formatCurrency(env.allocatedCents - env.spentCents)} left`;
  }, []);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {debt && (
        <Text variant="bodyMedium" style={[styles.hint, { color: colors.onSurfaceVariant }]}>
          {`Outstanding: ${formatCurrency(debt.outstandingBalanceCents)}`}
        </Text>
      )}
      <TextInput
        label="Payment amount (R)"
        value={amountRands}
        onChangeText={setAmountRands}
        keyboardType="numeric"
        mode="outlined"
        style={[styles.input, { backgroundColor: colors.surface }]}
        autoFocus
        accessibilityHint="Required — enter the payment amount in rands"
      />

      <View style={styles.toggleRow}>
        <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
          Also take it from an envelope
        </Text>
        <Switch
          value={takeFromEnvelope}
          onValueChange={(v) => {
            setTakeFromEnvelope(v);
            if (!v) setSelectedEnvelope(null);
          }}
          testID="take-from-envelope-toggle"
          trackColor={{ true: colors.primary, false: colors.surfaceVariant }}
          thumbColor={colors.onPrimary}
        />
      </View>

      {takeFromEnvelope && (
        <PickerField
          placeholder="Select envelope…"
          value={selectedEnvelope?.name}
          trailing={selectedEnvelope ? envelopeTrailing(selectedEnvelope) : undefined}
          showChevron
          onPress={() => setShowEnvelopePicker(true)}
          testID="log-payment-envelope-picker-trigger"
        />
      )}

      <View accessibilityLiveRegion="polite">
        {error ? (
          <HelperText type="error" visible>
            {error}
          </HelperText>
        ) : null}
      </View>
      <Button
        mode="contained"
        onPress={handleSave}
        loading={saving}
        disabled={saving || !debt}
        style={[styles.button, { backgroundColor: colors.primary }]}
      >
        Record Payment
      </Button>

      <EnvelopePickerSheet
        visible={showEnvelopePicker}
        envelopes={envelopes}
        selectedId={selectedEnvelope?.id}
        onSelect={setSelectedEnvelope}
        onClose={() => setShowEnvelopePicker(false)}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { padding: spacing.base, gap: spacing.sm },
  hint: { marginBottom: spacing.sm },
  input: {},
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  button: { marginTop: spacing.base },
});
