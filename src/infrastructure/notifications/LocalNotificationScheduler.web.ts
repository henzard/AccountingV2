/**
 * Web variant of LocalNotificationScheduler (Metro resolves `.web.ts` first on
 * the web platform).
 *
 * `expo-notifications` scheduling APIs are not available in the browser —
 * calling e.g. `Notifications.cancelAllScheduledNotificationsAsync()` throws
 * "not available on web". Local reminder notifications simply don't exist in
 * the web build, so every method here is a no-op with the same signature as
 * the native class. Native builds keep using LocalNotificationScheduler.ts.
 */
export class LocalNotificationScheduler {
  async scheduleEveningLogPrompt(_hour: number, _minute: number): Promise<void> {}

  async scheduleMeterReadingReminder(_dayOfMonth: number): Promise<void> {}

  async scheduleMonthStartPreflight(_paydayDay: number): Promise<void> {}

  async fireBabyStepCelebration(_stepNumber: number): Promise<void> {}

  async cancelAll(): Promise<void> {}
}
