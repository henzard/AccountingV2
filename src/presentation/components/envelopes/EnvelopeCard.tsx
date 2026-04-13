import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Surface } from 'react-native-paper';
import { EnvelopeFillBar } from '../shared/EnvelopeFillBar';
import { CurrencyText } from '../shared/CurrencyText';
import { colours, spacing, radius } from '../../theme/tokens';
import {
  getRemainingCents,
  getPercentRemaining,
  isOverBudget,
} from '../../../domain/envelopes/EnvelopeEntity';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

interface Props {
  envelope: EnvelopeEntity;
  /** Optional — omit when the card is display-only (e.g. BudgetScreen overview). */
  onPress?: () => void;
}

export function EnvelopeCard({ envelope, onPress }: Props): React.JSX.Element {
  const remaining = getRemainingCents(envelope);
  const pct = getPercentRemaining(envelope);
  const over = isOverBudget(envelope);

  return (
    <Surface style={styles.surface} elevation={1}>
      <TouchableRipple onPress={onPress} style={styles.ripple} borderless>
        <View style={styles.content}>
          <View style={styles.row}>
            <Text variant="titleSmall" style={styles.name} numberOfLines={1}>
              {envelope.name}
            </Text>
            <CurrencyText
              amountCents={remaining}
              style={{ ...styles.remaining, ...(over ? styles.overBudget : styles.underBudget) }}
            />
          </View>
          <Text variant="bodySmall" style={styles.meta}>
            {`of `}
            <CurrencyText amountCents={envelope.allocatedCents} style={styles.meta} />
            {` budgeted · ${pct}% remaining`}
          </Text>
          <View style={styles.bar}>
            <EnvelopeFillBar percentRemaining={pct} height={6} />
          </View>
        </View>
      </TouchableRipple>
    </Surface>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    backgroundColor: colours.surface,
  },
  ripple: {
    borderRadius: radius.lg,
  },
  content: {
    padding: spacing.base,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  name: {
    flex: 1,
    color: colours.onSurface,
    marginRight: spacing.sm,
  },
  remaining: {
    fontSize: 15,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  underBudget: {
    color: colours.onSurface,
  },
  overBudget: {
    color: colours.error,
  },
  meta: {
    color: colours.onSurfaceVariant,
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  bar: {
    marginTop: spacing.xs,
  },
});
