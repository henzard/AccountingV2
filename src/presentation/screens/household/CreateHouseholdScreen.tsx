import React, { useState } from 'react';
import { StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text, TextInput, Button, Snackbar } from 'react-native-paper';
import { db } from '../../../data/local/db';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { CreateHouseholdUseCase } from '../../../domain/households/CreateHouseholdUseCase';
import { useAppStore } from '../../stores/appStore';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { CreateHouseholdScreenProps } from '../../navigation/types';

const audit = new AuditLogger(db);

export const CreateHouseholdScreen: React.FC<CreateHouseholdScreenProps> = () => {
  const { colors } = useAppTheme();
  const session = useAppStore((s) => s.session);
  const setHouseholdId = useAppStore((s) => s.setHouseholdId);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);
  const setAvailableHouseholds = useAppStore((s) => s.setAvailableHouseholds);
  const availableHouseholds = useAppStore((s) => s.availableHouseholds);

  const [name, setName] = useState('');
  const [paydayDay, setPaydayDayInput] = useState('25');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (): Promise<void> => {
    if (!session) return;
    const day = parseInt(paydayDay, 10);
    setLoading(true);
    setError(null);

    const uc = new CreateHouseholdUseCase(db, audit, {
      userId: session.user.id,
      name,
      paydayDay: day,
    });
    const result = await uc.execute();
    setLoading(false);

    if (!result.success) {
      setError(result.error.message);
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
          style={[styles.input, { backgroundColor: colors.surface }]}
          disabled={loading}
        />

        <TextInput
          label="Payday day of month (1–28)"
          value={paydayDay}
          onChangeText={setPaydayDayInput}
          keyboardType="numeric"
          mode="outlined"
          style={[styles.input, { backgroundColor: colors.surface }]}
          disabled={loading}
        />

        <Button
          mode="contained"
          onPress={handleCreate}
          loading={loading}
          disabled={loading}
          style={styles.button}
          contentStyle={styles.buttonContent}
        >
          Create Household
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
  flex: { flex: 1 },
  container: { flexGrow: 1, padding: spacing.xl, gap: spacing.base },
  description: { marginBottom: spacing.base },
  input: {},
  button: { marginTop: spacing.sm },
  buttonContent: { paddingVertical: spacing.xs },
});
