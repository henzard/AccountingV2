/**
 * DashboardScreen.persistentOnly.test.tsx
 *
 * DASH-1: a household whose only envelopes are PERSISTENT (savings/
 * emergency_fund/sinking_fund/baby_step) has not set up this month's
 * spending. The ring / Spent-Budget-Score row / safe-to-spend block used to
 * be gated on `spendEnvelopes` (everything but income), while the empty state
 * underneath is gated on the period-scoped `budgetSpendEnvelopes` — so those
 * figures rendered directly above "You haven't set up this month's spending
 * yet". Both must key off the same list.
 *
 * The "Savings & funds" section lives in the list FOOTER and must still show.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));

jest.mock('../../../../data/local/db', () => ({ db: {} }));
jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaView: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      RN.createElement('View', p, children),
  };
});

jest.mock('../resolveEnvelopeTransactions', () => ({
  resolveEnvelopeTransactions: jest.fn().mockResolvedValue([]),
}));

// Only funds — no 'spending'/'utility' envelope for this period.
const mockEnvelopes = [
  {
    id: 'ef-1',
    householdId: 'hh-1',
    name: 'Emergency Fund',
    envelopeType: 'emergency_fund',
    allocatedCents: 100000,
    spentCents: 900000,
    periodStart: '2026-01-01',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
];

jest.mock('../../../hooks/useEnvelopes', () => ({
  useEnvelopes: () => ({
    envelopes: mockEnvelopes,
    loading: false,
    reload: jest.fn(),
  }),
}));

jest.mock('../../../hooks/useBabySteps', () => ({
  useBabySteps: jest.fn().mockReturnValue({ statuses: [] }),
}));

const mockSavedCentsByEnvelopeId = new Map([['ef-1', 350000]]);
jest.mock('../../../hooks/usePersistentEnvelopeSavings', () => ({
  usePersistentEnvelopeSavings: () => ({
    savedCentsByEnvelopeId: mockSavedCentsByEnvelopeId,
    loading: false,
    error: null,
    reload: jest.fn(),
  }),
}));

jest.mock('../../../../domain/shared/resolveBabyStepIsActive', () => ({
  resolveBabyStepIsActive: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../../../domain/scoring/resolveLoggingDays', () => ({
  resolveLoggingDays: jest.fn().mockResolvedValue(0),
}));

jest.mock('../resolveMeterReadingsLogged', () => ({
  resolveMeterReadingsLogged: jest.fn().mockResolvedValue(false),
}));

jest.mock('../findLatestPeriodWithEnvelopes', () => ({
  findLatestPeriodWithEnvelopes: jest.fn().mockResolvedValue(null),
  hasPeriodScopedEnvelopeAfter: jest.fn().mockResolvedValue(false),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue('true'),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string | null; paydayDay: number }) => unknown) =>
    sel({ householdId: 'hh-1', paydayDay: 25 }),
  ),
}));

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Dialog = ({
    children,
    visible,
    testID,
  }: {
    children?: React.ReactNode;
    visible?: boolean;
    testID?: string;
  }) => (visible ? React.createElement('View', { testID }, children) : null);
  Dialog.Title = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('Text', null, children);
  Dialog.Content = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', null, children);
  Dialog.Actions = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', null, children);
  return {
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
    Button: ({ onPress, children }: { onPress?: () => void; children?: React.ReactNode }) =>
      React.createElement('Pressable', { onPress }, children),
    FAB: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement('Pressable', { onPress, testID: testID ?? 'fab' }),
    ActivityIndicator: () => React.createElement('View', { testID: 'loading' }),
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    Portal: ({ children }: { children?: React.ReactNode }) => children,
    Dialog,
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

jest.mock('expo-linear-gradient', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    LinearGradient: ({ children, style }: { children?: React.ReactNode; style?: unknown }) =>
      React.createElement('View', { style }, children),
  };
});

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

import { DashboardScreen } from '../DashboardScreen';

describe('DashboardScreen — persistent envelopes only (no spending set up)', () => {
  const renderScreen = (): ReturnType<typeof render> =>
    render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );

  it('shows the "no spending set up" empty state', () => {
    const { getByTestId } = renderScreen();
    expect(getByTestId('dashboard-empty-state')).toBeTruthy();
  });

  it('does not render the budget ring above that empty state', () => {
    const { queryByTestId } = renderScreen();
    expect(queryByTestId('dashboard-kpi-row')).toBeNull();
  });

  it('does not render the Spent / Budget stat row', () => {
    const { queryByTestId } = renderScreen();
    expect(queryByTestId('dashboard-stat-spent-value')).toBeNull();
    expect(queryByTestId('dashboard-stat-budget-value')).toBeNull();
  });

  it('does not render the safe-to-spend card', () => {
    const { queryByTestId } = renderScreen();
    expect(queryByTestId('dashboard-safe-to-spend')).toBeNull();
  });

  it('still shows the Savings & funds section with the fund’s saved balance', () => {
    const { getByTestId, getByText } = renderScreen();
    expect(getByTestId('persistent-envelope-ef-1')).toBeTruthy();
    expect(getByText(/R3\s?500,00 saved/)).toBeTruthy();
  });
});
