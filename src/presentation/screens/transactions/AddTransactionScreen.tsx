import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, Snackbar } from 'react-native-paper';
import DateTimePicker from '@react-native-community/datetimepicker';
import { and, eq, ne } from 'drizzle-orm';
import { format } from 'date-fns';
import { db } from '../../../data/local/db';
import { envelopes as envelopesTable } from '../../../data/local/schema';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { CreateTransactionUseCase } from '../../../domain/transactions/CreateTransactionUseCase';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { useToastStore } from '../../stores/toastStore';
import { useAppStore } from '../../stores/appStore';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { AddTransactionScreenProps } from '../../navigation/types';
import { EnvelopePickerSheet } from '../../screens/slipScanning/components/EnvelopePickerSheet';
import type { EnvelopeOption } from '../../screens/slipScanning/components/EnvelopePickerSheet';
import { PickerField } from '../../components/shared/PickerField';

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();

function toCents(randStr: string): number {
  const n = parseFloat(randStr.replace(',', '.'));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

function formatBalance(env: EnvelopeOption): string {
  const balance = env.allocatedCents - env.spentCents;
  const absR = Math.abs(balance / 100).toFixed(2);
  return balance < 0 ? `-R${absR}` : `R${absR}`;
}

export const AddTransactionScreen: React.FC<AddTransactionScreenProps> = ({ navigation }) => {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);
  const enqueue = useToastStore((s) => s.enqueue);

  const period = engine.getCurrentPeriod(paydayDay);
  const periodStart = format(period.startDate, 'yyyy-MM-dd');

  const [envelopes, setEnvelopes] = useState<EnvelopeOption[]>([]);
  const [selectedEnvelope, setSelectedEnvelope] = useState<EnvelopeOption | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [amountStr, setAmountStr] = useState('');
  const [payee, setPayee] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Date picker
  const [transactionDate, setTransactionDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    db.select({
      id: envelopesTable.id,
      name: envelopesTable.name,
      allocatedCents: envelopesTable.allocatedCents,
      spentCents: envelopesTable.spentCents,
      envelopeType: envelopesTable.envelopeType,
    })
      .from(envelopesTable)
      .where(
        and(
          eq(envelopesTable.householdId, householdId),
          eq(envelopesTable.periodStart, periodStart),
          eq(envelopesTable.isArchived, false),
          // Exclude income-type envelopes per domain rule
          ne(envelopesTable.envelopeType, 'income'),
        ),
      )
      .then((rows) => {
        setEnvelopes(rows as EnvelopeOption[]);
        if (rows.length === 1) setSelectedEnvelope(rows[0] as EnvelopeOption);
      });
  }, [householdId, periodStart]);

  const handleSave = useCallback(async () => {
    if (!selectedEnvelope) {
      setError('Please select an envelope');
      return;
    }
    const cents = toCents(amountStr);
    if (cents <= 0) {
      setError('Amount must be greater than R0');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const uc = new CreateTransactionUseCase(db, audit, {
        householdId,
        envelopeId: selectedEnvelope.id,
        amountCents: cents,
        payee: payee.trim() || null,
        description: description.trim() || null,
        transactionDate: format(transactionDate, 'yyyy-MM-dd'),
      });
      const result = await uc.execute();
      if (result.success) {
        enqueue('Transaction saved', 'success');
        navigation.goBack();
      } else {
        setError(result.error.message);
      }
    } finally {
      setLoading(false);
    }
  }, [
    selectedEnvelope,
    amountStr,
    payee,
    description,
    householdId,
    transactionDate,
    navigation,
    enqueue,
  ]);

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
          style={[styles.input, { backgroundColor: colors.surface }]}
          disabled={loading}
          placeholder="e.g. Checkers"
        />

        <TextInput
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          mode="outlined"
          style={[styles.input, { backgroundColor: colors.surface }]}
          disabled={loading}
          placeholder="e.g. Weekly groceries"
        />

        {/* Date picker row */}
        <PickerField
          label="Date"
          value={format(transactionDate, 'd MMM yyyy')}
          onPress={() => setShowDatePicker(true)}
          testID="date-picker-trigger"
        />

        {showDatePicker && (
          <DateTimePicker
            value={transactionDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            maximumDate={new Date()}
            onChange={(_, date) => {
              setShowDatePicker(false);
              if (date) setTransactionDate(date);
            }}
          />
        )}

        <Button
          mode="contained"
          onPress={handleSave}
          loading={loading}
          disabled={loading}
          style={styles.button}
          contentStyle={styles.buttonContent}
        >
          Record Transaction
        </Button>

        <Button
          mode="outlined"
          onPress={() => navigation.navigate('SlipScanning' as never)}
          style={styles.button}
          contentStyle={styles.buttonContent}
          testID="scan-slip-button"
        >
          Scan slip
        </Button>
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
});
