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

  // BUDGET-1: a persistent envelope's `spentCents` is an ALL-TIME withdrawal
  // total and its `allocatedCents` is only this period's contribution, so the
  // allocated/spent/difference row compared two different time spans and
  // flagged an untouched fund as over budget.
  describe('persistent envelopes (savings / sinking fund / emergency fund / baby step)', () => {
    const babyStepFund = makeEnvelope({
      id: 'bs-1',
      name: 'Baby Step 1',
      envelopeType: 'baby_step',
      allocatedCents: 50000, // R500 a month
      spentCents: 320000, // R3 200 of LIFETIME withdrawals
    });

    it('shows the monthly contribution and the saved balance, not allocated/spent/difference', () => {
      const { getByTestId, queryByText } = render(
        <BudgetEnvelopeRow
          envelope={babyStepFund}
          deltaCents={null}
          savedCents={180000}
          testID="row"
        />,
      );
      expect(getByTestId('row-saved').props.children).toBe('R500.00 a month · R1800.00 saved');
      expect(queryByText(/allocated/)).toBeNull();
      expect(queryByText(/spent/)).toBeNull();
      expect(queryByText(/difference/)).toBeNull();
    });

    it('never reads as over budget, however large the lifetime withdrawals', () => {
      const { queryByText } = render(
        <BudgetEnvelopeRow
          envelope={babyStepFund}
          deltaCents={null}
          savedCents={180000}
          testID="row"
        />,
      );
      // R3200.00 is the all-time spend; it must not surface on this row at all.
      expect(queryByText(/R3200\.00/)).toBeNull();
      expect(queryByText(/−R2700\.00 difference/)).toBeNull();
    });

    it('shows R0.00 saved before the savings hook has loaded', () => {
      const { getByTestId } = render(
        <BudgetEnvelopeRow envelope={babyStepFund} deltaCents={null} testID="row" />,
      );
      expect(getByTestId('row-saved').props.children).toBe('R500.00 a month · R0.00 saved');
    });

    it('suppresses the "vs previous month" line (an all-time figure never changes)', () => {
      const { queryByTestId } = render(
        <BudgetEnvelopeRow
          envelope={babyStepFund}
          deltaCents={0}
          savedCents={180000}
          testID="row"
        />,
      );
      expect(queryByTestId('row-delta')).toBeNull();
    });

    it.each(['savings', 'sinking_fund', 'emergency_fund', 'baby_step'] as const)(
      'uses the saved-balance presentation for %s',
      (envelopeType) => {
        const { getByTestId } = render(
          <BudgetEnvelopeRow
            envelope={makeEnvelope({ envelopeType, allocatedCents: 50000, spentCents: 320000 })}
            deltaCents={null}
            savedCents={180000}
            testID="row"
          />,
        );
        expect(getByTestId('row-saved')).toBeTruthy();
      },
    );

    it.each(['spending', 'utility'] as const)(
      'keeps the allocated/spent presentation for %s',
      (envelopeType) => {
        const { queryByTestId, getByText } = render(
          <BudgetEnvelopeRow
            envelope={makeEnvelope({ envelopeType })}
            deltaCents={null}
            testID="row"
          />,
        );
        expect(queryByTestId('row-saved')).toBeNull();
        expect(getByText(/R2000\.00 allocated/)).toBeTruthy();
      },
    );

    it('is still tappable when a press handler is given', () => {
      const onPress = jest.fn();
      const { getByTestId } = render(
        <BudgetEnvelopeRow
          envelope={babyStepFund}
          deltaCents={null}
          savedCents={180000}
          onPress={onPress}
          testID="row"
        />,
      );
      fireEvent.press(getByTestId('row'));
      expect(onPress).toHaveBeenCalledTimes(1);
    });
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
