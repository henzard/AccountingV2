/**
 * DashboardScreen.persistentEnvelopes.test.tsx
 *
 * Verifies persistent envelopes (savings/emergency_fund/sinking_fund/
 * baby_step) are handled correctly on the dashboard:
 *  - shown in their own "Savings & funds" section, tappable to edit
 *  - displayed with their real SAVED balance (usePersistentEnvelopeSavings),
 *    never allocatedCents - spentCents
 *  - counted into "Budget" by their monthly allocatedCents, but excluded
 *    from "Spent" (their spentCents from useEnvelopes is an ALL-TIME figure,
 *    not this period's)
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));

jest.mock('../../../../data/local/db', () => ({ db: {} }));

jest.mock('../resolveEnvelopeTransactions', () => ({
  resolveEnvelopeTransactions: jest.fn().mockResolvedValue([]),
}));

const mockEnvelopes = [
  {
    id: 'spend-1',
    householdId: 'hh-1',
    name: 'Groceries',
    envelopeType: 'spending',
    allocatedCents: 200000,
    spentCents: 50000,
    periodStart: '2026-09-01',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
  },
  {
    id: 'ef-1',
    householdId: 'hh-1',
    name: 'Emergency Fund',
    envelopeType: 'emergency_fund',
    allocatedCents: 100000, // this period's monthly contribution
    spentCents: 900000, // ALL-TIME spend against the fund — must not count as this period's spend
    periodStart: '2026-01-01',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
];

// Not `.mockReturnValue({ envelopes: mockEnvelopes, ... })` — that argument
// would be evaluated eagerly when this factory runs (hoisted above
// `mockEnvelopes`'s own declaration), capturing `undefined`. A plain closure
// defers reading `mockEnvelopes` until `useEnvelopes()` is actually called
// during render, by which point the module's top-level code has finished.
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

describe('DashboardScreen — persistent envelopes', () => {
  it('shows a persistent envelope row with its SAVED balance, not allocatedCents - spentCents', () => {
    const { getByTestId, getByText, queryByText } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(getByTestId('persistent-envelope-ef-1')).toBeTruthy();
    // Saved balance (R3,500.00) from usePersistentEnvelopeSavings, not
    // allocatedCents - spentCents (which would be deeply negative).
    expect(getByText(/R3,?\s?500/)).toBeTruthy();
    expect(queryByText('Emergency Fund, R-8,000.00')).toBeNull();
  });

  it('pressing a persistent envelope row opens the envelope detail sheet (VAL-9)', async () => {
    const { getByTestId, findByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    fireEvent.press(getByTestId('persistent-envelope-ef-1'));
    expect(await findByTestId('envelope-detail-sheet')).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('counts the persistent envelope’s monthly allocation into "Budget" but excludes its all-time spend from "Spent"', () => {
    const { getByText } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    // Budget = 200000 (Groceries) + 100000 (Emergency Fund monthly contribution) = R3,000.00
    expect(getByText(/^R3.000,00$/)).toBeTruthy();
    // Spent = 50000 (Groceries only) = R500.00 — the fund's R9,000.00
    // all-time spend must NOT be added in.
    expect(getByText('R500,00')).toBeTruthy();
  });

  it('does not show the main envelope list section header for the persistent-only fund', () => {
    // Groceries (spending) is still the only item counted in "N active".
    const { getByText } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(getByText('1 active ›')).toBeTruthy();
  });
});
