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

  const pct = totalAllocatedCents > 0 ? Math.min(1, totalSpentCents / totalAllocatedCents) : 0;
  const dashOffset = CIRCUMFERENCE * (1 - pct);
  const remainingCents = Math.max(0, totalAllocatedCents - totalSpentCents);
  const isOver = totalSpentCents > totalAllocatedCents;
  const ringColor = isOver ? colors.error : score >= 70 ? colors.primary : '#F5A623';

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
      <View style={[StyleSheet.absoluteFillObject, styles.center]}>
        <Text
          variant="headlineMedium"
          style={[styles.amount, { color: isOver ? colors.error : colors.onSurface }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {formatCurrency(remainingCents)}
        </Text>
        <Text variant="bodySmall" style={[styles.label, { color: colors.onSurfaceVariant }]}>
          {isOver ? 'over budget' : 'remaining'}
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
