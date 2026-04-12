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
import { render } from '@testing-library/react-native';
import type { BabyStepStatus } from '../../../../domain/babySteps/types';

// ─── Navigation mock ──────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn((cb: () => void) => cb()),
}));

// ─── react-native-paper mocks ─────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
  const React = require('react');
  const Text = ({ children, ...p }: { children?: React.ReactNode }) =>
    React.createElement('Text', p, children);
  const Surface = ({ children, ...p }: { children?: React.ReactNode }) =>
    React.createElement('View', p, children);
  const Button = ({ children, onPress, testID, ...p }: {
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
  const React = require('react');
  const Svg = ({ children, ...p }: { children?: React.ReactNode }) =>
    React.createElement('View', { testID: 'svg', ...p }, children);
  const el = (name: string) => ({ children, ...p }: { children?: React.ReactNode }) =>
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
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) =>
    selector({ householdId: 'hh-test', paydayDay: 25 }),
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

function makeStatus(
  stepNumber: number,
  overrides: Partial<BabyStepStatus> = {},
): BabyStepStatus {
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
    progress: i < completedCount
      ? null
      : stepNumber(i + 1),
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

  it('shows CTA for Step 2 no-debts when Step 2 is current with null progress', () => {
    mockStatuses = [
      makeStatus(1, { isCompleted: true, completedAt: '2026-04-10T10:00:00.000Z' }),
      makeStatus(2, { progress: null }), // no debts
      makeStatus(3),
      makeStatus(4),
      makeStatus(5),
      makeStatus(6),
      makeStatus(7),
    ];
    const { getByTestId } = render(<BabyStepsScreen {...makeNavProps()} />);
    expect(getByTestId('cta-no-debts')).toBeTruthy();
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
