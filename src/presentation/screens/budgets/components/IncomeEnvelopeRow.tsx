/**
 * IncomeEnvelopeRow — an INCOME-section row on `BudgetScreen`.
 *
 * An income envelope is money IN. Its `allocatedCents` is what the household
 * EXPECTS to earn this period, and its derived `spentCents` (from
 * `getEnvelopeSpentCents`, a plain sum of the transaction ledger) is what
 * actually LANDED — imported history records salary deposits as transactions
 * against this envelope.
 *
 * The generic `EnvelopeCard` this section used to render reads those two
 * columns as a spending budget: it showed `allocated - spent` as "remaining",
 * in the ERROR colour with "0% remaining" and an empty fill bar, for a
 * household whose salary had simply arrived in full. That is the opposite of
 * what happened. This row says it plainly instead: received, of expected.
 *
 * See `domain/transactions/moneyDirection` for the one rule deciding what is
 * money in.
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
  /** Omit for a read-only (past-period) row. */
  onPress?: () => void;
  testID?: string;
}

export function IncomeEnvelopeRow({ envelope, onPress, testID }: Props): React.JSX.Element {
  const { colors } = useAppTheme();
  const receivedCents = Math.abs(envelope.spentCents);
  const expectedCents = envelope.allocatedCents;
  const hasReceipts = envelope.spentCents !== 0;
  const shortfallCents = expectedCents - receivedCents;

  const detail = hasReceipts
    ? `${formatCurrency(receivedCents)} received of ${formatCurrency(expectedCents)} expected`
    : `${formatCurrency(expectedCents)} expected`;

  return (
    <Surface style={[styles.surface, { backgroundColor: colors.surface }]} elevation={1}>
      <TouchableRipple
        onPress={onPress}
        disabled={!onPress}
        style={styles.ripple}
        borderless
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${envelope.name}, income. ${detail}.`}
      >
        <View style={styles.content}>
          <View style={styles.row}>
            <Text
              variant="titleSmall"
              style={[styles.name, { color: colors.onSurface }]}
              numberOfLines={1}
            >
              {envelope.name}
            </Text>
            {/* Money IN never reads in the error colour, and never by colour
                alone — the "+" and the word "Income" below carry it too. */}
            <Text
              variant="titleSmall"
              style={[styles.amount, { color: colors.success }]}
              testID={testID ? `${testID}-received` : undefined}
            >
              {`+${formatCurrency(hasReceipts ? receivedCents : expectedCents)}`}
            </Text>
          </View>
          <Text
            variant="bodySmall"
            style={[styles.meta, { color: colors.onSurfaceVariant }]}
            testID={testID ? `${testID}-detail` : undefined}
          >
            {`Income · ${detail}`}
          </Text>
          {/* Only ever a note, never an overspend: income arriving short of
              what was budgeted is a planning fact, not a rule broken. */}
          {hasReceipts && shortfallCents > 0 && (
            <Text
              variant="bodySmall"
              style={[styles.meta, { color: colors.onSurfaceVariant }]}
              testID={testID ? `${testID}-shortfall` : undefined}
            >
              {`${formatCurrency(shortfallCents)} less than expected`}
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    flex: 1,
    marginRight: spacing.sm,
  },
  amount: {
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  meta: {
    fontSize: fontSize.xs,
  },
});
