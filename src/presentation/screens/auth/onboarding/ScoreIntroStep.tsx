import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colours, spacing, radius } from '../../../theme/tokens';
import type { OnboardingStackParamList } from './OnboardingNavigator';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'ScoreIntro'>;

export function ScoreIntroStep(): React.JSX.Element {
  const navigation = useNavigation<Nav>();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>
        Your Ramsey Score
      </Text>
      <Text variant="bodyMedium" style={styles.subtitle}>
        Every day you track your spending, your score improves.
      </Text>

      <Surface style={styles.card} elevation={1}>
        <Text variant="titleMedium" style={styles.cardTitle}>
          How it works
        </Text>
        <Text variant="bodyMedium" style={styles.cardBody}>
          Your Ramsey Score is calculated based on three factors:{'\n\n'}
          {'1. '}
          <Text style={styles.bold}>Daily logging</Text> — log transactions consistently to earn
          points.{'\n\n'}
          {'2. '}
          <Text style={styles.bold}>On-budget envelopes</Text> — keep spending within your allocated
          amounts.{'\n\n'}
          {'3. '}
          <Text style={styles.bold}>Baby Steps progress</Text> — completing financial goals unlocks
          bonus points.
        </Text>
      </Surface>

      <Surface style={styles.scoreScale} elevation={0}>
        <View style={styles.scaleRow}>
          <Text variant="labelMedium" style={{ color: colours.scorePoor }}>
            0–49
          </Text>
          <Text variant="bodySmall" style={styles.scaleLabel}>
            Poor — getting started
          </Text>
        </View>
        <View style={styles.scaleRow}>
          <Text variant="labelMedium" style={{ color: colours.scoreFair }}>
            50–69
          </Text>
          <Text variant="bodySmall" style={styles.scaleLabel}>
            Fair — building habits
          </Text>
        </View>
        <View style={styles.scaleRow}>
          <Text variant="labelMedium" style={{ color: colours.scoreGood }}>
            70–84
          </Text>
          <Text variant="bodySmall" style={styles.scaleLabel}>
            Good — on track
          </Text>
        </View>
        <View style={styles.scaleRow}>
          <Text variant="labelMedium" style={{ color: colours.scoreExcellent }}>
            85–100
          </Text>
          <Text variant="bodySmall" style={styles.scaleLabel}>
            Excellent — financial freedom
          </Text>
        </View>
      </Surface>

      <Button
        mode="contained"
        onPress={() => navigation.navigate('Finish')}
        style={styles.button}
        contentStyle={styles.buttonContent}
      >
        Continue
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: spacing.xl, backgroundColor: colours.background },
  title: {
    color: colours.primary,
    fontFamily: 'PlusJakartaSans_700Bold',
    marginBottom: spacing.sm,
  },
  subtitle: { color: colours.onSurfaceVariant, marginBottom: spacing.lg },
  card: {
    backgroundColor: colours.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.base,
  },
  cardTitle: {
    color: colours.onSurface,
    fontFamily: 'PlusJakartaSans_700Bold',
    marginBottom: spacing.sm,
  },
  cardBody: { color: colours.onSurfaceVariant, lineHeight: 22 },
  bold: { fontFamily: 'PlusJakartaSans_700Bold', color: colours.onSurface },
  scoreScale: {
    backgroundColor: colours.surfaceVariant,
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  scaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    paddingVertical: spacing.xs,
  },
  scaleLabel: { color: colours.onSurfaceVariant, flex: 1 },
  button: { marginTop: spacing.sm },
  buttonContent: { paddingVertical: spacing.xs },
});
