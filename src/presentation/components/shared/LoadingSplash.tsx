import React from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../../theme/useAppTheme';

/**
 * LoadingSplash — neutral full-screen loading view shown while async flags
 * (e.g. onboardingCompleted) are being resolved. Prevents flashing the wrong
 * navigator on slow devices.
 */
export function LoadingSplash(): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.surface }]}
      testID="loading-splash"
    >
      <ActivityIndicator size="large" color={colors.primary} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
