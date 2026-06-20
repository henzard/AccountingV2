import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    Circle: () => React.createElement('View'),
  };
});

import { HeroSummaryCard } from '../HeroSummaryCard';

describe('HeroSummaryCard', () => {
  const defaultProps = {
    totalAllocatedCents: 1000000,
    totalSpentCents: 400000,
    totalRemainingCents: 600000,
    daysRemaining: 15,
    score: 75,
    testID: 'hero-card',
  };

  it('renders with testID', () => {
    const { getByTestId } = render(<HeroSummaryCard {...defaultProps} />);
    expect(getByTestId('hero-card')).toBeTruthy();
  });

  it('displays days remaining text', () => {
    const { getByText } = render(<HeroSummaryCard {...defaultProps} />);
    expect(getByText('15 days remaining')).toBeTruthy();
  });

  it('shows "Last day of period" when daysRemaining is 0', () => {
    const { getByText } = render(<HeroSummaryCard {...defaultProps} daysRemaining={0} />);
    expect(getByText('Last day of period')).toBeTruthy();
  });

  it('shows gauge percentage', () => {
    const { getByText } = render(<HeroSummaryCard {...defaultProps} />);
    expect(getByText('40%')).toBeTruthy();
  });

  it('shows "used" label', () => {
    const { getByText } = render(<HeroSummaryCard {...defaultProps} />);
    expect(getByText('used')).toBeTruthy();
  });

  it('shows score number', () => {
    const { getByText } = render(<HeroSummaryCard {...defaultProps} />);
    expect(getByText('75')).toBeTruthy();
  });

  it('shows GOOD label for score 75', () => {
    const { getByText } = render(<HeroSummaryCard {...defaultProps} />);
    expect(getByText('GOOD')).toBeTruthy();
  });

  it('shows EXCELLENT label for score 80+', () => {
    const { getByText } = render(<HeroSummaryCard {...defaultProps} score={90} />);
    expect(getByText('EXCELLENT')).toBeTruthy();
  });

  it('handles zero allocated without crashing', () => {
    const { getByTestId } = render(
      <HeroSummaryCard {...defaultProps} totalAllocatedCents={0} totalSpentCents={0} />,
    );
    expect(getByTestId('hero-card')).toBeTruthy();
  });

  it('handles over-budget (pct > 90)', () => {
    const { getByText } = render(
      <HeroSummaryCard {...defaultProps} totalSpentCents={950000} totalRemainingCents={50000} />,
    );
    expect(getByText('95%')).toBeTruthy();
  });

  it('handles negative remaining', () => {
    const { getByTestId } = render(
      <HeroSummaryCard {...defaultProps} totalSpentCents={1200000} totalRemainingCents={-200000} />,
    );
    expect(getByTestId('hero-card')).toBeTruthy();
  });
});
