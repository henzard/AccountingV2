import * as Notifications from 'expo-notifications';
import { NOTIFICATION_COPY } from '../../domain/babySteps/BabyStepRules';

export class LocalNotificationScheduler {
  async scheduleEveningLogPrompt(hour: number, minute: number): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync('evening-log').catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: 'evening-log',
      content: {
        title: 'Did you spend anything today?',
        body: 'Takes 10 seconds. Tap to log.',
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
  }

  async scheduleMeterReadingReminder(dayOfMonth: number): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync('meter-reading').catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: 'meter-reading',
      content: {
        title: 'Time to log your meter readings',
        body: 'Record electricity, water, and odometer readings.',
        sound: true,
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
        body: 'Pre-flight checklist ready — 5 questions, 4 minutes.',
        sound: true,
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
