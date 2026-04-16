import React, { useState } from 'react';
import { StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import { db } from '../../../data/local/db';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { CreateHouseholdUseCase } from '../../../domain/households/CreateHouseholdUseCase';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
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

  const enqueue = useToastStore((s) => s.enqueue);

  const [name, setName] = useState('');
  const [paydayDay, setPaydayDayInput] = useState('25');
  const [loading, setLoading] = useState(false);

  const handleCreate = async (): Promise<void> => {
    if (!session) return;
    const day = parseInt(paydayDay, 10);
    setLoading(true);

    const uc = new CreateHouseholdUseCase(db, audit, {
      userId: session.user.id,
      name,
      paydayDay: day,
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
