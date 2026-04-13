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

// ─── Mock expo-notifications (used in RootNavigator) ─────────────────────────
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  scheduleNotificationAsync: jest.fn(),
  cancelAllScheduledNotificationsAsync: jest.fn(),
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

// ─── appStore mock — controlled per test ─────────────────────────────────────
let mockSession: object | null = null;
let mockHouseholdId: string | null = null;

jest.mock('../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) =>
    selector({
      session: mockSession,
      householdId: mockHouseholdId,
      paydayDay: 25,
    }),
  ),
}));

import { isOnboardingComplete } from '../../../infrastructure/storage/onboardingFlag';
import { RootNavigator } from '../RootNavigator';

const mockIsOnboardingComplete = isOnboardingComplete as jest.Mock;

describe('RootNavigator routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession = null;
    mockHouseholdId = null;
  });

  it('renders AuthNavigator when user is not logged in', () => {
    mockSession = null;
    mockHouseholdId = null;
    mockIsOnboardingComplete.mockResolvedValue(false);

    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId('auth-nav')).toBeTruthy();
  });

  it('renders CreateHouseholdNavigator when user exists but no householdId', () => {
    mockSession = { user: { id: 'user-1' } };
    mockHouseholdId = null;
    mockIsOnboardingComplete.mockResolvedValue(false);

    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId('create-household-nav')).toBeTruthy();
  });

  it('renders MainTabNavigator when user and household exist and onboarding is complete', async () => {
    mockSession = { user: { id: 'user-1' } };
    mockHouseholdId = 'h1';
    mockIsOnboardingComplete.mockResolvedValue(true);

    const { findByTestId } = render(<RootNavigator />);
    // Wait for onboarding flag async resolution
    expect(await findByTestId('main-tab-nav')).toBeTruthy();
  });

  it('renders OnboardingNavigator when user and household exist but onboarding not complete', async () => {
    mockSession = { user: { id: 'user-1' } };
    mockHouseholdId = 'h1';
    mockIsOnboardingComplete.mockResolvedValue(false);

    const { findByTestId } = render(<RootNavigator />);
    expect(await findByTestId('onboarding-nav')).toBeTruthy();
  });
});
