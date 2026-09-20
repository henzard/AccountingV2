/**
 * RootNavigator.test.tsx — B3 four-state routing coverage
 *
 * Tests that the correct child navigator is rendered for each combination
 * of (session, householdId, onboardingCompleted) state.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// ─── Mock child navigators so the test is pure ────────────────────────────────
// Note: jest.mock factories cannot reference out-of-scope variables (except those
// prefixed with 'mock'). Use require() inside the factory to access React/View.

jest.mock('../AuthNavigator', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { AuthNavigator: () => React.createElement(View, { testID: 'auth-nav' }) };
});

jest.mock('../CreateHouseholdNavigator', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    CreateHouseholdNavigator: () => React.createElement(View, { testID: 'create-household-nav' }),
  };
});

jest.mock('../MainTabNavigator', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { MainTabNavigator: () => React.createElement(View, { testID: 'main-tab-nav' }) };
});

jest.mock('../../screens/auth/onboarding/OnboardingNavigator', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { OnboardingNavigator: () => React.createElement(View, { testID: 'onboarding-nav' }) };
});

// ─── Mock household screens used in RootNavigator ─────────────────────────────
jest.mock('../../screens/household/HouseholdPickerScreen', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { HouseholdPickerScreen: () => React.createElement(View, { testID: 'household-picker' }) };
});
jest.mock('../../screens/household/CreateHouseholdScreen', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    CreateHouseholdScreen: () => React.createElement(View, { testID: 'create-household-screen' }),
  };
});
jest.mock('../../screens/household/ShareInviteScreen', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    ShareInviteScreen: () => React.createElement(View, { testID: 'share-invite-screen' }),
  };
});
jest.mock('../../screens/household/JoinHouseholdScreen', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    JoinHouseholdScreen: () => React.createElement(View, { testID: 'join-household-screen' }),
  };
});

// ─── Mock ResetPasswordScreen — has its own dedicated test file ──────────────
jest.mock('../../screens/auth/ResetPasswordScreen', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    ResetPasswordScreen: () => React.createElement(View, { testID: 'reset-password-screen' }),
  };
});

// ─── Mock SlipScanningScreen — encapsulates all DI / camera / AsyncStorage ────
jest.mock('../SlipScanningScreen', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    SlipScanningScreen: () => React.createElement(View, { testID: 'slip-scanning-screen' }),
  };
});

// ─── Mock ConfirmDialogHost — UX-6/wave-3: RootNavigator mounts one at the
// root (alongside/outside the stack) so it overlays every screen, including
// the pre-Main household-creation gate where MainTabNavigator's own copy
// isn't mounted yet ─────────────────────────────────────────────────────────
jest.mock('../../components/shared/ConfirmDialogHost', () => {
  const RN = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    ConfirmDialogHost: () => RN.createElement(View, { testID: 'root-confirm-dialog-host' }),
    confirm: jest.fn(),
  };
});

// ─── Mock expo-notifications (used in RootNavigator) ─────────────────────────
const mockAddNotificationResponseReceivedListener = jest.fn(() => ({ remove: jest.fn() }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  scheduleNotificationAsync: jest.fn(),
  cancelAllScheduledNotificationsAsync: jest.fn(),
  addNotificationResponseReceivedListener: (
    ...args: Parameters<typeof mockAddNotificationResponseReceivedListener>
  ) => mockAddNotificationResponseReceivedListener(...args),
}));

// ─── Mock db/schema (used by RootNavigator's hasLoggedTransactionToday check) ─
const mockDbSelect = jest.fn(() => ({
  from: jest.fn(() => ({
    where: jest.fn(() => ({
      limit: jest.fn().mockResolvedValue([]),
    })),
  })),
}));
jest.mock('../../../data/local/db', () => ({
  db: { select: () => mockDbSelect() },
}));
jest.mock('../../../data/local/schema', () => ({
  transactions: {
    id: 'id',
    householdId: 'householdId',
    transactionDate: 'transactionDate',
    deletedAt: 'deletedAt',
  },
}));

// ─── Mock notification infrastructure ────────────────────────────────────────
jest.mock('../../../infrastructure/notifications/NotificationPreferencesRepository', () => ({
  NotificationPreferencesRepository: jest.fn().mockImplementation(() => ({
    load: jest.fn().mockResolvedValue({
      eveningLogPromptEnabled: false,
      meterReadingReminderEnabled: false,
      monthStartPreflightEnabled: false,
    }),
  })),
}));

jest.mock('../../../infrastructure/notifications/LocalNotificationScheduler', () => ({
  LocalNotificationScheduler: jest.fn().mockImplementation(() => ({
    cancelAll: jest.fn().mockResolvedValue(undefined),
    scheduleEveningLogPrompt: jest.fn().mockResolvedValue(undefined),
    scheduleMeterReadingReminder: jest.fn().mockResolvedValue(undefined),
    scheduleMonthStartPreflight: jest.fn().mockResolvedValue(undefined),
  })),
}));

// ─── Mock LoadingSplash ───────────────────────────────────────────────────────
jest.mock('../../components/shared/LoadingSplash', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { LoadingSplash: () => React.createElement(View, { testID: 'loading-splash' }) };
});

// ─── Mock onboarding flag ─────────────────────────────────────────────────────
jest.mock('../../../infrastructure/storage/onboardingFlag', () => ({
  isOnboardingComplete: jest.fn(),
}));

// ─── Mock notificationStore ───────────────────────────────────────────────────
jest.mock('../../stores/notificationStore', () => ({
  useNotificationStore: jest.fn(() => ({
    setPreferences: jest.fn(),
    setPermissionsGranted: jest.fn(),
  })),
}));

// No appStore mock — use the real zustand store and set state per test.

import { isOnboardingComplete } from '../../../infrastructure/storage/onboardingFlag';
import { RootNavigator, resolveNotificationTarget } from '../RootNavigator';
import { useAppStore } from '../../stores/appStore';
import * as Notifications from 'expo-notifications';
import { LocalNotificationScheduler } from '../../../infrastructure/notifications/LocalNotificationScheduler';

const mockIsOnboardingComplete = isOnboardingComplete as jest.Mock;
const mockRequestPermissionsAsync = Notifications.requestPermissionsAsync as jest.Mock;
const mockLocalNotificationScheduler = LocalNotificationScheduler as jest.MockedClass<
  typeof LocalNotificationScheduler
>;

function setStore(session: object | null, householdId: string | null): void {
  useAppStore.setState({
    session: session as any,
    householdId,
    onboardingCompleted: null,
  });
}

describe('RootNavigator routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.getState().reset();
  });

  it('renders AuthNavigator when user is not logged in', () => {
    setStore(null, null);
    mockIsOnboardingComplete.mockResolvedValue(false);

    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId('auth-nav')).toBeTruthy();
  });

  it('renders CreateHouseholdNavigator when user exists but no householdId', () => {
    setStore({ user: { id: 'user-1' } }, null);
    mockIsOnboardingComplete.mockResolvedValue(false);

    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId('create-household-nav')).toBeTruthy();
  });

  it('renders MainTabNavigator when user and household exist and onboarding is complete', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(true);

    const { findByTestId } = render(<RootNavigator />);
    expect(await findByTestId('main-tab-nav')).toBeTruthy();
  });

  it('renders OnboardingNavigator when user and household exist but onboarding not complete', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(false);

    const { findByTestId } = render(<RootNavigator />);
    expect(await findByTestId('onboarding-nav')).toBeTruthy();
  });

  it('renders LoadingSplash while onboarding flag is pending', () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockReturnValue(new Promise(() => {}));

    const { getByTestId, queryByTestId } = render(<RootNavigator />);
    expect(getByTestId('loading-splash')).toBeTruthy();
    expect(queryByTestId('main-tab-nav')).toBeNull();
    expect(queryByTestId('onboarding-nav')).toBeNull();
  });

  it('renders ResetPasswordScreen when passwordRecoveryPending is set, even with a full session+household', async () => {
    // The temporary recovery session App.tsx's deep-link handler establishes
    // makes `isAuthenticated` (and even `hasHousehold`) true — the pending
    // flag must still win over the normal Main/Onboarding routing.
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(true);
    useAppStore.setState({ passwordRecoveryPending: true });

    const { getByTestId, queryByTestId } = render(<RootNavigator />);
    expect(getByTestId('reset-password-screen')).toBeTruthy();
    expect(queryByTestId('main-tab-nav')).toBeNull();
  });

  it('renders ResetPasswordScreen when passwordRecoveryPending is set even with no session at all', () => {
    setStore(null, null);
    useAppStore.setState({ passwordRecoveryPending: true });

    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId('reset-password-screen')).toBeTruthy();
  });
});

// ─── ConfirmDialogHost mounting (wave-3 item 1) ──────────────────────────────
// MainTabNavigator mounts its own `ConfirmDialogHost` (see MainTabNavigator.tsx
// — read-only, not owned here). Before Main ever renders (e.g. the
// household-creation gate, CreateHouseholdScreen's "Sign out" confirm), that
// copy doesn't exist, so RootNavigator must mount its own — but never both at
// once.
describe('RootNavigator — root-level ConfirmDialogHost mount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.getState().reset();
  });

  it('mounts the root ConfirmDialogHost at the household-creation gate (no household yet)', () => {
    setStore({ user: { id: 'user-1' } }, null);
    mockIsOnboardingComplete.mockResolvedValue(false);

    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId('root-confirm-dialog-host')).toBeTruthy();
  });

  it('mounts the root ConfirmDialogHost while signed out', () => {
    setStore(null, null);
    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId('root-confirm-dialog-host')).toBeTruthy();
  });

  it('does NOT mount a second root-level host once Main is active (avoids a double-mounted confirm dialog)', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(true);

    const { findByTestId, queryByTestId } = render(<RootNavigator />);
    expect(await findByTestId('main-tab-nav')).toBeTruthy();
    // MainTabNavigator is mocked to a plain View here (it has its own real
    // ConfirmDialogHost in production, verified by MainTabNavigator.test.tsx)
    // — the root-level one must be absent so there is only ever one.
    expect(queryByTestId('root-confirm-dialog-host')).toBeNull();
  });

  it('does NOT mount the root host while ResetPasswordScreen is showing over a full session+household (still not Main)', () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(true);
    useAppStore.setState({ passwordRecoveryPending: true });

    // ResetPassword isn't Main either, so the root host SHOULD still mount —
    // this pins that "not Main" (not just "not password-recovery") is the
    // actual condition covering every non-Main branch.
    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId('root-confirm-dialog-host')).toBeTruthy();
  });
});

// ─── UX-20: defer the OS notification permission until onboarding completes ──
describe('RootNavigator — deferred notification permission request (UX-20)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.getState().reset();
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  });

  it('does not request the OS notification permission while onboarding is incomplete', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(false);

    const { findByTestId } = render(<RootNavigator />);
    await findByTestId('onboarding-nav');

    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does not request the permission at the household-creation gate (no household yet)', async () => {
    setStore({ user: { id: 'user-1' } }, null);
    mockIsOnboardingComplete.mockResolvedValue(false);

    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId('create-household-nav')).toBeTruthy();
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('requests the permission exactly once after onboarding completes', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(true);

    const { findByTestId } = render(<RootNavigator />);
    await findByTestId('main-tab-nav');

    expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});

// ─── VAL-12: notification-tap routing ────────────────────────────────────────
describe('resolveNotificationTarget (VAL-12)', () => {
  it('maps "add_transaction" to the Transactions stack\'s AddTransaction screen', () => {
    expect(resolveNotificationTarget('add_transaction')).toEqual({
      screen: 'Main',
      params: { screen: 'Transactions', params: { screen: 'AddTransaction' } },
    });
  });

  it('maps "meters" to the Meters tab', () => {
    expect(resolveNotificationTarget('meters')).toEqual({
      screen: 'Main',
      params: { screen: 'Meters' },
    });
  });

  it('maps "dashboard" to the DashboardTab', () => {
    expect(resolveNotificationTarget('dashboard')).toEqual({
      screen: 'Main',
      params: { screen: 'DashboardTab' },
    });
  });

  it.each([undefined, null, 'unknown-target', 42])(
    'returns null for an unrecognised target %p',
    (target) => {
      expect(resolveNotificationTarget(target)).toBeNull();
    },
  );
});

describe('RootNavigator — notification-tap listener wiring (VAL-12)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.getState().reset();
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  });

  it('subscribes addNotificationResponseReceivedListener on mount and unsubscribes on unmount', () => {
    setStore(null, null);
    const { unmount } = render(<RootNavigator />);

    expect(mockAddNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
    const removeMock = mockAddNotificationResponseReceivedListener.mock.results[0].value as {
      remove: jest.Mock;
    };

    unmount();
    expect(removeMock.remove).toHaveBeenCalledTimes(1);
  });
});

// ─── VAL-12: LocalNotificationScheduler is given a hasLoggedTransactionToday
// check (backed by the real transactions table) once onboarding is complete ──
describe('RootNavigator — wires hasLoggedTransactionToday into the scheduler (VAL-12)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.getState().reset();
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  });

  it('constructs LocalNotificationScheduler with a hasLoggedTransactionToday function once Main is reached', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(true);

    const { findByTestId } = render(<RootNavigator />);
    await findByTestId('main-tab-nav');

    expect(mockLocalNotificationScheduler).toHaveBeenCalledWith(
      expect.objectContaining({ hasLoggedTransactionToday: expect.any(Function) }),
    );
  });

  it('does not construct a scheduler with the check while onboarding is incomplete (no scheduling happens yet)', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(false);

    const { findByTestId } = render(<RootNavigator />);
    await findByTestId('onboarding-nav');

    expect(mockLocalNotificationScheduler).not.toHaveBeenCalledWith(
      expect.objectContaining({ hasLoggedTransactionToday: expect.any(Function) }),
    );
  });
});
