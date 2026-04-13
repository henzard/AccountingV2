import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colours, radius, spacing } from '../../theme/tokens';

export function LoadingSkeletonCard(): React.JSX.Element {
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
    <View style={styles.card}>
      <Animated.View style={[styles.titleLine, { opacity }]} />
      <Animated.View style={[styles.amountLine, { opacity }]} />
      <Animated.View style={[styles.barLine, { opacity }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colours.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  titleLine: {
    height: 16,
    width: '60%',
    backgroundColor: colours.outlineVariant,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  amountLine: {
    height: 22,
    width: '40%',
    backgroundColor: colours.outlineVariant,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  barLine: {
    height: 8,
    width: '100%',
    backgroundColor: colours.outlineVariant,
    borderRadius: radius.full,
  },
});
