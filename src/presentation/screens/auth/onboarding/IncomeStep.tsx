import React, { useState } from 'react';
import { StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { db } from '../../../../data/local/db';
import { AuditLogger } from '../../../../data/audit/AuditLogger';
import { CreateEnvelopeUseCase } from '../../../../domain/envelopes/CreateEnvelopeUseCase';
import { BudgetPeriodEngine } from '../../../../domain/shared/BudgetPeriodEngine';
import { useAppStore } from '../../../stores/appStore';
import { colours, spacing } from '../../../theme/tokens';
import type { OnboardingStackParamList } from './OnboardingNavigator';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Income'>;

const audit = new AuditLogger(db);
const engine = new BudgetPeriodEngine();

function toCents(str: string): number {
  const n = parseFloat(str.replace(',', '.'));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

export function IncomeStep(): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);

  const [amountStr, setAmountStr] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNext = async (): Promise<void> => {
    setError(null);
    const cents = toCents(amountStr);
    if (cents <= 0) {
      setError('Please enter a valid monthly income amount');
      return;
    }

    setLoading(true);
    try {
      const period = engine.getCurrentPeriod(paydayDay);
      const periodStart = format(period.startDate, 'yyyy-MM-dd');

      const uc = new CreateEnvelopeUseCase(db, audit, {
        householdId,
        name: 'Monthly Income',
        allocatedCents: cents,
        envelopeType: 'income',
        periodStart,
      });
      const result = await uc.execute();
      if (!result.success) {
        setError(result.error.message);
        return;
      }
    } finally {
      setLoading(false);
    }

    navigation.navigate('ExpenseCategories');
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text variant="headlineMedium" style={styles.title}>
          What's your monthly income?
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          This helps us plan your budget envelopes.
        </Text>

        <TextInput
          label="Monthly income (R)"
          value={amountStr}
          onChangeText={setAmountStr}
          mode="outlined"
          style={styles.input}
          keyboardType="decimal-pad"
          disabled={loading}
          placeholder="0.00"
          left={<TextInput.Affix text="R" />}
        />
        {error !== null && (
          <HelperText type="error" visible>
            {error}
          </HelperText>
        )}

        <Button
          mode="contained"
          onPress={handleNext}
          loading={loading}
          disabled={loading}
          style={styles.button}
          contentStyle={styles.buttonContent}
        >
          Next
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  container: { flexGrow: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.base },
  title: { color: colours.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  subtitle: { color: colours.onSurfaceVariant, marginBottom: spacing.base },
  input: { backgroundColor: colours.surface },
  button: { marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.xs },
});
