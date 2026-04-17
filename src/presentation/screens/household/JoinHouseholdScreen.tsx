import React, { useState } from 'react';
import { ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import { db } from '../../../data/local/db';
import { supabase } from '../../../data/remote/supabaseClient';
import { AcceptInviteUseCase } from '../../../domain/households/AcceptInviteUseCase';
import { RestoreService } from '../../../data/sync/RestoreService';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { markOnboardingComplete } from '../../../infrastructure/storage/onboardingFlag';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { JoinHouseholdScreenProps } from '../../navigation/types';

const restoreService = new RestoreService(db, supabase);

export const JoinHouseholdScreen: React.FC<JoinHouseholdScreenProps> = () => {
  const { colors } = useAppTheme();
  const session = useAppStore((s) => s.session);
  const setHouseholdId = useAppStore((s) => s.setHouseholdId);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);
  const setAvailableHouseholds = useAppStore((s) => s.setAvailableHouseholds);
  const availableHouseholds = useAppStore((s) => s.availableHouseholds);
  const setOnboardingCompleted = useAppStore((s) => s.setOnboardingCompleted);
  const enqueue = useToastStore((s) => s.enqueue);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleJoin = async (): Promise<void> => {
    if (!session) return;
    const trimmedCode = code.trim().toUpperCase();
    if (trimmedCode.length !== 6) {
      enqueue('Please enter a 6-character invite code', 'error');
      return;
    }

    setLoading(true);

    const uc = new AcceptInviteUseCase(supabase, db, restoreService, {
      code: trimmedCode,
      userId: session.user.id,
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

    // Joiners inherit the household's existing config — skip the full
    // budget-setup wizard by marking onboarding complete immediately.
    if (session) {
      await markOnboardingComplete(session.user.id, result.data.id);
      setOnboardingCompleted(true);
    }

    enqueue('Joined household', 'success');
    // RootNavigator reacts automatically when householdId + onboardingCompleted are set.
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text variant="bodyMedium" style={[styles.description, { color: colors.onSurfaceVariant }]}>
          Enter the 6-character code shared by your household member.
        </Text>

        <TextInput
          label="Invite code"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          mode="outlined"
          style={[styles.input, { backgroundColor: colors.surface }]}
          disabled={loading}
        />

        <Button
          mode="contained"
          onPress={handleJoin}
          loading={loading}
          disabled={loading || code.trim().length !== 6}
          style={styles.button}
          contentStyle={styles.buttonContent}
          testID="join-household-btn"
        >
          Join Household
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
