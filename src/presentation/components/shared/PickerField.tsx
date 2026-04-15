import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { useAppTheme } from '../../theme/useAppTheme';
import { spacing, radius } from '../../theme/tokens';

interface PickerFieldProps {
  /**
   * When set, renders as "inline label | value" row (date-picker style).
   * When absent, renders as "value fills space | trailing | chevron" (selection style).
   */
  label?: string;
  /** Placeholder text shown when value is absent (selection style only). */
  placeholder?: string;
  /** Currently selected value. */
  value?: string;
  /** Secondary text on the right (e.g. "R120 left"). */
  trailing?: string;
  /** Color for trailing text. Defaults to onSurfaceVariant. */
  trailingColor?: string;
  /** Show › chevron at trailing edge (selection style). Default: false */
  showChevron?: boolean;
  onPress: () => void;
  testID?: string;
}

export function PickerField({
  label,
  placeholder,
  value,
  trailing,
  trailingColor,
  showChevron = false,
  onPress,
  testID,
}: PickerFieldProps): React.JSX.Element {
  const { colors } = useAppTheme();

  return (
    <TouchableRipple
      onPress={onPress}
      style={[styles.trigger, { borderColor: colors.outline }]}
      testID={testID}
    >
      <View style={styles.inner}>
        {label !== undefined ? (
          // Inline-label style: "Date    8 Apr 2026"
          <>
            <Text variant="bodyMedium" style={{ flex: 1, color: colors.onSurfaceVariant }}>
              {label}
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
              {value ?? placeholder ?? ''}
            </Text>
          </>
        ) : (
          // Selection style: value fills width, trailing + chevron on right
          <>
            <Text
              variant="bodyLarge"
              style={[
                styles.selectionValue,
                { color: value !== undefined ? colors.onSurface : colors.onSurfaceVariant },
              ]}
            >
              {value ?? placeholder ?? ''}
            </Text>
            {trailing !== undefined && (
              <Text
                variant="bodySmall"
                style={{
                  color: trailingColor ?? colors.onSurfaceVariant,
                  marginRight: spacing.sm,
                }}
              >
                {trailing}
              </Text>
            )}
            {showChevron && (
              <Text style={{ color: colors.onSurfaceVariant }}>›</Text>
            )}
          </>
        )}
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  trigger: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectionValue: { flex: 1 },
});
