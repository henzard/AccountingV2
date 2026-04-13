/**
 * MeterSetupStep.test.tsx — B1
 *
 * Tests:
 *   - Three toggles render (electricity, water, odometer).
 *   - Skip button text shown when no toggles are on.
 *   - Pressing skip (no toggles) navigates to ScoreIntro.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ─── Navigation mock ──────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// ─── react-native-paper mocks ─────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Text = ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('Text', p, children);
  const Button = ({
    children,
    onPress,
    testID,
    disabled,
    ...p
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    disabled?: boolean;
    [k: string]: unknown;
  }) =>
    React.createElement(
      'TouchableOpacity',
      { onPress, testID, disabled, ...p },
      React.createElement('Text', {}, children),
    );
  const List = {
    Item: ({ title, right }: { title?: string; right?: (p: object) => React.ReactNode }) =>
      React.createElement(
        'View',
        {},
        React.createElement('Text', {}, title),
        right ? right({}) : null,
      ),
    Icon: () => null,
  };
  const Switch = ({
    value,
    onValueChange,
    testID,
  }: {
    value?: boolean;
    onValueChange?: (v: boolean) => void;
    testID?: string;
  }) =>
    React.createElement('View', {
      testID,
      accessibilityState: { checked: value },
      // Simulate toggle on touch end
      onTouchEnd: () => onValueChange?.(!value),
    });
  return { Text, Button, List, Switch };
});

// ─── appStore mock ────────────────────────────────────────────────────────────
jest.mock('../../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) => selector({ householdId: 'hh-test' })),
}));

// ─── DB mock ──────────────────────────────────────────────────────────────────
const mockInsertValues = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../../../data/local/db', () => ({
  db: {
    insert: jest.fn(() => ({ values: mockInsertValues })),
  },
}));

// ─── Schema mock ──────────────────────────────────────────────────────────────
jest.mock('../../../../../data/local/schema', () => ({
  meterReadings: 'meterReadings',
}));

// ─── PendingSyncEnqueuer mock ─────────────────────────────────────────────────
const mockEnqueue = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../../../data/sync/PendingSyncEnqueuer', () => ({
  PendingSyncEnqueuer: jest.fn().mockImplementation(() => ({ enqueue: mockEnqueue })),
}));

// ─── expo-crypto mock ─────────────────────────────────────────────────────────
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'mock-uuid-1234'),
}));

import { MeterSetupStep } from '../MeterSetupStep';

describe('MeterSetupStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders three switches (electricity, water, odometer)', () => {
    const { getByTestId } = render(<MeterSetupStep />);
    expect(getByTestId('switch-electricity')).toBeTruthy();
    expect(getByTestId('switch-water')).toBeTruthy();
    expect(getByTestId('switch-odometer')).toBeTruthy();
  });

  it('shows "Skip" button text when no toggles are enabled', () => {
    const { getByText } = render(<MeterSetupStep />);
    expect(getByText('Skip')).toBeTruthy();
  });

  it('pressing skip (no toggles) navigates to ScoreIntro without inserting rows', async () => {
    const { getByText } = render(<MeterSetupStep />);
    fireEvent.press(getByText('Skip'));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('ScoreIntro');
      expect(mockInsertValues).not.toHaveBeenCalled();
    });
  });
});
