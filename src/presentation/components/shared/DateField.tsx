/**
 * DateField — native (Android/iOS) variant.
 *
 * Wraps the existing PickerField + @react-native-community/datetimepicker
 * pattern (see AddTransactionScreen's date row) as a reusable field whose
 * value/onChange are 'yyyy-MM-dd' local-date strings, so callers never
 * juggle Date objects or timezones themselves.
 *
 * @react-native-community/datetimepicker renders null on web (UX-12) — see
 * DateField.web.tsx for the web variant, which react-native-web/Metro's
 * platform extension resolution picks up automatically for web builds.
 */
import React, { useState } from 'react';
import { Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format, parse, isValid } from 'date-fns';
import { PickerField } from './PickerField';

const DATE_ONLY_FORMAT = 'yyyy-MM-dd';
const DISPLAY_FORMAT = 'd MMM yyyy';

export interface DateFieldProps {
  label?: string;
  placeholder?: string;
  /** Selected date as a 'yyyy-MM-dd' local-date string, or null/undefined for unset. */
  value: string | null | undefined;
  /** Called with the newly selected date as a 'yyyy-MM-dd' local-date string. */
  onChange: (value: string) => void;
  /** Defaults to today — pass null to allow any date (e.g. a future target date). */
  maximumDate?: Date | null;
  disabled?: boolean;
  testID?: string;
}

function parseDateOnly(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = parse(value, DATE_ONLY_FORMAT, new Date());
  return isValid(parsed) ? parsed : undefined;
}

export function DateField({
  label = 'Date',
  placeholder = 'Select a date',
  value,
  onChange,
  maximumDate = new Date(),
  disabled = false,
  testID = 'date-field',
}: DateFieldProps): React.JSX.Element {
  const [showPicker, setShowPicker] = useState(false);
  const parsedValue = parseDateOnly(value);

  return (
    <>
      <PickerField
        label={label}
        placeholder={placeholder}
        value={parsedValue ? format(parsedValue, DISPLAY_FORMAT) : undefined}
        onPress={() => {
          if (!disabled) setShowPicker(true);
        }}
        testID={testID}
      />

      {showPicker && (
        <DateTimePicker
          value={parsedValue ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={maximumDate ?? undefined}
          onChange={(_, date) => {
            setShowPicker(false);
            if (date) onChange(format(date, DATE_ONLY_FORMAT));
          }}
        />
      )}
    </>
  );
}
