import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({
      children,
      testID,
      ...p
    }: {
      children?: React.ReactNode;
      testID?: string;
      [k: string]: unknown;
    }) => React.createElement('Text', { testID, ...p }, children),
    Surface: ({
      children,
      testID,
      ...p
    }: {
      children?: React.ReactNode;
      testID?: string;
      [k: string]: unknown;
    }) => React.createElement('View', { testID, ...p }, children),
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

const mockUseBudgetBalance = jest.fn();
jest.mock('../../../../hooks/useBudgetBalance', () => ({
  useBudgetBalance: (...args: unknown[]) => mockUseBudgetBalance(...args),
}));

import { BudgetBalanceBanner } from '../BudgetBalanceBanner';
import type { EnvelopeEntity } from '../../../../../domain/envelopes/EnvelopeEntity';

const envelope: EnvelopeEntity = {
  id: 'e1',
  householdId: 'h1',
  name: 'Groceries',
  envelopeType: 'spending',
  allocatedCents: 500000,
  spentCents: 200000,
  isSavingsLocked: false,
  isArchived: false,
  periodStart: '2024-01-01',
  targetAmountCents: null,
  targetDate: null,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
};

describe('BudgetBalanceBanner', () => {
  beforeEach(() => {
    mockUseBudgetBalance.mockReset();
  });

  it('shows balanced state', () => {
    mockUseBudgetBalance.mockReturnValue({
      incomeTotal: 1000000,
      expenseAllocationTotal: 1000000,
      toAssign: 0,
      isBalanced: true,
    });
    const { getByTestId, getByText } = render(<BudgetBalanceBanner envelopes={[envelope]} />);
    expect(getByTestId('budget-balance-banner')).toBeTruthy();
    expect(getByText(/every rand assigned/i)).toBeTruthy();
  });

  it('shows unassigned state', () => {
    mockUseBudgetBalance.mockReturnValue({
      incomeTotal: 1000000,
      expenseAllocationTotal: 700000,
      toAssign: 300000,
      isBalanced: false,
    });
    const { getByText } = render(<BudgetBalanceBanner envelopes={[envelope]} />);
    expect(getByText(/left to assign/i)).toBeTruthy();
  });

  it('shows overcommitted state', () => {
    mockUseBudgetBalance.mockReturnValue({
      incomeTotal: 1000000,
      expenseAllocationTotal: 1200000,
      toAssign: -200000,
      isBalanced: false,
    });
    const { getByText } = render(<BudgetBalanceBanner envelopes={[envelope]} />);
    expect(getByText(/overcommitted/i)).toBeTruthy();
  });

  it('renders breakdown items', () => {
    mockUseBudgetBalance.mockReturnValue({
      incomeTotal: 500000,
      expenseAllocationTotal: 300000,
      toAssign: 200000,
      isBalanced: false,
    });
    const { getByTestId } = render(<BudgetBalanceBanner envelopes={[envelope]} />);
    expect(getByTestId('banner-income')).toBeTruthy();
    expect(getByTestId('banner-expenses')).toBeTruthy();
    expect(getByTestId('banner-to-assign')).toBeTruthy();
  });
});
