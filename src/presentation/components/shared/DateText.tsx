import React from 'react';
import { Text } from 'react-native';
import type { TextStyle } from 'react-native';
import { format, parseISO } from 'date-fns';

interface Props {
  isoDate: string;
  formatStr?: string;
  style?: TextStyle;
}

export function DateText({
  isoDate,
  formatStr = 'dd MMM yyyy',
  style,
}: Props): React.JSX.Element {
  const date = parseISO(isoDate);
  return (
    <Text style={[{ fontFamily: 'PlusJakartaSans_400Regular' }, style]}>
      {format(date, formatStr)}
    </Text>
  );
}
