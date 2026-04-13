import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { markOnboardingComplete } from '../../../../infrastructure/storage/onboardingFlag';
import { useAppStore } from '../../../stores/appStore';
import { colours, spacing } from '../../../theme/tokens';
import type { RootStackParamList } from '../../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function FinishStep(): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const session = useAppStore((s) => s.session);
  const householdId = useAppStore((s) => s.householdId);
  const [loading, setLoading] = useState(false);

  const handleDone = async (): Promise<void> => {
    setLoading(true);
    try {
      const userId = session?.user?.id;
      if (userId && householdId) {
        await markOnboardingComplete(userId, householdId);
      }
    } finally {
      setLoading(false);
    }
    // Navigate to Main — RootNavigator will re-render and show MainTabNavigator
    // because onboardingCompleted will be true on next check.
    // We use reset so the onboarding stack is removed.
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  return (
    <View style={styles.container}>
      <Text variant="displaySmall" style={styles.title}>
        Your budget is ready.
      </Text>
      <Text variant="bodyLarge" style={styles.body}>
        You've set up your income, spending envelopes, and payday. Start logging transactions to
        grow your Ramsey Score.
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  title: {
    color: colours.primary,
    fontFamily: 'PlusJakartaSans_700Bold',
    marginBottom: spacing.base,
  },
  body: {
    color: colours.onSurface,
    marginBottom: spacing.xl,
    lineHeight: 24,
  },
  button: { marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.xs },
});
