/**
 * DateField.test.tsx — native (Android/iOS) variant (UX-12).
 * Verifies the value/onChange contract stays 'yyyy-MM-dd' local-date
 * strings even though the underlying picker works with Date objects.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

let lastPickerProps: { value?: Date; onChange?: (e: unknown, d?: Date) => void } = {};
jest.mock('@react-native-community/datetimepicker', () => (props: any) => {
  lastPickerProps = props;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return React.createElement('View', { testID: 'native-date-picker' });
});

import { DateField } from '../DateField';

describe('DateField (native)', () => {
  beforeEach(() => {
    lastPickerProps = {};
  });

  it('shows a placeholder when value is null', () => {
    const { getByTestId } = render(
      <DateField value={null} onChange={jest.fn()} testID="my-date-field" placeholder="Pick one" />,
    );
    expect(getByTestId('my-date-field')).toBeTruthy();
  });

  it('does not render the native picker until pressed', () => {
    const { queryByTestId } = render(
      <DateField value="2027-12-01" onChange={jest.fn()} testID="my-date-field" />,
    );
    expect(queryByTestId('native-date-picker')).toBeNull();
  });

  it('renders the native picker after the field is pressed', () => {
    const { getByTestId, queryByTestId } = render(
      <DateField value="2027-12-01" onChange={jest.fn()} testID="my-date-field" />,
    );
    fireEvent.press(getByTestId('my-date-field'));
    expect(queryByTestId('native-date-picker')).toBeTruthy();
  });

  it('calls onChange with a yyyy-MM-dd string when a date is picked', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <DateField value="2027-12-01" onChange={onChange} testID="my-date-field" />,
    );
    fireEvent.press(getByTestId('my-date-field'));

    lastPickerProps.onChange?.({}, new Date(2028, 0, 15)); // Jan 15 2028 (local)

    expect(onChange).toHaveBeenCalledWith('2028-01-15');
  });

  it('parses the initial value as a local date, not shifted by timezone', () => {
    const { getByTestId } = render(
      <DateField value="2027-12-01" onChange={jest.fn()} testID="my-date-field" />,
    );
    fireEvent.press(getByTestId('my-date-field'));

    // date-fns `parse` with 'yyyy-MM-dd' produces a local midnight Date — a
    // UTC-parse regression (e.g. `new Date('2027-12-01')`) would shift the
    // day backwards in timezones behind UTC.
    const pickerValue = lastPickerProps.value;
    expect(pickerValue?.getFullYear()).toBe(2027);
    expect(pickerValue?.getMonth()).toBe(11);
    expect(pickerValue?.getDate()).toBe(1);
  });
});
