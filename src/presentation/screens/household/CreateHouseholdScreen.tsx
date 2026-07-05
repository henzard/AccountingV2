import React, { useState } from 'react';
import { StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { db } from '../../../data/local/db';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { CreateHouseholdUseCase } from '../../../domain/households/CreateHouseholdUseCase';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { CreateHouseholdStackParamList } from '../../navigation/types';

const audit = new AuditLogger(db);

export const CreateHouseholdScreen: React.FC = () => {
  const { colors } = useAppTheme();
  const navigation = useNavigation<NativeStackNavigationProp<CreateHouseholdStackParamList>>();
  const session = useAppStore((s) => s.session);
  const setHouseholdId = useAppStore((s) => s.setHouseholdId);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);
  const setAvailableHouseholds = useAppStore((s) => s.setAvailableHouseholds);
  const availableHouseholds = useAppStore((s) => s.availableHouseholds);

  const enqueue = useToastStore((s) => s.enqueue);

  const [name, setName] = useState('');
  const [paydayDay, setPaydayDayInput] = useState('25');
  const [paydayError, setPaydayError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePaydayChange = (value: string): void => {
    setPaydayDayInput(value);
    if (paydayError) setPaydayError(null);
  };

  const handleCreate = async (): Promise<void> => {
    if (!session) return;

    // `parseInt` yields NaN when the field is cleared, and NaN fails both
    // `< 1` and `> 28` — so the use case's range guard silently lets it
    // through. Validate here, before ever calling the use case, so a
    // cleared/invalid payday shows an inline error and blocks submit
    // instead of reaching CreateHouseholdUseCase with a NaN.
    const parsedPayday = Number(paydayDay);
    const isValidPayday = Number.isInteger(parsedPayday) && parsedPayday >= 1 && parsedPayday <= 28;
    if (!isValidPayday) {
      setPaydayError('Payday day must be a whole number between 1 and 28');
      return;
    }
    setPaydayError(null);
    setLoading(true);

    const uc = new CreateHouseholdUseCase(db, audit, {
      userId: session.user.id,
      name,
      paydayDay: parsedPayday,
    });
    const result = await uc.execute();
    setLoading(false);

    if (!result.success) {
      enqueue(result.error.message, 'error');
      return;
    }

    setHouseholdId(result.data.id);
    setPaydayDay(result.data.paydayDay);
    setAvailableHouseholds([...availableHouseholds, result.data]);
    // RootNavigator will re-render and switch to Onboarding/Main when householdId is set.
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text variant="bodyMedium" style={[styles.description, { color: colors.onSurfaceVariant }]}>
          Give your household a name and set your payday. You can invite members after creating it.
        </Text>

        <TextInput
          label="Household name"
          value={name}
          onChangeText={setName}
          mode="outlined"
          testID="household-name-input"
          style={[styles.input, { backgroundColor: colors.surface }]}
          disabled={loading}
        />

        <TextInput
          label="Payday day of month (1–28)"
          value={paydayDay}
          onChangeText={handlePaydayChange}
          keyboardType="numeric"
          mode="outlined"
          testID="household-payday-input"
          style={[styles.input, { backgroundColor: colors.surface }]}
          disabled={loading}
          error={!!paydayError}
        />
        {paydayError ? (
          <Text
            variant="bodySmall"
            style={[styles.paydayError, { color: colors.error }]}
            testID="household-payday-error"
          >
            {paydayError}
          </Text>
        ) : null}

        <Button
          mode="contained"
          onPress={handleCreate}
          loading={loading}
          disabled={loading}
          style={styles.button}
          contentStyle={styles.buttonContent}
          testID="household-create-submit"
        >
          Create Household
        </Button>

        <Button
          mode="text"
          onPress={() => navigation.navigate('JoinHouseholdGate')}
          disabled={loading}
          style={styles.joinLink}
        >
          Have an invite code? Join instead
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, padding: spacing.xl, gap: spacing.base },
  description: { marginBottom: spacing.base },
  input: {},
  paydayError: { marginTop: -spacing.sm },
  button: { marginTop: spacing.sm },
  buttonContent: { paddingVertical: spacing.xs },
  joinLink: { marginTop: spacing.xs },
});
