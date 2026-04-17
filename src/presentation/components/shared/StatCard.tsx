import React from 'react';
import { StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

export interface StatCardProps {
  label: string;
  value: string;
  sublabel?: string;
  backgroundColor?: string;
  valueColor?: string;
  testID?: string;
}

export function StatCard({
  label,
  value,
  sublabel,
  backgroundColor,
  valueColor,
  testID,
}: StatCardProps): React.JSX.Element {
  const { colors } = useAppTheme();

  return (
    <Surface
      style={[styles.card, { backgroundColor: backgroundColor ?? colors.surface }]}
      elevation={1}
      testID={testID}
    >
      <Text
        style={[styles.label, { color: colors.onSurfaceVariant }]}
        variant="labelSmall"
        numberOfLines={1}
      >
        {label.toUpperCase()}
      </Text>
      <Text
        style={[styles.value, { color: valueColor ?? colors.onSurface }]}
        variant="headlineSmall"
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {sublabel !== undefined && (
        <Text
          style={[styles.sublabel, { color: colors.onSurfaceVariant }]}
          variant="bodySmall"
          testID="stat-card-sublabel"
        >
          {sublabel}
        </Text>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: radius.lg,
    padding: spacing.base,
  },
  label: {
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  value: {
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  sublabel: {
    marginTop: spacing.xs,
    opacity: 0.75,
  },
});
