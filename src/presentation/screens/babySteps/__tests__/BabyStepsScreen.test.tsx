/**
 * BabyStepsScreen.test.tsx — task 4.15
 *
 * Tests:
 *   - All three tiers render (completed chips, current hero, future steps)
 *   - CTA for no-EMF (Step 1 without progress)
 *   - CTA for no-income (Step 3 blocked)
 *   - CTA for Step 2 no-debts (Step 2 without progress)
 *   - Manual steps show ManualStepPanel
 *
 * Spec §BabyStepsScreen: three-tier layout, §Empty-state CTAs.
 */

import React from 'react';
import { render, within } from '@testing-library/react-native';
import type { BabyStepStatus } from '../../../../domain/babySteps/types';

// ─── Navigation mock ──────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn((cb: () => void) => cb()),
}));

// ─── react-native-paper mocks ─────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Text = ({ children, ...p }: { children?: React.ReactNode }) =>
    React.createElement('Text', p, children);
  const Surface = ({ children, ...p }: { children?: React.ReactNode }) =>
    React.createElement('View', p, children);
  const Button = ({
    children,
    onPress,
    testID,
    ...p
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) => React.createElement('TouchableOpacity', { onPress, testID, ...p }, children);
  const Chip = ({ children, ...p }: { children?: React.ReactNode }) =>
    React.createElement('View', p, children);
  const ActivityIndicator = () => React.createElement('View', { testID: 'activity-indicator' });
  return { Text, Surface, Button, Chip, ActivityIndicator };
});

// ─── SVG mock ─────────────────────────────────────────────────────────────────
jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Svg = ({ children, ...p }: { children?: React.ReactNode }) =>
    React.createElement('View', { testID: 'svg', ...p }, children);
  const el =
    (name: string) =>
    ({ children, ...p }: { children?: React.ReactNode }) =>
      React.createElement('View', { testID: name, ...p }, children);
  return {
    __esModule: true,
    default: Svg,
    Svg,
    Circle: el('circle'),
    Line: el('line'),
    Path: el('path'),
    Rect: el('rect'),
    G: ({ children, ...p }: { children?: React.ReactNode }) =>
      React.createElement('View', { testID: 'g', ...p }, children),
    Text: el('svg-text'),
  };
});

// ─── Icon mock ────────────────────────────────────────────────────────────────
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return ({ name }: { name: string }) => React.createElement('View', { testID: `icon-${name}` });
});

// ─── useBabySteps mock ────────────────────────────────────────────────────────
const mockReconcile = jest.fn().mockResolvedValue(null);
const mockToggle = jest.fn().mockResolvedValue(undefined);

let mockStatuses: BabyStepStatus[] = [];
let mockLoading = false;

jest.mock('../../../hooks/useBabySteps', () => ({
  useBabySteps: () => ({
    statuses: mockStatuses,
    loading: mockLoading,
    error: null,
    reconcile: mockReconcile,
    toggleManualStep: mockToggle,
  }),
}));

// ─── appStore mock ────────────────────────────────────────────────────────────
let mockBabyStepsHouseholdId: string | null = 'hh-test';
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) =>
    selector({ householdId: mockBabyStepsHouseholdId, paydayDay: 25 }),
  ),
}));

// ─── BudgetPeriodEngine mock ──────────────────────────────────────────────────
jest.mock('../../../../domain/shared/BudgetPeriodEngine', () => ({
  BudgetPeriodEngine: jest.fn().mockImplementation(() => ({
    getCurrentPeriod: jest.fn(() => ({
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
      label: 'April 2026',
    })),
  })),
  // `formatPeriodDateKey` (L7 tz-consistent period key) is a plain exported
  // function, not a class member — the screen now imports it alongside
  // `BudgetPeriodEngine`, so this manual module mock must also provide it.
  formatPeriodDateKey: (date: Date): string => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
}));

// ─── useWindowDimensions mock ─────────────────────────────────────────────────
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  default: jest.fn(() => ({ width: 390, height: 844 })),
}));

import { BabyStepsScreen } from '../BabyStepsScreen';

// Helper navigation props
const makeNavProps = () => ({
  navigation: { navigate: mockNavigate, goBack: jest.fn() } as any,
  route: { key: 'BabySteps', name: 'BabySteps', params: undefined } as any,
});

function makeStatus(stepNumber: number, overrides: Partial<BabyStepStatus> = {}): BabyStepStatus {
  return {
    stepNumber: stepNumber as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    isCompleted: false,
    isManual: [4, 5, 7].includes(stepNumber),
    progress: null,
    completedAt: null,
    celebratedAt: null,
    ...overrides,
  };
}

function allStatuses(completedCount = 0): BabyStepStatus[] {
  return Array.from({ length: 7 }, (_, i) => ({
    stepNumber: (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    isCompleted: i < completedCount,
    isManual: [4, 5, 7].includes(i + 1),
    progress: i < completedCount ? null : stepNumber(i + 1),
    completedAt: i < completedCount ? '2026-04-12T10:00:00.000Z' : null,
    celebratedAt: null,
  }));
}

function stepNumber(_n: number): null {
  return null; // helper alias for clarity
}

describe('BabyStepsScreen', () => {
  beforeEach(() => {
    mockLoading = false;
    mockStatuses = [];
    mockReconcile.mockClear();
    mockBabyStepsHouseholdId = 'hh-test';
  });

  it('shows loading splash when householdId is null', () => {
    mockBabyStepsHouseholdId = null;
    const { getByTestId } = render(<BabyStepsScreen {...makeNavProps()} />);
    expect(getByTestId('loading-splash')).toBeTruthy();
  });

  // ─── Three tiers ─────────────────────────────────────────────────────────

  it('renders completed chips tier when steps are complete', () => {
    mockStatuses = allStatuses(2); // 2 completed
    const { getByText } = render(<BabyStepsScreen {...makeNavProps()} />);
    expect(getByText('COMPLETED')).toBeTruthy();
  });

  it('renders current step hero tier', () => {
    mockStatuses = allStatuses(0);
    const { getByTestId } = render(<BabyStepsScreen {...makeNavProps()} />);
    expect(getByTestId('current-step-hero')).toBeTruthy();
  });

  it('renders future steps tier when there are upcoming steps', () => {
    mockStatuses = allStatuses(0);
    // future-steps-section has accessibilityElementsHidden — use {hidden: true} to find it
    const { getByTestId } = render(<BabyStepsScreen {...makeNavProps()} />);
    expect(getByTestId('future-steps-section', { hidden: true })).toBeTruthy();
  });

  // ─── CTAs ─────────────────────────────────────────────────────────────────

  it('shows CTA for no-EMF when Step 1 has null progress', () => {
    mockStatuses = allStatuses(0); // Step 1 current, null progress
    const { getByTestId } = render(<BabyStepsScreen {...makeNavProps()} />);
    expect(getByTestId('cta-no-emf')).toBeTruthy();
  });

  it('shows CTA for no-income when Step 3 is current with null progress', () => {
    // Steps 1 and 2 completed; step 3 current with no income
    mockStatuses = [
      makeStatus(1, { isCompleted: true, completedAt: '2026-04-10T10:00:00.000Z' }),
      makeStatus(2, { isCompleted: true, completedAt: '2026-04-11T10:00:00.000Z' }),
      makeStatus(3, { progress: null }), // blocked on income
      makeStatus(4),
      makeStatus(5),
      makeStatus(6),
      makeStatus(7),
    ];
    const { getByTestId } = render(<BabyStepsScreen {...makeNavProps()} />);
    expect(getByTestId('cta-no-income')).toBeTruthy();
  });

  // NOTE (C-1 rework): this used to assert that Step 2 stayed the CURRENT
  // step — showing the blocking "Add debt account" CTA — forever, for any
  // household with zero non-bond debts. That was exactly the bug C-1 fixes:
  // once Step 1 is done, zero applicable debts means Step 2 is SKIPPED (see
  // BabyStepEvaluator's "Steps 2 and 6" note and `inferBabyStepSkips`), so it
  // can no longer be the blocking current step — the household advances to
  // Step 3 and sees a "No debts recorded — skipped" notice instead. This
  // exact scenario is covered by the C-1 tests below; kept here (renamed) as
  // an explicit regression guard against the CTA reappearing as a blocker.
  it('does NOT show the Step 2 no-debts CTA as a blocker once Step 1 is done (C-1 — it is skipped instead)', () => {
    mockStatuses = [
      makeStatus(1, { isCompleted: true, completedAt: '2026-04-10T10:00:00.000Z' }),
      makeStatus(2, { progress: null }), // no debts
      makeStatus(3),
      makeStatus(4),
      makeStatus(5),
      makeStatus(6),
      makeStatus(7),
    ];
    const { queryByTestId, getByText } = render(<BabyStepsScreen {...makeNavProps()} />);
    expect(queryByTestId('cta-no-debts')).toBeNull();
    expect(getByText('No debts recorded — skipped')).toBeTruthy();
  });

  // ─── C-2: futureSteps must exclude effectively-done (completed OR skipped) steps ──

  it('C-2: a vacuously-skipped step past currentIdx does NOT also render as a dimmed future card', () => {
    // Step 1 is complete. Step 2 has zero non-bond debts (progress: null,
    // isCompleted: false — the SYNCED-safe skip shape, never `isCompleted: true`)
    // — it must be inferred as skipped, advancing currentStep to Step 3, and
    // must never ALSO appear as a dimmed "Coming Up" future card.
    mockStatuses = [
      makeStatus(1, { isCompleted: true, completedAt: '2026-04-10T10:00:00.000Z' }),
      makeStatus(2, { isCompleted: false, progress: null }), // skip-eligible
      makeStatus(3),
      makeStatus(4),
      makeStatus(5),
      makeStatus(6),
      makeStatus(7),
    ];
    const { getByText, queryByText, getByTestId } = render(<BabyStepsScreen {...makeNavProps()} />);

    // Shows up in its own "skipped" notice...
    expect(getByText('No debts recorded — skipped')).toBeTruthy();
    // ...NOT as a "2. Debt Free" completed chip inside the COMPLETED tier
    // (it was never `isCompleted`; Step 1's own genuine completion
    // legitimately still shows a chip there for Step 1)...
    const completedSection = getByTestId('completed-steps-section');
    expect(within(completedSection).queryByText('2. Debt Free')).toBeNull();
    // ...and NOT as a future card under "Coming Up".
    const futureSection = getByTestId('future-steps-section', { hidden: true });
    expect(within(futureSection).queryByText('Debt Free')).toBeNull();
    expect(queryByText('STEP 2')).toBeNull();
  });

  // ─── C-1 (reworked): vacuous Step 2/6 skip is inferred from statuses, ──────
  // never persisted as `isCompleted: true` (SYNCED-table safety) ─────────────

  it('C-1: a vacuously-skipped Step 2 (no debts, isCompleted stays false) shows "No debts recorded — skipped" and advances currentStep to Step 3', () => {
    mockStatuses = [
      makeStatus(1, { isCompleted: true, completedAt: '2026-04-10T10:00:00.000Z' }),
      makeStatus(2, { isCompleted: false, progress: null }),
      makeStatus(3),
      makeStatus(4),
      makeStatus(5),
      makeStatus(6),
      makeStatus(7),
    ];
    const { getByText, getByTestId } = render(<BabyStepsScreen {...makeNavProps()} />);
    expect(getByText('No debts recorded — skipped')).toBeTruthy();
    // Step 3 (not Step 2) is now the active hero card.
    expect(getByTestId('cta-no-income')).toBeTruthy();
  });

  it('a brand-new household with zero debts and Step 1 NOT complete keeps Step 2 as the (blocked, non-skipped) current step', () => {
    mockStatuses = [
      makeStatus(1), // Step 1 not complete yet
      makeStatus(2, { isCompleted: false, progress: null }),
      makeStatus(3),
      makeStatus(4),
      makeStatus(5),
      makeStatus(6),
      makeStatus(7),
    ];
    const { getByTestId, queryByText } = render(<BabyStepsScreen {...makeNavProps()} />);
    // Still blocked on Step 1 — never told "debt free" ahead of it.
    expect(getByTestId('cta-no-emf')).toBeTruthy();
    expect(queryByText('No debts recorded — skipped')).toBeNull();
  });

  it('a GENUINELY completed Step 2 (non-null progress, real isCompleted=true) shows the completion date as a normal chip, not "skipped"', () => {
    mockStatuses = [
      makeStatus(1, { isCompleted: true, completedAt: '2026-04-10T10:00:00.000Z' }),
      makeStatus(2, {
        isCompleted: true,
        progress: { current: 1, target: 1, unit: 'count' },
        completedAt: '2026-04-12T00:00:00.000Z',
      }),
      makeStatus(3),
      makeStatus(4),
      makeStatus(5),
      makeStatus(6),
      makeStatus(7),
    ];
    const { getByText, queryByText } = render(<BabyStepsScreen {...makeNavProps()} />);
    expect(getByText('12 Apr 2026')).toBeTruthy();
    expect(queryByText('No debts recorded — skipped')).toBeNull();
  });

  // ─── Manual steps ─────────────────────────────────────────────────────────

  it('shows ManualStepPanel when current step is a manual step (Step 4)', () => {
    mockStatuses = [
      makeStatus(1, { isCompleted: true, completedAt: '2026-04-10T10:00:00.000Z' }),
      makeStatus(2, { isCompleted: true, completedAt: '2026-04-10T10:00:00.000Z' }),
      makeStatus(3, { isCompleted: true, completedAt: '2026-04-10T10:00:00.000Z' }),
      makeStatus(4, { isManual: true }), // current — manual
      makeStatus(5, { isManual: true }),
      makeStatus(6),
      makeStatus(7, { isManual: true }),
    ];
    const { getByTestId } = render(<BabyStepsScreen {...makeNavProps()} />);
    expect(getByTestId('manual-step-panel')).toBeTruthy();
  });
});
