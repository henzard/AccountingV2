import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { Text, TextInput, Button, Snackbar, TouchableRipple, Surface } from 'react-native-paper';
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
import { colours, spacing, radius } from '../../theme/tokens';
import type { AddTransactionScreenProps } from '../../navigation/types';
import type { EnvelopeType } from '../../../domain/envelopes/EnvelopeEntity';

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();

interface EnvelopeOption {
  id: string;
  name: string;
  allocatedCents: number;
  spentCents: number;
  envelopeType: EnvelopeType;
}

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
    return balance < 0 ? colours.error : colours.onSurfaceVariant;
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text variant="labelLarge" style={styles.label}>
          Envelope
        </Text>
        <TouchableRipple
          onPress={() => setShowPicker(true)}
          style={styles.pickerButton}
          testID="envelope-picker-trigger"
        >
          <View style={styles.pickerInner}>
            <Text
              variant="bodyLarge"
              style={selectedEnvelope ? styles.pickerValue : styles.pickerPlaceholder}
            >
              {selectedEnvelope ? selectedEnvelope.name : 'Select envelope…'}
            </Text>
            {selectedEnvelope && (
              <Text
                variant="bodySmall"
                style={{
                  color: balanceColor(selectedEnvelope),
                  marginRight: spacing.sm,
                }}
              >
                {formatBalance(selectedEnvelope)} left
              </Text>
            )}
            <Text style={styles.pickerChevron}>›</Text>
          </View>
        </TouchableRipple>

        <TextInput
          label="Amount (R)"
          value={amountStr}
          onChangeText={setAmountStr}
          mode="outlined"
          style={styles.input}
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
          style={styles.input}
          disabled={loading}
          placeholder="e.g. Checkers"
        />

        <TextInput
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          mode="outlined"
          style={styles.input}
          disabled={loading}
          placeholder="e.g. Weekly groceries"
        />

        {/* Date picker row */}
        <TouchableRipple
          onPress={() => setShowDatePicker(true)}
          style={styles.dateButton}
          testID="date-picker-trigger"
        >
          <View style={styles.pickerInner}>
            <Text variant="bodyMedium" style={styles.dateLabel}>
              Date
            </Text>
            <Text variant="bodyMedium" style={styles.dateValue}>
              {format(transactionDate, 'd MMM yyyy')}
            </Text>
          </View>
        </TouchableRipple>

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
      </ScrollView>

      {/* Envelope picker modal */}
      <Modal
        visible={showPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPicker(false)}
        accessibilityViewIsModal
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          onPress={() => setShowPicker(false)}
          activeOpacity={1}
          accessibilityLabel="Close envelope picker"
          accessibilityRole="button"
        >
          <Surface style={styles.modalSheet} elevation={4}>
            <View style={styles.modalHandle} />
            <Text variant="titleMedium" style={styles.modalTitle}>
              Select Envelope
            </Text>
            <FlatList
              data={envelopes}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const balance = item.allocatedCents - item.spentCents;
                return (
                  <TouchableRipple
                    onPress={() => {
                      setSelectedEnvelope(item);
                      setShowPicker(false);
                    }}
                    style={styles.modalItem}
                    testID={`envelope-option-${item.id}`}
                  >
                    <View style={styles.modalItemInner}>
                      <Text
                        variant="bodyLarge"
                        style={
                          selectedEnvelope?.id === item.id
                            ? styles.modalItemSelected
                            : styles.modalItemText
                        }
                      >
                        {item.name}
                      </Text>
                      <Text
                        variant="bodySmall"
                        style={{
                          color: balance < 0 ? colours.error : colours.onSurfaceVariant,
                        }}
                        testID={`envelope-balance-${item.id}`}
                      >
                        {formatBalance(item)} left
                      </Text>
                    </View>
                  </TouchableRipple>
                );
              }}
              ListEmptyComponent={
                <View style={styles.center}>
                  <Text variant="bodyMedium" style={{ color: colours.onSurfaceVariant }}>
                    No envelopes for this period. Add envelopes first.
                  </Text>
                </View>
              }
            />
          </Surface>
        </TouchableOpacity>
      </Modal>

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
  flex: { flex: 1, backgroundColor: colours.surface },
  container: { padding: spacing.base, gap: spacing.sm },
  label: { color: colours.onSurface, marginTop: spacing.xs },
  input: { backgroundColor: colours.surface },
  pickerButton: {
    borderWidth: 1,
    borderColor: colours.outline,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
  },
  pickerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
  },
  pickerValue: { flex: 1, color: colours.onSurface },
  pickerPlaceholder: { flex: 1, color: colours.onSurfaceVariant },
  pickerChevron: { color: colours.onSurfaceVariant, fontSize: 20 },
  dateButton: {
    borderWidth: 1,
    borderColor: colours.outline,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
  },
  dateLabel: { flex: 1, color: colours.onSurfaceVariant },
  dateValue: { color: colours.onSurface },
  button: { marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.xs },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colours.scrim },
  modalSheet: {
    backgroundColor: colours.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingBottom: spacing.xl,
    maxHeight: '60%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: colours.outlineVariant,
    borderRadius: radius.full,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  modalTitle: {
    color: colours.onSurface,
    fontFamily: 'PlusJakartaSans_700Bold',
    paddingHorizontal: spacing.base,
    marginBottom: spacing.sm,
  },
  modalItem: { paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  modalItemInner: { gap: 2 },
  modalItemText: { color: colours.onSurface },
  modalItemSelected: { color: colours.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  center: { padding: spacing.base },
});
