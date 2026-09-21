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

  /**
   * REF-SLIP: a slip routinely carries a "DISCOUNT -5,00" / voucher /
   * returned-item line. Before this fix the amount field stripped the sign
   * (`.replace(/^-?R/, '')` with no way to put it back), so such a line could
   * not be shown as a discount, could not be typed, and any edit silently
   * turned it into a CHARGE.
   */
  describe('REF-SLIP: negative (discount / refund) lines', () => {
    const discountItem: SlipExtractionItem = {
      description: 'DISCOUNT',
      amountCents: -1500,
      quantity: 1,
      suggestedEnvelopeId: null,
      confidence: 0.9,
    };

    it('marks a negative line with a worded label (not colour alone), a signed affix and an accessibilityLabel that says so', () => {
      const { getByTestId } = render(
        <LineItemRow
          item={discountItem}
          index={0}
          selectedEnvelope={envelope}
          transactionDate="2026-04-13"
          onSelectEnvelope={jest.fn()}
          onDescriptionChange={jest.fn()}
          onAmountChange={jest.fn()}
          onRemove={jest.fn()}
        />,
      );

      expect(getByTestId('line-item-discount-label-0').props.children).toBe(
        'Discount / refund (money back)',
      );
      expect(getByTestId('line-item-0').props.accessibilityLabel).toContain(
        'discount or refund — money back',
      );
      // The amount is announced SIGNED (formatCurrency renders "-R…").
      expect(getByTestId('line-item-0').props.accessibilityLabel).toContain('-R');
      // The FIELD holds the positive magnitude; the affix carries the sign.
      expect(getByTestId('line-item-amount-0').props.value).not.toMatch(/^-/);
      expect(getByTestId('line-item-amount-0').props.left.props.text).toBe('-R');
      expect(getByTestId('line-item-discount-toggle-0').props.value).toBe(true);
    });

    it('keeps the sign when the amount is edited — a discount stays a discount', () => {
      const onAmountChange = jest.fn();
      const { getByTestId } = render(
        <LineItemRow
          item={discountItem}
          index={0}
          selectedEnvelope={envelope}
          transactionDate="2026-04-13"
          onSelectEnvelope={jest.fn()}
          onDescriptionChange={jest.fn()}
          onAmountChange={onAmountChange}
          onRemove={jest.fn()}
        />,
      );

      fireEvent(getByTestId('line-item-amount-0'), 'changeText', '20,00');
      expect(onAmountChange).toHaveBeenCalledWith(0, -2000);
    });

    it('flips a charge into a discount and back again with the explicit toggle', () => {
      const onAmountChange = jest.fn();
      const { getByTestId, rerender } = render(
        <LineItemRow
          item={item}
          index={0}
          selectedEnvelope={envelope}
          transactionDate="2026-04-13"
          onSelectEnvelope={jest.fn()}
          onDescriptionChange={jest.fn()}
          onAmountChange={onAmountChange}
          onRemove={jest.fn()}
        />,
      );

      const toggle = getByTestId('line-item-discount-toggle-0');
      expect(toggle.props.value).toBe(false);
      fireEvent(toggle, 'valueChange', true);
      expect(onAmountChange).toHaveBeenLastCalledWith(0, -2500);

      rerender(
        <LineItemRow
          item={{ ...item, amountCents: -2500 }}
          index={0}
          selectedEnvelope={envelope}
          transactionDate="2026-04-13"
          onSelectEnvelope={jest.fn()}
          onDescriptionChange={jest.fn()}
          onAmountChange={onAmountChange}
          onRemove={jest.fn()}
        />,
      );
      fireEvent(getByTestId('line-item-discount-toggle-0'), 'valueChange', false);
      expect(onAmountChange).toHaveBeenLastCalledWith(0, 2500);
    });

    it('shows the discount label read-only too, with no toggle', () => {
      const { getByTestId, queryByTestId } = render(
        <LineItemRow
          item={discountItem}
          index={0}
          selectedEnvelope={envelope}
          transactionDate="2026-04-13"
          onSelectEnvelope={jest.fn()}
          readOnly
        />,
      );
      expect(getByTestId('line-item-discount-label-0')).toBeTruthy();
      expect(queryByTestId('line-item-discount-toggle-0')).toBeNull();
    });

    it('does not label a plain charge as a discount', () => {
      const { queryByTestId, getByTestId } = render(
        <LineItemRow
          item={item}
          index={0}
          selectedEnvelope={envelope}
          transactionDate="2026-04-13"
          onSelectEnvelope={jest.fn()}
          readOnly
        />,
      );
      expect(queryByTestId('line-item-discount-label-0')).toBeNull();
      expect(getByTestId('line-item-0').props.accessibilityLabel).not.toContain('discount');
    });
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
