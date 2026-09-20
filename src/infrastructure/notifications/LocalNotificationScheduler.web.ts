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
  // VAL2-1: constructor shape kept in step with the native scheduler (deps
  // unused here — there is nothing to schedule on web) so call sites don't
  // need a platform branch just to construct this class.
  constructor(
    _deps: { hasLoggedTransactionToday?: () => Promise<boolean>; now?: () => Date } = {},
  ) {}

  async scheduleEveningLogPrompt(_hour: number, _minute: number): Promise<void> {}

  async cancelEveningLogPrompt(): Promise<void> {}

  async scheduleMeterReadingReminder(_dayOfMonth: number): Promise<void> {}

  async scheduleMonthStartPreflight(_paydayDay: number): Promise<void> {}

  async fireBabyStepCelebration(_stepNumber: number): Promise<void> {}

  async cancelAll(): Promise<void> {}
}
