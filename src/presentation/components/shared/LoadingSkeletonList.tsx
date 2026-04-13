import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LoadingSkeletonCard } from './LoadingSkeletonCard';
import { spacing } from '../../theme/tokens';

interface LoadingSkeletonListProps {
  count?: number;
  testID?: string;
}

export function LoadingSkeletonList({
  count = 3,
  testID,
}: LoadingSkeletonListProps): React.JSX.Element {
  return (
    <View
      style={styles.container}
      testID={testID ?? 'loading-skeleton-list'}
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
    >
      {Array.from({ length: count }, (_, i) => (
        <LoadingSkeletonCard key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.md,
  },
});
