import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { radius, spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

export function LoadingSkeletonCard(): React.JSX.Element {
  const { colors } = useAppTheme();
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]),
    ).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] });

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Animated.View
        style={[styles.titleLine, { opacity, backgroundColor: colors.outlineVariant }]}
      />
      <Animated.View
        style={[styles.amountLine, { opacity, backgroundColor: colors.outlineVariant }]}
      />
      <Animated.View
        style={[styles.barLine, { opacity, backgroundColor: colors.outlineVariant }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  titleLine: {
    height: 16,
    width: '60%',
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  amountLine: {
    height: 22,
    width: '40%',
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  barLine: {
    height: 8,
    width: '100%',
    borderRadius: radius.full,
  },
});
