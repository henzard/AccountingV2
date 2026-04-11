import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { colours, spacing, radius } from '../../../theme/tokens';

interface DebtPayoffBarProps {
  progressPercent: number; // 0–100
  label: string;
}

export function DebtPayoffBar({ progressPercent, label }: DebtPayoffBarProps): React.JSX.Element {
  const clamped = Math.min(100, Math.max(0, progressPercent));
  const isPaidOff = clamped >= 100;

  return (
    <View style={styles.container}>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${clamped}%`,
              backgroundColor: isPaidOff ? colours.debtBarPaid : colours.debtBar,
            },
          ]}
        />
      </View>
      <Text variant="labelSmall" style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: spacing.xs },
  track: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colours.debtBarBackground,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.full,
  },
  label: {
    color: colours.onSurfaceVariant,
    marginTop: spacing.xs / 2,
    textAlign: 'right',
  },
});
