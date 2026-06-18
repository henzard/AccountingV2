import { useNotificationStore } from '../notificationStore';

describe('notificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({
      preferences: {
        eveningLogPromptEnabled: true,
        eveningLogPromptHour: 19,
        eveningLogPromptMinute: 0,
        meterReadingReminderEnabled: true,
        meterReadingReminderDay: 1,
        monthStartPreflightEnabled: true,
        envelopeWarningEnabled: true,
      },
      permissionsGranted: false,
    });
  });

  it('has default preferences', () => {
    const { preferences } = useNotificationStore.getState();
    expect(preferences).toBeDefined();
  });

  it('sets preferences', () => {
    useNotificationStore.getState().setPreferences({
      eveningLogPromptEnabled: false,
      eveningLogPromptHour: 20,
      eveningLogPromptMinute: 30,
      meterReadingReminderEnabled: false,
      meterReadingReminderDay: 15,
      monthStartPreflightEnabled: false,
      envelopeWarningEnabled: false,
    });
    const { preferences } = useNotificationStore.getState();
    expect(preferences.eveningLogPromptEnabled).toBe(false);
    expect(preferences.eveningLogPromptHour).toBe(20);
  });

  it('sets permissions granted', () => {
    useNotificationStore.getState().setPermissionsGranted(true);
    expect(useNotificationStore.getState().permissionsGranted).toBe(true);
  });

  it('defaults permissionsGranted to false', () => {
    expect(useNotificationStore.getState().permissionsGranted).toBe(false);
  });
});
