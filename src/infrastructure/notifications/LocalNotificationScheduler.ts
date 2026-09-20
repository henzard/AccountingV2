import * as Notifications from 'expo-notifications';
import { addDays, format } from 'date-fns';
import { NOTIFICATION_COPY } from '../../domain/babySteps/BabyStepRules';

/** Deterministic per-day identifier prefix — see `scheduleEveningLogPrompt`. */
const EVENING_LOG_PREFIX = 'evening-log-';
/** The legacy single recurring-DAILY identifier this replaces (VAL2-1). */
const LEGACY_EVENING_LOG_IDENTIFIER = 'evening-log';
/** How many evenings ahead stay scheduled at once. */
const EVENING_LOG_WINDOW_DAYS = 7;

export class LocalNotificationScheduler {
  /**
   * VAL2-1 (replaces the earlier VAL-12 fix, which this closes a real gap
   * in): the OLD `scheduleEveningLogPrompt` scheduled ONE recurring
   * OS-level DAILY alarm (identifier `evening-log`) and, when
   * `hasLoggedTransactionToday` was true, CANCELLED that alarm outright and
   * returned WITHOUT rescheduling anything. Because this method only ever
   * ran from RootNavigator's auth/household effect, logging a transaction
   * once (e.g. first thing in the morning) killed the reminder for EVERY
   * later day, forever, until a cold start happened to land on a day with
   * nothing logged yet.
   *
   * Fixed by dropping the single recurring alarm for a ROLLING WINDOW of
   * one-off DATE-triggered notifications, one per evening for the next
   * `EVENING_LOG_WINDOW_DAYS` days, each with a deterministic identifier
   * (`evening-log-YYYY-MM-DD`). `hasLoggedTransactionToday` can only ever
   * skip TODAY's slot (future days haven't happened yet, so there's nothing
   * to check them against) — every other day in the window is always
   * (re)scheduled. The method is fully idempotent: it cancels only its own
   * previously-scheduled identifiers (see `cancelEveningLogPrompt`) before
   * writing a fresh window, so calling it repeatedly — from RootNavigator's
   * effect, on `AppState` becoming 'active', and after a transaction save
   * (see `rearmEveningLogPrompt` in RootNavigator.tsx) — never duplicates a
   * day or leaves a stale one behind.
   */
  constructor(
    private readonly deps: {
      hasLoggedTransactionToday?: () => Promise<boolean>;
      /** Injectable clock for tests; defaults to `new Date()`. */
      now?: () => Date;
    } = {},
  ) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  async scheduleEveningLogPrompt(hour: number, minute: number): Promise<void> {
    // Idempotent re-arm: clear our own previously-scheduled window first so
    // a repeated call never duplicates a day.
    await this.cancelEveningLogPrompt();

    const alreadyLoggedToday = this.deps.hasLoggedTransactionToday
      ? await this.deps.hasLoggedTransactionToday()
      : false;
    const today = this.now();

    for (let offset = 0; offset < EVENING_LOG_WINDOW_DAYS; offset += 1) {
      // Only TODAY can be skipped — future days haven't been logged yet.
      if (offset === 0 && alreadyLoggedToday) continue;

      const day = addDays(today, offset);
      const triggerDate = new Date(day);
      triggerDate.setHours(hour, minute, 0, 0);
      // Never schedule a time that's already passed (e.g. re-arming at 8pm
      // for a 7pm prompt on the same day).
      if (triggerDate.getTime() <= today.getTime()) continue;

      await Notifications.scheduleNotificationAsync({
        identifier: `${EVENING_LOG_PREFIX}${format(day, 'yyyy-MM-dd')}`,
        content: {
          title: 'Did you spend anything today?',
          body: 'Takes 10 seconds. Tap to log.',
          sound: true,
          data: { target: 'add_transaction' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: triggerDate,
        },
      });
    }
  }

  /**
   * Cancels every evening-log occurrence this scheduler owns — the whole
   * rolling window (`evening-log-YYYY-MM-DD`) plus the legacy single
   * recurring identifier from before VAL2-1, for anyone upgrading who still
   * has it scheduled. Never touches another feature's notifications.
   */
  async cancelEveningLogPrompt(): Promise<void> {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(
      () => [] as Notifications.NotificationRequest[],
    );
    const ours = scheduled.filter((n) => n.identifier.startsWith(EVENING_LOG_PREFIX));
    await Promise.all(
      ours.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})),
    );
    await Notifications.cancelScheduledNotificationAsync(LEGACY_EVENING_LOG_IDENTIFIER).catch(
      () => {},
    );
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
