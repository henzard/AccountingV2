import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({
      children,
      testID,
      style,
      ...p
    }: {
      children?: React.ReactNode;
      testID?: string;
      style?: unknown;
      [k: string]: unknown;
    }) => React.createElement('Text', { testID, style, ...p }, children),
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

jest.mock('../../../../components/shared/StatCard', () => ({
  StatCard: ({ label, value, testID }: { label: string; value: string; testID?: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement('View', { testID }, `${label}: ${value}`);
  },
}));

jest.mock('../../../../utils/currency', () => ({
  formatCurrency: (cents: number) => `R${(cents / 100).toFixed(0)}`,
}));

import { PayoffProjectionCard } from '../PayoffProjectionCard';
import type { SnowballPlan } from '../../../../../domain/debtSnowball/SnowballPayoffProjector';

describe('PayoffProjectionCard', () => {
  const basePlan: SnowballPlan = {
    debtFreeDate: new Date('2026-12-01'),
    projections: [
      { debtId: 'd1', creditorName: 'FNB', monthsToPayoff: 6, payoffDate: new Date('2026-12-01') },
    ],
  };

  it('renders debt-free date formatted as MMM yyyy', () => {
    const { getByText } = render(<PayoffProjectionCard plan={basePlan} totalDebtCents={500000} />);
    expect(getByText('Dec 2026')).toBeTruthy();
  });

  it('shows total debt stat', () => {
    const { getByTestId } = render(
      <PayoffProjectionCard plan={basePlan} totalDebtCents={500000} />,
    );
    expect(getByTestId('stat-total-debt')).toBeTruthy();
  });

  it('shows debts to clear stat', () => {
    const { getByTestId } = render(
      <PayoffProjectionCard plan={basePlan} totalDebtCents={500000} />,
    );
    expect(getByTestId('stat-debts-to-clear')).toBeTruthy();
  });

  it('returns null when projections is empty', () => {
    const emptyPlan: SnowballPlan = { debtFreeDate: null, projections: [] };
    const { toJSON } = render(<PayoffProjectionCard plan={emptyPlan} totalDebtCents={0} />);
    expect(toJSON()).toBeNull();
  });

  it('shows fallback text when debtFreeDate is null', () => {
    const noPlan: SnowballPlan = {
      debtFreeDate: null,
      projections: [
        { debtId: 'd1', creditorName: 'FNB', monthsToPayoff: -1, payoffDate: new Date(0) },
      ],
    };
    const { getByText } = render(<PayoffProjectionCard plan={noPlan} totalDebtCents={100000} />);
    expect(getByText(/increase payments/i)).toBeTruthy();
  });

  it('shows months remaining text', () => {
    const futurePlan: SnowballPlan = {
      debtFreeDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      projections: [
        { debtId: 'd1', creditorName: 'Car Loan', monthsToPayoff: 12, payoffDate: new Date() },
      ],
    };
    const { getByText } = render(
      <PayoffProjectionCard plan={futurePlan} totalDebtCents={200000} />,
    );
    expect(getByText(/month.*away/i)).toBeTruthy();
  });
});
