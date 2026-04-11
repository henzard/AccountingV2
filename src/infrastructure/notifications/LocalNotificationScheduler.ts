import * as Notifications from 'expo-notifications';

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

  async cancelAll(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }
}
