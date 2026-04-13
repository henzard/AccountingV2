import React, { useState } from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { TextInput, Button, HelperText, SegmentedButtons, Text } from 'react-native-paper';
import { db } from '../../../data/local/db';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { CreateDebtUseCase } from '../../../domain/debtSnowball/CreateDebtUseCase';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { colours, spacing } from '../../theme/tokens';
import type { DebtType } from '../../../domain/debtSnowball/DebtEntity';
import type { AddDebtScreenProps } from '../../navigation/types';

const audit = new AuditLogger(db);

const DEBT_TYPES: { value: DebtType; label: string }[] = [
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'personal_loan', label: 'Personal Loan' },
  { value: 'store_account', label: 'Store Account' },
  { value: 'vehicle_finance', label: 'Vehicle Finance' },
  { value: 'bond', label: 'Bond' },
];

export const AddDebtScreen: React.FC<AddDebtScreenProps> = ({ navigation }) => {
  const householdId = useAppStore((s) => s.householdId)!;
  const enqueue = useToastStore((s) => s.enqueue);
  const [creditorName, setCreditorName] = useState('');
  const [debtType, setDebtType] = useState<DebtType>('credit_card');
  const [balanceRands, setBalanceRands] = useState('');
  const [ratePercent, setRatePercent] = useState('');
  const [minPaymentRands, setMinPaymentRands] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (): Promise<void> => {
    if (!creditorName.trim()) {
      setError('Creditor name is required');
      return;
    }
    const balanceCents = Math.round(parseFloat(balanceRands) * 100);
    const rate = parseFloat(ratePercent);
    const minPayCents = Math.round(parseFloat(minPaymentRands) * 100);

    if (isNaN(balanceCents) || balanceCents <= 0) {
      setError('Enter a valid outstanding balance');
      return;
    }
    if (isNaN(rate) || rate < 0) {
      setError('Enter a valid interest rate (0 for interest-free)');
      return;
    }
    if (isNaN(minPayCents) || minPayCents <= 0) {
      setError('Enter a valid minimum monthly payment');
      return;
    }

    setSaving(true);
    setError(null);
    const uc = new CreateDebtUseCase(db, audit, {
      householdId,
      creditorName: creditorName.trim(),
      debtType,
      outstandingBalanceCents: balanceCents,
      interestRatePercent: rate,
      minimumPaymentCents: minPayCents,
    });
    const result = await uc.execute();
    setSaving(false);
    if (result.success) {
      enqueue('Debt saved', 'success');
      navigation.goBack();
    } else {
      setError(result.error.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text variant="titleMedium" style={styles.sectionLabel}>
        Debt Type
      </Text>
      <SegmentedButtons
        value={debtType}
        onValueChange={(v) => setDebtType(v as DebtType)}
        buttons={DEBT_TYPES.map((dt) => ({ value: dt.value, label: dt.label }))}
        style={styles.segmented}
      />

      <TextInput
        label="Creditor / Account name"
        value={creditorName}
        onChangeText={setCreditorName}
        mode="outlined"
        style={styles.input}
        accessibilityHint="Required — enter the creditor or account name"
      />
      <TextInput
        label="Outstanding balance (R)"
        value={balanceRands}
        onChangeText={setBalanceRands}
        keyboardType="numeric"
        mode="outlined"
        style={styles.input}
        accessibilityHint="Required — enter the current outstanding balance in rands"
      />
      <TextInput
        label="Interest rate (%)"
        value={ratePercent}
        onChangeText={setRatePercent}
        keyboardType="numeric"
        mode="outlined"
        style={styles.input}
        accessibilityHint="Required — enter 0 for interest-free"
      />
      <TextInput
        label="Minimum monthly payment (R)"
        value={minPaymentRands}
        onChangeText={setMinPaymentRands}
        keyboardType="numeric"
        mode="outlined"
        style={styles.input}
        accessibilityHint="Required — enter the minimum monthly payment in rands"
      />

      {error ? (
        <View accessibilityLiveRegion="polite">
          <HelperText type="error">{error}</HelperText>
        </View>
      ) : null}

      <Button
        mode="contained"
        onPress={handleSave}
        loading={saving}
        disabled={saving}
        style={styles.button}
      >
        Add Debt
      </Button>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: spacing.base, gap: spacing.sm },
  sectionLabel: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_600SemiBold' },
  segmented: { marginBottom: spacing.sm },
  input: { backgroundColor: colours.surface },
  button: { marginTop: spacing.base, backgroundColor: colours.primary },
});
