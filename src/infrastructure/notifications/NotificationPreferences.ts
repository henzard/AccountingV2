export interface NotificationPreferences {
  eveningLogPromptEnabled: boolean;
  eveningLogPromptHour: number; // 0–23 (default 19 = 7pm)
  eveningLogPromptMinute: number; // 0–59 (default 0)
  meterReadingReminderEnabled: boolean;
  meterReadingReminderDay: number; // 1–28 (default 1)
  monthStartPreflightEnabled: boolean;
  envelopeWarningEnabled: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  eveningLogPromptEnabled: true,
  eveningLogPromptHour: 19,
  eveningLogPromptMinute: 0,
  meterReadingReminderEnabled: true,
  meterReadingReminderDay: 1,
  monthStartPreflightEnabled: true,
  envelopeWarningEnabled: true,
};
