import React from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useAppTheme } from '../../../theme/useAppTheme';
import { spacing } from '../../../theme/tokens';

interface OnboardingStepLayoutProps {
  title: string;
  subtitle: string;
  /** Current step index (1-based). Shows progress dots when provided. */
  step?: number;
  /** Total number of onboarding steps. Required when step is set. */
  totalSteps?: number;
  /**
   * Wrap content in KeyboardAvoidingView.
   * Set false for steps that have no text inputs (e.g. chip pickers).
   * Default: true
   */
  avoidKeyboard?: boolean;
  /** CTA button label. Default: "Next" */
  ctaLabel?: string;
  onCta: () => void | Promise<void>;
  ctaLoading?: boolean;
  ctaDisabled?: boolean;
  children?: React.ReactNode;
}

export function OnboardingStepLayout({
  title,
  subtitle,
  step,
  totalSteps,
  avoidKeyboard = true,
  ctaLabel = 'Next',
  onCta,
  ctaLoading,
  ctaDisabled,
  children,
}: OnboardingStepLayoutProps): React.JSX.Element {
  const { colors } = useAppTheme();

  const scrollContent = (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {step !== undefined && totalSteps !== undefined && (
        <View style={styles.progressRow}>
          {Array.from({ length: totalSteps }, (_, i) => (
            <View
              key={i}
              style={[
                styles.progressDot,
                {
                  backgroundColor: i < step ? colors.primary : colors.outlineVariant,
                  width: i === step - 1 ? 20 : 8,
                },
              ]}
            />
          ))}
        </View>
      )}
      <Text variant="headlineMedium" style={[styles.title, { color: colors.primary }]}>
        {title}
      </Text>
      <Text variant="bodyMedium" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
        {subtitle}
      </Text>
      {children}
      <Button
        mode="contained"
        onPress={onCta}
        loading={ctaLoading}
        disabled={Boolean(ctaDisabled || ctaLoading)}
        style={styles.button}
        contentStyle={styles.buttonContent}
      >
        {ctaLabel}
      </Button>
    </ScrollView>
  );

  if (!avoidKeyboard) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>{scrollContent}</View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {scrollContent}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.base },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  progressDot: { height: 8, borderRadius: 4 },
  title: { fontFamily: 'PlusJakartaSans_700Bold' },
  subtitle: { marginBottom: spacing.base },
  button: { marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.xs },
});
