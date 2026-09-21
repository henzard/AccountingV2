/**
 * BudgetEnvelopeRow — an expense-section row on `BudgetScreen` (VAL2-4).
 *
 * Unlike the generic `EnvelopeCard` (remaining + % used), this shows the
 * three figures a period-switching budget view actually needs: allocated,
 * spent, and the difference, plus a "vs previous month" delta on spent
 * (matched by envelope name + type — see `computeSpentDeltaVsPreviousPeriod`).
 * Read-only when viewing a past period: no press handler, so it never
 * pretends a past envelope's allocation can still be edited.
 *
 * A PERSISTENT envelope ('savings' | 'sinking_fund' | 'emergency_fund' |
 * 'baby_step') gets a different presentation entirely. Those rows are not
 * re-created per period, so `spentCents` (from `useEnvelopes` /
 * `getEnvelopeSpentCents`) is their ALL-TIME withdrawal total while
 * `allocatedCents` is only THIS period's monthly contribution — subtracting
 * one from the other compares two different time spans and flagged a healthy
 * baby-step fund with R500/month and R3 200 of lifetime withdrawals as
 * "R500,00 allocated · R3 200,00 spent — over budget" in a month it had not
 * been touched at all. They show monthly contribution + the real SAVED
 * balance from the contribution ledger instead, exactly as the dashboard's
 * "Savings & funds" section does (see `usePersistentEnvelopeSavings`).
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Surface } from 'react-native-paper';
import { fontSize, spacing, radius } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';
import { formatCurrency } from '../../../utils/currency';
import { getEnvelopeScope } from '../../../../domain/envelopes/EnvelopeEntity';
import type { EnvelopeEntity } from '../../../../domain/envelopes/EnvelopeEntity';

interface Props {
  envelope: EnvelopeEntity;
  /** From `computeSpentDeltaVsPreviousPeriod` — null when nothing to compare against. */
  deltaCents: number | null;
  /**
   * Saved balance from the contribution ledger
   * (`usePersistentEnvelopeSavings`). Only read for a PERSISTENT envelope;
   * 0 until that hook's first load resolves.
   */
  savedCents?: number;
  /** Omit for a read-only (past-period) row. */
  onPress?: () => void;
  testID?: string;
}

export function BudgetEnvelopeRow({
  envelope,
  deltaCents,
  savedCents = 0,
  onPress,
  testID,
}: Props): React.JSX.Element {
  const { colors } = useAppTheme();
  const isPersistent = getEnvelopeScope(envelope) === 'persistent';
  const difference = envelope.allocatedCents - envelope.spentCents;
  // Never true for a persistent envelope — see the header comment: there is
  // no period budget for its all-time withdrawals to exceed.
  const isOver = !isPersistent && envelope.spentCents > envelope.allocatedCents;

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
          {isPersistent ? (
            <Text
              variant="bodySmall"
              style={[styles.meta, { color: colors.onSurfaceVariant }]}
              testID={testID ? `${testID}-saved` : undefined}
            >
              {`${formatCurrency(envelope.allocatedCents)} a month · ${formatCurrency(savedCents)} saved`}
            </Text>
          ) : (
            <Text variant="bodySmall" style={[styles.meta, { color: colors.onSurfaceVariant }]}>
              {`${formatCurrency(envelope.allocatedCents)} allocated · ${formatCurrency(envelope.spentCents)} spent · `}
              <Text style={{ color: isOver ? colors.error : colors.onSurfaceVariant }}>
                {`${difference < 0 ? '−' : ''}${formatCurrency(Math.abs(difference))} difference`}
              </Text>
            </Text>
          )}
          {/* "vs previous month" compares `spentCents` across periods, which
              for a persistent envelope is the same all-time number on both
              sides — always "Same as last month", never informative. */}
          {!isPersistent && deltaCents !== null && (
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
