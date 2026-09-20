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
  const TextInput = ({
    value,
    onChangeText,
    testID,
    ...p
  }: {
    value?: string;
    onChangeText?: (t: string) => void;
    testID?: string;
    [k: string]: unknown;
  }) =>
    React.createElement('TextInput', {
      value,
      onChangeText,
      testID,
      ...p,
    });
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
  const IconButton = ({
    onPress,
    testID,
    accessibilityLabel,
    accessibilityRole,
    ...p
  }: {
    onPress?: () => void;
    testID?: string;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    [k: string]: unknown;
  }) =>
    React.createElement('TouchableOpacity', {
      onPress,
      testID,
      accessibilityLabel,
      accessibilityRole,
      ...p,
    });
  return { Text, TextInput, TouchableRipple, IconButton };
});

import { LineItemRow } from '../LineItemRow';
import type { SlipExtractionItem } from '../../../../../domain/slipScanning/types';

const item: SlipExtractionItem = {
  description: 'Bread',
  amountCents: 2500,
  quantity: 1,
  suggestedEnvelopeId: null,
  confidence: 0.9,
};

const envelope = {
  id: 'e1',
  name: 'Groceries',
  allocatedCents: 50000,
  spentCents: 10000,
  envelopeType: 'spending' as const,
};

describe('LineItemRow (UX2-19)', () => {
  it('gives the envelope-picker touch target a minHeight of at least 44dp and hitSlop', () => {
    const { getByTestId } = render(
      <LineItemRow
        item={item}
        index={0}
        selectedEnvelope={envelope}
        transactionDate="2026-04-13"
        onSelectEnvelope={jest.fn()}
        onDescriptionChange={jest.fn()}
        onAmountChange={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    const button = getByTestId('line-item-envelope-picker-0');
    const flatStyle = [button.props.style].flat();
    const minHeight = flatStyle.reduce(
      (found: number | undefined, s: { minHeight?: number } | undefined) => found ?? s?.minHeight,
      undefined,
    );
    expect(minHeight).toBeGreaterThanOrEqual(44);
    expect(button.props.hitSlop).toBeTruthy();
  });

  it('renders Remove as a trailing icon button, at least 44dp, with hitSlop and a description-specific accessibilityLabel', () => {
    const onRemove = jest.fn();
    const { getByTestId } = render(
      <LineItemRow
        item={item}
        index={2}
        selectedEnvelope={envelope}
        transactionDate="2026-04-13"
        onSelectEnvelope={jest.fn()}
        onDescriptionChange={jest.fn()}
        onAmountChange={jest.fn()}
        onRemove={onRemove}
      />,
    );
    const removeButton = getByTestId('line-item-remove-2');
    expect(removeButton.props.accessibilityLabel).toBe('Remove line Bread');
    expect(removeButton.props.accessibilityRole).toBe('button');
    expect(removeButton.props.hitSlop).toBeTruthy();

    const flatStyle = [removeButton.props.style].flat();
    const minHeight = flatStyle.reduce(
      (found: number | undefined, s: { minHeight?: number } | undefined) => found ?? s?.minHeight,
      undefined,
    );
    expect(minHeight).toBeGreaterThanOrEqual(44);

    fireEvent.press(removeButton);
    expect(onRemove).toHaveBeenCalledWith(2);
  });

  it('does not render the remove button when read-only', () => {
    const { queryByTestId } = render(
      <LineItemRow
        item={item}
        index={0}
        selectedEnvelope={envelope}
        transactionDate="2026-04-13"
        onSelectEnvelope={jest.fn()}
        readOnly
      />,
    );
    expect(queryByTestId('line-item-remove-0')).toBeNull();
  });
});
