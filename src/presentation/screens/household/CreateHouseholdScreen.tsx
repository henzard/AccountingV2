import React, { useState } from 'react';
import { StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text, TextInput, Button, Snackbar } from 'react-native-paper';
import { db } from '../../../data/local/db';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { CreateHouseholdUseCase } from '../../../domain/households/CreateHouseholdUseCase';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing } from '../../theme/tokens';
import type { CreateHouseholdScreenProps } from '../../navigation/types';

const audit = new AuditLogger(db);

export const CreateHouseholdScreen: React.FC<CreateHouseholdScreenProps> = ({ navigation }) => {
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
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text variant="bodyMedium" style={styles.description}>
          Give your household a name and set your payday. You can invite members after creating it.
        </Text>

        <TextInput
          label="Household name"
          value={name}
          onChangeText={setName}
          mode="outlined"
          style={styles.input}
          disabled={loading}
        />

        <TextInput
          label="Payday day of month (1–28)"
          value={paydayDay}
          onChangeText={setPaydayDayInput}
          keyboardType="numeric"
          mode="outlined"
          style={styles.input}
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
  flex: { flex: 1, backgroundColor: colours.surface },
  container: { flexGrow: 1, padding: spacing.xl, gap: spacing.base },
  description: { color: colours.onSurfaceVariant, marginBottom: spacing.base },
  input: { backgroundColor: colours.surface },
  button: { marginTop: spacing.sm },
  buttonContent: { paddingVertical: spacing.xs },
});
