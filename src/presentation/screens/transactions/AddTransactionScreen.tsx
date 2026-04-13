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
import { and, eq } from 'drizzle-orm';
import { format } from 'date-fns';
import { db } from '../../../data/local/db';
import { envelopes as envelopesTable } from '../../../data/local/schema';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { CreateTransactionUseCase } from '../../../domain/transactions/CreateTransactionUseCase';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing, radius } from '../../theme/tokens';
import type { AddTransactionScreenProps } from '../../navigation/types';

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();

interface EnvelopeOption {
  id: string;
  name: string;
}

function toCents(randStr: string): number {
  const n = parseFloat(randStr.replace(',', '.'));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

export const AddTransactionScreen: React.FC<AddTransactionScreenProps> = ({ navigation }) => {
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);

  const period = engine.getCurrentPeriod(paydayDay);
  const periodStart = format(period.startDate, 'yyyy-MM-dd');
  const today = format(new Date(), 'yyyy-MM-dd');

  const [envelopes, setEnvelopes] = useState<EnvelopeOption[]>([]);
  const [selectedEnvelope, setSelectedEnvelope] = useState<EnvelopeOption | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [amountStr, setAmountStr] = useState('');
  const [payee, setPayee] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    db.select({ id: envelopesTable.id, name: envelopesTable.name })
      .from(envelopesTable)
      .where(
        and(
          eq(envelopesTable.householdId, householdId),
          eq(envelopesTable.periodStart, periodStart),
          eq(envelopesTable.isArchived, false),
        ),
      )
      .then((rows) => {
        setEnvelopes(rows);
        if (rows.length === 1) setSelectedEnvelope(rows[0]);
      });
  }, [householdId, periodStart]);

  const handleSave = useCallback(async () => {
    if (!selectedEnvelope) {
      setError('Please select an envelope');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const uc = new CreateTransactionUseCase(db, audit, {
        householdId,
        envelopeId: selectedEnvelope.id,
        amountCents: toCents(amountStr),
        payee: payee.trim() || null,
        description: description.trim() || null,
        transactionDate: today,
      });
      const result = await uc.execute();
      if (result.success) {
        navigation.goBack();
      } else {
        setError(result.error.message);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedEnvelope, amountStr, payee, description, householdId, today, navigation]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text variant="labelLarge" style={styles.label}>
          Envelope
        </Text>
        <TouchableRipple onPress={() => setShowPicker(true)} style={styles.pickerButton}>
          <View style={styles.pickerInner}>
            <Text
              variant="bodyLarge"
              style={selectedEnvelope ? styles.pickerValue : styles.pickerPlaceholder}
            >
              {selectedEnvelope ? selectedEnvelope.name : 'Select envelope…'}
            </Text>
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

        <Text variant="bodySmall" style={styles.dateNote}>
          Date: {format(new Date(), 'd MMM yyyy')} (today)
        </Text>

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

      <Modal
        visible={showPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          onPress={() => setShowPicker(false)}
          activeOpacity={1}
        >
          <Surface style={styles.modalSheet} elevation={4}>
            <View style={styles.modalHandle} />
            <Text variant="titleMedium" style={styles.modalTitle}>
              Select Envelope
            </Text>
            <FlatList
              data={envelopes}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableRipple
                  onPress={() => {
                    setSelectedEnvelope(item);
                    setShowPicker(false);
                  }}
                  style={styles.modalItem}
                >
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
                </TouchableRipple>
              )}
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
  dateNote: { color: colours.onSurfaceVariant, marginTop: spacing.xs },
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
  modalItemText: { color: colours.onSurface },
  modalItemSelected: { color: colours.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  center: { padding: spacing.base },
});
