import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Text, TextInput, Button, SegmentedButtons, Snackbar } from 'react-native-paper';
import { eq } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { envelopes as envelopesTable } from '../../../data/local/schema';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { CreateEnvelopeUseCase } from '../../../domain/envelopes/CreateEnvelopeUseCase';
import { UpdateEnvelopeUseCase } from '../../../domain/envelopes/UpdateEnvelopeUseCase';
import { ArchiveEnvelopeUseCase } from '../../../domain/envelopes/ArchiveEnvelopeUseCase';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        enqueue('Envelope saved', 'success');
        navigation.goBack();
      } else {
        setError(result.error.message);
      }
    } finally {
      setLoading(false);
    }
  }, [name, amountStr, envelopeType, existing, householdId, paydayDay, navigation, enqueue]);

  const handleArchive = useCallback((): void => {
    if (!existing) return;
    Alert.alert(
      'Archive envelope?',
      'Historical transactions will keep their envelope name. You can not undo this.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: async (): Promise<void> => {
            const uc = new ArchiveEnvelopeUseCase(db, audit, existing);
            const result = await uc.execute();
            if (result.success) {
              enqueue('Envelope archived', 'success');
              navigation.goBack();
            } else {
              setError('Failed to archive envelope');
            }
          },
        },
      ],
    );
  }, [existing, navigation, enqueue]);

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
          label="Monthly budget (R)"
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
  segmented: { marginTop: spacing.xs },
  button: { marginTop: spacing.lg },
  archiveButton: { marginTop: spacing.sm },
  buttonContent: { paddingVertical: spacing.xs },
});
