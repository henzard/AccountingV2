import React from 'react';
import { Text } from 'react-native';
import type { TextStyle } from 'react-native';
import { formatCurrency } from '../../utils/currency';

interface Props {
  amountCents: number;
  style?: TextStyle;
  showSign?: boolean;
}

export function CurrencyText({ amountCents, style, showSign = false }: Props): React.JSX.Element {
  const isNegative = amountCents < 0;
  const formatted = formatCurrency(Math.abs(amountCents));
  const prefix = isNegative ? '-' : showSign ? '+' : '';
  return (
    <Text
      style={[{ fontFamily: 'PlusJakartaSans_600SemiBold', fontVariant: ['tabular-nums'] }, style]}
    >
      {`${prefix}${formatted}`}
    </Text>
  );
}
