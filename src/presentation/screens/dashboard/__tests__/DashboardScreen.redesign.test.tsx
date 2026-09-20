/**
 * Smoke test for the redesigned DashboardScreen.
 * Verifies the root testID is present and key navigation actions are wired.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: object) => unknown) =>
    sel({ householdId: 'hh-1', paydayDay: 25 }),
  ),
}));
jest.mock('../../../hooks/useEnvelopes', () => ({
  useEnvelopes: () => ({ envelopes: [], loading: false, reload: jest.fn() }),
}));
jest.mock('../../../hooks/useBabySteps', () => ({
  useBabySteps: () => ({ statuses: [] }),
}));
jest.mock('../../../hooks/usePersistentEnvelopeSavings', () => ({
  usePersistentEnvelopeSavings: () => ({
    savedCentsByEnvelopeId: new Map(),
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
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => cb(),
}));
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children: React.ReactNode }) => children,
}));

// react-native-paper's real Dialog/Portal need a PaperProvider host, which
// this smoke test doesn't mount — stub the pieces DashboardScreen uses
// (ScoreBreakdownDialog) instead of pulling in the whole real library.
jest.mock('react-native-paper', () => {
  const RN = jest.requireActual('react');
  const Dialog = ({
    children,
    visible,
    testID,
  }: {
    children?: React.ReactNode;
    visible?: boolean;
    testID?: string;
  }) => (visible ? RN.createElement('View', { testID }, children) : null);
  Dialog.Title = ({ children }: { children?: React.ReactNode }) =>
    RN.createElement('Text', null, children);
  Dialog.Content = ({ children }: { children?: React.ReactNode }) =>
    RN.createElement('View', null, children);
  Dialog.Actions = ({ children }: { children?: React.ReactNode }) =>
    RN.createElement('View', null, children);
  return {
    Text: ({ children }: { children?: React.ReactNode }) =>
      RN.createElement('Text', null, children),
    Button: ({ onPress, children }: { onPress?: () => void; children?: React.ReactNode }) =>
      RN.createElement('Pressable', { onPress }, children),
    Portal: ({ children }: { children?: React.ReactNode }) => children,
    Dialog,
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue('true'),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

import { DashboardScreen } from '../DashboardScreen';

const mockNavigate = jest.fn();
const nav = { navigate: mockNavigate } as never;
const route = {} as never;

beforeEach(() => mockNavigate.mockClear());

it('renders dashboard root testID', () => {
  const { getByTestId } = render(<DashboardScreen navigation={nav} route={route} />);
  expect(getByTestId('dashboard-root')).toBeTruthy();
});

it('add-transaction FAB is present and navigates', () => {
  const { getByTestId } = render(<DashboardScreen navigation={nav} route={route} />);
  fireEvent.press(getByTestId('add-transaction-fab'));
  expect(mockNavigate).toHaveBeenCalledWith('AddTransaction');
});

it('new-envelope button is present when empty', () => {
  const { getByTestId } = render(<DashboardScreen navigation={nav} route={route} />);
  expect(getByTestId('new-envelope-button')).toBeTruthy();
});
