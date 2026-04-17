/**
 * DashboardScreen.test.tsx — C8 screen test
 * Tests render and primary interaction (FAB navigation to AddTransaction).
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// ─── Navigation mock ──────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));

// ─── Local DB mock ────────────────────────────────────────────────────────────
jest.mock('../../../../data/local/db', () => ({ db: {} }));

// ─── Domain/hooks mocks ───────────────────────────────────────────────────────
jest.mock('../../../hooks/useEnvelopes', () => ({
  useEnvelopes: jest.fn().mockReturnValue({ envelopes: [], loading: false, reload: jest.fn() }),
}));

jest.mock('../../../hooks/useBabySteps', () => ({
  useBabySteps: jest.fn().mockReturnValue({ statuses: [] }),
}));

jest.mock('../../../../domain/shared/resolveBabyStepIsActive', () => ({
  resolveBabyStepIsActive: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../../../domain/scoring/resolveLoggingDays', () => ({
  resolveLoggingDays: jest.fn().mockResolvedValue(7),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue('true'), // acknowledged — suppresses rollover modal
  setItem: jest.fn().mockResolvedValue(undefined),
}));

// ─── Store mock ───────────────────────────────────────────────────────────────
let mockHouseholdId: string | null = 'hh-1';
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string | null; paydayDay: number }) => unknown) =>
    sel({ householdId: mockHouseholdId, paydayDay: 25 }),
  ),
}));

// ─── react-native-paper mocks ─────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
    FAB: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement('Pressable', { onPress, testID: testID ?? 'fab' }),
    Button: ({ onPress, children }: { onPress?: () => void; children?: React.ReactNode }) =>
      React.createElement('Pressable', { onPress }, children),
    ActivityIndicator: () => React.createElement('View', { testID: 'loading' }),
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

import { DashboardScreen } from '../DashboardScreen';

describe('DashboardScreen', () => {
  afterEach(() => {
    mockHouseholdId = 'hh-1';
  });

  it('shows loading splash when householdId is null', () => {
    mockHouseholdId = null;
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(getByTestId('loading-splash')).toBeTruthy();
  });

  it('renders without crashing and shows Add Transaction FAB', () => {
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(getByTestId('add-transaction-fab')).toBeTruthy();
  });

  it('pressing Add Transaction FAB navigates to AddTransaction', () => {
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    fireEvent.press(getByTestId('add-transaction-fab'));
    expect(mockNavigate).toHaveBeenCalledWith('AddTransaction');
  });
});
