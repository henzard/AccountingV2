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
  /**
   * Back control. Every step except the first passes this — an onboarding
   * wizard the user cannot walk backwards through makes a mistyped income or
   * a wrong category set unrecoverable without restarting the app.
   */
  onBack?: () => void;
  /** Back button label. Default: "Back" */
  backLabel?: string;
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
  onBack,
  backLabel = 'Back',
  children,
}: OnboardingStepLayoutProps): React.JSX.Element {
  const { colors } = useAppTheme();

  // The CTA is a sticky footer, not the last child of the ScrollView: on
  // steps taller than the screen (AllocateEnvelopes with several rows) a
  // trailing button sat below the fold, so "Next" had to be scrolled for.
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
    </ScrollView>
  );

  const footer = (
    <View style={[styles.footer, { backgroundColor: colors.background }]}>
      <Button
        mode="contained"
        onPress={onCta}
        loading={ctaLoading}
        disabled={Boolean(ctaDisabled || ctaLoading)}
        contentStyle={styles.buttonContent}
        testID="onboarding-cta"
      >
        {ctaLabel}
      </Button>
      {onBack !== undefined && (
        <Button
          mode="text"
          onPress={onBack}
          disabled={ctaLoading}
          style={styles.backButton}
          testID="onboarding-back"
        >
          {backLabel}
        </Button>
      )}
    </View>
  );

  if (!avoidKeyboard) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        {scrollContent}
        {footer}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {scrollContent}
      {footer}
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
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.base },
  buttonContent: { paddingVertical: spacing.xs },
  backButton: { marginTop: spacing.xs },
});
