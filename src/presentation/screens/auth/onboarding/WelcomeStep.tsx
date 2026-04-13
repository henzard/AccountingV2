import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colours, spacing } from '../../../theme/tokens';
import type { OnboardingStackParamList } from './OnboardingNavigator';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Welcome'>;

export function WelcomeStep(): React.JSX.Element {
  const navigation = useNavigation<Nav>();

  return (
    <View style={styles.container}>
      <Text variant="displaySmall" style={styles.title}>
        Welcome.
      </Text>
      <Text variant="bodyLarge" style={styles.body}>
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
