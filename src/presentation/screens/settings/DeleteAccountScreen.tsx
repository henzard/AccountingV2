/**
 * DeleteAccountScreen — the in-app account-deletion path required by Google
 * Play and promised by docs/privacy-policy.md.
 *
 * Two gates before anything happens, because this is irreversible: the user
 * must type DELETE (which rules out a mis-tap), and then confirm the shared
 * destructive dialog (which states the consequence one last time). The screen
 * also refuses to start while offline — the erasure happens on the server, so
 * an offline attempt would fail after the confirmation rather than before it.
 *
 * Navigation note: this screen is registered by the lead in
 * SettingsStackNavigator/navigation types (route `DeleteAccount`, no params).
 * Its props are declared locally rather than imported from
 * ../../navigation/types so the screen compiles independently of that wiring.
 */

import React, { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Surface,
  HelperText,
  ActivityIndicator,
} from 'react-native-paper';
import { supabase } from '../../../data/remote/supabaseClient';
import { db } from '../../../data/local/db';
import { DeleteAccountUseCase } from '../../../domain/auth/DeleteAccountUseCase';
import { confirm } from '../../components/shared/ConfirmDialogHost';
import { useSyncStore } from '../../stores/syncStore';
import { radius, spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

/** The word the user must type, exactly, to arm the button. */
const CONFIRM_WORD = 'DELETE';

export interface DeleteAccountScreenProps {
  navigation?: { goBack: () => void };
}

const WHAT_GOES: readonly string[] = [
  'Your sign-in account, so you can no longer sign in.',
  'Your push-notification tokens, consent record and app preferences.',
  'The till-slip photos you uploaded for scanning.',
  'Your membership of every household you belong to.',
  'Everything stored on this device — the local database is cleared and you are signed out.',
];

export const DeleteAccountScreen: React.FC<DeleteAccountScreenProps> = ({ navigation }) => {
  const { colors } = useAppTheme();
  const isOnline = useSyncStore((s) => s.isOnline);

  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wordMatches = typed.trim().toUpperCase() === CONFIRM_WORD;
  const canDelete = wordMatches && isOnline && !busy;

  const handleDelete = async (): Promise<void> => {
    setError(null);

    const confirmed = await confirm({
      title: 'Delete your account?',
      message:
        'This permanently deletes your account and removes your data from this device. It cannot be undone.',
      confirmLabel: 'Delete account',
      destructive: true,
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      const useCase = new DeleteAccountUseCase(supabase, db, {
        isOnline: () => useSyncStore.getState().isOnline,
      });
      const result = await useCase.execute();
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      // On success the sign-out inside the use case makes App.tsx's
      // onAuthStateChange listener swap the whole navigator back to the auth
      // stack, so there is nothing left to navigate to from here.
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.container}
      testID="delete-account-screen"
    >
      <Text variant="titleMedium" style={[styles.heading, { color: colors.onSurface }]}>
        What gets deleted
      </Text>
      <Surface style={[styles.section, { backgroundColor: colors.surface }]} elevation={0}>
        {WHAT_GOES.map((line) => (
          <Text
            key={line}
            variant="bodyMedium"
            style={[styles.bullet, { color: colors.onSurfaceVariant }]}
          >
            {`•  ${line}`}
          </Text>
        ))}
      </Surface>

      <Text variant="titleMedium" style={[styles.heading, { color: colors.onSurface }]}>
        If you share a household
      </Text>
      <Surface style={[styles.section, { backgroundColor: colors.surface }]} elevation={0}>
        <Text variant="bodyMedium" style={[styles.bullet, { color: colors.onSurfaceVariant }]}>
          Budget data belongs to the household, not to one person. Your envelopes, transactions and
          history stay with the members who remain — only your link to the household is removed, and
          your name is replaced with an anonymous placeholder on anything you created.
        </Text>
        <Text variant="bodyMedium" style={[styles.bullet, { color: colors.onSurfaceVariant }]}>
          If you are the last owner, ownership passes automatically to the longest-standing
          remaining member, so the household is never left without an owner.
        </Text>
        <Text variant="bodyMedium" style={[styles.bullet, { color: colors.onSurfaceVariant }]}>
          If you are the only member, nobody can reach that household&apos;s data again.
        </Text>
      </Surface>

      {!isOnline && (
        <Surface
          style={[styles.notice, { backgroundColor: colors.warningContainer }]}
          elevation={0}
          testID="delete-account-offline"
        >
          <Text variant="bodySmall" style={{ color: colors.warning }}>
            You are offline. Deleting your account erases it on our servers, so it needs an internet
            connection. Reconnect and come back.
          </Text>
        </Surface>
      )}

      <Text variant="titleMedium" style={[styles.heading, { color: colors.onSurface }]}>
        Confirm
      </Text>
      <Text variant="bodyMedium" style={[styles.bullet, { color: colors.onSurfaceVariant }]}>
        {`Type ${CONFIRM_WORD} below to enable the button. This cannot be undone.`}
      </Text>
      <TextInput
        mode="outlined"
        label={CONFIRM_WORD}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        autoCorrect={false}
        disabled={busy}
        style={styles.input}
        testID="delete-account-input"
      />

      {error !== null && (
        <HelperText type="error" visible testID="delete-account-error">
          {error}
        </HelperText>
      )}

      {busy && (
        <View style={styles.progress} testID="delete-account-progress">
          <ActivityIndicator animating color={colors.primary} />
          <Text
            variant="bodySmall"
            style={[styles.progressText, { color: colors.onSurfaceVariant }]}
          >
            Deleting your account…
          </Text>
        </View>
      )}

      <Button
        mode="contained"
        buttonColor={colors.error}
        textColor={colors.onError}
        disabled={!canDelete}
        loading={busy}
        onPress={handleDelete}
        style={styles.deleteButton}
        testID="delete-account-button"
      >
        Delete my account
      </Button>

      <Button
        mode="text"
        disabled={busy}
        onPress={() => navigation?.goBack()}
        testID="delete-account-cancel"
      >
        Keep my account
      </Button>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { padding: spacing.base },
  heading: { marginTop: spacing.base, marginBottom: spacing.sm },
  section: { borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.sm },
  bullet: { marginBottom: spacing.sm },
  notice: { borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.sm },
  input: { marginTop: spacing.sm },
  progress: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.base },
  progressText: { marginLeft: spacing.sm },
  deleteButton: { marginTop: spacing.base, marginBottom: spacing.sm },
});
