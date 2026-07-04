import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  AccessibilityInfo,
} from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { supabase } from '../../../data/remote/supabaseClient';
import { useAppStore } from '../../stores/appStore';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Rendered by RootNavigator (in place of the normal Auth/Main tree) while
 * `appStore.passwordRecoveryPending` OR `appStore.passwordRecoveryError` is
 * set — i.e. after the user has tapped a Supabase password-recovery link
 * and App.tsx's deep-link handler either established the temporary
 * recovery session via `setSession` (`passwordRecoveryPending`), or that
 * call rejected — a bad/expired/reused link (`passwordRecoveryError`).
 *
 * On success, `updateUser({ password })` sets the new password. We then
 * sign the user out and clear `passwordRecoveryPending` so RootNavigator
 * falls through to the normal Auth flow and the user re-authenticates with
 * their NEW password — this is deliberately a clean re-auth rather than
 * silently proceeding into the normal signed-in bootstrap: `initSessionOnce`
 * (EnsureHousehold/RestoreService/SeedBabySteps/registerFcmToken/
 * SyncScheduler) never ran for this recovery session (App.tsx's auth
 * listener gates it off exactly because a recovery session must not
 * trigger it), and a real `SIGNED_IN` from signing back in is what runs it,
 * the same way it does for every other login.
 */
export function ResetPasswordScreen(): React.JSX.Element {
  const { colors } = useAppTheme();
  const setPasswordRecoveryPending = useAppStore((s) => s.setPasswordRecoveryPending);
  const setPasswordRecoveryError = useAppStore((s) => s.setPasswordRecoveryError);
  const passwordRecoveryError = useAppStore((s) => s.passwordRecoveryError);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      AccessibilityInfo.announceForAccessibility(`Reset failed: ${updateError.message}`);
      return;
    }
    setDone(true);
    AccessibilityInfo.announceForAccessibility('Password updated.');
  };

  // Back-to-sign-in: the escape hatch for every dead end on this screen —
  // an invalid/expired link (`passwordRecoveryError`), a repeatedly-failing
  // `updateUser` (e.g. "Session expired"), or the user simply changing
  // their mind. Signs out defensively (harmless no-op if there's no
  // session, e.g. the link never established one) so a lingering recovery
  // session is never left behind, then clears both flags so RootNavigator
  // falls back to the normal Auth flow.
  const handleBackToSignIn = (): void => {
    void supabase.auth.signOut().catch(() => {});
    setPasswordRecoveryError(null);
    setPasswordRecoveryPending(false);
  };

  // Clearing the flag hands control back to RootNavigator's normal routing.
  // Signing out first (rather than proceeding signed-in) is deliberate: see
  // the doc comment above this component for why. Done as an effect (not
  // inline during render) since it updates a store another component tree
  // reads.
  useEffect(() => {
    if (!done) return;
    void supabase.auth
      .signOut()
      .catch(() => {})
      .finally(() => {
        setPasswordRecoveryPending(false);
      });
  }, [done, setPasswordRecoveryPending]);

  // A rejected `setSession` (see App.tsx's deep-link handler) means there is
  // no session to reset a password on — show the error and the only
  // available action, rather than a form that can't possibly succeed.
  if (passwordRecoveryError) {
    return (
      <View
        style={[styles.flex, styles.centerContent, { backgroundColor: colors.surface }]}
        testID="reset-password-link-error"
      >
        <Text variant="displaySmall" style={[styles.title, { color: colors.primary }]}>
          Link expired
        </Text>
        <HelperText
          type="error"
          visible
          testID="reset-password-link-error-text"
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
        >
          {passwordRecoveryError}
        </HelperText>
        <Button
          mode="contained"
          onPress={handleBackToSignIn}
          style={styles.button}
          contentStyle={styles.buttonContent}
          testID="reset-password-back-to-signin"
          accessibilityLabel="Back to sign in"
          accessibilityRole="button"
        >
          Back to sign in
        </Button>
      </View>
    );
  }

  if (done) {
    // Brief transitional state while the effect above signs out, flips the
    // flag, and RootNavigator swaps this screen out for the Auth flow.
    return (
      <View
        style={[styles.flex, styles.centerContent, { backgroundColor: colors.surface }]}
        testID="reset-password-success"
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="bodyLarge" style={[styles.successText, { color: colors.onSurfaceVariant }]}>
          Password updated. Taking you to sign in…
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text variant="displaySmall" style={[styles.title, { color: colors.primary }]}>
            Set a new password
          </Text>
          <Text variant="bodyLarge" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
            Choose a new password for your account.
          </Text>
        </View>

        <View style={styles.form}>
          <TextInput
            label="New password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!passwordVisible}
            autoComplete="password-new"
            textContentType="newPassword"
            mode="outlined"
            testID="reset-password-new"
            style={[styles.input, { backgroundColor: colors.surface }]}
            disabled={loading}
            accessibilityLabel="New password, at least 8 characters"
            accessibilityRole="none"
            maxFontSizeMultiplier={1.6}
            right={
              <TextInput.Icon
                icon={passwordVisible ? 'eye-off' : 'eye'}
                onPress={() => setPasswordVisible((v) => !v)}
                accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
              />
            }
          />

          <TextInput
            label="Confirm new password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!passwordVisible}
            autoComplete="password-new"
            textContentType="newPassword"
            mode="outlined"
            testID="reset-password-confirm"
            style={[styles.input, { backgroundColor: colors.surface }]}
            disabled={loading}
            accessibilityLabel="Confirm new password"
            accessibilityRole="none"
            maxFontSizeMultiplier={1.6}
          />

          {error !== null && (
            <HelperText
              type="error"
              visible
              testID="reset-password-error"
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
            >
              {error}
            </HelperText>
          )}

          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={loading}
            disabled={loading}
            style={styles.button}
            contentStyle={styles.buttonContent}
            testID="reset-password-submit"
            accessibilityLabel="Update password"
            accessibilityRole="button"
          >
            Update password
          </Button>

          <Button
            mode="text"
            onPress={handleBackToSignIn}
            disabled={loading}
            style={styles.button}
            testID="reset-password-back-to-signin"
            accessibilityLabel="Back to sign in"
            accessibilityRole="button"
          >
            Back to sign in
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.base,
    padding: spacing.xl,
  },
  successText: {
    textAlign: 'center',
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  form: {
    gap: spacing.base,
  },
  input: {},
  button: {
    marginTop: spacing.sm,
  },
  buttonContent: {
    paddingVertical: spacing.xs,
  },
});
