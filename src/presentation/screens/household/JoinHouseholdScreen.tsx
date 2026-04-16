import React, { useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, Snackbar } from 'react-native-paper';
import { db } from '../../../data/local/db';
import { supabase } from '../../../data/remote/supabaseClient';
import { AcceptInviteUseCase } from '../../../domain/households/AcceptInviteUseCase';
import { RestoreService } from '../../../data/sync/RestoreService';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { JoinHouseholdScreenProps } from '../../navigation/types';

const restoreService = new RestoreService(db, supabase);

export const JoinHouseholdScreen: React.FC<JoinHouseholdScreenProps> = ({ navigation }) => {
  const { colors } = useAppTheme();
  const session = useAppStore((s) => s.session);
  const setHouseholdId = useAppStore((s) => s.setHouseholdId);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);
  const setAvailableHouseholds = useAppStore((s) => s.setAvailableHouseholds);
  const availableHouseholds = useAppStore((s) => s.availableHouseholds);
  const enqueue = useToastStore((s) => s.enqueue);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async (): Promise<void> => {
    if (!session) return;
    const trimmedCode = code.trim().toUpperCase();
    if (trimmedCode.length !== 6) {
      setError('Please enter a 6-character invite code');
      return;
    }

    setLoading(true);
    setError(null);

    const uc = new AcceptInviteUseCase(supabase, db, restoreService, {
      code: trimmedCode,
      userId: session.user.id,
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
    enqueue('Joined household', 'success');
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.container}>
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
        >
          Join Household
        </Button>
      </View>

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
