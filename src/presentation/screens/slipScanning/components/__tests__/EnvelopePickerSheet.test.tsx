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

jest.mock('../../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) => selector({ householdId: 'hh-1' })),
}));

// REG-8/VAL2-2: a persistent envelope's balance comes from the contribution
// ledger, not `allocatedCents - spentCents` — mocked per-test below.
let mockSavedCentsByEnvelopeId = new Map<string, number>();
jest.mock('../../../../hooks/usePersistentEnvelopeSavings', () => ({
  usePersistentEnvelopeSavings: jest.fn(() => ({
    savedCentsByEnvelopeId: mockSavedCentsByEnvelopeId,
    loading: false,
    error: null,
    reload: jest.fn(),
  })),
}));

import { EnvelopePickerSheet } from '../EnvelopePickerSheet';
import type { EnvelopeOption } from '../EnvelopePickerSheet';
import { formatCurrency } from '../../../../utils/currency';

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
  beforeEach(() => {
    mockSavedCentsByEnvelopeId = new Map();
  });

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

  // REG-8/VAL2-2 regression: a persistent envelope's trailing balance must
  // come from the saved-balance ledger, not allocatedCents - spentCents.
  it('shows the saved balance (not allocatedCents - spentCents) for a persistent envelope', () => {
    mockSavedCentsByEnvelopeId = new Map([['e3', 600000]]); // R6 000 saved
    const fundEnvelope: EnvelopeOption = {
      id: 'e3',
      name: 'Holiday fund',
      allocatedCents: 50000, // R500/month contribution — NOT a balance
      spentCents: 200000, // all-time spend from the fund
      envelopeType: 'savings',
    };
    const { getByTestId, getByText } = render(
      <EnvelopePickerSheet
        visible
        envelopes={[fundEnvelope]}
        selectedId={null}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(getByTestId('envelope-balance-e3')).toBeTruthy();
    expect(getByText(`${formatCurrency(600000)} saved`)).toBeTruthy();
    // The buggy formula (50000 - 200000 = -150000) must not appear.
    expect(() => getByText(`${formatCurrency(-150000)} left`)).toThrow();
  });

  // DATA_SHAPE: 216 real envelopes = 12 names x 18 periods, so "Food" (and
  // every other name) has one row PER PERIOD, and the persistent "Saving"
  // envelope has 18 rows (import bug, being fixed separately). Whatever a
  // caller hands this sheet, a person must never be shown two rows they
  // cannot tell apart.
  it('never hides a same-named PERIOD envelope — only persistent funds are collapsed', () => {
    // Callers scope period envelopes to one period, so same-named spending
    // envelopes handed to the sheet are the user's own distinct envelopes.
    const duplicateFood: EnvelopeOption[] = [
      {
        id: 'food-2026-08',
        name: 'Food',
        allocatedCents: 100000,
        spentCents: 40000,
        envelopeType: 'spending',
      },
      {
        id: 'food-2026-07',
        name: 'Food',
        allocatedCents: 90000,
        spentCents: 90000,
        envelopeType: 'spending',
      },
      {
        id: 'food-2026-06',
        name: 'Food',
        allocatedCents: 80000,
        spentCents: 10000,
        envelopeType: 'spending',
      },
    ];
    const { getByTestId, queryByTestId, getAllByText } = render(
      <EnvelopePickerSheet
        visible
        envelopes={duplicateFood}
        selectedId={null}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(getByTestId('envelope-option-food-2026-08')).toBeTruthy();
    expect(queryByTestId('envelope-option-food-2026-07')).not.toBeNull();
    expect(queryByTestId('envelope-option-food-2026-06')).not.toBeNull();
    expect(getAllByText('Food')).toHaveLength(3);
  });

  it('collapses 18 duplicate persistent-fund rows (same name, different id) to one', () => {
    const duplicateSavings: EnvelopeOption[] = Array.from({ length: 18 }, (_, i) => ({
      id: `saving-period-${i}`,
      name: 'Saving',
      allocatedCents: 50000,
      spentCents: 0,
      envelopeType: 'savings' as const,
    }));
    const { getAllByText } = render(
      <EnvelopePickerSheet
        visible
        envelopes={duplicateSavings}
        selectedId={null}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(getAllByText('Saving')).toHaveLength(1);
  });

  it('keeps the fund CARRIER (earliest createdAt, then id) whatever order the rows arrive in', () => {
    // The monthly contribution lands on the carrier at rollover, so a spend
    // must be pointed at that same row — not at whichever duplicate the
    // query happened to return first.
    const rows: EnvelopeOption[] = [
      { id: 'saving-c', createdAt: '2026-03-25T00:00:00.000Z' },
      { id: 'saving-b', createdAt: '2025-04-25T00:00:00.000Z' },
      { id: 'saving-a', createdAt: '2025-04-25T00:00:00.000Z' },
    ].map((row) => ({
      ...row,
      name: 'Saving',
      allocatedCents: 50000,
      spentCents: 0,
      envelopeType: 'savings' as const,
    }));
    const onSelect = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <EnvelopePickerSheet
        visible
        envelopes={rows}
        selectedId={null}
        onSelect={onSelect}
        onClose={jest.fn()}
      />,
    );
    expect(queryByTestId('envelope-option-saving-c')).toBeNull();
    fireEvent.press(getByTestId('envelope-option-saving-a'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'saving-a' }));
  });

  it('keeps distinct names and treats matching names of different types as distinct', () => {
    const options: EnvelopeOption[] = [
      { id: 'food', name: 'Food', allocatedCents: 100000, spentCents: 0, envelopeType: 'spending' },
      { id: 'income-food', name: 'Food', allocatedCents: 0, spentCents: 0, envelopeType: 'income' },
      { id: 'fuel', name: 'Fuel', allocatedCents: 50000, spentCents: 0, envelopeType: 'spending' },
    ];
    const { getByTestId } = render(
      <EnvelopePickerSheet
        visible
        envelopes={options}
        selectedId={null}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(getByTestId('envelope-option-food')).toBeTruthy();
    expect(getByTestId('envelope-option-income-food')).toBeTruthy();
    expect(getByTestId('envelope-option-fuel')).toBeTruthy();
  });
});
