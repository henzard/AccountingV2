import React, { useState, useEffect } from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { TextInput, Button, HelperText, Text } from 'react-native-paper';
import { eq } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { debts as debtsTable } from '../../../data/local/schema';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { LogDebtPaymentUseCase } from '../../../domain/debtSnowball/LogDebtPaymentUseCase';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { DebtEntity } from '../../../domain/debtSnowball/DebtEntity';
import type { LogPaymentScreenProps } from '../../navigation/types';

const audit = new AuditLogger(db);

export const LogPaymentScreen: React.FC<LogPaymentScreenProps> = ({ navigation, route }) => {
  const { colors } = useAppTheme();
  const { debtId } = route.params;
  const householdId = useAppStore((s) => s.householdId)!;
  const enqueue = useToastStore((s) => s.enqueue);
  const [debt, setDebt] = useState<DebtEntity | null>(null);
  const [amountRands, setAmountRands] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    db.select()
      .from(debtsTable)
      .where(eq(debtsTable.id, debtId))
      .then((rows) => {
        const row = rows[0] as DebtEntity | undefined;
        if (row) setAmountRands((row.minimumPaymentCents / 100).toFixed(2));
        setDebt(row ?? null);
      });
  }, [debtId]);

  const handleSave = async (): Promise<void> => {
    if (!debt) return;
    const amountCents = Math.round(parseFloat(amountRands) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      setError('Enter a valid payment amount');
      return;
    }
    setSaving(true);
    setError(null);
    const uc = new LogDebtPaymentUseCase(db, audit, {
      householdId,
      debtId,
      paymentAmountCents: amountCents,
      currentDebt: debt,
    });
    const result = await uc.execute();
    setSaving(false);
    if (result.success) {
      enqueue('Payment logged', 'success');
      navigation.goBack();
    } else {
      setError(result.error.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {debt && (
        <Text variant="bodyMedium" style={[styles.hint, { color: colors.onSurfaceVariant }]}>
          Outstanding: R
          {(debt.outstandingBalanceCents / 100).toLocaleString('en-ZA', {
            minimumFractionDigits: 2,
          })}
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
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: spacing.base, gap: spacing.sm },
  hint: { marginBottom: spacing.sm },
  input: {},
  button: { marginTop: spacing.base },
});
