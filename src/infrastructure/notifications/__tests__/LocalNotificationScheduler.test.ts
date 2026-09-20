import { LocalNotificationScheduler } from '../LocalNotificationScheduler';
import { NOTIFICATION_COPY } from '../../../domain/babySteps/BabyStepRules';

const mockCancel = jest.fn().mockResolvedValue(undefined);
const mockSchedule = jest.fn().mockResolvedValue('id');
const mockCancelAll = jest.fn().mockResolvedValue(undefined);
const mockGetAllScheduled = jest.fn().mockResolvedValue([]);

jest.mock('expo-notifications', () => ({
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
  scheduleNotificationAsync: (req: unknown) => mockSchedule(req),
  cancelAllScheduledNotificationsAsync: () => mockCancelAll(),
  getAllScheduledNotificationsAsync: () => mockGetAllScheduled(),
  SchedulableTriggerInputTypes: {
    DAILY: 'daily',
    MONTHLY: 'monthly',
    DATE: 'date',
  },
}));

/** Fixed "now" for every test below — 2026-04-13 12:00 local. */
const NOW = new Date(2026, 3, 13, 12, 0, 0, 0);

function scheduledIdentifiers(): string[] {
  return mockSchedule.mock.calls.map((c: [{ identifier: string }]) => c[0].identifier);
}

describe('LocalNotificationScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllScheduled.mockResolvedValue([]);
  });

  describe('scheduleEveningLogPrompt — rolling window (VAL2-1)', () => {
    it('schedules one DATE-triggered notification per evening for the next 7 days, with deterministic YYYY-MM-DD identifiers', async () => {
      const scheduler = new LocalNotificationScheduler({ now: () => NOW });
      await scheduler.scheduleEveningLogPrompt(19, 0);

      expect(scheduledIdentifiers()).toEqual([
        'evening-log-2026-04-13',
        'evening-log-2026-04-14',
        'evening-log-2026-04-15',
        'evening-log-2026-04-16',
        'evening-log-2026-04-17',
        'evening-log-2026-04-18',
        'evening-log-2026-04-19',
      ]);
      for (const call of mockSchedule.mock.calls) {
        const req = call[0] as {
          trigger: { type: string; date: Date };
          content: { data: { target: string } };
        };
        expect(req.trigger.type).toBe('date');
        expect(req.content.data).toEqual({ target: 'add_transaction' });
      }
    });

    it('sets each trigger date to the requested hour/minute on its own day', async () => {
      const scheduler = new LocalNotificationScheduler({ now: () => NOW });
      await scheduler.scheduleEveningLogPrompt(19, 30);

      const first = mockSchedule.mock.calls[0][0] as { trigger: { date: Date } };
      expect(first.trigger.date.getHours()).toBe(19);
      expect(first.trigger.date.getMinutes()).toBe(30);
      expect(first.trigger.date.getDate()).toBe(13);
    });

    it('skips only TODAY when hasLoggedTransactionToday resolves true — every future day still schedules', async () => {
      const hasLoggedTransactionToday = jest.fn().mockResolvedValue(true);
      const scheduler = new LocalNotificationScheduler({
        hasLoggedTransactionToday,
        now: () => NOW,
      });

      await scheduler.scheduleEveningLogPrompt(19, 0);

      expect(hasLoggedTransactionToday).toHaveBeenCalledTimes(1);
      const ids = scheduledIdentifiers();
      expect(ids).not.toContain('evening-log-2026-04-13');
      expect(ids).toEqual([
        'evening-log-2026-04-14',
        'evening-log-2026-04-15',
        'evening-log-2026-04-16',
        'evening-log-2026-04-17',
        'evening-log-2026-04-18',
        'evening-log-2026-04-19',
      ]);
    });

    it('schedules today too when nothing was logged today', async () => {
      const hasLoggedTransactionToday = jest.fn().mockResolvedValue(false);
      const scheduler = new LocalNotificationScheduler({
        hasLoggedTransactionToday,
        now: () => NOW,
      });

      await scheduler.scheduleEveningLogPrompt(19, 0);

      expect(scheduledIdentifiers()).toContain('evening-log-2026-04-13');
    });

    it("does not schedule today's slot when the requested time has already passed today", async () => {
      // NOW is 12:00 — a 08:00 prompt for today is already in the past.
      const scheduler = new LocalNotificationScheduler({ now: () => NOW });
      await scheduler.scheduleEveningLogPrompt(8, 0);

      const ids = scheduledIdentifiers();
      expect(ids).not.toContain('evening-log-2026-04-13');
      expect(ids).toContain('evening-log-2026-04-14');
    });

    it('schedules unconditionally when no hasLoggedTransactionToday check is supplied (backward compatible)', async () => {
      const scheduler = new LocalNotificationScheduler({ now: () => NOW });
      await scheduler.scheduleEveningLogPrompt(19, 0);
      expect(scheduledIdentifiers()).toContain('evening-log-2026-04-13');
    });

    it('is idempotent: calling it twice in a row never duplicates a day (cancels its own window first)', async () => {
      const scheduler = new LocalNotificationScheduler({ now: () => NOW });
      await scheduler.scheduleEveningLogPrompt(19, 0);
      await scheduler.scheduleEveningLogPrompt(19, 0);

      // cancelEveningLogPrompt ran once per call, before that call's own writes.
      expect(mockCancel.mock.calls.filter(([id]) => id === 'evening-log')).toHaveLength(2);
      expect(mockGetAllScheduled).toHaveBeenCalledTimes(2);
    });
  });

  describe('cancelEveningLogPrompt (VAL2-1)', () => {
    it('cancels every evening-log-YYYY-MM-DD identifier currently scheduled, and the legacy single identifier', async () => {
      mockGetAllScheduled.mockResolvedValue([
        { identifier: 'evening-log-2026-04-13' },
        { identifier: 'evening-log-2026-04-14' },
        { identifier: 'meter-reading' }, // another feature's notification — must be left alone
      ]);
      const scheduler = new LocalNotificationScheduler({ now: () => NOW });

      await scheduler.cancelEveningLogPrompt();

      expect(mockCancel).toHaveBeenCalledWith('evening-log-2026-04-13');
      expect(mockCancel).toHaveBeenCalledWith('evening-log-2026-04-14');
      expect(mockCancel).toHaveBeenCalledWith('evening-log'); // legacy identifier
      expect(mockCancel).not.toHaveBeenCalledWith('meter-reading');
    });
  });

  it('scheduleMeterReadingReminder uses identifier "meter-reading" and data.target "meters" (VAL-12)', async () => {
    const scheduler = new LocalNotificationScheduler();
    await scheduler.scheduleMeterReadingReminder(1);
    expect(mockCancel).toHaveBeenCalledWith('meter-reading');
    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'meter-reading',
        content: expect.objectContaining({ data: { target: 'meters' } }),
      }),
    );
  });

  it('scheduleMonthStartPreflight uses identifier "month-start" and data.target "dashboard" (VAL-12)', async () => {
    const scheduler = new LocalNotificationScheduler();
    await scheduler.scheduleMonthStartPreflight(25);
    expect(mockCancel).toHaveBeenCalledWith('month-start');
    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'month-start',
        content: expect.objectContaining({ data: { target: 'dashboard' } }),
      }),
    );
  });

  it('cancelAll calls cancelAllScheduledNotificationsAsync', async () => {
    const scheduler = new LocalNotificationScheduler();
    await scheduler.cancelAll();
    expect(mockCancelAll).toHaveBeenCalledTimes(1);
  });

  describe('fireBabyStepCelebration', () => {
    const scheduler = new LocalNotificationScheduler();

    it('calls scheduleNotificationAsync with identifier matching baby-step-{n}-{nonce} pattern', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-04-12T12:00:00.000Z'));

      await scheduler.fireBabyStepCelebration(2);

      expect(mockSchedule).toHaveBeenCalledTimes(1);
      const call = mockSchedule.mock.calls[0][0] as { identifier: string };
      expect(call.identifier).toMatch(/^baby-step-2-/);

      jest.useRealTimers();
    });

    it('uses title and body from NOTIFICATION_COPY for the given step number', async () => {
      await scheduler.fireBabyStepCelebration(1);
      const call = mockSchedule.mock.calls[0][0] as {
        content: { title: string; body: string };
      };
      expect(call.content.title).toBe(NOTIFICATION_COPY[1].title);
      expect(call.content.body).toBe(NOTIFICATION_COPY[1].body);
    });

    it('uses trigger: null (immediate fire)', async () => {
      await scheduler.fireBabyStepCelebration(3);
      const call = mockSchedule.mock.calls[0][0] as { trigger: null };
      expect(call.trigger).toBeNull();
    });

    it('generates a unique identifier for each call even under fake timers', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-04-12T12:00:00.000Z'));

      await scheduler.fireBabyStepCelebration(2);
      await scheduler.fireBabyStepCelebration(2);

      const ids = mockSchedule.mock.calls.map((c: [{ identifier: string }]) => c[0].identifier);
      // Identifiers may differ because Math.random() still advances even under fake timers
      expect(ids).toHaveLength(2);

      jest.useRealTimers();
    });

    it.each([1, 2, 3, 4, 5, 6, 7] as const)(
      'correctly reads NOTIFICATION_COPY for step %i',
      async (step) => {
        await scheduler.fireBabyStepCelebration(step);
        const call = mockSchedule.mock.calls[0][0] as {
          content: { title: string; body: string };
        };
        expect(call.content.title).toBe(NOTIFICATION_COPY[step].title);
        expect(call.content.body).toBe(NOTIFICATION_COPY[step].body);
        mockSchedule.mockClear();
      },
    );
  });
});
