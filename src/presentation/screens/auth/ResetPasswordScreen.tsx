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
 * `appStore.passwordRecoveryPending` is true — i.e. after the user has
 * tapped a Supabase password-recovery link and App.tsx's deep-link handler
 * has established the temporary recovery session via `setSession`.
 *
 * On success, `updateUser({ password })` sets the new password while
 * keeping the user signed in (Supabase's documented recovery flow) — we
 * simply clear `passwordRecoveryPending` so RootNavigator falls through to
 * its normal session-based routing.
 */
export function ResetPasswordScreen(): React.JSX.Element {
  const { colors } = useAppTheme();
  const setPasswordRecoveryPending = useAppStore((s) => s.setPasswordRecoveryPending);

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

  // Clearing the flag hands control straight back to RootNavigator's normal
  // routing (the user is still signed in). Done as an effect (not inline
  // during render) since it updates a store another component tree reads.
  useEffect(() => {
    if (!done) return;
    setPasswordRecoveryPending(false);
  }, [done, setPasswordRecoveryPending]);

  if (done) {
    // Brief transitional state while the effect above flips the flag and
    // RootNavigator swaps this screen out for the normal app tree.
    return (
      <View
        style={[styles.flex, styles.centerContent, { backgroundColor: colors.surface }]}
        testID="reset-password-success"
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="bodyLarge" style={[styles.successText, { color: colors.onSurfaceVariant }]}>
          Password updated. Taking you to your account…
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
