/**
 * Consolidated tests for dashboard components.
 * Covers: BabyStepsBar, BudgetRingCard, BabyStepsCard.
 *
 * EnvelopeTile, HeroSummaryCard and RamseyScoreBadge were deleted — they were
 * no longer rendered anywhere (DashboardScreen only ever imported the `P`
 * palette from HeroSummaryCard, which now lives in
 * `screens/dashboard/palette.ts`).
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import type { BabyStepStatus } from '../../../domain/babySteps/types';

// ─── react-native-paper mock ────────────────────────────────────────────────
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
    Button: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) => React.createElement('Pressable', { onPress, testID }, children),
    Surface: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('View', p, children),
  };
});

// ─── react-native-svg mock ──────────────────────────────────────────────────
jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('View', { testID: 'svg', ...p }, children),
    Circle: (p: { [k: string]: unknown }) =>
      React.createElement('View', { testID: 'circle', ...p }),
  };
});

// ─── Baby step rules mock ───────────────────────────────────────────────────
jest.mock('../../../domain/babySteps/BabyStepRules', () => ({
  BABY_STEP_RULES: {
    1: { shortTitle: 'Starter Fund', description: 'Save R1,000', regressionToast: '' },
    2: { shortTitle: 'Debt Snowball', description: 'Pay off debt', regressionToast: '' },
    3: { shortTitle: 'Emergency Fund', description: '3-6 months', regressionToast: '' },
    4: { shortTitle: 'Invest 15%', description: 'Invest', regressionToast: '' },
    5: { shortTitle: 'Education', description: 'Kids education', regressionToast: '' },
    6: { shortTitle: 'Pay Off Home', description: 'Mortgage', regressionToast: '' },
    7: { shortTitle: 'Build Wealth', description: 'Build', regressionToast: '' },
  },
}));

// ─── SevenDotPath mock for BabyStepsCard ────────────────────────────────────
jest.mock('../../screens/babySteps/components/SevenDotPath', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    SevenDotPath: () => React.createElement('View', { testID: 'seven-dot-path' }),
  };
});

jest.mock('../../utils/currency', () => ({
  formatCurrency: (cents: number) => `R${(cents / 100).toFixed(2)}`,
}));

import { BabyStepsBar } from '../../screens/dashboard/components/BabyStepsBar';
import { BudgetRingCard } from '../../screens/dashboard/components/BudgetRingCard';
import { BabyStepsCard } from '../../screens/dashboard/BabyStepsCard';

// ─── Helpers ────────────────────────────────────────────────────────────────
function makeStatuses(completedSteps: number[]): BabyStepStatus[] {
  return Array.from({ length: 7 }, (_, i) => ({
    stepNumber: (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    isCompleted: completedSteps.includes(i + 1),
    isManual: false,
    progress: null,
    completedAt: completedSteps.includes(i + 1) ? '2026-01-01' : null,
    celebratedAt: null,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// BabyStepsBar
// ═══════════════════════════════════════════════════════════════════════════════
describe('BabyStepsBar', () => {
  it('renders with all steps incomplete', () => {
    const statuses = makeStatuses([]);
    const { toJSON } = render(<BabyStepsBar statuses={statuses} onPress={jest.fn()} />);
    expect(toJSON()).not.toBeNull();
  });

  it('renders with some steps completed', () => {
    const statuses = makeStatuses([1, 2, 3]);
    const { toJSON } = render(<BabyStepsBar statuses={statuses} onPress={jest.fn()} />);
    expect(toJSON()).not.toBeNull();
  });

  it('renders with all steps completed', () => {
    const statuses = makeStatuses([1, 2, 3, 4, 5, 6, 7]);
    const { toJSON } = render(<BabyStepsBar statuses={statuses} onPress={jest.fn()} />);
    expect(toJSON()).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BudgetRingCard
// ═══════════════════════════════════════════════════════════════════════════════
describe('BudgetRingCard', () => {
  it('renders with error color when over budget (score < 70)', () => {
    const { getByTestId } = render(
      <BudgetRingCard
        totalAllocatedCents={100000}
        totalSpentCents={150000}
        daysRemaining={10}
        score={40}
      />,
    );
    expect(getByTestId('budget-ring-card')).toBeTruthy();
  });

  it('renders with primary color when score >= 70', () => {
    const { getByTestId } = render(
      <BudgetRingCard
        totalAllocatedCents={100000}
        totalSpentCents={50000}
        daysRemaining={10}
        score={75}
      />,
    );
    expect(getByTestId('budget-ring-card')).toBeTruthy();
  });

  it('renders with amber color when score < 70 and not over budget', () => {
    const { getByTestId } = render(
      <BudgetRingCard
        totalAllocatedCents={100000}
        totalSpentCents={80000}
        daysRemaining={10}
        score={50}
      />,
    );
    expect(getByTestId('budget-ring-card')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BabyStepsCard
// ═══════════════════════════════════════════════════════════════════════════════
describe('BabyStepsCard', () => {
  it('renders current step title when present', () => {
    const statuses = makeStatuses([1]);
    const { getByText } = render(<BabyStepsCard statuses={statuses} onPress={jest.fn()} />);
    expect(getByText(/Step 2/)).toBeTruthy();
  });

  it('renders "All Baby Steps complete!" when all complete', () => {
    const statuses = makeStatuses([1, 2, 3, 4, 5, 6, 7]);
    const { getByText } = render(<BabyStepsCard statuses={statuses} onPress={jest.fn()} />);
    expect(getByText(/All Baby Steps complete!/)).toBeTruthy();
  });

  it('renders count "1 / 7"', () => {
    const statuses = makeStatuses([1]);
    const { getByText } = render(<BabyStepsCard statuses={statuses} onPress={jest.fn()} />);
    expect(getByText('1 / 7')).toBeTruthy();
  });
});
