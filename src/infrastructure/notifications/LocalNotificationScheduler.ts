import * as Notifications from 'expo-notifications';
import { NOTIFICATION_COPY } from '../../domain/babySteps/BabyStepRules';

export class LocalNotificationScheduler {
  /**
   * VAL-12: `deps.hasLoggedTransactionToday`, when supplied, is a cheap
   * caller-provided check ("does a transaction with today's date already
   * exist for this household?"). `scheduleEveningLogPrompt` uses it to skip
   * (re)scheduling — cancelling today's occurrence instead — when the user
   * has already logged something today, since the prompt only exists to
   * remind them to do that. This scheduler has no DB access of its own, so
   * the check is injected; RootNavigator supplies it (it has `db` and the
   * current `householdId`) each time it (re)initialises notifications.
   *
   * Caveat: this is a check-at-(re)schedule-time mitigation, not a live
   * daily one — `evening-log`'s trigger is a recurring OS-level DAILY alarm,
   * so a transaction logged AFTER this method last ran (and before the OS
   * fires that day's already-scheduled notification) will still see the
   * prompt fire once more, until the next time this runs (e.g. next app
   * foreground) cancels it. Closing that gap needs a background task, which
   * is out of scope here.
   */
  constructor(private readonly deps: { hasLoggedTransactionToday?: () => Promise<boolean> } = {}) {}

  async scheduleEveningLogPrompt(hour: number, minute: number): Promise<void> {
    if (this.deps.hasLoggedTransactionToday && (await this.deps.hasLoggedTransactionToday())) {
      await this.cancelEveningLogPrompt();
      return;
    }
    await Notifications.cancelScheduledNotificationAsync('evening-log').catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: 'evening-log',
      content: {
        title: 'Did you spend anything today?',
        body: 'Takes 10 seconds. Tap to log.',
        sound: true,
        data: { target: 'add_transaction' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
  }

  /** Cancels today's (and every future) evening-log occurrence — see the constructor doc above. */
  async cancelEveningLogPrompt(): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync('evening-log').catch(() => {});
  }

  async scheduleMeterReadingReminder(dayOfMonth: number): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync('meter-reading').catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: 'meter-reading',
      content: {
        title: 'Time to log your meter readings',
        body: 'Record electricity, water, and odometer readings.',
        sound: true,
        data: { target: 'meters' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
        day: dayOfMonth,
        hour: 8,
        minute: 0,
      },
    });
  }

  async scheduleMonthStartPreflight(paydayDay: number): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync('month-start').catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: 'month-start',
      content: {
        title: 'Payday! Fill your envelopes.',
        body: "Payday! Open the app to set up this month's budget.",
        sound: true,
        data: { target: 'dashboard' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
        day: paydayDay,
        hour: 7,
        minute: 0,
      },
    });
  }

  /**
   * Fire an immediate notification as a Baby Step celebration preview signal.
   *
   * Identifier is unique per call — guaranteed under fake timers via nonce.
   * Title/body are sourced from BabyStepRules.NOTIFICATION_COPY (single SoT).
   * Trigger is null (fires immediately).
   *
   * IMPORTANT: This method writes NO domain state. celebrated_at is stamped only
   * by StampCelebratedUseCase, called from modal dismiss. Spec §Notification infrastructure.
   */
  async fireBabyStepCelebration(stepNumber: number): Promise<void> {
    const nonce = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const identifier = `baby-step-${stepNumber}-${nonce}`;
    const copy = NOTIFICATION_COPY[stepNumber as keyof typeof NOTIFICATION_COPY];

    if (!copy) {
      throw new Error(`fireBabyStepCelebration: invalid step number ${stepNumber}`);
    }

    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: copy.title,
        body: copy.body,
        sound: true,
      },
      trigger: null,
    });
  }

  async cancelAll(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }
}
