import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { colours, spacing } from '../../theme/tokens';

interface EmptyStateProps {
  title: string;
  body?: string;
  ctaLabel?: string;
  onCta?: () => void;
  testID?: string;
}

export function EmptyState({
  title,
  body,
  ctaLabel,
  onCta,
  testID,
}: EmptyStateProps): React.JSX.Element {
  return (
    <View
      style={styles.container}
      testID={testID ?? 'empty-state'}
      accessibilityRole="none"
      accessible={false}
    >
      <Text
        variant="titleMedium"
        style={styles.title}
        testID="empty-state-title"
        accessibilityRole="text"
      >
        {title}
      </Text>
      {body ? (
        <Text
          variant="bodyMedium"
          style={styles.body}
          testID="empty-state-body"
          accessibilityRole="text"
        >
          {body}
        </Text>
      ) : null}
      {ctaLabel && onCta ? (
        <Button
          mode="contained"
          onPress={onCta}
          style={styles.cta}
          testID="empty-state-cta"
          accessibilityLabel={ctaLabel}
          accessibilityRole="button"
        >
          {ctaLabel}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  title: {
    color: colours.onSurface,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  body: {
    color: colours.onSurfaceVariant,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  cta: {
    marginTop: spacing.md,
  },
});
