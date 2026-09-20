/**
 * BudgetEnvelopeRow — an expense-section row on `BudgetScreen` (VAL2-4).
 *
 * Unlike the generic `EnvelopeCard` (remaining + % used), this shows the
 * three figures a period-switching budget view actually needs: allocated,
 * spent, and the difference, plus a "vs previous month" delta on spent
 * (matched by envelope name + type — see `computeSpentDeltaVsPreviousPeriod`).
 * Read-only when viewing a past period: no press handler, so it never
 * pretends a past envelope's allocation can still be edited.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Surface } from 'react-native-paper';
import { fontSize, spacing, radius } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';
import { formatCurrency } from '../../../utils/currency';
import type { EnvelopeEntity } from '../../../../domain/envelopes/EnvelopeEntity';

interface Props {
  envelope: EnvelopeEntity;
  /** From `computeSpentDeltaVsPreviousPeriod` — null when nothing to compare against. */
  deltaCents: number | null;
  /** Omit for a read-only (past-period) row. */
  onPress?: () => void;
  testID?: string;
}

export function BudgetEnvelopeRow({
  envelope,
  deltaCents,
  onPress,
  testID,
}: Props): React.JSX.Element {
  const { colors } = useAppTheme();
  const difference = envelope.allocatedCents - envelope.spentCents;
  const isOver = envelope.spentCents > envelope.allocatedCents;

  return (
    <Surface style={[styles.surface, { backgroundColor: colors.surface }]} elevation={1}>
      <TouchableRipple
        onPress={onPress}
        disabled={!onPress}
        style={styles.ripple}
        borderless
        testID={testID}
        accessibilityRole="button"
      >
        <View style={styles.content}>
          <Text
            variant="titleSmall"
            style={[styles.name, { color: colors.onSurface }]}
            numberOfLines={1}
          >
            {envelope.name}
          </Text>
          <Text variant="bodySmall" style={[styles.meta, { color: colors.onSurfaceVariant }]}>
            {`${formatCurrency(envelope.allocatedCents)} allocated · ${formatCurrency(envelope.spentCents)} spent · `}
            <Text style={{ color: isOver ? colors.error : colors.onSurfaceVariant }}>
              {`${difference < 0 ? '−' : ''}${formatCurrency(Math.abs(difference))} difference`}
            </Text>
          </Text>
          {deltaCents !== null && (
            <Text
              variant="bodySmall"
              style={[styles.delta, { color: colors.onSurfaceVariant }]}
              testID={testID ? `${testID}-delta` : undefined}
            >
              {deltaCents === 0
                ? 'Same as last month'
                : `${deltaCents > 0 ? '+' : '−'}${formatCurrency(Math.abs(deltaCents))} vs previous month`}
            </Text>
          )}
        </View>
      </TouchableRipple>
    </Surface>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
  },
  ripple: {
    borderRadius: radius.lg,
  },
  content: {
    padding: spacing.base,
    gap: 2,
  },
  name: {
    marginBottom: 2,
  },
  meta: {
    fontSize: fontSize.xs,
  },
  delta: {
    fontSize: fontSize.xs,
  },
});
