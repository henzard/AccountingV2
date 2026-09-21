/**
 * PreviousPeriodSummaryCard — last period's headline numbers, shown on the
 * dashboard when the CURRENT period has no spending envelopes yet.
 *
 * A household with 18 months of history that opens the app the day after
 * payday used to get a blank screen: everything on the dashboard keys off
 * "the current period", and the current period has nothing in it until a
 * rollover happens. This card is what stops that screen being empty — it
 * shows what the last budgeted period actually did, so the numbers are still
 * there while the new period is being started.
 *
 * SPENT and RECEIVED are separate figures, never one net: money booked
 * against an `income` envelope (imported salary deposits) is money IN — see
 * `domain/transactions/moneyDirection`, which produces the numbers passed in
 * here.
 */
import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { formatCurrency } from '../../../utils/currency';
import { spacing, radius, fontSize } from '../../../theme/tokens';

export interface PreviousPeriodSummaryCardProps {
  /** Display label of the period these figures belong to, e.g. "August 2026". */
  periodLabel: string;
  spentCents: number;
  allocatedCents: number;
  /** Money IN recorded that period; the Received line is hidden when 0. */
  receivedCents: number;
  backgroundColor: string;
  borderColor: string;
  labelColor: string;
  valueColor: string;
  /** Theme success colour — Received is money in, not another expense. */
  receivedColor: string;
  testID?: string;
}

export function PreviousPeriodSummaryCard({
  periodLabel,
  spentCents,
  allocatedCents,
  receivedCents,
  backgroundColor,
  borderColor,
  labelColor,
  valueColor,
  receivedColor,
  testID = 'dashboard-previous-period-summary',
}: PreviousPeriodSummaryCardProps): React.JSX.Element {
  return (
    <View style={[styles.card, { backgroundColor, borderColor }]} testID={testID}>
      <Text style={[styles.title, { color: labelColor }]}>{`${periodLabel} · last period`}</Text>

      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={[styles.statLabel, { color: labelColor }]}>Spent</Text>
          <Text
            style={[styles.statValue, { color: valueColor }]}
            testID={`${testID}-spent`}
          >{`${formatCurrency(spentCents)} of ${formatCurrency(allocatedCents)}`}</Text>
        </View>
      </View>

      {receivedCents !== 0 && (
        <View style={styles.row}>
          <View style={styles.stat}>
            <Text style={[styles.statLabel, { color: labelColor }]}>Received</Text>
            <Text
              style={[styles.statValue, { color: receivedColor }]}
              testID={`${testID}-received`}
            >
              {formatCurrency(receivedCents)}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.base,
    marginTop: spacing.base,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
  },
  title: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: fontSize.xs,
    letterSpacing: 0.4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stat: { flex: 1, gap: 2 },
  statLabel: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.xs,
  },
  statValue: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: fontSize.base,
  },
});
