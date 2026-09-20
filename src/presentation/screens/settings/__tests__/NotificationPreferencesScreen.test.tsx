/**
 * NotificationPreferencesScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, waitFor, act, fireEvent } from '@testing-library/react-native';

// Mock specific modules before importing the component
jest.mock('react-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const mockOpenSettings = jest.fn();
  return {
    View: ({ children, style, testID }: any) =>
      React.createElement('View', { style, testID }, children),
    ScrollView: ({ children, style, contentContainerStyle }: any) =>
      React.createElement('View', { style: [style, contentContainerStyle] }, children),
    StyleSheet: {
      create: (styles: any) => styles,
      flatten: (style: any) => {
        if (Array.isArray(style)) {
          return style.reduce((acc, s) => ({ ...acc, ...s }), {});
        }
        return style || {};
      },
    },
    Linking: {
      openSettings: mockOpenSettings,
    },
    Platform: {
      OS: 'ios',
    },
  };
});

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

// Mirrors the real zustand store: setPreferences actually updates the
// backing state so getState().preferences (used by the L10 fix) reflects
// what a real store would after each commit.
const mockSetPreferences = jest.fn((updated: typeof mockPreferences) => {
  mockPreferences = updated;
});
let mockPreferences = {
  eveningLogPromptEnabled: true,
  eveningLogPromptHour: 20,
  eveningLogPromptMinute: 0,
  meterReadingReminderEnabled: false,
  meterReadingReminderDay: 1,
  monthStartPreflightEnabled: false,
};
let mockPermissionsGranted = false;

jest.mock('../../../stores/notificationStore', () => {
  const fn = jest.fn(() => ({
    preferences: mockPreferences,
    setPreferences: mockSetPreferences,
    permissionsGranted: mockPermissionsGranted,
  })) as jest.Mock & { getState?: () => { preferences: typeof mockPreferences } };
  // getState() must reflect the LATEST mockPreferences too (L10 fix reads
  // fresh state via getState() instead of the hook's render-time snapshot).
  fn.getState = () => ({ preferences: mockPreferences });
  return { useNotificationStore: fn };
});
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
      disabled,
    }: {
      value?: boolean;
      onValueChange?: (v: boolean) => void;
      testID?: string;
      color?: string;
      disabled?: boolean;
    }) =>
      React.createElement('Switch', {
        testID: testID ?? 'switch',
        value,
        onValueChange,
        disabled,
        accessibilityValue: { text: String(value) },
      }),
    Button: ({
      onPress,
      testID,
      children,
    }: {
      onPress?: () => void;
      testID?: string;
      children?: React.ReactNode;
    }) =>
      React.createElement(
        'Pressable',
        { onPress, testID },
        React.createElement('Text', null, children),
      ),
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
      onBlur,
    }: {
      testID?: string;
      label?: string;
      value?: string;
      onChangeText?: (v: string) => void;
      onBlur?: () => void;
    }) =>
      React.createElement('TextInput', {
        testID: testID ?? label,
        value,
        onChangeText,
        onBlur,
      }),
    HelperText: ({
      children,
      visible,
      testID,
    }: {
      children?: React.ReactNode;
      visible?: boolean;
      testID?: string;
    }) =>
      visible
        ? React.createElement('Text', { testID }, children)
        : React.createElement('View', null),
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
    expect(getByTestId('evening-hour-input')).toBeTruthy();
    expect(getByTestId('evening-minute-input')).toBeTruthy();
  });

  it('hides time inputs when evening log is disabled', () => {
    mockPreferences = { ...mockPreferences, eveningLogPromptEnabled: false };
    const { queryByTestId } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(queryByTestId('evening-hour-input')).toBeNull();
    expect(queryByTestId('evening-minute-input')).toBeNull();
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

  it('renders payday reminder toggle', () => {
    const { getAllByText } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(getAllByText(/Payday reminder/i).length).toBeGreaterThan(0);
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

  it('renders Payday reminder label', () => {
    const { getAllByText } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(getAllByText(/Payday reminder/i).length).toBeGreaterThan(0);
  });

  it('renders all section subheaders', () => {
    const { getAllByText } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(getAllByText(/Daily Log Prompt/i).length).toBeGreaterThan(0);
    expect(getAllByText(/Meter Reading Reminder/i).length).toBeGreaterThan(0);
    expect(getAllByText(/Budget Period/i).length).toBeGreaterThan(0);
    expect(getAllByText(/Household Activity/i).length).toBeGreaterThan(0);
  });

  // VAL-6/DB-7 — sending-side gate for household-activity pushes.
  describe('Household activity toggle', () => {
    it('renders the household activity toggle', () => {
      const { getAllByText } = render(
        <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
      );
      expect(getAllByText(/Household activity/i).length).toBeGreaterThan(0);
    });

    it('calls setPreferences and repo.save when the household activity toggle fires', async () => {
      mockPreferences = { ...mockPreferences, householdActivityEnabled: true } as never;
      const { UNSAFE_root } = render(
        <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
      );
      const switches = UNSAFE_root.findAllByType('Switch');
      const householdActivitySwitch = switches[switches.length - 1];
      await act(async () => {
        householdActivitySwitch.props.onValueChange(false);
      });
      await waitFor(() => {
        expect(mockSetPreferences).toHaveBeenCalledWith(
          expect.objectContaining({ householdActivityEnabled: false }),
        );
        expect(mockSave).toHaveBeenCalledWith(
          expect.objectContaining({ householdActivityEnabled: false }),
        );
      });
    });
  });

  // UX2-15a — Open settings button for notification permission
  describe('UX2-15a — permission banner with Open settings button', () => {
    it('renders Open settings button when permission not granted and Platform.OS !== web', () => {
      const { getByTestId } = render(
        <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
      );
      expect(getByTestId('open-notification-settings')).toBeTruthy();
    });

    it('renders Open settings button that presses without error', () => {
      const { getByTestId } = render(
        <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
      );
      const button = getByTestId('open-notification-settings');
      expect(button).toBeTruthy();
      // Button press should not throw; the actual behavior is tested in platform-specific tests
      fireEvent.press(button);
    });

    it('does not render Open settings button when Platform.OS is web', () => {
      // Modify the mocked Platform.OS to be 'web'
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const platform = require('react-native').Platform;
      const originalOS = platform.OS;
      platform.OS = 'web';
      try {
        const { queryByTestId } = render(
          <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
        );
        expect(queryByTestId('open-notification-settings')).toBeNull();
      } finally {
        platform.OS = originalOS;
      }
    });
  });

  // UX2-15b — Payday reminder label
  describe('UX2-15b — Payday reminder label', () => {
    it('renders "Payday reminder" instead of "Month-start pre-flight"', () => {
      const { getAllByText, queryAllByText } = render(
        <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
      );
      expect(getAllByText(/Payday reminder/i).length).toBeGreaterThan(0);
      expect(queryAllByText(/Month-start pre-flight/i).length).toBe(0);
    });

    it('renders the correct description for payday reminder', () => {
      const { getAllByText } = render(
        <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
      );
      expect(
        getAllByText(/A nudge on payday to set up the month's budget/i).length,
      ).toBeGreaterThan(0);
    });
  });

  // UX2-15c — Locally-controlled time inputs with validation
  describe('UX2-15c — locally-controlled time inputs', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('allows clearing the hour field without saving or crashing', async () => {
      mockPreferences = { ...mockPreferences, eveningLogPromptEnabled: true };
      const { getByTestId } = render(
        <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
      );

      const hourInput = getByTestId('evening-hour-input');
      act(() => {
        fireEvent.changeText(hourInput, '');
      });
      act(() => {
        hourInput.props.onBlur();
      });
      await act(async () => {
        jest.advanceTimersByTime(700);
      });

      expect(mockSave).not.toHaveBeenCalled();
    });

    it('shows error and does not save when hour is 25', async () => {
      mockPreferences = { ...mockPreferences, eveningLogPromptEnabled: true };
      const { getByTestId, queryByTestId } = render(
        <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
      );

      const hourInput = getByTestId('evening-hour-input');
      act(() => {
        fireEvent.changeText(hourInput, '25');
      });
      act(() => {
        hourInput.props.onBlur();
      });

      expect(getByTestId('hour-error')).toBeTruthy();
      expect(getByTestId('hour-error')).toHaveTextContent(/Enter an hour from 0 to 23/);
      expect(queryByTestId('time-preview')).toBeNull();
      await act(async () => {
        jest.advanceTimersByTime(700);
      });
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('saves and previews 07:05 when hour is 7 and minute is 5', async () => {
      mockPreferences = {
        ...mockPreferences,
        eveningLogPromptEnabled: true,
        eveningLogPromptHour: 20,
        eveningLogPromptMinute: 0,
      };
      const { getByTestId } = render(
        <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
      );

      const hourInput = getByTestId('evening-hour-input');
      const minuteInput = getByTestId('evening-minute-input');

      act(() => {
        fireEvent.changeText(hourInput, '7');
      });
      act(() => {
        hourInput.props.onBlur();
      });
      act(() => {
        jest.advanceTimersByTime(700);
      });

      act(() => {
        fireEvent.changeText(minuteInput, '5');
      });
      act(() => {
        minuteInput.props.onBlur();
      });
      await act(async () => {
        jest.advanceTimersByTime(700);
      });

      expect(getByTestId('time-preview')).toHaveTextContent(/Reminder at 07:05/);
      const lastSaved = mockSave.mock.calls[mockSave.mock.calls.length - 1][0];
      expect(lastSaved).toMatchObject({
        eveningLogPromptHour: 7,
        eveningLogPromptMinute: 5,
      });
    });

    it('shows error and does not save when minute is 60', async () => {
      mockPreferences = { ...mockPreferences, eveningLogPromptEnabled: true };
      const { getByTestId } = render(
        <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
      );

      const minuteInput = getByTestId('evening-minute-input');
      act(() => {
        fireEvent.changeText(minuteInput, '60');
      });
      act(() => {
        minuteInput.props.onBlur();
      });

      expect(getByTestId('minute-error')).toBeTruthy();
      expect(getByTestId('minute-error')).toHaveTextContent(/Enter minutes from 0 to 59/);
      await act(async () => {
        jest.advanceTimersByTime(700);
      });
      expect(mockSave).not.toHaveBeenCalled();
    });
  });
});
