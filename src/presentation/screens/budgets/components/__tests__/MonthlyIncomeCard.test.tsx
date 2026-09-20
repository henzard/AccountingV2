import React from 'react';
import { render } from '@testing-library/react-native';
import { formatCurrency } from '../../../../utils/currency';

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
    Button: ({
      children,
      testID,
      ...p
    }: {
      children?: React.ReactNode;
      testID?: string;
      [k: string]: unknown;
    }) => React.createElement('button', { testID, ...p }, children),
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

import { MonthlyIncomeCard } from '../MonthlyIncomeCard';

describe('MonthlyIncomeCard', () => {
  it('displays formatted income using formatCurrency', () => {
    const { getByTestId } = render(
      <MonthlyIncomeCard incomeCents={1234567} hasIncome onSetIncome={() => {}} />,
    );
    expect(getByTestId('monthly-income-amount').children[0]).toBe(formatCurrency(1234567));
  });

  it('displays "Not set" when no income', () => {
    const { getByTestId } = render(
      <MonthlyIncomeCard incomeCents={0} hasIncome={false} onSetIncome={() => {}} />,
    );
    expect(getByTestId('monthly-income-amount').children[0]).toBe('Not set');
  });

  it('shows "Update" button when income is set', () => {
    const { getByTestId } = render(
      <MonthlyIncomeCard incomeCents={500000} hasIncome onSetIncome={() => {}} />,
    );
    expect(getByTestId('monthly-income-action')).toBeTruthy();
  });
});
