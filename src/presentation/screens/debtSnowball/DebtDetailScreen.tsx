import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import {
  Text,
  Surface,
  Button,
  ActivityIndicator,
  Dialog,
  Portal,
  TextInput,
  HelperText,
} from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { and, eq, isNull } from 'drizzle-orm';
import { format } from 'date-fns';
import { db } from '../../../data/local/db';
import { debts as debtsTable } from '../../../data/local/schema';
import { SnowballPayoffProjector } from '../../../domain/debtSnowball/SnowballPayoffProjector';
import {
  getDebtTypeLabel,
  getPayoffProgressPercent,
} from '../../../domain/debtSnowball/DebtEntity';
import { UpdateDebtUseCase } from '../../../domain/debtSnowball/UpdateDebtUseCase';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { DebtPayoffBar } from './components/DebtPayoffBar';
import { StatCard } from '../../components/shared/StatCard';
import { formatCurrency } from '../../utils/currency';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { parseMoneyInput } from '../../utils/parseMoneyInput';
import { parseRatePercent } from '../../utils/parseRatePercent';
import type { DebtEntity } from '../../../domain/debtSnowball/DebtEntity';
import type { DebtDetailScreenProps } from '../../navigation/types';

const audit = new AuditLogger(db);

const projector = new SnowballPayoffProjector();

export const DebtDetailScreen: React.FC<DebtDetailScreenProps> = ({ navigation, route }) => {
  const { colors } = useAppTheme();
  const { debtId } = route.params;
  const householdId = useAppStore((s) => s.householdId)!;
  const enqueue = useToastStore((s) => s.enqueue);
  const [debt, setDebt] = useState<DebtEntity | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [balanceRands, setBalanceRands] = useState('');
  const [rateInput, setRateInput] = useState('');
  const [minPaymentRands, setMinPaymentRands] = useState('');
  const [creditorNameInput, setCreditorNameInput] = useState('');
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateSaving, setUpdateSaving] = useState(false);

  // Only the newest load may write state: if the active household changes
  // while a query is in flight, the older result must not land afterwards.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    if (!householdId) {
      setDebt(null);
      setLoading(false);
      return;
    }
    const rows = await db
      .select()
      .from(debtsTable)
      .where(
        and(
          eq(debtsTable.id, debtId),
          eq(debtsTable.householdId, householdId),
          isNull(debtsTable.deletedAt),
        ),
      );
    if (seq !== loadSeq.current) return;
    const loaded = (rows[0] as DebtEntity) ?? null;
    setDebt(loaded);
    if (loaded) {
      setBalanceRands((loaded.outstandingBalanceCents / 100).toFixed(2));
      setRateInput(loaded.interestRatePercent.toString());
      setMinPaymentRands((loaded.minimumPaymentCents / 100).toFixed(2));
      setCreditorNameInput(loaded.creditorName);
    }
    setLoading(false);
  }, [debtId, householdId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleUpdateDialogOpen = (): void => {
    setUpdateError(null);
    setShowUpdateDialog(true);
  };

  const handleUpdateDialogClose = (): void => {
    setShowUpdateDialog(false);
  };

  const handleUpdateSave = async (): Promise<void> => {
    if (!debt) return;

    setUpdateError(null);

    // Parse balance
    const balanceParsed = parseMoneyInput(balanceRands);
    if (!balanceParsed.ok) {
      setUpdateError(balanceParsed.error);
      return;
    }

    // Parse rate
    const rate = parseRatePercent(rateInput);
    if (rate === null || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      setUpdateError('Interest rate must be between 0 and 100');
      return;
    }

    // Parse minimum payment
    const minPaymentParsed = parseMoneyInput(minPaymentRands);
    if (!minPaymentParsed.ok) {
      setUpdateError(minPaymentParsed.error);
      return;
    }

    if (minPaymentParsed.cents <= 0) {
      setUpdateError('Minimum payment must be greater than zero');
      return;
    }

    // Validate creditor name
    const trimmedName = creditorNameInput.trim();
    if (!trimmedName) {
      setUpdateError('Creditor name is required');
      return;
    }

    setUpdateSaving(true);
    try {
      const uc = new UpdateDebtUseCase(db, audit, debt, {
        householdId,
        debtId,
        outstandingBalanceCents: balanceParsed.cents,
        interestRatePercent: rate,
        minimumPaymentCents: minPaymentParsed.cents,
        creditorName: trimmedName,
      });

      const result = await uc.execute();
      if (result.success) {
        enqueue('Debt updated', 'success');
        setShowUpdateDialog(false);
        await load();
      } else {
        setUpdateError(result.error.message);
      }
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Failed to update debt');
    } finally {
      setUpdateSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator animating color={colors.primary} />
      </View>
    );
  }

  if (!debt) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text variant="titleMedium" style={{ color: colors.onSurface, marginBottom: spacing.md }}>
          Debt not found
        </Text>
        <Button mode="contained" onPress={() => navigation.goBack()}>
          Go back
        </Button>
      </View>
    );
  }

  const plan = projector.project([debt]);
  const projection = plan.projections[0];
  const progress = getPayoffProgressPercent(debt);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.container}
    >
      <Surface style={[styles.card, { backgroundColor: colors.surface }]} elevation={1}>
        <Text variant="titleLarge" style={[styles.creditor, { color: colors.onSurface }]}>
          {debt.creditorName}
        </Text>
        <Text variant="bodyMedium" style={[styles.type, { color: colors.onSurfaceVariant }]}>
          {getDebtTypeLabel(debt.debtType)}
        </Text>

        <View style={styles.statsRow}>
          <StatCard
            label="Outstanding"
            value={formatCurrency(debt.outstandingBalanceCents)}
            testID="stat-outstanding"
          />
          <StatCard
            label="Paid to Date"
            value={formatCurrency(debt.totalPaidCents)}
            valueColor={colors.success}
            testID="stat-paid-to-date"
          />
        </View>

        <DebtPayoffBar progressPercent={progress} label={`${progress}% paid off`} />

        <View style={styles.detailsRow}>
          <Text variant="bodySmall" style={[styles.detail, { color: colors.onSurfaceVariant }]}>
            {`Min payment: ${formatCurrency(debt.minimumPaymentCents)}/month`}
          </Text>
          <Text variant="bodySmall" style={[styles.detail, { color: colors.onSurfaceVariant }]}>
            Rate: {debt.interestRatePercent}% p.a.
          </Text>
        </View>

        {projection && projection.monthsToPayoff > 0 && (
          <Text variant="bodyMedium" style={[styles.payoffDate, { color: colors.primary }]}>
            Projected payoff: {format(projection.payoffDate, 'MMMM yyyy')} (
            {projection.monthsToPayoff} months)
          </Text>
        )}
      </Surface>

      {!debt.isPaidOff && (
        <Button
          mode="contained"
          icon="cash"
          onPress={() => navigation.navigate('LogPayment', { debtId: debt.id })}
          style={[styles.payButton, { backgroundColor: colors.primary }]}
        >
          Log Payment
        </Button>
      )}

      <Button
        mode="outlined"
        icon="pencil"
        onPress={handleUpdateDialogOpen}
        style={[styles.payButton]}
        testID="update-from-statement-button"
      >
        Update from statement
      </Button>

      <Portal>
        <Dialog
          visible={showUpdateDialog}
          onDismiss={handleUpdateDialogClose}
          testID="update-debt-dialog"
        >
          <Dialog.Title>Update from statement</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="Creditor name"
              value={creditorNameInput}
              onChangeText={setCreditorNameInput}
              mode="outlined"
              style={[styles.dialogInput, { backgroundColor: colors.surface }]}
              testID="update-dialog-creditor-name"
            />

            <TextInput
              label="Outstanding balance (R)"
              value={balanceRands}
              onChangeText={setBalanceRands}
              keyboardType="numeric"
              mode="outlined"
              style={[styles.dialogInput, { backgroundColor: colors.surface }]}
              testID="update-dialog-balance"
            />
            <HelperText type="info" visible={true}>
              Use the closing balance on your latest statement — it includes interest.
            </HelperText>

            <TextInput
              label="Interest rate (%) "
              value={rateInput}
              onChangeText={setRateInput}
              keyboardType="numeric"
              mode="outlined"
              style={[styles.dialogInput, { backgroundColor: colors.surface }]}
              testID="update-dialog-rate"
            />

            <TextInput
              label="Minimum payment (R)"
              value={minPaymentRands}
              onChangeText={setMinPaymentRands}
              keyboardType="numeric"
              mode="outlined"
              style={[styles.dialogInput, { backgroundColor: colors.surface }]}
              testID="update-dialog-min-payment"
            />

            {updateError && (
              <Text
                variant="bodySmall"
                style={[styles.errorText, { color: colors.error }]}
                testID="update-error"
              >
                {updateError}
              </Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={handleUpdateDialogClose} testID="update-dialog-cancel">
              Cancel
            </Button>
            <Button
              onPress={() => void handleUpdateSave()}
              disabled={updateSaving}
              testID="update-dialog-save"
            >
              {updateSaving ? 'Saving...' : 'Save'}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { padding: spacing.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, padding: spacing.base },
  creditor: { fontFamily: 'PlusJakartaSans_700Bold' },
  type: { marginTop: 2, marginBottom: spacing.base },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.base },
  detailsRow: { marginTop: spacing.sm, gap: spacing.xs },
  detail: {},
  payoffDate: {
    marginTop: spacing.sm,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  payButton: { marginTop: spacing.base },
  dialogInput: { marginBottom: spacing.sm },
  errorText: { marginTop: spacing.xs },
});
