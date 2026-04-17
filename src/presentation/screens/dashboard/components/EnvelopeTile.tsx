/**
 * EnvelopeTile — compact 2-column grid tile for the PULSE dashboard.
 *
 * Shows envelope name, remaining amount (color-coded), a 3px fill bar,
 * and a short status line. Adapts colors to light/dark scheme.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, useColorScheme } from 'react-native';
import { EnvelopeFillBar } from '../../../components/shared/EnvelopeFillBar';
import { CurrencyText } from '../../../components/shared/CurrencyText';
import {
  getRemainingCents,
  getPercentRemaining,
  isOverBudget,
} from '../../../../domain/envelopes/EnvelopeEntity';
import type { EnvelopeEntity } from '../../../../domain/envelopes/EnvelopeEntity';
import { P } from './HeroSummaryCard';
import { radius, spacing, fontSize } from '../../../theme/tokens';

interface Props {
  envelope: EnvelopeEntity;
  onPress?: () => void;
}

function statusLine(pct: number, over: boolean): string {
  if (over) return 'Over budget ✕';
  if (pct === 0) return 'Empty';
  if (pct <= 18) return `${pct}% left · ⚠`;
  if (pct >= 99) return 'Funded ✓';
  return `${pct}% left`;
}

export function EnvelopeTile({ envelope, onPress }: Props): React.JSX.Element {
  const isDark = useColorScheme() === 'dark';
  const remaining = getRemainingCents(envelope);
  const pct = getPercentRemaining(envelope);
  const over = isOverBudget(envelope);

  // Amount color
  let amountColor: string;
  if (over) {
    amountColor = isDark ? P.red : P.redLight;
  } else if (pct <= 18) {
    amountColor = isDark ? P.amber : P.amberLight;
  } else {
    amountColor = isDark ? P.heroText : '#1A2E28';
  }

  const tileStyle = isDark
    ? { backgroundColor: P.tileBgDark, borderColor: P.tileBorderDark }
    : { backgroundColor: P.tileBgLight, borderColor: P.tileBorderLight };

  const nameColor = isDark ? P.statLabel : '#6A8A7E';
  const statusColor = isDark ? 'rgba(160,210,190,0.28)' : '#A8C4B8';

  return (
    <TouchableOpacity
      style={[styles.tile, tileStyle]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${envelope.name}, ${remaining} cents remaining, ${pct}% left`}
    >
      <Text style={[styles.name, { color: nameColor }]} numberOfLines={1}>
        {envelope.name}
      </Text>
      <CurrencyText
        amountCents={remaining}
        style={StyleSheet.flatten([styles.amount, { color: amountColor }])}
      />
      <EnvelopeFillBar percentRemaining={pct} height={3} />
      <Text style={[styles.status, { color: statusColor }]}>{statusLine(pct, over)}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.md,
    paddingBottom: spacing.sm,
    // shadow for light mode (ignored on dark — surface is transparent)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  name: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: fontSize.sm,
    marginBottom: spacing.sm,
  },
  amount: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: fontSize.lg,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
    marginBottom: spacing.sm,
  },
  status: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
});
