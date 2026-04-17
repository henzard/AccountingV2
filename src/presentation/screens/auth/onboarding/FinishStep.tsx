import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { markOnboardingComplete } from '../../../../infrastructure/storage/onboardingFlag';
import { useAppStore } from '../../../stores/appStore';
import { spacing } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';

export function FinishStep(): React.JSX.Element {
  const { colors } = useAppTheme();
  const session = useAppStore((s) => s.session);
  const householdId = useAppStore((s) => s.householdId);
  const setOnboardingCompleted = useAppStore((s) => s.setOnboardingCompleted);
  const [loading, setLoading] = useState(false);

  const handleDone = async (): Promise<void> => {
    setLoading(true);
    try {
      const userId = session?.user?.id;
      if (userId && householdId) {
        // Non-fatal: if AsyncStorage write fails the in-memory flag still lets
        // the user proceed. On the next cold start they'll see the wizard again
        // and the flag will be re-written then.
        await markOnboardingComplete(userId, householdId).catch(() => {});
      }
      // Flip the store flag so RootNavigator swaps OnboardingNavigator for
      // MainTabNavigator. navigation.reset is not usable here — 'Main' is not
      // registered in the current Stack until onboardingCompleted becomes true.
      setOnboardingCompleted(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.container}
    >
      <Text variant="displaySmall" style={[styles.title, { color: colors.primary }]}>
        Your budget is ready.
      </Text>
      <Text variant="bodyLarge" style={[styles.body, { color: colors.onSurface }]}>
        You've set up your income, spending envelopes, and payday. Start logging transactions to
        grow your Habit Score.
      </Text>
      <Button
        mode="contained"
        onPress={handleDone}
        loading={loading}
        disabled={loading}
        style={styles.button}
        contentStyle={styles.buttonContent}
      >
        Go to Dashboard
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    padding: spacing.xl,
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'PlusJakartaSans_700Bold',
    marginBottom: spacing.base,
  },
  body: {
    marginBottom: spacing.xl,
    lineHeight: 24,
  },
  button: { marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.xs },
});
