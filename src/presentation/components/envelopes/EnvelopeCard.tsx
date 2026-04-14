import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Surface } from 'react-native-paper';
import { EnvelopeFillBar } from '../shared/EnvelopeFillBar';
import { CurrencyText } from '../shared/CurrencyText';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
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
  const { colors } = useAppTheme();
  const remaining = getRemainingCents(envelope);
  const pct = getPercentRemaining(envelope);
  const over = isOverBudget(envelope);

  return (
    <Surface style={[styles.surface, { backgroundColor: colors.surface }]} elevation={1}>
      <TouchableRipple onPress={onPress} style={styles.ripple} borderless>
        <View style={styles.content}>
          <View style={styles.row}>
            <Text
              variant="titleSmall"
              style={[styles.name, { color: colors.onSurface }]}
              numberOfLines={1}
            >
              {envelope.name}
            </Text>
            <CurrencyText
              amountCents={remaining}
              style={StyleSheet.flatten([
                styles.remaining,
                { color: over ? colors.error : colors.onSurface },
              ])}
            />
          </View>
          <Text variant="bodySmall" style={[styles.meta, { color: colors.onSurfaceVariant }]}>
            {`of `}
            <CurrencyText
              amountCents={envelope.allocatedCents}
              style={StyleSheet.flatten([styles.meta, { color: colors.onSurfaceVariant }])}
            />
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
    marginRight: spacing.sm,
  },
  remaining: {
    fontSize: 15,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  meta: {
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  bar: {
    marginTop: spacing.xs,
  },
});
