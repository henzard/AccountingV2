import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colours, radius } from '../../theme/tokens';

interface Props {
  percentRemaining: number;
  height?: number;
}

function getFillColour(pct: number): string {
  if (pct > 60) return colours.envelopeFull;
  if (pct > 20) return colours.envelopeMid;
  if (pct > 10) return colours.envelopeWarning;
  if (pct > 0) return colours.envelopeDanger;
  return colours.envelopeEmpty;
}

export function EnvelopeFillBar({ percentRemaining, height = 8 }: Props): React.JSX.Element {
  const anim = useRef(new Animated.Value(0)).current;

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
    <View style={[styles.track, { height, borderRadius: radius.full }]}>
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
  track: { width: '100%', backgroundColor: colours.outlineVariant, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0 },
});
