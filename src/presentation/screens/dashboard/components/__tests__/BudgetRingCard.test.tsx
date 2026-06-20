/**
 * BudgetRingCard.test.tsx — C8 component test
 */
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
  };
});

jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('View', { testID: 'svg', ...p }, children),
    Circle: (p: Record<string, unknown>) =>
      React.createElement('View', { testID: 'svg-circle', ...p }),
  };
});

import { BudgetRingCard } from '../BudgetRingCard';

describe('BudgetRingCard', () => {
  it('renders with testID', () => {
    const { getByTestId } = render(
      <BudgetRingCard
        totalAllocatedCents={100000}
        totalSpentCents={50000}
        daysRemaining={15}
        score={80}
      />,
    );
    expect(getByTestId('budget-ring-card')).toBeTruthy();
  });

  it('renders with custom testID', () => {
    const { getByTestId } = render(
      <BudgetRingCard
        totalAllocatedCents={100000}
        totalSpentCents={50000}
        daysRemaining={15}
        score={80}
        testID="custom-ring"
      />,
    );
    expect(getByTestId('custom-ring')).toBeTruthy();
  });

  it('shows "remaining" label when under budget', () => {
    const { getAllByText } = render(
      <BudgetRingCard
        totalAllocatedCents={100000}
        totalSpentCents={50000}
        daysRemaining={15}
        score={80}
      />,
    );
    const remaining = getAllByText('remaining');
    expect(remaining.length).toBeGreaterThan(0);
  });

  it('shows "over budget" label when spent exceeds allocated', () => {
    const { getAllByText } = render(
      <BudgetRingCard
        totalAllocatedCents={100000}
        totalSpentCents={150000}
        daysRemaining={5}
        score={30}
      />,
    );
    const over = getAllByText('over budget');
    expect(over.length).toBeGreaterThan(0);
  });

  it('displays days remaining', () => {
    const { getAllByText } = render(
      <BudgetRingCard
        totalAllocatedCents={100000}
        totalSpentCents={50000}
        daysRemaining={12}
        score={70}
      />,
    );
    const days = getAllByText('12d left');
    expect(days.length).toBeGreaterThan(0);
  });

  it('renders SVG ring elements', () => {
    const { getAllByTestId } = render(
      <BudgetRingCard
        totalAllocatedCents={100000}
        totalSpentCents={50000}
        daysRemaining={15}
        score={80}
      />,
    );
    expect(getAllByTestId('svg-circle').length).toBe(2);
  });

  it('handles zero allocated cents (empty budget)', () => {
    const { getByTestId } = render(
      <BudgetRingCard totalAllocatedCents={0} totalSpentCents={0} daysRemaining={30} score={0} />,
    );
    expect(getByTestId('budget-ring-card')).toBeTruthy();
  });

  it('clamps progress percentage at 100%', () => {
    const { getByTestId } = render(
      <BudgetRingCard
        totalAllocatedCents={10000}
        totalSpentCents={20000}
        daysRemaining={1}
        score={10}
      />,
    );
    expect(getByTestId('budget-ring-card')).toBeTruthy();
  });

  it('displays formatted remaining amount when under budget', () => {
    const { getAllByText } = render(
      <BudgetRingCard
        totalAllocatedCents={100000}
        totalSpentCents={40000}
        daysRemaining={10}
        score={85}
      />,
    );
    expect(getAllByText(/R600/i).length).toBeGreaterThan(0);
  });

  it('shows R0.00 remaining when spent equals allocated', () => {
    const { getAllByText } = render(
      <BudgetRingCard
        totalAllocatedCents={100000}
        totalSpentCents={100000}
        daysRemaining={0}
        score={50}
      />,
    );
    expect(getAllByText(/R0/i).length).toBeGreaterThan(0);
    expect(getAllByText('remaining').length).toBeGreaterThan(0);
  });

  it('clamps remaining to zero (never negative) when over budget', () => {
    const { getAllByText } = render(
      <BudgetRingCard
        totalAllocatedCents={50000}
        totalSpentCents={80000}
        daysRemaining={3}
        score={20}
      />,
    );
    expect(getAllByText(/R0/i).length).toBeGreaterThan(0);
    expect(getAllByText('over budget').length).toBeGreaterThan(0);
  });

  it('displays days remaining as "0d left"', () => {
    const { getAllByText } = render(
      <BudgetRingCard
        totalAllocatedCents={100000}
        totalSpentCents={90000}
        daysRemaining={0}
        score={60}
      />,
    );
    expect(getAllByText('0d left').length).toBeGreaterThan(0);
  });

  it('renders with large values without crashing', () => {
    const { getByTestId } = render(
      <BudgetRingCard
        totalAllocatedCents={99999999}
        totalSpentCents={50000000}
        daysRemaining={31}
        score={95}
      />,
    );
    expect(getByTestId('budget-ring-card')).toBeTruthy();
  });
});
