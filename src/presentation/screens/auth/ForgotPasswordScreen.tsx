import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  AccessibilityInfo,
} from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../../data/remote/supabaseClient';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { AuthStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'ForgotPassword'>;

// Deep link back into the app once the user taps the recovery link in their
// email. Requires app.config.ts's `scheme: 'accountingv2'` — see
// ResetPasswordScreen / App.tsx's deep-link handler for the consuming side.
const RESET_PASSWORD_REDIRECT_URL = 'accountingv2://reset-password';

export function ForgotPasswordScreen(): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError('Please enter your email address.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: RESET_PASSWORD_REDIRECT_URL,
    });
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      AccessibilityInfo.announceForAccessibility(`Request failed: ${resetError.message}`);
      return;
    }
    setSent(true);
    AccessibilityInfo.announceForAccessibility('Password reset email sent. Check your inbox.');
  };

  if (sent) {
    return (
      <View
        style={[styles.flex, styles.centerContent, { backgroundColor: colors.surface }]}
        testID="forgot-password-check-email"
      >
        <Text variant="headlineSmall" style={[styles.title, { color: colors.primary }]}>
          Check your email
        </Text>
        <Text
          variant="bodyLarge"
          style={[styles.successText, { color: colors.onSurfaceVariant }]}
          accessibilityLiveRegion="polite"
        >
          If an account exists for {email.trim()}, we've sent a link to reset your password.
        </Text>
        <Button
          mode="contained"
          onPress={() => navigation.navigate('Login')}
          style={styles.button}
          contentStyle={styles.buttonContent}
          testID="forgot-password-back-to-signin"
          accessibilityLabel="Back to sign in"
          accessibilityRole="button"
        >
          Back to sign in
        </Button>
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
            Reset your password
          </Text>
          <Text variant="bodyLarge" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
            Enter your email and we'll send you a link to reset your password.
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
            testID="forgot-password-email"
            style={[styles.input, { backgroundColor: colors.surface }]}
            disabled={loading}
            accessibilityLabel="Email address"
            accessibilityRole="none"
            maxFontSizeMultiplier={1.6}
          />

          {error !== null && (
            <HelperText
              type="error"
              visible
              testID="forgot-password-error"
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
            testID="forgot-password-submit"
            accessibilityLabel="Send reset link"
            accessibilityRole="button"
          >
            Send reset link
          </Button>

          <Button
            mode="text"
            onPress={() => navigation.navigate('Login')}
            style={styles.linkButton}
            testID="forgot-password-back-link"
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
  linkButton: {
    marginTop: spacing.xs,
  },
});
