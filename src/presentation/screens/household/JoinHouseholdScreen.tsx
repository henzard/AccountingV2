import React, { useState } from 'react';
import { ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import { db } from '../../../data/local/db';
import { supabase } from '../../../data/remote/supabaseClient';
import { AcceptInviteUseCase } from '../../../domain/households/AcceptInviteUseCase';
// RestoreService is deleted machinery per the oplog-sync spec (spec §2, §8:
// "replaced by an initial sync_pull with progress UI") — but the sync_pull
// RPC/puller is slice 5 work that doesn't exist yet. Per the slice-3 plan's
// scope discipline ("do NOT try to build the new puller"), this keeps the
// existing REST-based restore call, which still compiles and works against
// the unchanged remote (confirmed: RestoreService has no reference to the
// spent_cents/is_synced columns dropped in migration 0012). This is an
// intentional, documented non-crashing shim — slice 5 replaces it wholesale.
import { RestoreService } from '../../../data/sync/RestoreService';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { markOnboardingComplete } from '../../../infrastructure/storage/onboardingFlag';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { JoinHouseholdScreenProps } from '../../navigation/types';

const restoreService = new RestoreService(db, supabase);

// SEC2-2(d): existing invitations minted before 0015_security_followups.sql
// are 6 characters; new ones are 10. Both must be accepted — never assume a
// fixed length.
const MIN_INVITE_CODE_LENGTH = 6;
const MAX_INVITE_CODE_LENGTH = 10;

export const JoinHouseholdScreen: React.FC<JoinHouseholdScreenProps> = ({ navigation }) => {
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
  // F1 (round 6): HOUSEHOLD_RESTORE_FAILED means the join DID succeed
  // server-side and only the download of the household is missing. A toast
  // that disappears leaves the user staring at the join form with a code
  // that now reads as "already used" — so the retry lives on the screen.
  const [restoreFailed, setRestoreFailed] = useState<string | null>(null);

  const handleJoin = async (): Promise<void> => {
    if (!session) return;
    const trimmedCode = code.trim().toUpperCase();
    // SEC2-2(d): invite codes lengthened from 6 to 10 characters
    // (create_invitation, 0015_security_followups.sql). Existing 6-char
    // codes must keep working, so this checks a range rather than an exact
    // length — never assume a fixed code length.
    if (
      trimmedCode.length < MIN_INVITE_CODE_LENGTH ||
      trimmedCode.length > MAX_INVITE_CODE_LENGTH
    ) {
      enqueue(
        `Please enter a ${MIN_INVITE_CODE_LENGTH}- to ${MAX_INVITE_CODE_LENGTH}-character invite code`,
        'error',
      );
      return;
    }

    setLoading(true);
    setRestoreFailed(null);

    let result;
    try {
      const uc = new AcceptInviteUseCase(supabase, db, restoreService, {
        code: trimmedCode,
        userId: session.user.id,
      });
      result = await uc.execute();
    } catch (err) {
      enqueue(err instanceof Error ? err.message : 'Failed to join household', 'error');
      return;
    } finally {
      setLoading(false);
    }

    if (!result.success) {
      if (result.error.code === 'HOUSEHOLD_RESTORE_FAILED') {
        // Keep the code in the input: re-running execute() with it is
        // exactly what finishes the join (AcceptInviteUseCase resumes from
        // the membership row it already wrote).
        setRestoreFailed(result.error.message);
        return;
      }
      enqueue(result.error.message, 'error');
      return;
    }

    setRestoreFailed(null);

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

    // Navigate back to Main if opened as a root screen (can go back).
    // If opened as a gate flow, RootNavigator handles the transition.
    if (navigation.canGoBack()) {
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text variant="bodyMedium" style={[styles.description, { color: colors.onSurfaceVariant }]}>
          Enter the invite code shared by your household member.
        </Text>

        <TextInput
          label="Invite code"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={MAX_INVITE_CODE_LENGTH}
          mode="outlined"
          style={[styles.input, { backgroundColor: colors.surface }]}
          disabled={loading}
        />

        <Button
          mode="contained"
          onPress={handleJoin}
          loading={loading}
          disabled={
            loading ||
            code.trim().length < MIN_INVITE_CODE_LENGTH ||
            code.trim().length > MAX_INVITE_CODE_LENGTH
          }
          style={styles.button}
          contentStyle={styles.buttonContent}
          testID="join-household-btn"
        >
          Join Household
        </Button>

        {restoreFailed !== null && (
          <>
            <Text
              variant="bodyMedium"
              style={[styles.restoreError, { color: colors.error }]}
              testID="join-restore-failed-message"
            >
              {restoreFailed}
            </Text>
            <Button
              mode="outlined"
              onPress={handleJoin}
              loading={loading}
              disabled={loading}
              style={styles.button}
              contentStyle={styles.buttonContent}
              testID="join-retry-btn"
            >
              Try again
            </Button>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, padding: spacing.xl, gap: spacing.base },
  description: { marginBottom: spacing.base },
  input: {},
  restoreError: { marginTop: spacing.base },
  button: { marginTop: spacing.sm },
  buttonContent: { paddingVertical: spacing.xs },
});
