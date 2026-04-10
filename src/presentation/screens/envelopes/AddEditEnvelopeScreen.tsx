import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, SegmentedButtons, Snackbar } from 'react-native-paper';
import { eq } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { envelopes as envelopesTable } from '../../../data/local/schema';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { CreateEnvelopeUseCase } from '../../../domain/envelopes/CreateEnvelopeUseCase';
import { UpdateEnvelopeUseCase } from '../../../domain/envelopes/UpdateEnvelopeUseCase';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing } from '../../theme/tokens';
import type { AddEditEnvelopeScreenProps } from '../../navigation/types';
import type { EnvelopeEntity, EnvelopeType } from '../../../domain/envelopes/EnvelopeEntity';
import { format } from 'date-fns';

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();

function toCents(randStr: string): number {
  const n = parseFloat(randStr.replace(',', '.'));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

function toRandString(cents: number): string {
  if (cents === 0) return '';
  return (cents / 100).toFixed(2);
}

export const AddEditEnvelopeScreen: React.FC<AddEditEnvelopeScreenProps> = ({ route, navigation }) => {
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);
  const envelopeId = route.params?.envelopeId;

  const [existing, setExisting] = useState<EnvelopeEntity | null>(null);
  const [name, setName] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [envelopeType, setEnvelopeType] = useState<EnvelopeType>('spending');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: envelopeId ? 'Edit Envelope' : 'Add Envelope' });
    if (envelopeId) {
      db.select()
        .from(envelopesTable)
        .where(eq(envelopesTable.id, envelopeId))
        .limit(1)
        .then(([row]) => {
          if (row) {
            setExisting(row as EnvelopeEntity);
            setName(row.name);
            setAmountStr(toRandString(row.allocatedCents));
            setEnvelopeType(row.envelopeType as EnvelopeType);
          }
        });
    }
  }, [envelopeId, navigation]);

  const handleSave = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const allocatedCents = toCents(amountStr);
      const period = engine.getCurrentPeriod(paydayDay);
      const periodStart = format(period.startDate, 'yyyy-MM-dd');

      let result;
      if (existing) {
        const uc = new UpdateEnvelopeUseCase(db, audit, existing, { name, allocatedCents });
        result = await uc.execute();
      } else {
        const uc = new CreateEnvelopeUseCase(db, audit, {
          householdId,
          name,
          allocatedCents,
          envelopeType,
          periodStart,
        });
        result = await uc.execute();
      }

      if (result.success) {
        navigation.goBack();
      } else {
        setError(result.error.message);
      }
    } finally {
      setLoading(false);
    }
  }, [name, amountStr, envelopeType, existing, householdId, paydayDay, navigation]);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <TextInput
          label="Envelope name"
          value={name}
          onChangeText={setName}
          mode="outlined"
          style={styles.input}
          disabled={loading}
          placeholder="e.g. Groceries"
        />

        <TextInput
          label="Monthly budget (R)"
          value={amountStr}
          onChangeText={setAmountStr}
          mode="outlined"
          style={styles.input}
          keyboardType="decimal-pad"
          disabled={loading}
          placeholder="0.00"
          left={<TextInput.Affix text="R" />}
        />

        <Text variant="labelLarge" style={styles.typeLabel}>
          Type
        </Text>
        <SegmentedButtons
          value={envelopeType}
          onValueChange={(v) => setEnvelopeType(v as EnvelopeType)}
          buttons={[
            { value: 'spending', label: 'Spending' },
            { value: 'savings', label: 'Savings' },
            { value: 'utility', label: 'Utility' },
          ]}
          style={styles.segmented}
        />

        <Button
          mode="contained"
          onPress={handleSave}
          loading={loading}
          disabled={loading}
          style={styles.button}
          contentStyle={styles.buttonContent}
        >
          {existing ? 'Save Changes' : 'Add Envelope'}
        </Button>
      </ScrollView>

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
  input: { backgroundColor: colours.surface },
  typeLabel: { color: colours.onSurface, marginTop: spacing.sm },
  segmented: { marginTop: spacing.xs },
  button: { marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.xs },
});
