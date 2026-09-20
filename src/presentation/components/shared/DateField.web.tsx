/**
 * DateField — web variant (UX-12).
 *
 * @react-native-community/datetimepicker renders null on web, so the native
 * DateField.tsx (metro/react-native-web platform resolution picks this file
 * automatically for web builds) is replaced here with a plain themed
 * `<input type="date">`, which every modern browser renders as a real date
 * picker. Value/onChange stay 'yyyy-MM-dd' local-date strings on both
 * platforms, so screens using DateField don't need platform branches.
 */
import React from 'react';
import { format } from 'date-fns';
import { useAppTheme } from '../../theme/useAppTheme';
import { spacing, radius, fontSize } from '../../theme/tokens';
import type { DateFieldProps } from './DateField';

const DATE_ONLY_FORMAT = 'yyyy-MM-dd';

export function DateField({
  label = 'Date',
  value,
  onChange,
  maximumDate = new Date(),
  disabled = false,
  testID = 'date-field',
}: DateFieldProps): React.JSX.Element {
  const { colors, dark: isDark } = useAppTheme();

  return (
    <div style={{ marginBottom: spacing.sm }}>
      {label && (
        <label
          htmlFor={testID}
          style={{
            display: 'block',
            color: colors.onSurfaceVariant,
            fontSize: fontSize.sm,
            marginBottom: spacing.xs,
          }}
        >
          {label}
        </label>
      )}
      <input
        id={testID}
        data-testid={testID}
        type="date"
        value={value ?? ''}
        max={maximumDate ? format(maximumDate, DATE_ONLY_FORMAT) : undefined}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
        style={
          {
            width: '100%',
            boxSizing: 'border-box',
            padding: spacing.md,
            fontSize: fontSize.md,
            color: colors.onSurface,
            backgroundColor: colors.surface,
            border: `1px solid ${colors.outline}`,
            borderRadius: radius.sm,
            colorScheme: isDark ? 'dark' : 'light',
          } as React.CSSProperties
        }
      />
    </div>
  );
}
