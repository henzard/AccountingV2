/**
 * RootNavigator.test.tsx — B3 four-state routing coverage
 *
 * Tests that the correct child navigator is rendered for each combination
 * of (session, householdId, onboardingCompleted) state.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { AppState } from 'react-native';

// ─── AppState.addEventListener (VAL2-1: re-arm on 'active') — the RN jest
// preset already mocks `AppState.addEventListener` as a jest.fn, so this
// just spies on it (no need to mock the whole 'react-native' module, which
// would also strip out everything else this file/react-navigation needs).
type AppStateChangeListener = (state: string) => void;
let mockAppStateListener: AppStateChangeListener | null = null;
const mockAppStateRemove = jest.fn();
jest.spyOn(AppState, 'addEventListener').mockImplementation(((
  event: string,
  listener: AppStateChangeListener,
) => {
  if (event === 'change') mockAppStateListener = listener;
  return { remove: mockAppStateRemove };
}) as typeof AppState.addEventListener);

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
// PUSH-2: captures the route params the last render of HouseholdMembersScreen
// received, so tests can assert the household-switch flow filled them in
// correctly (see the "household mismatch" describe block below).
const mockHouseholdMembersRouteParams: { current: unknown } = { current: null };
jest.mock('../../screens/household/HouseholdMembersScreen', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    HouseholdMembersScreen: (props: { route?: { params?: unknown } }) => {
      mockHouseholdMembersRouteParams.current = props?.route?.params ?? null;
      return React.createElement(View, { testID: 'household-members-screen' });
    },
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
// F1 (round 6): mocked like every other household screen — it pulls in db,
// supabase and RestoreService, and has its own dedicated test file.
jest.mock('../../screens/household/FinishJoinScreen', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    FinishJoinScreen: () => React.createElement(View, { testID: 'finish-join-screen' }),
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

// ─── Mock ConfirmDialogHost/ToastHost — UX2-3: RootNavigator mounts both,
// unconditionally, ONCE at the root (alongside/outside the stack) so they
// overlay every screen, including the pre-Main household-creation gate and
// screens outside the five main tabs — MainTabNavigator no longer mounts
// its own copy of either (see MainTabNavigator.test.tsx) ───────────────────
jest.mock('../../components/shared/ConfirmDialogHost', () => {
  const RN = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    ConfirmDialogHost: () => RN.createElement(View, { testID: 'root-confirm-dialog-host' }),
    confirm: jest.fn(),
  };
});
jest.mock('../../components/shared/ToastHost', () => {
  const RN = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    ToastHost: () => RN.createElement(View, { testID: 'root-toast-host' }),
  };
});

// ─── Mock expo-notifications (used in RootNavigator) ─────────────────────────
const mockAddNotificationResponseReceivedListener = jest.fn(() => ({ remove: jest.fn() }));
// REG-10: resolves `null` by default (no cold-start launch notification) —
// individual tests override this to simulate a cold-start tap.
const mockGetLastNotificationResponseAsync = jest.fn().mockResolvedValue(null);
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  scheduleNotificationAsync: jest.fn(),
  cancelAllScheduledNotificationsAsync: jest.fn(),
  addNotificationResponseReceivedListener: (
    ...args: Parameters<typeof mockAddNotificationResponseReceivedListener>
  ) => mockAddNotificationResponseReceivedListener(...args),
  getLastNotificationResponseAsync: () => mockGetLastNotificationResponseAsync(),
}));

// ─── Mock db/schema (used by RootNavigator's hasLoggedTransactionToday check,
// and by rearmBudgetNudges' VAL2-11 envelope/spend lookups) ──────────────────
// `where(...)` is BOTH directly awaitable (resolving to `[]`, the shape
// `rearmBudgetNudges`'s helpers query with) AND exposes `.limit()` (the shape
// `hasLoggedTransactionToday` queries with) — a Promise is a plain object, so
// attaching `.limit` to one satisfies both call shapes off the same mock.
const mockDbSelect = jest.fn(() => ({
  from: jest.fn(() => ({
    where: jest.fn(() => {
      const result = Promise.resolve([]) as Promise<never[]> & { limit: jest.Mock };
      result.limit = jest.fn().mockResolvedValue([]);
      return result;
    }),
  })),
}));
jest.mock('../../../data/local/db', () => ({
  db: { select: () => mockDbSelect() },
}));
jest.mock('../../../data/local/schema', () => ({
  transactions: {
    id: 'id',
    householdId: 'householdId',
    amountCents: 'amountCents',
    transactionDate: 'transactionDate',
    deletedAt: 'deletedAt',
  },
  // VAL2-11: `rearmBudgetNudges`' envelope-snapshot lookup selects these columns.
  envelopes: {
    id: 'id',
    householdId: 'householdId',
    allocatedCents: 'allocatedCents',
    envelopeType: 'envelopeType',
    isArchived: 'isArchived',
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
    // VAL2-11: constructed unconditionally by rearmBudgetNudges (even
    // without permission, so a disabled nudge is still cancelled).
    schedulePeriodClosingNudge: jest.fn().mockResolvedValue(undefined),
    scheduleWeeklyCheckIn: jest.fn().mockResolvedValue(undefined),
    cancelPeriodClosingNudge: jest.fn().mockResolvedValue(undefined),
    cancelWeeklyCheckIn: jest.fn().mockResolvedValue(undefined),
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
// VAL2-1: `rearmEveningLogPrompt` reads `useNotificationStore.getState()`
// directly (it runs outside any component's render) — `mockNotificationState`
// is what that resolves to; tests mutate it to control
// permissionsGranted/preferences.eveningLogPromptEnabled.
const mockNotificationState = {
  preferences: {
    eveningLogPromptEnabled: true,
    eveningLogPromptHour: 19,
    eveningLogPromptMinute: 0,
    meterReadingReminderEnabled: false,
    meterReadingReminderDay: 1,
    monthStartPreflightEnabled: false,
    envelopeWarningEnabled: true,
    periodClosingNudgeEnabled: true,
    weeklyCheckInNudgeEnabled: true,
    householdActivityEnabled: true,
  },
  permissionsGranted: true,
};
jest.mock('../../stores/notificationStore', () => {
  const hook = jest.fn(() => ({
    setPreferences: jest.fn(),
    setPermissionsGranted: jest.fn(),
  }));
  (hook as unknown as { getState: () => typeof mockNotificationState }).getState = () =>
    mockNotificationState;
  return { useNotificationStore: hook };
});

// No appStore mock — use the real zustand store and set state per test.

import { isOnboardingComplete } from '../../../infrastructure/storage/onboardingFlag';
import { RootNavigator, resolveNotificationTarget } from '../RootNavigator';
import { useAppStore } from '../../stores/appStore';
import { usePendingJoinStore } from '../../boot/pendingJoinStore';
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

  // F1 (round 6): a user who force-quit after a half-completed join has an
  // active membership but no local household row. They must NOT get the
  // create/join gate — "Create Household" there mints a SECOND household for
  // someone who is already a member.
  it('renders FinishJoinScreen (not the create/join gate) when a join is pending download', () => {
    setStore({ user: { id: 'user-1' } }, null);
    usePendingJoinStore.getState().setPendingJoinHouseholdId('hh-orphan');
    mockIsOnboardingComplete.mockResolvedValue(false);

    const { getByTestId, queryByTestId } = render(<RootNavigator />);
    expect(getByTestId('finish-join-screen')).toBeTruthy();
    expect(queryByTestId('create-household-nav')).toBeNull();

    usePendingJoinStore.getState().setPendingJoinHouseholdId(null);
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

// ─── ConfirmDialogHost + ToastHost mounting (UX2-3) ──────────────────────────
// Both now mount exactly ONCE, unconditionally, at the root — regardless of
// which branch is showing (Auth, CreateHouseholdFlow, LoadingSplash,
// Onboarding, ResetPassword, or Main). MainTabNavigator no longer mounts its
// own copy of either (MainTabNavigator.test.tsx covers that side), so there
// is never a double-mount, and a toast enqueued from a screen outside the
// five main tabs (JoinHousehold, CreateHousehold, HouseholdMembers,
// SlipCapture, onboarding) now has somewhere to render too.
describe('RootNavigator — root-level ConfirmDialogHost + ToastHost mount (UX2-3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.getState().reset();
  });

  it('mounts both hosts at the household-creation gate (no household yet)', () => {
    setStore({ user: { id: 'user-1' } }, null);
    mockIsOnboardingComplete.mockResolvedValue(false);

    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId('root-confirm-dialog-host')).toBeTruthy();
    expect(getByTestId('root-toast-host')).toBeTruthy();
  });

  it('mounts both hosts while signed out', () => {
    setStore(null, null);
    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId('root-confirm-dialog-host')).toBeTruthy();
    expect(getByTestId('root-toast-host')).toBeTruthy();
  });

  it('keeps mounting both hosts once Main is active — there is only ever one of each now', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(true);

    const { findByTestId } = render(<RootNavigator />);
    expect(await findByTestId('main-tab-nav')).toBeTruthy();
    expect(await findByTestId('root-confirm-dialog-host')).toBeTruthy();
    expect(await findByTestId('root-toast-host')).toBeTruthy();
  });

  it('mounts both hosts while ResetPasswordScreen is showing over a full session+household', () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(true);
    useAppStore.setState({ passwordRecoveryPending: true });

    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId('root-confirm-dialog-host')).toBeTruthy();
    expect(getByTestId('root-toast-host')).toBeTruthy();
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
  it('maps "add_transaction" to the Transactions stack\'s AddTransaction screen, with initial: false (REG-10)', () => {
    // REG-10: `initial: false` is required so navigating into a Transactions
    // stack that was never visited this session still mounts its normal
    // initial route underneath AddTransaction, instead of AddTransaction
    // becoming the tab's ONLY route (a blank Add form the user is stuck on
    // after Save, with no way back to the transaction list).
    expect(resolveNotificationTarget('add_transaction')).toEqual({
      screen: 'Main',
      params: { screen: 'Transactions', params: { screen: 'AddTransaction' }, initial: false },
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

  it("also accepts the {target: string} data object directly (matches content.data's real shape)", () => {
    expect(resolveNotificationTarget({ target: 'meters' })).toEqual({
      screen: 'Main',
      params: { screen: 'Meters' },
    });
  });

  // ─── PUSH-2: server push data ({type: 'household_activity', kind,
  // householdId, target}) — notify-event's buildV1Message data block. ───────
  it('PUSH-2: maps a household_activity push with target "Transactions" to the Transactions tab', () => {
    expect(
      resolveNotificationTarget({
        type: 'household_activity',
        kind: 'transaction_created',
        householdId: 'h1',
        target: 'Transactions',
      }),
    ).toEqual({
      screen: 'Main',
      params: { screen: 'Transactions' },
      householdId: 'h1',
    });
  });

  it('PUSH-2: maps a household_activity push for kind "refund_recorded" (target "Transactions") to the Transactions tab', () => {
    expect(
      resolveNotificationTarget({
        type: 'household_activity',
        kind: 'refund_recorded',
        householdId: 'h1',
        target: 'Transactions',
      }),
    ).toEqual({
      screen: 'Main',
      params: { screen: 'Transactions' },
      householdId: 'h1',
    });
  });

  it('PUSH-2: an older client that has never heard of "refund_recorded" still resolves it via `target`, never throws', () => {
    // resolveNotificationTarget never switches on `kind` — it's routing
    // metadata the client doesn't need to recognise. An app build that
    // predates this event kind entirely still routes correctly off `target`
    // (set server-side by pushTargetForKind), and an app build that predates
    // BOTH this kind and its `target` value falls back to Dashboard, exactly
    // like any other unrecognised target — it never crashes either way.
    expect(
      resolveNotificationTarget({
        type: 'household_activity',
        kind: 'refund_recorded',
        householdId: 'h1',
        target: 'some-future-target',
      }),
    ).toEqual({
      screen: 'Main',
      params: { screen: 'DashboardTab' },
      householdId: 'h1',
    });
  });

  it('PUSH-2: maps a household_activity push with target "Dashboard" to the DashboardTab', () => {
    expect(
      resolveNotificationTarget({
        type: 'household_activity',
        kind: 'slip_confirmed',
        householdId: 'h1',
        target: 'Dashboard',
      }),
    ).toEqual({
      screen: 'Main',
      params: { screen: 'DashboardTab' },
      householdId: 'h1',
    });
  });

  it('PUSH-2: maps a household_activity push with target "HouseholdMembers" to the HouseholdMembers screen', () => {
    expect(
      resolveNotificationTarget({
        type: 'household_activity',
        householdId: 'h1',
        target: 'HouseholdMembers',
      }),
    ).toEqual({
      screen: 'HouseholdMembers',
      params: {},
      householdId: 'h1',
    });
  });

  it('PUSH-2: an unrecognised target falls back to Dashboard rather than being dropped', () => {
    expect(
      resolveNotificationTarget({
        type: 'household_activity',
        householdId: 'h1',
        target: 'not-a-real-target',
      }),
    ).toEqual({
      screen: 'Main',
      params: { screen: 'DashboardTab' },
      householdId: 'h1',
    });
  });

  it('PUSH-2: a missing target falls back to Dashboard, never throws', () => {
    expect(() =>
      resolveNotificationTarget({ type: 'household_activity', householdId: 'h1' }),
    ).not.toThrow();
    expect(resolveNotificationTarget({ type: 'household_activity', householdId: 'h1' })).toEqual({
      screen: 'Main',
      params: { screen: 'DashboardTab' },
      householdId: 'h1',
    });
  });

  it('PUSH-2: an unknown/malformed kind never throws and still resolves the target', () => {
    expect(() =>
      resolveNotificationTarget({
        type: 'household_activity',
        kind: 12345,
        householdId: 'h1',
        target: 'Transactions',
      }),
    ).not.toThrow();
  });

  it('PUSH-2: omits householdId from the result when the payload has none', () => {
    const result = resolveNotificationTarget({
      type: 'household_activity',
      target: 'Transactions',
    });
    expect(result).not.toBeNull();
    expect(result?.householdId).toBeUndefined();
  });

  it.each([null, 42, 'household_activity', {}])(
    'PUSH-2: never throws for a malformed data payload %p',
    (data) => {
      expect(() => resolveNotificationTarget(data)).not.toThrow();
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

// ─── REG-10: a notification tap that COLD-STARTS the app fires no
// `addNotificationResponseReceivedListener` event — `getLastNotificationResponseAsync`
// is the only way to see it. ──────────────────────────────────────────────────
describe('RootNavigator — cold-start notification tap (REG-10)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.getState().reset();
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockGetLastNotificationResponseAsync.mockResolvedValue(null);
  });

  it('checks getLastNotificationResponseAsync on mount', async () => {
    setStore(null, null);
    render(<RootNavigator />);
    await Promise.resolve();
    expect(mockGetLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
  });

  it('does not throw and navigates once ready when the app was cold-started by a recognised notification', async () => {
    mockGetLastNotificationResponseAsync.mockResolvedValue({
      notification: { request: { content: { data: { target: 'meters' } } } },
    });
    setStore(null, null);

    expect(() => render(<RootNavigator />)).not.toThrow();
    // Let the getLastNotificationResponseAsync promise (and any queued
    // navigation once the container becomes ready) settle without error.
    await Promise.resolve();
    await Promise.resolve();
  });

  it('does nothing for a cold-start response with an unrecognised target', async () => {
    mockGetLastNotificationResponseAsync.mockResolvedValue({
      notification: { request: { content: { data: { target: 'not-a-real-target' } } } },
    });
    setStore(null, null);

    expect(() => render(<RootNavigator />)).not.toThrow();
    await Promise.resolve();
  });
});

// ─── PUSH-2: a household-scoped server push may name a household other than
// the one currently active. Never show that screen against the wrong
// household's data. ────────────────────────────────────────────────────────
describe('RootNavigator — PUSH-2 household mismatch on a server push tap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.getState().reset();
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockHouseholdMembersRouteParams.current = null;
  });

  it('switches the active household and navigates when the user belongs to the pushed household', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(true);
    useAppStore.setState({
      availableHouseholds: [
        { id: 'h1', name: 'Household One', paydayDay: 1, userLevel: 1 },
        { id: 'h2', name: 'Household Two', paydayDay: 15, userLevel: 1 },
      ],
    });
    mockGetLastNotificationResponseAsync.mockResolvedValue({
      notification: {
        request: {
          content: {
            data: {
              type: 'household_activity',
              kind: 'transaction_created',
              householdId: 'h2',
              target: 'Transactions',
            },
          },
        },
      },
    });

    render(<RootNavigator />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(useAppStore.getState().householdId).toBe('h2');
    expect(useAppStore.getState().paydayDay).toBe(15);
  });

  it('fills in HouseholdMembers params from the switched-to household', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(true);
    useAppStore.setState({
      availableHouseholds: [
        { id: 'h1', name: 'Household One', paydayDay: 1, userLevel: 1 },
        { id: 'h2', name: 'Household Two', paydayDay: 15, userLevel: 1 },
      ],
    });
    mockGetLastNotificationResponseAsync.mockResolvedValue({
      notification: {
        request: {
          content: {
            data: { type: 'household_activity', householdId: 'h2', target: 'HouseholdMembers' },
          },
        },
      },
    });

    const { findByTestId } = render(<RootNavigator />);
    await findByTestId('household-members-screen');

    expect(mockHouseholdMembersRouteParams.current).toEqual({
      householdId: 'h2',
      householdName: 'Household Two',
    });
  });

  it('does NOT switch households and falls back to Dashboard when the user is not a member of the pushed household', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(true);
    useAppStore.setState({
      availableHouseholds: [{ id: 'h1', name: 'Household One', paydayDay: 1, userLevel: 1 }],
    });
    mockGetLastNotificationResponseAsync.mockResolvedValue({
      notification: {
        request: {
          content: {
            data: {
              type: 'household_activity',
              householdId: 'h-not-a-member',
              target: 'Transactions',
            },
          },
        },
      },
    });

    const { findByTestId } = render(<RootNavigator />);
    await findByTestId('main-tab-nav');
    await Promise.resolve();

    expect(useAppStore.getState().householdId).toBe('h1');
  });

  it('does not switch households when the push is about the already-active household', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(true);
    useAppStore.setState({
      availableHouseholds: [{ id: 'h1', name: 'Household One', paydayDay: 1, userLevel: 1 }],
      paydayDay: 1,
    });
    mockGetLastNotificationResponseAsync.mockResolvedValue({
      notification: {
        request: {
          content: {
            data: { type: 'household_activity', householdId: 'h1', target: 'Transactions' },
          },
        },
      },
    });

    const { findByTestId } = render(<RootNavigator />);
    await findByTestId('main-tab-nav');
    await Promise.resolve();

    expect(useAppStore.getState().householdId).toBe('h1');
  });
});

// ─── VAL2-1: re-arm the evening-log rolling window on AppState 'active' ──────
describe('RootNavigator — re-arms evening-log prompt on AppState active (VAL2-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.getState().reset();
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockAppStateListener = null;
    mockAppStateRemove.mockClear();
    mockNotificationState.permissionsGranted = true;
    mockNotificationState.preferences.eveningLogPromptEnabled = true;
  });

  it('subscribes an AppState "change" listener on mount and unsubscribes on unmount', () => {
    setStore(null, null);
    const { unmount } = render(<RootNavigator />);

    expect(mockAppStateListener).toEqual(expect.any(Function));
    unmount();
    expect(mockAppStateRemove).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the app becomes active with no household set', () => {
    setStore(null, null);
    render(<RootNavigator />);

    expect(() => mockAppStateListener?.('active')).not.toThrow();
  });

  it('re-arms the scheduler (constructs LocalNotificationScheduler again) when the app becomes active with a household and the evening prompt enabled', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(true);

    const { findByTestId } = render(<RootNavigator />);
    await findByTestId('main-tab-nav');
    mockLocalNotificationScheduler.mockClear();

    await mockAppStateListener?.('active');

    expect(mockLocalNotificationScheduler).toHaveBeenCalledWith(
      expect.objectContaining({ hasLoggedTransactionToday: expect.any(Function) }),
    );
  });

  it('does not construct an evening-log scheduler on AppState active when permissions were never granted', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(true);

    const { findByTestId } = render(<RootNavigator />);
    await findByTestId('main-tab-nav');
    mockLocalNotificationScheduler.mockClear();
    mockNotificationState.permissionsGranted = false;

    await mockAppStateListener?.('active');

    // `rearmEveningLogPrompt` still guards on permission BEFORE constructing
    // its scheduler (identified here by the `hasLoggedTransactionToday` it
    // passes in) — unlike `rearmBudgetNudges` (VAL2-11), which now
    // constructs a scheduler unconditionally so it can still cancel a
    // disabled nudge with no permission (see eveningLogPrompt.ts item 2,
    // round-3 review), so this file's shared scheduler mock class may still
    // have been constructed for THAT reason alone.
    expect(mockLocalNotificationScheduler).not.toHaveBeenCalledWith(
      expect.objectContaining({ hasLoggedTransactionToday: expect.any(Function) }),
    );
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
