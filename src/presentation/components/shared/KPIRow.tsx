import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Surface, Text } from 'react-native-paper';
import { CurrencyText } from './CurrencyText';
import { useAppTheme } from '../../theme/useAppTheme';
import { spacing, radius } from '../../theme/tokens';

export interface KPIItem {
  label: string;
  valueCents: number;
  /** Show error color when valueCents is negative. Default: false */
  errorWhenNegative?: boolean;
}

interface KPIRowProps {
  items: KPIItem[];
  testID?: string;
}

export function KPIRow({ items, testID }: KPIRowProps): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <Surface
      style={[styles.surface, { backgroundColor: colors.primaryContainer }]}
      elevation={1}
      testID={testID}
    >
      {items.map((item, index) => (
        <React.Fragment key={`${item.label}-${index}`}>
          {index > 0 && (
            <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
          )}
          <View style={styles.item}>
            <Text variant="labelSmall" style={[styles.label, { color: colors.onPrimaryContainer }]}>
              {item.label.toUpperCase()}
            </Text>
            <CurrencyText
              amountCents={item.valueCents}
              style={{
                ...styles.value,
                color:
                  item.errorWhenNegative && item.valueCents < 0
                    ? colors.error
                    : colors.onPrimaryContainer,
              }}
            />
          </View>
        </React.Fragment>
      ))}
    </Surface>
  );
}

const styles = StyleSheet.create({
  surface: {
    flexDirection: 'row',
    marginHorizontal: spacing.base,
    marginTop: spacing.base,
    borderRadius: radius.lg,
    padding: spacing.base,
  },
  item: { flex: 1, alignItems: 'center' },
  label: { letterSpacing: 0.8, marginBottom: spacing.xs },
  value: {
    fontSize: 24,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontVariant: ['tabular-nums'],
  },
  divider: { width: 1, marginVertical: spacing.xs },
});
