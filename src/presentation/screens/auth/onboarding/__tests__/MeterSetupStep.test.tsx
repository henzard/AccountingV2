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
// MeterSetupStep now writes through the shared oplog synced repo
// (resolveSyncedRepo/resolveSyncedRepoCtx) instead of a raw db.insert +
// PendingSyncEnqueuer pair — see MeterSetupStep.tsx's doc comment. `db` only
// needs to exist as an identity for resolveSyncedRepo to key off of; the
// synced-repo fake below is what actually gets exercised.
jest.mock('../../../../../data/local/db', () => ({ db: {} }));

const mockRepoInsert = jest.fn();
jest.mock('../../../../../domain/shared/syncWrite', () => ({
  resolveSyncedRepo: jest.fn(() => ({
    insert: mockRepoInsert,
    update: jest.fn(),
    softDelete: jest.fn(),
    increment: jest.fn(),
  })),
  resolveSyncedRepoCtx: jest.fn(() => ({
    deviceId: 'unassigned-device',
    actorUserId: null,
    clock: () => '2026-01-01T00:00:00.000Z',
  })),
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
      expect(mockRepoInsert).not.toHaveBeenCalled();
    });
  });

  it('pressing Next with a toggle enabled seeds a zero-value baseline reading via the synced repo', async () => {
    const { getByTestId, getByText } = render(<MeterSetupStep />);
    fireEvent(getByTestId('switch-electricity'), 'touchEnd');
    fireEvent.press(getByText('Next'));

    await waitFor(() => {
      expect(mockRepoInsert).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('ScoreIntro');
    });

    const [row] = mockRepoInsert.mock.calls[0];
    expect(row.household_id).toBe('hh-test');
    expect(row.meter_type).toBe('electricity');
    expect(row.reading_value).toBe(0);
    expect(row.notes).toBe('Opening baseline');
  });
});
