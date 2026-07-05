/**
 * NotificationPreferencesScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, waitFor, act, fireEvent } from '@testing-library/react-native';

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
  envelopeWarningEnabled: false,
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

  // L9 — envelopeWarningEnabled had no scheduler/notify-event path reading
  // it, so the toggle was a decorative no-op. Fixed by disabling the
  // control and being honest about it in the description, rather than
  // leaving a fake "this does something" control.
  it('disables the envelope overspend warning switch and labels it as not yet wired', () => {
    const { getByTestId, getAllByText } = render(
      <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
    );
    expect(getByTestId('envelope-warning-switch').props.disabled).toBe(true);
    expect(getAllByText(/coming soon/i).length).toBeGreaterThan(0);
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

  // L10 — a single shared debounce timer meant editing hour then minute
  // within 600ms cleared hour's pending callback before it fired, silently
  // dropping the hour edit. Fixed with per-field timers + merging against
  // the freshest store state (getState()) instead of a stale render-time
  // closure (which would otherwise let the later field's save clobber the
  // earlier field's already-persisted value back to its old value).
  describe('L10 — per-field debounce', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('persists both the hour and minute edits when both change within the debounce window', async () => {
      mockPreferences = {
        ...mockPreferences,
        eveningLogPromptEnabled: true,
        eveningLogPromptHour: 19,
        eveningLogPromptMinute: 0,
      };
      const { getByTestId } = render(
        <NotificationPreferencesScreen route={{} as never} navigation={{} as never} />,
      );

      act(() => {
        fireEvent.changeText(getByTestId('Hour (0-23)'), '20');
      });
      act(() => {
        jest.advanceTimersByTime(200);
      });
      act(() => {
        fireEvent.changeText(getByTestId('Minute (0-59)'), '30');
      });
      await act(async () => {
        jest.advanceTimersByTime(700);
      });

      expect(mockSave).toHaveBeenCalled();
      const lastSaved = mockSave.mock.calls[mockSave.mock.calls.length - 1][0];
      expect(lastSaved).toMatchObject({
        eveningLogPromptHour: 20,
        eveningLogPromptMinute: 30,
      });
    });
  });
});
