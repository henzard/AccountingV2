/**
 * HeroSummaryCard.test.tsx — smoke tests for the PULSE hero card.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: unknown }) =>
      R.createElement('View', { testID: 'svg' }, children),
    Circle: () => R.createElement('View', { testID: 'circle' }),
  };
});

jest.mock('../../../../components/shared/CurrencyText', () => ({
  CurrencyText: ({ amountCents, testID }: { amountCents: number; testID?: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const R = require('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text } = require('react-native');
    return R.createElement(Text, { testID }, String(amountCents));
  },
}));

import { HeroSummaryCard } from '../HeroSummaryCard';

const baseProps = {
  totalAllocatedCents: 500000,
  totalSpentCents: 200000,
  totalRemainingCents: 300000,
  daysRemaining: 10,
  score: 75,
};

describe('HeroSummaryCard', () => {
  it('renders without crashing', () => {
    const { getByText } = render(<HeroSummaryCard {...baseProps} />);
    expect(getByText('REMAINING THIS PERIOD')).toBeTruthy();
  });

  it('shows days remaining text', () => {
    const { getByText } = render(<HeroSummaryCard {...baseProps} />);
    expect(getByText('10 days remaining')).toBeTruthy();
  });

  it('shows "Last day of period" when daysRemaining is 0', () => {
    const { getByText } = render(<HeroSummaryCard {...baseProps} daysRemaining={0} />);
    expect(getByText('Last day of period')).toBeTruthy();
  });

  it('shows score label for score >= 60', () => {
    const { getByText } = render(<HeroSummaryCard {...baseProps} score={65} />);
    expect(getByText('GOOD')).toBeTruthy();
  });

  it('shows score label for score >= 80', () => {
    const { getByText } = render(<HeroSummaryCard {...baseProps} score={85} />);
    expect(getByText('EXCELLENT')).toBeTruthy();
  });

  it('shows score label for score >= 40', () => {
    const { getByText } = render(<HeroSummaryCard {...baseProps} score={45} />);
    expect(getByText('FAIR')).toBeTruthy();
  });

  it('shows "Keep going" for low score', () => {
    const { getByText } = render(<HeroSummaryCard {...baseProps} score={20} />);
    expect(getByText('KEEP GOING')).toBeTruthy();
  });

  it('accepts testID prop', () => {
    const { getByTestId } = render(<HeroSummaryCard {...baseProps} testID="hero-card" />);
    expect(getByTestId('hero-card')).toBeTruthy();
  });

  it('handles zero allocated budget', () => {
    const { getByText } = render(
      <HeroSummaryCard {...baseProps} totalAllocatedCents={0} totalSpentCents={0} />,
    );
    expect(getByText('0%')).toBeTruthy();
  });

  it('shows 100% when fully spent', () => {
    const { getByText } = render(
      <HeroSummaryCard
        {...baseProps}
        totalAllocatedCents={100000}
        totalSpentCents={100000}
        totalRemainingCents={0}
      />,
    );
    expect(getByText('100%')).toBeTruthy();
  });
});
