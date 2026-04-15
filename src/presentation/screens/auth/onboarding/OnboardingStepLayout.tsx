import React from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useAppTheme } from '../../../theme/useAppTheme';
import { spacing } from '../../../theme/tokens';

interface OnboardingStepLayoutProps {
  title: string;
  subtitle: string;
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
        disabled={ctaDisabled}
        style={styles.button}
        contentStyle={styles.buttonContent}
      >
        {ctaLabel}
      </Button>
    </ScrollView>
  );

  if (!avoidKeyboard) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        {scrollContent}
      </View>
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
  title: { fontFamily: 'PlusJakartaSans_700Bold' },
  subtitle: { marginBottom: spacing.base },
  button: { marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.xs },
});
