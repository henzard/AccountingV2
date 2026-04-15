import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { PickerField } from '../PickerField';

describe('PickerField', () => {
  it('shows value when provided', () => {
    const { getByText } = render(
      <PickerField value="Groceries" onPress={jest.fn()} />,
    );
    expect(getByText('Groceries')).toBeTruthy();
  });

  it('shows placeholder when no value', () => {
    const { getByText } = render(
      <PickerField placeholder="Select envelope…" onPress={jest.fn()} />,
    );
    expect(getByText('Select envelope…')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <PickerField placeholder="Pick one" onPress={onPress} testID="pf" />,
    );
    fireEvent.press(getByTestId('pf'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows trailing text when provided', () => {
    const { getByText } = render(
      <PickerField value="Groceries" trailing="R120 left" onPress={jest.fn()} />,
    );
    expect(getByText('R120 left')).toBeTruthy();
  });

  it('shows inline label when label prop is provided', () => {
    const { getByText } = render(
      <PickerField label="Date" value="8 Apr 2026" onPress={jest.fn()} />,
    );
    expect(getByText('Date')).toBeTruthy();
    expect(getByText('8 Apr 2026')).toBeTruthy();
  });
});
