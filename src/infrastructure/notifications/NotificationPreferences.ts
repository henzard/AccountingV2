export interface NotificationPreferences {
  eveningLogPromptEnabled: boolean;
  eveningLogPromptHour: number; // 0–23 (default 19 = 7pm)
  eveningLogPromptMinute: number; // 0–59 (default 0)
  meterReadingReminderEnabled: boolean;
  meterReadingReminderDay: number; // 1–28 (default 1)
  monthStartPreflightEnabled: boolean;
  envelopeWarningEnabled: boolean;
  /** VAL2-11: "payday countdown" pull-back nudge, 3 days before period end. */
  periodClosingNudgeEnabled: boolean;
  /** VAL2-11: "weekly check-in" pull-back nudge, every Sunday. */
  weeklyCheckInNudgeEnabled: boolean;
  /**
   * VAL-6/DB-7: gates SENDING a household-activity push (transaction created,
   * envelope over budget, slip confirmed) from this device. There is no
   * server-side per-user receiving preference — `user_preferences`
   * (supabase/migrations/0001_baseline.sql) only stores `theme_preference`,
   * and notify-event/index.ts has no preference lookup — so this can only
   * gate what THIS device sends, not what a partner's device receives.
   */
  householdActivityEnabled: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  eveningLogPromptEnabled: true,
  eveningLogPromptHour: 19,
  eveningLogPromptMinute: 0,
  meterReadingReminderEnabled: true,
  meterReadingReminderDay: 1,
  monthStartPreflightEnabled: true,
  envelopeWarningEnabled: true,
  periodClosingNudgeEnabled: true,
  weeklyCheckInNudgeEnabled: true,
  householdActivityEnabled: true,
};
