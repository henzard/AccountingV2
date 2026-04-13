import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Text = ({
    children,
    testID,
    ...p
  }: {
    children?: React.ReactNode;
    testID?: string;
    [k: string]: unknown;
  }) => React.createElement('Text', { testID, ...p }, children);
  const TouchableRipple = ({
    children,
    onPress,
    testID,
    ...p
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    [k: string]: unknown;
  }) => React.createElement('TouchableOpacity', { onPress, testID, ...p }, children);
  const Surface = ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('View', p, children);
  return { Text, TouchableRipple, Surface };
});

import { EnvelopePickerSheet } from '../EnvelopePickerSheet';
import type { EnvelopeOption } from '../EnvelopePickerSheet';

const mockEnvelopes: EnvelopeOption[] = [
  {
    id: 'e1',
    name: 'Groceries',
    allocatedCents: 50000,
    spentCents: 20000,
    envelopeType: 'spending',
  },
  { id: 'e2', name: 'Fuel', allocatedCents: 30000, spentCents: 30000, envelopeType: 'spending' },
];

describe('EnvelopePickerSheet', () => {
  it('renders envelope options when visible', () => {
    const { getByTestId } = render(
      <EnvelopePickerSheet
        visible
        envelopes={mockEnvelopes}
        selectedId={null}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(getByTestId('envelope-option-e1')).toBeTruthy();
    expect(getByTestId('envelope-option-e2')).toBeTruthy();
  });

  it('calls onSelect and onClose when an envelope is tapped', () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const { getByTestId } = render(
      <EnvelopePickerSheet
        visible
        envelopes={mockEnvelopes}
        selectedId={null}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    fireEvent.press(getByTestId('envelope-option-e1'));
    expect(onSelect).toHaveBeenCalledWith(mockEnvelopes[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is pressed', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <EnvelopePickerSheet
        visible
        envelopes={mockEnvelopes}
        selectedId={null}
        onSelect={jest.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.press(getByTestId('envelope-picker-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows balance for each envelope', () => {
    const { getByTestId } = render(
      <EnvelopePickerSheet
        visible
        envelopes={mockEnvelopes}
        selectedId={null}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(getByTestId('envelope-balance-e1')).toBeTruthy();
    expect(getByTestId('envelope-balance-e2')).toBeTruthy();
  });
});
