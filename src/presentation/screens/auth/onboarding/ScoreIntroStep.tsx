import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { spacing, radius } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';
import type { OnboardingStackParamList } from './OnboardingNavigator';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'ScoreIntro'>;

export function ScoreIntroStep(): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
      <Text variant="headlineMedium" style={[styles.title, { color: colors.primary }]}>
        Your Ramsey Score
      </Text>
      <Text variant="bodyMedium" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
        Every day you track your spending, your score improves.
      </Text>

      <Surface style={[styles.card, { backgroundColor: colors.surface }]} elevation={1}>
        <Text variant="titleMedium" style={[styles.cardTitle, { color: colors.onSurface }]}>
          How it works
        </Text>
        <Text variant="bodyMedium" style={[styles.cardBody, { color: colors.onSurfaceVariant }]}>
          Your Ramsey Score is calculated based on three factors:{'\n\n'}
          {'1. '}
          <Text style={[styles.bold, { color: colors.onSurface }]}>Daily logging</Text> — log
          transactions consistently to earn points.{'\n\n'}
          {'2. '}
          <Text style={[styles.bold, { color: colors.onSurface }]}>On-budget envelopes</Text> — keep
          spending within your allocated amounts.{'\n\n'}
          {'3. '}
          <Text style={[styles.bold, { color: colors.onSurface }]}>Baby Steps progress</Text> —
          completing financial goals unlocks bonus points.
        </Text>
      </Surface>

      <Surface
        style={[styles.scoreScale, { backgroundColor: colors.surfaceVariant }]}
        elevation={0}
      >
        <View style={styles.scaleRow}>
          <Text variant="labelMedium" style={{ color: colors.scorePoor }}>
            0–49
          </Text>
          <Text variant="bodySmall" style={[styles.scaleLabel, { color: colors.onSurfaceVariant }]}>
            Poor — getting started
          </Text>
        </View>
        <View style={styles.scaleRow}>
          <Text variant="labelMedium" style={{ color: colors.scoreFair }}>
            50–69
          </Text>
          <Text variant="bodySmall" style={[styles.scaleLabel, { color: colors.onSurfaceVariant }]}>
            Fair — building habits
          </Text>
        </View>
        <View style={styles.scaleRow}>
          <Text variant="labelMedium" style={{ color: colors.scoreGood }}>
            70–84
          </Text>
          <Text variant="bodySmall" style={[styles.scaleLabel, { color: colors.onSurfaceVariant }]}>
            Good — on track
          </Text>
        </View>
        <View style={styles.scaleRow}>
          <Text variant="labelMedium" style={{ color: colors.scoreExcellent }}>
            85–100
          </Text>
          <Text variant="bodySmall" style={[styles.scaleLabel, { color: colors.onSurfaceVariant }]}>
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
  container: { flexGrow: 1, padding: spacing.xl },
  title: {
    fontFamily: 'PlusJakartaSans_700Bold',
    marginBottom: spacing.sm,
  },
  subtitle: { marginBottom: spacing.lg },
  card: {
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.base,
  },
  cardTitle: {
    fontFamily: 'PlusJakartaSans_700Bold',
    marginBottom: spacing.sm,
  },
  cardBody: { lineHeight: 22 },
  bold: { fontFamily: 'PlusJakartaSans_700Bold' },
  scoreScale: {
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
  scaleLabel: { flex: 1 },
  button: { marginTop: spacing.sm },
  buttonContent: { paddingVertical: spacing.xs },
});
