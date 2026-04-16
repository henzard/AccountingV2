import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { spacing } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';
import type { OnboardingStackParamList } from './OnboardingNavigator';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Welcome'>;

export function WelcomeStep(): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.container}
    >
      <Text variant="displaySmall" style={[styles.title, { color: colors.primary }]}>
        Welcome.
      </Text>
      <Text variant="bodyLarge" style={[styles.body, { color: colors.onSurface }]}>
        Let's set up your money. One question at a time. Takes about 12 minutes.
      </Text>
      <Button
        mode="contained"
        onPress={() => navigation.navigate('Income')}
        style={styles.button}
        contentStyle={styles.buttonContent}
      >
        Let's begin
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
    marginTop: spacing.base,
    marginBottom: spacing.xl,
  },
  button: {
    marginTop: spacing.xl,
  },
  buttonContent: {
    paddingVertical: spacing.xs,
  },
});
