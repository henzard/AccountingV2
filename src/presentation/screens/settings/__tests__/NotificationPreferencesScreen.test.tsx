/**
 * NotificationPreferencesScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';

const mockSave = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../../infrastructure/notifications/NotificationPreferencesRepository', () => ({
  NotificationPreferencesRepository: jest.fn().mockImplementation(() => ({
    save: (...args: unknown[]) => mockSave(...args),
  })),
}));

const mockScheduleEvening = jest.fn().mockResolvedValue(undefined);
const mockScheduleMeter = jest.fn().mockResolvedValue(undefined);
const mockScheduleMonthStart = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../../infrastructure/notifications/LocalNotificationScheduler', () => ({
  LocalNotificationScheduler: jest.fn().mockImplementation(() => ({
    scheduleEveningLogPrompt: (...args: unknown[]) => mockScheduleEvening(...args),
    scheduleMeterReadingReminder: (...args: unknown[]) => mockScheduleMeter(...args),
    scheduleMonthStartPreflight: (...args: unknown[]) => mockScheduleMonthStart(...args),
  })),
}));

const mockCancel = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-notifications', () => ({
  cancelScheduledNotificationAsync: (...args: unknown[]) => mockCancel(...args),
  setNotificationHandler: jest.fn(),
}));

const mockSetPreferences = jest.fn();
let mockPreferences = {
  eveningLogPromptEnabled: true,
  eveningLogPromptHour: 20,
  eveningLogPromptMinute: 0,
  meterReadingReminderEnabled: false,
  meterReadingReminderDay: 1,
  monthStartPreflightEnabled: false,
  envelopeWarningEnabled: false,
};
let mockPermissionsGranted = false;

jest.mock('../../../stores/notificationStore', () => ({
  useNotificationStore: jest.fn(() => ({
    preferences: mockPreferences,
    setPreferences: mockSetPreferences,
    permissionsGranted: mockPermissionsGranted,
  })),
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { paydayDay: number }) => unknown) => sel({ paydayDay: 25 })),
}));
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('Text', { testID }, children),
    Switch: ({
      value,
      onValueChange,
      testID,
    }: {
      value?: boolean;
      onValueChange?: (v: boolean) => void;
      testID?: string;
      color?: string;
    }) =>
      React.createElement('Switch', {
        testID: testID ?? 'switch',
        value,
        onValueChange,
        accessibilityValue: { text: String(value) },
      }),
    Divider: () => React.createElement('View', null),
    List: {
      Item: ({
        title,
        description,
        right,
        testID,
      }: {
        title?: string;
        description?: string;
        right?: () => React.ReactNode;
        testID?: string;
      }) =>
        React.createElement(
          'View',
          { testID: testID ?? `list-item-${title}` },
          React.createElement('Text', null, title),
          description ? React.createElement('Text', null, description) : null,
          right ? right() : null,
        ),
      Section: ({ children }: { children?: React.ReactNode }) =>
        React.createElement('View', null, children),
      Subheader: ({ children }: { children?: React.ReactNode }) =>
        React.createElement('Text', null, children),
    },
    TextInput: ({
      testID,
      label,
      value,
      onChangeText,
    }: {
      testID?: string;
      label?: string;
      value?: string;
      onChangeText?: (v: string) => void;
    }) =>
      React.createElement('TextInput', {
        testID: testID ?? label,
        value,
        onChangeText,
      }),
    Surface: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('View', { testID: testID ?? 'surface' }, children),
  };
});

import { NotificationPreferencesScreen } from '../NotificationPreferencesScreen';

describe('NotificationPreferencesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPreferences = {
      eveningLogPromptEnabled: true,
      eveningLogPromptHour: 20,
      eveningLogPromptMinute: 0,
      meterReadingReminderEnabled: false,
      meterReadingReminderDay: 1,
      monthStartPreflightEnabled: false,
      envelopeWarningEnabled: false,
    };
    mockPermissionsGranted = false;
  });

  it('renders without crashing', () => {
    const { UNSAFE_root } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows permission warning when permissions are not granted', () => {
    const { getAllByText } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(getAllByText(/Notification permissions not granted/i).length).toBeGreaterThan(0);
  });

  it('hides permission warning when permissions are granted', () => {
    mockPermissionsGranted = true;
    const { queryAllByText } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(queryAllByText(/Notification permissions not granted/i).length).toBe(0);
  });

  it('renders Evening Log Prompt section', () => {
    const { getAllByText } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(getAllByText(/Evening/i).length).toBeGreaterThan(0);
  });

  it('renders Meter Reading Reminder section', () => {
    const { getAllByText } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(getAllByText(/meter/i).length).toBeGreaterThan(0);
  });

  it('renders Budget Period section with payday day', () => {
    const { getAllByText } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(getAllByText(/Budget Period/i).length).toBeGreaterThan(0);
  });

  it('shows time inputs when evening log is enabled', () => {
    mockPreferences = { ...mockPreferences, eveningLogPromptEnabled: true };
    const { getByTestId } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(getByTestId('Hour (0-23)')).toBeTruthy();
    expect(getByTestId('Minute (0-59)')).toBeTruthy();
  });

  it('hides time inputs when evening log is disabled', () => {
    mockPreferences = { ...mockPreferences, eveningLogPromptEnabled: false };
    const { queryByTestId } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(queryByTestId('Hour (0-23)')).toBeNull();
    expect(queryByTestId('Minute (0-59)')).toBeNull();
  });

  it('shows day input when meter reading reminder is enabled', () => {
    mockPreferences = { ...mockPreferences, meterReadingReminderEnabled: true };
    const { getByTestId } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(getByTestId('Day of month (1-28)')).toBeTruthy();
  });

  it('hides day input when meter reading reminder is disabled', () => {
    mockPreferences = { ...mockPreferences, meterReadingReminderEnabled: false };
    const { queryByTestId } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(queryByTestId('Day of month (1-28)')).toBeNull();
  });

  it('renders envelope overspend warning toggle', () => {
    const { getAllByText } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(getAllByText(/overspend/i).length).toBeGreaterThan(0);
  });

  it('renders month-start pre-flight toggle', () => {
    const { getAllByText } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(getAllByText(/pre-flight/i).length).toBeGreaterThan(0);
  });

  it('calls setPreferences when evening log toggle fires', async () => {
    mockPreferences = { ...mockPreferences, eveningLogPromptEnabled: false };
    const { UNSAFE_root } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    const switches = UNSAFE_root.findAllByType('Switch');
    expect(switches.length).toBeGreaterThan(0);
    await act(async () => {
      switches[0].props.onValueChange(true);
    });
    await waitFor(() => {
      expect(mockSetPreferences).toHaveBeenCalled();
    });
  });

  it('calls repo.save when a toggle fires', async () => {
    mockPreferences = { ...mockPreferences, eveningLogPromptEnabled: true };
    const { UNSAFE_root } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    const switches = UNSAFE_root.findAllByType('Switch');
    await act(async () => {
      switches[0].props.onValueChange(false);
    });
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalled();
    });
  });

  it('cancels evening notification when toggled off with permissions', async () => {
    mockPermissionsGranted = true;
    mockPreferences = { ...mockPreferences, eveningLogPromptEnabled: true };
    const { UNSAFE_root } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    const switches = UNSAFE_root.findAllByType('Switch');
    await act(async () => {
      switches[0].props.onValueChange(false);
    });
    await waitFor(() => {
      expect(mockCancel).toHaveBeenCalledWith('evening-log');
    });
  });

  it('schedules evening notification when toggled on with permissions', async () => {
    mockPermissionsGranted = true;
    mockPreferences = { ...mockPreferences, eveningLogPromptEnabled: false };
    const { UNSAFE_root } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    const switches = UNSAFE_root.findAllByType('Switch');
    await act(async () => {
      switches[0].props.onValueChange(true);
    });
    await waitFor(() => {
      expect(mockScheduleEvening).toHaveBeenCalled();
    });
  });

  it('renders payday day in month-start description', () => {
    const { getAllByText } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(getAllByText(/day 25/i).length).toBeGreaterThan(0);
  });

  it('renders all section subheaders', () => {
    const { getAllByText } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(getAllByText(/Daily Log Prompt/i).length).toBeGreaterThan(0);
    expect(getAllByText(/Meter Reading Reminder/i).length).toBeGreaterThan(0);
    expect(getAllByText(/Budget Period/i).length).toBeGreaterThan(0);
  });
});
