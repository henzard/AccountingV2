/**
 * IncomeEnvelopeRow.test.tsx — the Budget screen's INCOME rows.
 *
 * An income envelope's derived `spentCents` is the salary that LANDED, not
 * money spent. Read by the generic spending presentation, a household whose
 * pay had arrived in full saw "R0,00 remaining · 0% remaining" in the error
 * colour. These rows must say received-of-expected instead, and never frame
 * money in as a budget being used up.
 */
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
      accessibilityLabel,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      testID?: string;
      accessibilityLabel?: string;
    }) =>
      React.createElement(
        'Pressable',
        { onPress: disabled ? undefined : onPress, testID, accessibilityLabel },
        children,
      ),
  };
});

jest.mock('../../../../utils/currency', () => ({
  formatCurrency: (cents: number) => `R${(cents / 100).toFixed(2)}`,
}));

import { IncomeEnvelopeRow } from '../IncomeEnvelopeRow';
import type { EnvelopeEntity } from '../../../../../domain/envelopes/EnvelopeEntity';

function makeIncome(overrides: Partial<EnvelopeEntity> = {}): EnvelopeEntity {
  return {
    id: 'inc-1',
    householdId: 'hh-1',
    name: 'Nedbank',
    allocatedCents: 350000,
    spentCents: 348000,
    envelopeType: 'income',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-08-20',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-08-20',
    updatedAt: '2026-08-20',
    ...overrides,
  };
}

describe('IncomeEnvelopeRow', () => {
  it('reads as received of expected, never as remaining', () => {
    const { getByTestId } = render(<IncomeEnvelopeRow envelope={makeIncome()} testID="row" />);
    expect(String(getByTestId('row-detail').props.children)).toBe(
      'Income · R3480.00 received of R3500.00 expected',
    );
  });

  it('signs the amount as money coming IN', () => {
    const { getByTestId } = render(<IncomeEnvelopeRow envelope={makeIncome()} testID="row" />);
    expect(String(getByTestId('row-received').props.children)).toBe('+R3480.00');
  });

  it('carries the word "Income", so colour is never the only signal', () => {
    const { getByTestId } = render(<IncomeEnvelopeRow envelope={makeIncome()} testID="row" />);
    expect(String(getByTestId('row-detail').props.children)).toContain('Income');
  });

  it('notes a shortfall as a fact, not as an overspend', () => {
    const { getByTestId } = render(<IncomeEnvelopeRow envelope={makeIncome()} testID="row" />);
    expect(String(getByTestId('row-shortfall').props.children)).toBe('R20.00 less than expected');
  });

  it('shows no shortfall line when the full expected amount arrived', () => {
    const { queryByTestId } = render(
      <IncomeEnvelopeRow envelope={makeIncome({ spentCents: 350000 })} testID="row" />,
    );
    expect(queryByTestId('row-shortfall')).toBeNull();
  });

  it('falls back to the expected figure when nothing has been recorded yet', () => {
    const { getByTestId, queryByTestId } = render(
      <IncomeEnvelopeRow envelope={makeIncome({ spentCents: 0 })} testID="row" />,
    );
    expect(String(getByTestId('row-detail').props.children)).toBe('Income · R3500.00 expected');
    expect(String(getByTestId('row-received').props.children)).toBe('+R3500.00');
    expect(queryByTestId('row-shortfall')).toBeNull();
  });

  it('says "income" in words in its accessibility label', () => {
    const { getByTestId } = render(<IncomeEnvelopeRow envelope={makeIncome()} testID="row" />);
    expect(String(getByTestId('row').props.accessibilityLabel).toLowerCase()).toContain('income');
  });

  it('is not pressable for a read-only (past) period', () => {
    const onPress = jest.fn();
    const { getByTestId, rerender } = render(
      <IncomeEnvelopeRow envelope={makeIncome()} testID="row" />,
    );
    fireEvent.press(getByTestId('row'));
    expect(onPress).not.toHaveBeenCalled();

    rerender(<IncomeEnvelopeRow envelope={makeIncome()} onPress={onPress} testID="row" />);
    fireEvent.press(getByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
