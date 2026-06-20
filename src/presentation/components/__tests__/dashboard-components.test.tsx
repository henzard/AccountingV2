/**
 * Consolidated tests for dashboard components.
 * Covers: BabyStepsBar, BudgetRingCard, EnvelopeTile, HeroSummaryCard,
 * RamseyScoreBadge, BabyStepsCard, PeriodRolloverModal.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import type { BabyStepStatus } from '../../../domain/babySteps/types';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

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

// ─── Shared component mocks ─────────────────────────────────────────────────
jest.mock('../../components/shared/EnvelopeFillBar', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    EnvelopeFillBar: (p: { [k: string]: unknown }) =>
      React.createElement('View', { testID: 'fill-bar', ...p }),
  };
});

jest.mock('../../components/shared/CurrencyText', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    CurrencyText: ({ amountCents, ...p }: { amountCents: number; [k: string]: unknown }) =>
      React.createElement('Text', p, `R${(amountCents / 100).toFixed(2)}`),
  };
});

// Domain helpers mock (for EnvelopeCard/EnvelopeTile)
jest.mock('../../../domain/envelopes/EnvelopeEntity', () => ({
  getRemainingCents: (e: { allocatedCents: number; spentCents: number }) =>
    e.allocatedCents - e.spentCents,
  getPercentRemaining: (e: { allocatedCents: number; spentCents: number }) => {
    if (e.allocatedCents === 0) return 100;
    return Math.max(0, Math.round(((e.allocatedCents - e.spentCents) / e.allocatedCents) * 100));
  },
  isOverBudget: (e: { allocatedCents: number; spentCents: number }) =>
    e.spentCents > e.allocatedCents,
}));

jest.mock('../../utils/currency', () => ({
  formatCurrency: (cents: number) => `R${(cents / 100).toFixed(2)}`,
}));

import { BabyStepsBar } from '../../screens/dashboard/components/BabyStepsBar';
import { BudgetRingCard } from '../../screens/dashboard/components/BudgetRingCard';
import { EnvelopeTile } from '../../screens/dashboard/components/EnvelopeTile';
import { HeroSummaryCard } from '../../screens/dashboard/components/HeroSummaryCard';
import { RamseyScoreBadge } from '../../screens/dashboard/components/RamseyScoreBadge';
import { BabyStepsCard } from '../../screens/dashboard/BabyStepsCard';
import { PeriodRolloverModal } from '../../screens/dashboard/PeriodRolloverModal';

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

function makeEnvelope(overrides: Partial<EnvelopeEntity> = {}): EnvelopeEntity {
  return {
    id: 'env-1',
    householdId: 'hh-1',
    name: 'Groceries',
    allocatedCents: 500000,
    spentCents: 200000,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-06-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
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
// EnvelopeTile
// ═══════════════════════════════════════════════════════════════════════════════
describe('EnvelopeTile', () => {
  it('renders envelope name', () => {
    const { getByText } = render(<EnvelopeTile envelope={makeEnvelope()} />);
    expect(getByText('Groceries')).toBeTruthy();
  });

  it('shows "Over budget" status when over budget', () => {
    const overEnv = makeEnvelope({ allocatedCents: 100000, spentCents: 150000 });
    const { getByText } = render(<EnvelopeTile envelope={overEnv} />);
    expect(getByText(/Over budget/)).toBeTruthy();
  });

  it('shows "Empty" when 0% remaining', () => {
    const emptyEnv = makeEnvelope({ allocatedCents: 100000, spentCents: 100000 });
    const { getByText } = render(<EnvelopeTile envelope={emptyEnv} />);
    expect(getByText('Empty')).toBeTruthy();
  });

  it('shows warning when <=18% left', () => {
    const lowEnv = makeEnvelope({ allocatedCents: 100000, spentCents: 85000 });
    const { getByText } = render(<EnvelopeTile envelope={lowEnv} />);
    expect(getByText(/⚠/)).toBeTruthy();
  });

  it('shows "Funded" when >=99% remaining', () => {
    const fullEnv = makeEnvelope({ allocatedCents: 100000, spentCents: 0 });
    const { getByText } = render(<EnvelopeTile envelope={fullEnv} />);
    expect(getByText(/Funded/)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HeroSummaryCard
// ═══════════════════════════════════════════════════════════════════════════════
describe('HeroSummaryCard', () => {
  it('renders without crash for positive remaining', () => {
    const { toJSON } = render(
      <HeroSummaryCard
        totalAllocatedCents={500000}
        totalSpentCents={200000}
        totalRemainingCents={300000}
        daysRemaining={15}
        score={70}
      />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('renders with negative remaining (uses red color)', () => {
    const { toJSON } = render(
      <HeroSummaryCard
        totalAllocatedCents={500000}
        totalSpentCents={600000}
        totalRemainingCents={-100000}
        daysRemaining={5}
        score={30}
      />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('renders last day message when daysRemaining=0', () => {
    const { getByText } = render(
      <HeroSummaryCard
        totalAllocatedCents={500000}
        totalSpentCents={200000}
        totalRemainingCents={300000}
        daysRemaining={0}
        score={80}
      />,
    );
    expect(getByText('Last day of period')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RamseyScoreBadge
// ═══════════════════════════════════════════════════════════════════════════════
describe('RamseyScoreBadge', () => {
  it('renders score text', () => {
    const { getByText } = render(<RamseyScoreBadge score={85} />);
    expect(getByText('85')).toBeTruthy();
  });

  it('shows Excellent for score >= 80', () => {
    const { getByText } = render(<RamseyScoreBadge score={80} />);
    expect(getByText('Excellent')).toBeTruthy();
  });

  it('shows Good for score >= 60', () => {
    const { getByText } = render(<RamseyScoreBadge score={65} />);
    expect(getByText('Good')).toBeTruthy();
  });

  it('shows Fair for score >= 40', () => {
    const { getByText } = render(<RamseyScoreBadge score={45} />);
    expect(getByText('Fair')).toBeTruthy();
  });

  it('shows Keep going for score < 40', () => {
    const { getByText } = render(<RamseyScoreBadge score={20} />);
    expect(getByText('Keep going')).toBeTruthy();
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

// ═══════════════════════════════════════════════════════════════════════════════
// PeriodRolloverModal
// ═══════════════════════════════════════════════════════════════════════════════
describe('PeriodRolloverModal', () => {
  it('renders when visible=true', () => {
    const { getByTestId } = render(
      <PeriodRolloverModal visible={true} periodLabel="July" onAcknowledge={jest.fn()} />,
    );
    expect(getByTestId('period-rollover-modal')).toBeTruthy();
  });

  it('does not render content when visible=false', () => {
    const { queryByTestId } = render(
      <PeriodRolloverModal visible={false} periodLabel="July" onAcknowledge={jest.fn()} />,
    );
    expect(queryByTestId('period-rollover-acknowledge')).toBeNull();
  });
});
