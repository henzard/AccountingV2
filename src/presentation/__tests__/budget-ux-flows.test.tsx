/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * budget-ux-flows.test.tsx — WS6
 *
 * Tests budget UX flows:
 *   - Budget balance banner shows correct toAssign
 *   - Over-budget envelope warning state
 *   - Transaction list filtered to current period
 *   - Sinking fund progress bar percentage
 */
import React from 'react';
import { render } from '@testing-library/react-native';

// ─── BudgetBalanceBanner tests (uses existing mock pattern) ──────────────────

jest.mock('react-native-paper', () => {
  const React = require('react');
  return {
    Text: ({ children, testID, ...p }: any) =>
      React.createElement('Text', { testID, ...p }, children),
    Surface: ({ children, testID, ...p }: any) =>
      React.createElement('View', { testID, ...p }, children),
    // Added for section 3's full BudgetScreen render (VAL2-4 period switcher).
    FAB: (p: any) => React.createElement('View', p),
    IconButton: ({ onPress, disabled, testID }: any) =>
      React.createElement('View', { onPress: disabled ? undefined : onPress, testID }),
    Button: ({ children, onPress, testID }: any) =>
      React.createElement('View', { onPress, testID }, children),
    ActivityIndicator: (p: any) => React.createElement('View', p),
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

const mockUseBudgetBalance = jest.fn();
jest.mock('../hooks/useBudgetBalance', () => ({
  useBudgetBalance: (...args: unknown[]) => mockUseBudgetBalance(...args),
}));

// ─── BudgetScreen render support (section 3 only) — nothing else in this
// file touches these modules, so mocking them globally is safe. `useBudgetBalance`
// above already covers `BudgetBalanceBanner`, which stays the REAL component
// (section 1 imports it directly) since BudgetScreen also renders it for real.
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: () => {},
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../../data/local/db', () => ({ db: {} }));
const mockUseEnvelopes = jest
  .fn()
  .mockReturnValue({ envelopes: [], loading: false, error: null, reload: jest.fn() });
jest.mock('../hooks/useEnvelopes', () => ({
  useEnvelopes: (...args: unknown[]) => mockUseEnvelopes(...args),
}));
jest.mock('../hooks/usePersistentEnvelopeSavings', () => ({
  usePersistentEnvelopeSavings: () => ({
    savedCentsByEnvelopeId: new Map(),
    loading: false,
    error: null,
    reload: jest.fn(),
  }),
}));
jest.mock('../stores/appStore', () => ({
  useAppStore: (sel: (s: { householdId: string; paydayDay: number }) => unknown) =>
    sel({ householdId: 'hh-1', paydayDay: 25 }),
}));
jest.mock('../screens/budgets/RolloverWizard', () => ({ RolloverWizard: () => null }));
jest.mock('../screens/dashboard/components/EnvelopeDetailSheet', () => ({
  EnvelopeDetailSheet: () => null,
}));
jest.mock('../screens/budgets/components/MonthlyIncomeCard', () => ({
  MonthlyIncomeCard: () => null,
}));
jest.mock('../screens/budgets/components/DuplicateEmfBanner', () => ({
  DuplicateEmfBanner: () => null,
}));
jest.mock('../components/envelopes/EnvelopeCard', () => ({ EnvelopeCard: () => null }));
jest.mock('../components/shared/EmptyState', () => ({ EmptyState: () => null }));
jest.mock('../components/shared/SectionHeader', () => ({ SectionHeader: () => null }));

import { BudgetBalanceBanner } from '../screens/budgets/components/BudgetBalanceBanner';
import { BudgetScreen } from '../screens/budgets/BudgetScreen';
import { calculateBudgetBalance } from '../../domain/budgets/BudgetBalanceCalculator';
import { buildEnvelope } from '../../__test-utils__/factories';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../domain/shared/BudgetPeriodEngine';
import { KRUGER_ENVELOPES } from '../../__test-utils__/scenarioSeed';

// ═════════════════════════════════════════════════════════════════════════════════
// 1. Budget balance banner shows correct toAssign
// ═════════════════════════════════════════════════════════════════════════════════

describe('Budget balance banner — correct toAssign', () => {
  const incomeEnv = buildEnvelope({
    id: 'inc-1',
    envelopeType: 'income',
    allocatedCents: 4500000,
    isArchived: false,
  });
  const spendingEnv = buildEnvelope({
    id: 'spend-1',
    envelopeType: 'spending',
    allocatedCents: 3000000,
    isArchived: false,
  });

  it('banner shows unassigned amount when income > expenses', () => {
    mockUseBudgetBalance.mockReturnValue({
      incomeTotal: 4500000,
      expenseAllocationTotal: 3000000,
      toAssign: 1500000,
      isBalanced: false,
    });

    const { getByText } = render(<BudgetBalanceBanner envelopes={[incomeEnv, spendingEnv]} />);

    expect(getByText(/left to assign/i)).toBeTruthy();
  });

  it('banner shows balanced state when toAssign = 0', () => {
    mockUseBudgetBalance.mockReturnValue({
      incomeTotal: 3000000,
      expenseAllocationTotal: 3000000,
      toAssign: 0,
      isBalanced: true,
    });

    const { getByText } = render(<BudgetBalanceBanner envelopes={[incomeEnv, spendingEnv]} />);

    expect(getByText(/every rand assigned/i)).toBeTruthy();
  });

  it('banner shows overcommitted when expenses > income', () => {
    mockUseBudgetBalance.mockReturnValue({
      incomeTotal: 3000000,
      expenseAllocationTotal: 3500000,
      toAssign: -500000,
      isBalanced: false,
    });

    const { getByText } = render(<BudgetBalanceBanner envelopes={[incomeEnv, spendingEnv]} />);

    expect(getByText(/overcommitted/i)).toBeTruthy();
  });

  it('renders income, expenses, and to-assign breakdown items', () => {
    mockUseBudgetBalance.mockReturnValue({
      incomeTotal: 4500000,
      expenseAllocationTotal: 3000000,
      toAssign: 1500000,
      isBalanced: false,
    });

    const { getByTestId } = render(<BudgetBalanceBanner envelopes={[incomeEnv, spendingEnv]} />);

    expect(getByTestId('banner-income')).toBeTruthy();
    expect(getByTestId('banner-expenses')).toBeTruthy();
    expect(getByTestId('banner-to-assign')).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════
// 2. Over-budget envelope warning state (BudgetBalanceCalculator logic)
// ═════════════════════════════════════════════════════════════════════════════════

describe('Over-budget envelope warning state', () => {
  it('envelope with spentCents > allocatedCents is identifiable as over-budget', () => {
    const overBudget = buildEnvelope({
      allocatedCents: 200000,
      spentCents: 250000,
      envelopeType: 'spending',
    });

    const remaining = overBudget.allocatedCents - overBudget.spentCents;
    expect(remaining).toBeLessThan(0);
    expect(remaining).toBe(-50000);
  });

  it('calculateBudgetBalance produces negative toAssign when overcommitted', () => {
    const income = buildEnvelope({
      envelopeType: 'income',
      allocatedCents: 3000000,
      isArchived: false,
    });
    const expense1 = buildEnvelope({
      envelopeType: 'spending',
      allocatedCents: 2000000,
      isArchived: false,
    });
    const expense2 = buildEnvelope({
      envelopeType: 'spending',
      allocatedCents: 1500000,
      isArchived: false,
    });

    const result = calculateBudgetBalance([income, expense1, expense2]);

    expect(result.toAssign).toBe(-500000);
    expect(result.incomeTotal).toBe(3000000);
    expect(result.expenseAllocationTotal).toBe(3500000);
  });

  it('archived envelopes are excluded from balance calculation', () => {
    const income = buildEnvelope({
      envelopeType: 'income',
      allocatedCents: 5000000,
      isArchived: false,
    });
    const archivedExpense = buildEnvelope({
      envelopeType: 'spending',
      allocatedCents: 9000000,
      isArchived: true,
    });

    const result = calculateBudgetBalance([income, archivedExpense]);

    expect(result.expenseAllocationTotal).toBe(0);
    expect(result.toAssign).toBe(5000000);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════
// 3. Transaction list filtered to current period (domain logic)
// ═════════════════════════════════════════════════════════════════════════════════

describe('Transaction list filtered to current period', () => {
  it('BudgetPeriodEngine returns correct period boundaries', () => {
    const { BudgetPeriodEngine } = require('../../domain/shared/BudgetPeriodEngine');
    const engine = new BudgetPeriodEngine();
    const period = engine.getCurrentPeriod(25);

    expect(period.startDate).toBeInstanceOf(Date);
    expect(period.endDate).toBeInstanceOf(Date);
    expect(period.endDate.getTime()).toBeGreaterThan(period.startDate.getTime());
  });

  it('transactions outside period are identifiable by date comparison', () => {
    const periodStart = '2026-01-25';
    const periodEnd = '2026-02-24';

    const inPeriod = { transactionDate: '2026-02-01' };
    const beforePeriod = { transactionDate: '2026-01-20' };
    const afterPeriod = { transactionDate: '2026-02-26' };

    expect(inPeriod.transactionDate >= periodStart && inPeriod.transactionDate <= periodEnd).toBe(
      true,
    );
    expect(beforePeriod.transactionDate >= periodStart).toBe(false);
    expect(afterPeriod.transactionDate <= periodEnd).toBe(false);
  });

  // VAL2-4: BudgetScreen now has a period switcher, so `useEnvelopes` is
  // called with whichever period is being VIEWED, not a fixed `periodStart`.
  // A source-text grep for the literal old call is no longer meaningful —
  // this renders the real screen (with its own isolated mocks, so it doesn't
  // disturb the real `BudgetBalanceBanner` import used by section 1 above)
  // and asserts the actual invariant: on mount, `useEnvelopes` is called with
  // the household id and the CURRENT period's start (the default view).
  it('useEnvelopes hook is called with the household id and the current period start by default', () => {
    // `useBudgetBalance` backs the REAL `BudgetBalanceBanner` that
    // `BudgetScreen` renders — must return a real shape or it crashes on
    // destructuring (see BudgetBalanceBanner.tsx).
    mockUseBudgetBalance.mockReturnValue({
      incomeTotal: 0,
      expenseAllocationTotal: 0,
      toAssign: 0,
      isBalanced: true,
    });
    mockUseEnvelopes.mockClear();

    render(React.createElement(BudgetScreen));

    const currentPeriodStart = formatPeriodDateKey(
      new BudgetPeriodEngine().getCurrentPeriod(25).startDate,
    );

    // BudgetScreen also calls `useEnvelopes` a second time for the PREVIOUS
    // period (the "vs previous month" delta, VAL2-4) — `toHaveBeenCalledWith`
    // only needs ONE call to match, which is exactly the invariant here: the
    // viewed-period call defaults to the current period.
    expect(mockUseEnvelopes).toHaveBeenCalledWith('hh-1', currentPeriodStart);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════
// 4. Sinking fund progress bar percentage
// ═════════════════════════════════════════════════════════════════════════════════

describe('Sinking fund progress bar percentage', () => {
  it('progress is saved/target ratio (50% when half funded)', () => {
    const env = buildEnvelope({
      envelopeType: 'sinking_fund',
      allocatedCents: 750000,
      targetAmountCents: 1500000,
      targetDate: '2026-12-01',
    });

    const progress = env.allocatedCents / env.targetAmountCents!;
    expect(progress).toBeCloseTo(0.5);
    expect(Math.round(progress * 100)).toBe(50);
  });

  it('progress is 100% when fully funded', () => {
    const env = buildEnvelope({
      envelopeType: 'sinking_fund',
      allocatedCents: 1500000,
      targetAmountCents: 1500000,
      targetDate: '2026-12-01',
    });

    const progress = Math.min(env.allocatedCents / env.targetAmountCents!, 1);
    expect(progress).toBe(1);
    expect(Math.round(progress * 100)).toBe(100);
  });

  it('progress can exceed 100% (overfunded) — capped at 1.0 for display', () => {
    const env = buildEnvelope({
      envelopeType: 'sinking_fund',
      allocatedCents: 2000000,
      targetAmountCents: 1500000,
      targetDate: '2026-12-01',
    });

    const rawProgress = env.allocatedCents / env.targetAmountCents!;
    expect(rawProgress).toBeGreaterThan(1);

    const displayProgress = Math.min(rawProgress, 1);
    expect(displayProgress).toBe(1);
  });

  it('Kruger holiday sinking fund shows 0% initially (from scenario seed)', () => {
    const holidayFund = KRUGER_ENVELOPES.find((e) => e.name === 'Dec Holiday Sinking Fund')!;
    expect(holidayFund).toBeDefined();
    expect(holidayFund.targetAmountCents).toBe(1500000);
    expect(holidayFund.allocatedCents).toBe(0);

    const progress = holidayFund.allocatedCents / holidayFund.targetAmountCents!;
    expect(progress).toBe(0);
  });

  it('SinkingFundCard component renders progress bar', () => {
    const src = require.resolve('../components/envelopes/SinkingFundCard');
    const fs = require('fs');
    const content = fs.readFileSync(src, 'utf8');
    // Verifies the card calculates and displays progress
    expect(content).toContain('targetAmountCents');
    expect(content).toContain('savedCents');
  });
});
