import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import Svg, { Circle } from 'react-native-svg';
import { formatCurrency } from '../../../utils/currency';
import { spacing, fontSize } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';

interface BudgetRingCardProps {
  totalAllocatedCents: number;
  totalSpentCents: number;
  daysRemaining: number;
  score: number;
  testID?: string;
}

const RING_SIZE = 196;
const STROKE_WIDTH = 14;
const RADIUS = (RING_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function BudgetRingCard({
  totalAllocatedCents,
  totalSpentCents,
  daysRemaining,
  score,
  testID = 'budget-ring-card',
}: BudgetRingCardProps): React.JSX.Element {
  const { colors } = useAppTheme();

  // The ARC stays clamped at a full circle — it has nowhere further to travel.
  const pct = totalAllocatedCents > 0 ? Math.min(1, totalSpentCents / totalAllocatedCents) : 0;
  const dashOffset = CIRCUMFERENCE * (1 - pct);
  const isOver = totalSpentCents > totalAllocatedCents;
  // The HEADLINE is not clamped: clamping it to 0 made every overspend, from
  // R1 to R5 000, read "R0,00 over budget" — the one figure the household
  // needs to see. Under budget it is what is left; over budget it is how far
  // past the allocation the period has gone.
  const headlineCents = isOver
    ? totalSpentCents - totalAllocatedCents
    : totalAllocatedCents - totalSpentCents;
  const statusLabel = isOver ? 'over budget' : 'remaining';
  const ringColor = isOver ? colors.error : score >= 70 ? colors.primary : colors.warning;

  return (
    <View style={styles.container} testID={testID}>
      <Svg width={RING_SIZE} height={RING_SIZE}>
        {/* Track */}
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          stroke={colors.surfaceVariant}
          strokeWidth={STROKE_WIDTH}
          fill="none"
        />
        {/* Progress arc */}
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          stroke={ringColor}
          strokeWidth={STROKE_WIDTH}
          fill="none"
          strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
        />
      </Svg>

      {/* Center label */}
      <View
        style={[StyleSheet.absoluteFillObject, styles.center]}
        accessible
        accessibilityLabel={`${formatCurrency(headlineCents)} ${statusLabel}, ${daysRemaining} days left`}
        testID={`${testID}-center`}
      >
        <Text
          variant="headlineMedium"
          style={[styles.amount, { color: isOver ? colors.error : colors.onSurface }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          testID={`${testID}-amount`}
        >
          {formatCurrency(headlineCents)}
        </Text>
        <Text variant="bodySmall" style={[styles.label, { color: colors.onSurfaceVariant }]}>
          {statusLabel}
        </Text>
        <Text variant="bodySmall" style={[styles.days, { color: colors.onSurfaceVariant }]}>
          {daysRemaining}d left
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg + STROKE_WIDTH,
  },
  amount: {
    fontFamily: 'PlusJakartaSans_700Bold',
    marginBottom: 2,
  },
  label: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.sm,
  },
  days: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.xs,
    marginTop: 2,
  },
});
