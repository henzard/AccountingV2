import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { colours, spacing } from '../../theme/tokens';

interface ScreenHeaderProps {
  eyebrow?: string;
  title: string;
  testID?: string;
}

export function ScreenHeader({ eyebrow, title, testID }: ScreenHeaderProps): React.JSX.Element {
  return (
    <View style={styles.container} testID={testID ?? 'screen-header'}>
      {eyebrow ? (
        <Text
          variant="labelMedium"
          style={styles.eyebrow}
          testID="screen-header-eyebrow"
          accessibilityRole="text"
        >
          {eyebrow.toUpperCase()}
        </Text>
      ) : null}
      <Text
        variant="headlineLarge"
        style={styles.title}
        testID="screen-header-title"
        accessibilityRole="header"
      >
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  eyebrow: {
    color: colours.onSurfaceVariant,
    marginBottom: spacing.xs,
    letterSpacing: 1.2,
  },
  title: {
    color: colours.onSurface,
  },
});
