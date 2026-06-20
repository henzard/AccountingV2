import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from '../NotificationPreferences';

describe('NotificationPreferences', () => {
  describe('DEFAULT_NOTIFICATION_PREFERENCES', () => {
    it('has eveningLogPromptEnabled set to true', () => {
      expect(DEFAULT_NOTIFICATION_PREFERENCES.eveningLogPromptEnabled).toBe(true);
    });

    it('has eveningLogPromptHour default to 19 (7pm)', () => {
      expect(DEFAULT_NOTIFICATION_PREFERENCES.eveningLogPromptHour).toBe(19);
    });

    it('has eveningLogPromptMinute default to 0', () => {
      expect(DEFAULT_NOTIFICATION_PREFERENCES.eveningLogPromptMinute).toBe(0);
    });

    it('has meterReadingReminderEnabled set to true', () => {
      expect(DEFAULT_NOTIFICATION_PREFERENCES.meterReadingReminderEnabled).toBe(true);
    });

    it('has meterReadingReminderDay default to 1', () => {
      expect(DEFAULT_NOTIFICATION_PREFERENCES.meterReadingReminderDay).toBe(1);
    });

    it('has monthStartPreflightEnabled set to true', () => {
      expect(DEFAULT_NOTIFICATION_PREFERENCES.monthStartPreflightEnabled).toBe(true);
    });

    it('has envelopeWarningEnabled set to true', () => {
      expect(DEFAULT_NOTIFICATION_PREFERENCES.envelopeWarningEnabled).toBe(true);
    });

    it('satisfies NotificationPreferences interface shape', () => {
      const prefs: NotificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES;
      const expectedKeys = [
        'eveningLogPromptEnabled',
        'eveningLogPromptHour',
        'eveningLogPromptMinute',
        'meterReadingReminderEnabled',
        'meterReadingReminderDay',
        'monthStartPreflightEnabled',
        'envelopeWarningEnabled',
      ];
      expect(Object.keys(prefs).sort()).toEqual(expectedKeys.sort());
    });
  });
});
