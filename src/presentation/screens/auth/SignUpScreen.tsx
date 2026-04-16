import React, { useState } from 'react';
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
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { AuthStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'SignUp'>;

export function SignUpScreen(): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState<'idle' | 'check-email' | 'pending-session'>('idle');

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
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      setErr(error.message);
      setLoading(false);
      return;
    }

    setLoading(false);

    if (data.session) {
      // Immediate session (email confirmation disabled project-side) — auth listener will
      // navigate; show a brief transitional state.
      setSubmitted('pending-session');
    } else {
      // Email confirmation required — tell the user explicitly.
      setSubmitted('check-email');
    }
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
          We've sent a confirmation link to {email}. Tap it, then sign in.
        </Text>
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
            secureTextEntry
            autoComplete="password-new"
            textContentType="newPassword"
            mode="outlined"
            style={[styles.input, { backgroundColor: colors.surface }]}
            disabled={loading}
            accessibilityLabel="Password, at least 8 characters"
            accessibilityRole="none"
            maxFontSizeMultiplier={1.6}
          />

          <TextInput
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoComplete="password-new"
            textContentType="newPassword"
            mode="outlined"
            style={[styles.input, { backgroundColor: colors.surface }]}
            disabled={loading}
            accessibilityLabel="Confirm password"
            accessibilityRole="none"
            maxFontSizeMultiplier={1.6}
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
