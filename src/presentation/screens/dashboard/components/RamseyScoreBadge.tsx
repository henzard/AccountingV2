import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import Svg, { Circle } from 'react-native-svg';
import { colours } from '../../../theme/tokens';

interface RamseyScoreBadgeProps {
  score: number; // 0–100
}

const SIZE = 72;
const STROKE = 5;
const RADIUS = 28;
const CX = SIZE / 2;
const CY = SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC = CIRCUMFERENCE * 0.75; // 270° sweep
const GAP = CIRCUMFERENCE * 0.25; // 90° gap at the bottom

function getScoreColour(score: number): string {
  if (score >= 80) return colours.scoreExcellent;
  if (score >= 60) return colours.scoreGood;
  if (score >= 40) return colours.scoreFair;
  return colours.scorePoor;
}

function getScoreLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Keep going';
}

export function RamseyScoreBadge({ score }: RamseyScoreBadgeProps): React.JSX.Element {
  const colour = getScoreColour(score);
  const clamped = Math.min(100, Math.max(0, score));
  const filled = ARC * (clamped / 100);
  const label = getScoreLabel(score);

  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
      accessibilityLabel={`Ramsey score: ${score} — ${label}`}
    >
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Track arc */}
        <Circle
          cx={CX}
          cy={CY}
          r={RADIUS}
          fill="none"
          stroke={colours.outlineVariant}
          strokeWidth={STROKE}
          strokeDasharray={`${ARC} ${GAP}`}
          strokeLinecap="round"
          transform={`rotate(135 ${CX} ${CY})`}
        />
        {/* Score fill arc */}
        <Circle
          cx={CX}
          cy={CY}
          r={RADIUS}
          fill="none"
          stroke={colour}
          strokeWidth={STROKE}
          strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
          strokeLinecap="round"
          transform={`rotate(135 ${CX} ${CY})`}
        />
      </Svg>
      {/* Centered text overlay */}
      <View style={styles.overlay} pointerEvents="none">
        <Text style={[styles.score, { color: colour }]}>{score}</Text>
        <Text style={[styles.label, { color: colour }]}>{getScoreLabel(score)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  score: {
    fontSize: 20,
    fontFamily: 'PlusJakartaSans_700Bold',
    lineHeight: 23,
  },
  label: {
    fontSize: 8,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});
