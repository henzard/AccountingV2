/**
 * RootNavigator routing guard tests.
 * Tests auth/household/onboarding guards:
 * - !isAuthenticated -> AuthNavigator
 * - !hasHousehold -> CreateHouseholdNavigator
 * - onboardingCompleted === null -> LoadingSplash
 * - !onboardingCompleted -> OnboardingNavigator
 * - All conditions met -> MainTabNavigator
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// ─── Mock child navigators ──────────────────────────────────────────────────
jest.mock('../../navigation/AuthNavigator', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { AuthNavigator: () => React.createElement(View, { testID: 'auth-nav' }) };
});

jest.mock('../../navigation/CreateHouseholdNavigator', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    CreateHouseholdNavigator: () => React.createElement(View, { testID: 'create-household-nav' }),
  };
});

jest.mock('../../navigation/MainTabNavigator', () => {
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

jest.mock('../../navigation/SlipScanningScreen', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    SlipScanningScreen: () => React.createElement(View, { testID: 'slip-scanning-screen' }),
  };
});

jest.mock('../../components/shared/LoadingSplash', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { LoadingSplash: () => React.createElement(View, { testID: 'loading-splash' }) };
});

// ─── Mock infrastructure ────────────────────────────────────────────────────
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  scheduleNotificationAsync: jest.fn(),
  cancelAllScheduledNotificationsAsync: jest.fn(),
}));

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

jest.mock('../../../infrastructure/storage/onboardingFlag', () => ({
  isOnboardingComplete: jest.fn(),
}));

jest.mock('../../stores/notificationStore', () => ({
  useNotificationStore: jest.fn(() => ({
    setPreferences: jest.fn(),
    setPermissionsGranted: jest.fn(),
  })),
}));

import { isOnboardingComplete } from '../../../infrastructure/storage/onboardingFlag';
import { RootNavigator } from '../../navigation/RootNavigator';
import { useAppStore } from '../../stores/appStore';

const mockIsOnboardingComplete = isOnboardingComplete as jest.Mock;

function setStore(session: object | null, householdId: string | null): void {
  useAppStore.setState({
    session: session as any,
    householdId,
    onboardingCompleted: null,
  });
}

describe('RootNavigator routing guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.getState().reset();
  });

  it('!isAuthenticated -> AuthNavigator', () => {
    setStore(null, null);
    mockIsOnboardingComplete.mockResolvedValue(false);
    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId('auth-nav')).toBeTruthy();
  });

  it('!hasHousehold -> CreateHouseholdNavigator', () => {
    setStore({ user: { id: 'user-1' } }, null);
    mockIsOnboardingComplete.mockResolvedValue(false);
    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId('create-household-nav')).toBeTruthy();
  });

  it('onboardingCompleted === null -> LoadingSplash', () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockReturnValue(new Promise(() => {}));
    const { getByTestId, queryByTestId } = render(<RootNavigator />);
    expect(getByTestId('loading-splash')).toBeTruthy();
    expect(queryByTestId('main-tab-nav')).toBeNull();
    expect(queryByTestId('onboarding-nav')).toBeNull();
  });

  it('!onboardingCompleted -> OnboardingNavigator', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(false);
    const { findByTestId } = render(<RootNavigator />);
    expect(await findByTestId('onboarding-nav')).toBeTruthy();
  });

  it('all conditions met -> MainTabNavigator', async () => {
    setStore({ user: { id: 'user-1' } }, 'h1');
    mockIsOnboardingComplete.mockResolvedValue(true);
    const { findByTestId } = render(<RootNavigator />);
    expect(await findByTestId('main-tab-nav')).toBeTruthy();
  });
});
