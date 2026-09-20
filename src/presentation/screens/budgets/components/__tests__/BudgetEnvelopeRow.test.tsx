import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({
      children,
      testID,
      style,
    }: {
      children?: React.ReactNode;
      testID?: string;
      style?: unknown;
    }) => React.createElement('Text', { testID, style }, children),
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    TouchableRipple: ({
      children,
      onPress,
      disabled,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      testID?: string;
    }) =>
      React.createElement(
        'Pressable',
        { onPress: disabled ? undefined : onPress, testID },
        children,
      ),
  };
});

jest.mock('../../../../utils/currency', () => ({
  formatCurrency: (cents: number) => `R${(cents / 100).toFixed(2)}`,
}));

import { BudgetEnvelopeRow } from '../BudgetEnvelopeRow';
import type { EnvelopeEntity } from '../../../../../domain/envelopes/EnvelopeEntity';

function makeEnvelope(overrides: Partial<EnvelopeEntity> = {}): EnvelopeEntity {
  return {
    id: 'e1',
    householdId: 'hh-1',
    name: 'Groceries',
    allocatedCents: 200000,
    spentCents: 50000,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-09-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    ...overrides,
  } as EnvelopeEntity;
}

describe('BudgetEnvelopeRow', () => {
  it('shows allocated, spent, and the difference', () => {
    const { getByText } = render(
      <BudgetEnvelopeRow envelope={makeEnvelope()} deltaCents={null} testID="row" />,
    );
    expect(getByText(/R2000\.00 allocated/)).toBeTruthy();
    expect(getByText(/R500\.00 spent/)).toBeTruthy();
    expect(getByText(/R1500\.00 difference/)).toBeTruthy();
  });

  it('does not show a "vs previous month" line when deltaCents is null', () => {
    const { queryByTestId } = render(
      <BudgetEnvelopeRow envelope={makeEnvelope()} deltaCents={null} testID="row" />,
    );
    expect(queryByTestId('row-delta')).toBeNull();
  });

  it('shows an increase vs previous month', () => {
    const { getByTestId } = render(
      <BudgetEnvelopeRow envelope={makeEnvelope()} deltaCents={10000} testID="row" />,
    );
    expect(getByTestId('row-delta').props.children).toContain('R100.00 vs previous month');
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <BudgetEnvelopeRow
        envelope={makeEnvelope()}
        deltaCents={null}
        onPress={onPress}
        testID="row"
      />,
    );
    fireEvent.press(getByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not pressable (read-only) when onPress is omitted', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <BudgetEnvelopeRow envelope={makeEnvelope()} deltaCents={null} testID="row" />,
    );
    fireEvent.press(getByTestId('row'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
