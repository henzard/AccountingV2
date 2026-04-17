/**
 * EnvelopeTile.test.tsx — smoke tests for the PULSE envelope grid tile.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../../../../components/shared/CurrencyText', () => ({
  CurrencyText: ({ amountCents }: { amountCents: number }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const R = require('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text } = require('react-native');
    return R.createElement(Text, null, String(amountCents));
  },
}));

jest.mock('../../../../components/shared/EnvelopeFillBar', () => ({
  EnvelopeFillBar: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const R = require('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { View } = require('react-native');
    return R.createElement(View, { testID: 'fill-bar' });
  },
}));

import { EnvelopeTile } from '../EnvelopeTile';
import type { EnvelopeEntity } from '../../../../../domain/envelopes/EnvelopeEntity';

function makeEnvelope(overrides: Partial<EnvelopeEntity> = {}): EnvelopeEntity {
  return {
    id: 'env-1',
    name: 'Groceries',
    allocatedCents: 100000,
    spentCents: 40000,
    householdId: 'hh-1',
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-04-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

describe('EnvelopeTile', () => {
  it('renders envelope name', () => {
    const { getByText } = render(<EnvelopeTile envelope={makeEnvelope()} />);
    expect(getByText('Groceries')).toBeTruthy();
  });

  it('shows percentage remaining status', () => {
    const { getByText } = render(<EnvelopeTile envelope={makeEnvelope()} />);
    // 60% remaining — falls in "X% left" bucket
    expect(getByText(/60% left/)).toBeTruthy();
  });

  it('shows over budget status when spent exceeds allocated', () => {
    const { getByText } = render(
      <EnvelopeTile envelope={makeEnvelope({ spentCents: 120000, allocatedCents: 100000 })} />,
    );
    expect(getByText('Over budget ✕')).toBeTruthy();
  });

  it('shows "Funded ✓" when pct is >= 99 (near fully allocated)', () => {
    // 0% remaining → empty (spent == allocated)
    const { getByText } = render(
      <EnvelopeTile envelope={makeEnvelope({ spentCents: 0, allocatedCents: 100000 })} />,
    );
    expect(getByText('Funded ✓')).toBeTruthy();
  });

  it('shows warning when very little remaining', () => {
    // 10% remaining — triggers ⚠
    const { getByText } = render(
      <EnvelopeTile envelope={makeEnvelope({ spentCents: 90000, allocatedCents: 100000 })} />,
    );
    expect(getByText(/⚠/)).toBeTruthy();
  });

  it('shows "Empty" when nothing remains', () => {
    const { getByText } = render(
      <EnvelopeTile envelope={makeEnvelope({ spentCents: 100000, allocatedCents: 100000 })} />,
    );
    expect(getByText('Empty')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<EnvelopeTile envelope={makeEnvelope()} onPress={onPress} />);
    fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders fill bar', () => {
    const { getByTestId } = render(<EnvelopeTile envelope={makeEnvelope()} />);
    expect(getByTestId('fill-bar')).toBeTruthy();
  });
});
