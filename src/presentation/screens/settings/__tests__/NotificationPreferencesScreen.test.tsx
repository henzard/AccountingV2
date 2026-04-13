/**
 * NotificationPreferencesScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../../../../infrastructure/notifications/NotificationPreferencesRepository', () => ({
  NotificationPreferencesRepository: jest.fn().mockImplementation(() => ({
    save: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('../../../../infrastructure/notifications/LocalNotificationScheduler', () => ({
  LocalNotificationScheduler: jest.fn().mockImplementation(() => ({
    scheduleEveningLogPrompt: jest.fn().mockResolvedValue(undefined),
    scheduleMeterReadingReminder: jest.fn().mockResolvedValue(undefined),
    scheduleMonthStartPreflight: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('expo-notifications', () => ({
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationHandler: jest.fn(),
}));
jest.mock('../../../stores/notificationStore', () => ({
  useNotificationStore: jest.fn(() => ({
    preferences: {
      eveningLogPromptEnabled: true,
      eveningLogPromptHour: 20,
      eveningLogPromptMinute: 0,
      meterReadingReminderEnabled: false,
      meterReadingReminderDay: 1,
      monthStartPreflightEnabled: false,
    },
    setPreferences: jest.fn(),
    permissionsGranted: false,
  })),
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { paydayDay: number }) => unknown) => sel({ paydayDay: 25 })),
}));
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
    Switch: ({ value, testID }: { value?: boolean; testID?: string }) =>
      React.createElement('View', {
        testID: testID ?? 'switch',
        accessibilityValue: { text: String(value) },
      }),
    Divider: () => React.createElement('View', null),
    List: {
      Item: ({ title }: { title?: string }) => React.createElement('Text', null, title),
      Section: ({ children }: { children?: React.ReactNode }) =>
        React.createElement('View', null, children),
      Subheader: ({ children }: { children?: React.ReactNode }) =>
        React.createElement('Text', null, children),
    },
    TextInput: ({ testID, label }: { testID?: string; label?: string }) =>
      React.createElement('TextInput', { testID: testID ?? label }),
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
  };
});

import { NotificationPreferencesScreen } from '../NotificationPreferencesScreen';

describe('NotificationPreferencesScreen', () => {
  it('renders without crashing', () => {
    const { UNSAFE_root } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders Evening Log Prompt toggle label', () => {
    const { getAllByText } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    // The screen has "Evening Log Prompt" as a label
    expect(getAllByText(/Evening/i).length).toBeGreaterThan(0);
  });
});
