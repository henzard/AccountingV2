import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View, AccessibilityInfo } from 'react-native';
import { radius, spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

export function LoadingSkeletonCard(): React.JSX.Element {
  const { colors } = useAppTheme();
  const shimmer = useRef(new Animated.Value(0.4)).current;

  // C-4: don't animate when the system has reduce-motion enabled — render a
  // static skeleton instead. Subscribe for changes made while mounted too.
  // `null` = not yet known (the async check hasn't resolved) — treated the
  // same as "on" so the shimmer never even briefly starts before we find out
  // the setting was enabled all along.
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  useEffect((): (() => void) => {
    let mounted = true;
    // Subscribe first, and let an event win over the initial read: a stale
    // `false` resolving after `reduceMotionChanged(true)` would restart the
    // shimmer the user just turned off.
    let eventSeen = false;
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      eventSeen = true;
      setReduceMotion(enabled);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted && !eventSeen) setReduceMotion(enabled);
    });
    return (): void => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect((): (() => void) | void => {
    if (reduceMotion !== false) {
      // Static skeleton — no shimmer (either confirmed on, or not yet known).
      shimmer.setValue(0.4);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    // C-4: stop the loop on unmount (and whenever reduceMotion flips on) — an
    // unstopped Animated.loop keeps running (and keeps its native driver tied
    // up) forever after the card unmounts.
    return (): void => {
      loop.stop();
    };
  }, [reduceMotion, shimmer]);

  const opacity =
    reduceMotion !== false
      ? 0.65
      : shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] });

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
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  titleLine: {
    height: 14,
    width: '60%',
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  amountLine: {
    height: 14,
    width: '40%',
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  barLine: {
    height: 4,
    width: '100%',
    borderRadius: radius.full,
  },
});
