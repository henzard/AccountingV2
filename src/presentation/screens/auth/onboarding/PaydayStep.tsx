import React, { useState } from 'react';
import { StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { db } from '../../../../data/local/db';
import { UpdateHouseholdPaydayDayUseCase } from '../../../../domain/households/UpdateHouseholdPaydayDayUseCase';
import { useAppStore } from '../../../stores/appStore';
import { spacing } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';
import { LoadingSplash } from '../../../components/shared/LoadingSplash';
import type { OnboardingStackParamList } from './OnboardingNavigator';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Payday'>;

export function PaydayStep(): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();
  const householdId = useAppStore((s) => s.householdId);
  const currentPaydayDay = useAppStore((s) => s.paydayDay);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);

  const [dayStr, setDayStr] = useState(String(currentPaydayDay));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!householdId) return <LoadingSplash />;

  const handleNext = async (): Promise<void> => {
    setError(null);
    const day = parseInt(dayStr, 10);
    if (isNaN(day) || day < 1 || day > 28) {
      setError('Enter a day between 1 and 28');
      return;
    }

    setLoading(true);
    try {
      const uc = new UpdateHouseholdPaydayDayUseCase(db, householdId, day);
      const result = await uc.execute();
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      setPaydayDay(day);
      navigation.navigate('MeterSetup');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text variant="headlineMedium" style={[styles.title, { color: colors.primary }]}>
          When do you get paid?
        </Text>
        <Text variant="bodyMedium" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
          Your payday resets your budget period each month.
        </Text>

        <TextInput
          label="Day of month (1–28)"
          value={dayStr}
          onChangeText={setDayStr}
          mode="outlined"
          style={[styles.input, { backgroundColor: colors.surface }]}
          keyboardType="numeric"
          disabled={loading}
          placeholder="25"
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
  flex: { flex: 1 },
  container: { flexGrow: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.base },
  title: { fontFamily: 'PlusJakartaSans_700Bold' },
  subtitle: { marginBottom: spacing.base },
  input: {},
  button: { marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.xs },
});
