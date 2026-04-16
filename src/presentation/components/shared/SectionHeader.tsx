import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Divider } from 'react-native-paper';
import { useAppTheme } from '../../theme/useAppTheme';
import { spacing } from '../../theme/tokens';

interface SectionHeaderProps {
  title: string;
  /**
   * filled=true  → surfaceVariant background + labelMedium (for sticky list headers)
   * filled=false → transparent background + labelSmall   (for page-level sections)
   */
  filled?: boolean;
  /** Render a 1 px outlineVariant divider below the title. */
  showDivider?: boolean;
  testID?: string;
}

export function SectionHeader({
  title,
  filled = false,
  showDivider = false,
  testID,
}: SectionHeaderProps): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View
      style={[
        styles.container,
        { backgroundColor: filled ? colors.surfaceVariant : 'transparent' },
      ]}
      testID={testID}
    >
      <Text
        variant={filled ? 'labelMedium' : 'labelSmall'}
        style={[
          filled ? styles.filledTitle : styles.sparseTitle,
          { color: colors.onSurfaceVariant },
        ]}
      >
        {title.toUpperCase()}
      </Text>
      {showDivider && (
        <Divider
          style={{ backgroundColor: colors.outlineVariant }}
          testID={testID ? `${testID}-divider` : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
  },
  filledTitle: { letterSpacing: 0.8 },
  sparseTitle: { letterSpacing: 1.2, marginBottom: spacing.xs },
});
