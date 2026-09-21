import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../../data/remote/supabaseClient';
import { getFriendlyAuthErrorMessage } from '../../utils/authErrorMessages';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { AuthStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'SignUp'>;

// Cannot be hammered: re-issuing the confirmation email is throttled
// client-side on top of whatever Supabase itself enforces server-side.
const RESEND_COOLDOWN_SECONDS = 30;

export function SignUpScreen(): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState<'idle' | 'check-email' | 'pending-session'>('idle');
  // The normalised (trimmed + lowercased) address actually sent to Supabase —
  // shown in the confirmation copy instead of the raw typed value, and reused
  // as the target for "Resend email".
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearCooldownTimer = (): void => {
    if (cooldownTimerRef.current !== null) {
      clearInterval(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
  };

  // Clear the interval on unmount so it never fires (or leaks) after the
  // screen is gone.
  useEffect(() => clearCooldownTimer, []);

  const startResendCooldown = (): void => {
    clearCooldownTimer();
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    cooldownTimerRef.current = setInterval(() => {
      setResendCooldown((seconds) => {
        if (seconds <= 1) {
          clearCooldownTimer();
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
  };

  const onSubmit = async (): Promise<void> => {
    setErr(null);
    if (!email.trim()) {
      setErr('Please enter your email address');
      return;
    }
    if (password.length < 8) {
      setErr('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setErr('Passwords do not match');
      return;
    }
    setLoading(true);
    const normalisedEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signUp({
      email: normalisedEmail,
      password,
    });
    if (error) {
      setErr(getFriendlyAuthErrorMessage(error, 'SignUpScreen.signUp'));
      setLoading(false);
      return;
    }

    setLoading(false);
    setSubmittedEmail(normalisedEmail);

    if (data.session) {
      // Immediate session (email confirmation disabled project-side) — auth listener will
      // navigate; show a brief transitional state.
      setSubmitted('pending-session');
    } else {
      // Email confirmation required — tell the user explicitly.
      setSubmitted('check-email');
      setResendError(null);
      startResendCooldown();
    }
  };

  const handleResend = async (): Promise<void> => {
    if (resendCooldown > 0 || resending) return;
    setResendError(null);
    setResending(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: submittedEmail });
    setResending(false);
    if (error) {
      setResendError(getFriendlyAuthErrorMessage(error, 'SignUpScreen.resend'));
      return;
    }
    startResendCooldown();
  };

  // Returns to the form WITHOUT clearing what was typed — email, password
  // and confirm are still in state — so the user can just fix a typo'd
  // address rather than re-typing everything.
  const handleEditEmail = (): void => {
    clearCooldownTimer();
    setResendCooldown(0);
    setResendError(null);
    setSubmitted('idle');
  };

  if (submitted === 'check-email') {
    return (
      <View
        style={[styles.flex, styles.centerContent, { backgroundColor: colors.surface }]}
        testID="signup-check-email"
      >
        <Text variant="headlineSmall" style={[styles.title, { color: colors.primary }]}>
          Check your email
        </Text>
        <Text variant="bodyLarge" style={[styles.successText, { color: colors.onSurfaceVariant }]}>
          We've sent a confirmation link to {submittedEmail}. Tap it, then sign in.
        </Text>

        {resendError !== null && (
          <HelperText type="error" visible testID="signup-resend-error">
            {resendError}
          </HelperText>
        )}

        <Button
          mode="outlined"
          onPress={handleResend}
          loading={resending}
          disabled={resending || resendCooldown > 0}
          style={styles.button}
          contentStyle={styles.buttonContent}
          testID="signup-resend"
          accessibilityLabel={
            resendCooldown > 0
              ? `Resend email, available in ${resendCooldown} seconds`
              : 'Resend email'
          }
        >
          {resendCooldown > 0 ? `Resend email (${resendCooldown}s)` : 'Resend email'}
        </Button>

        <Button
          mode="text"
          onPress={handleEditEmail}
          style={styles.linkButton}
          testID="signup-edit-email"
          accessibilityLabel="Wrong email? Edit"
        >
          Wrong email? Edit
        </Button>

        <Button
          mode="contained"
          onPress={() => navigation.navigate('Login')}
          style={styles.button}
          contentStyle={styles.buttonContent}
          testID="back-to-signin"
        >
          Back to sign in
        </Button>
      </View>
    );
  }

  if (submitted === 'pending-session') {
    return (
      <View
        style={[styles.flex, styles.centerContent, { backgroundColor: colors.surface }]}
        testID="signup-success"
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="bodyLarge" style={[styles.successText, { color: colors.onSurfaceVariant }]}>
          Setting up your account…
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
            Create account
          </Text>
          <Text variant="bodyLarge" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
            Start managing your household budget
          </Text>
        </View>

        <View style={styles.form}>
          <TextInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            mode="outlined"
            testID="signup-email"
            style={[styles.input, { backgroundColor: colors.surface }]}
            disabled={loading}
            accessibilityLabel="Email address"
            accessibilityRole="none"
            maxFontSizeMultiplier={1.6}
          />

          <TextInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!passwordVisible}
            autoComplete="password-new"
            textContentType="newPassword"
            mode="outlined"
            testID="signup-password"
            style={[styles.input, { backgroundColor: colors.surface }]}
            disabled={loading}
            accessibilityLabel="Password, at least 8 characters"
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
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!confirmVisible}
            autoComplete="password-new"
            textContentType="newPassword"
            mode="outlined"
            testID="signup-confirm-password"
            style={[styles.input, { backgroundColor: colors.surface }]}
            disabled={loading}
            accessibilityLabel="Confirm password"
            accessibilityRole="none"
            maxFontSizeMultiplier={1.6}
            right={
              <TextInput.Icon
                icon={confirmVisible ? 'eye-off' : 'eye'}
                onPress={() => setConfirmVisible((v) => !v)}
                accessibilityLabel={confirmVisible ? 'Hide password' : 'Show password'}
              />
            }
          />

          {err !== null && (
            <HelperText
              type="error"
              visible
              testID="signup-error"
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
            >
              {err}
            </HelperText>
          )}

          <Button
            mode="contained"
            onPress={onSubmit}
            loading={loading}
            disabled={loading}
            style={styles.button}
            contentStyle={styles.buttonContent}
            testID="signup-submit"
          >
            Create Account
          </Button>

          <Button
            mode="text"
            onPress={() => navigation.navigate('Login')}
            style={styles.linkButton}
          >
            Already have an account? Sign in
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
  linkButton: {
    marginTop: spacing.xs,
  },
});
