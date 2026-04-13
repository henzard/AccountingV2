import React from 'react';
import { Text } from 'react-native';
import type { TextStyle } from 'react-native';

interface Props {
  amountCents: number;
  style?: TextStyle;
  showSign?: boolean;
}

export function CurrencyText({ amountCents, style, showSign = false }: Props): React.JSX.Element {
  const isNegative = amountCents < 0;
  const absAmount = Math.abs(amountCents);
  const rand = (absAmount / 100).toLocaleString('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const prefix = isNegative ? '-' : showSign ? '+' : '';
  return (
    <Text
      style={[{ fontFamily: 'PlusJakartaSans_600SemiBold', fontVariant: ['tabular-nums'] }, style]}
    >
      {`${prefix}${rand}`}
    </Text>
  );
}
