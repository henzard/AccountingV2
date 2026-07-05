/**
 * MeterSetupStep.test.tsx — B1 + M9/L4 fix regression (2026-07-05 audit)
 *
 * Tests:
 *   - Three toggles render (electricity, water, odometer).
 *   - Skip button text shown when no toggles are on; Next when any is on.
 *   - Pressing Next/Skip always navigates to ScoreIntro and NEVER writes a
 *     meter_readings row — the old zero-value "Opening baseline" seed (M9:
 *     wrong consumption/rate math against a 0 baseline; L4: blocked the
 *     first same-day real reading via the DUPLICATE_READING guard) is gone.
 *     The user's first real reading now simply becomes the baseline.
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

// ─── Detects any write attempt ─────────────────────────────────────────────────
// The fixed screen must never write through the synced-repo path at all —
// spying on resolveSyncedRepo lets the regression test assert that
// directly, rather than only inferring it from an absence of navigation
// side-effects. (MeterSetupStep no longer imports this module at all, but
// the mock is harmless to keep in place as a belt-and-braces guard in case
// a future edit re-adds a write.)
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

  it('shows "Next" button text once a toggle is enabled', () => {
    const { getByTestId, getByText } = render(<MeterSetupStep />);
    fireEvent(getByTestId('switch-water'), 'touchEnd');
    expect(getByText('Next')).toBeTruthy();
  });

  it('pressing skip (no toggles) navigates to ScoreIntro without inserting rows', async () => {
    const { getByText } = render(<MeterSetupStep />);
    fireEvent.press(getByText('Skip'));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('ScoreIntro');
    });
    expect(mockRepoInsert).not.toHaveBeenCalled();
  });

  it('pressing Next with a toggle enabled navigates to ScoreIntro WITHOUT seeding any baseline reading (M9/L4 fix)', async () => {
    const { getByTestId, getByText } = render(<MeterSetupStep />);
    fireEvent(getByTestId('switch-electricity'), 'touchEnd');
    fireEvent.press(getByText('Next'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('ScoreIntro');
    });

    // No meter_readings row (zero-value or otherwise) is ever written from
    // this screen — the first REAL reading logged via AddReadingScreen is
    // now the only baseline that ever exists.
    expect(mockRepoInsert).not.toHaveBeenCalled();
  });

  it('pressing Next with ALL toggles enabled still writes nothing', async () => {
    const { getByTestId, getByText } = render(<MeterSetupStep />);
    fireEvent(getByTestId('switch-electricity'), 'touchEnd');
    fireEvent(getByTestId('switch-water'), 'touchEnd');
    fireEvent(getByTestId('switch-odometer'), 'touchEnd');
    fireEvent.press(getByText('Next'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('ScoreIntro');
    });
    expect(mockRepoInsert).not.toHaveBeenCalled();
  });
});
