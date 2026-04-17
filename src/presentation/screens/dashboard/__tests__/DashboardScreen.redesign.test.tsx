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
jest.mock('../../../../domain/shared/resolveBabyStepIsActive', () => ({
  resolveBabyStepIsActive: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../../../domain/scoring/resolveLoggingDays', () => ({
  resolveLoggingDays: jest.fn().mockResolvedValue(0),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => cb(),
}));
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children: React.ReactNode }) => children,
}));

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
