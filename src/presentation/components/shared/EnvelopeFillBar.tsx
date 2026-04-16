import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

interface Props {
  percentRemaining: number;
  height?: number;
}

export function EnvelopeFillBar({ percentRemaining, height = 8 }: Props): React.JSX.Element {
  const { colors } = useAppTheme();
  const anim = useRef(new Animated.Value(0)).current;

  function getFillColour(pct: number): string {
    if (pct > 60) return colors.envelopeFull;
    if (pct > 20) return colors.envelopeMid;
    if (pct > 10) return colors.envelopeWarning;
    if (pct > 0) return colors.envelopeDanger;
    return colors.envelopeEmpty;
  }

  useEffect(() => {
    Animated.timing(anim, {
      toValue: percentRemaining,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [percentRemaining]);

  const width = anim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View
      style={[
        styles.track,
        { height, borderRadius: radius.full, backgroundColor: colors.outlineVariant },
      ]}
    >
      <Animated.View
        style={[
          styles.fill,
          {
            width,
            height,
            borderRadius: radius.full,
            backgroundColor: getFillColour(percentRemaining),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0 },
});
