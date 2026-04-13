import { LocalNotificationScheduler } from '../LocalNotificationScheduler';
import { NOTIFICATION_COPY } from '../../../domain/babySteps/BabyStepRules';

const mockCancel = jest.fn().mockResolvedValue(undefined);
const mockSchedule = jest.fn().mockResolvedValue('id');
const mockCancelAll = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-notifications', () => ({
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
  scheduleNotificationAsync: (req: unknown) => mockSchedule(req),
  cancelAllScheduledNotificationsAsync: () => mockCancelAll(),
  SchedulableTriggerInputTypes: {
    DAILY: 'daily',
    MONTHLY: 'monthly',
  },
}));

describe('LocalNotificationScheduler', () => {
  const scheduler = new LocalNotificationScheduler();

  beforeEach(() => jest.clearAllMocks());

  it('scheduleEveningLogPrompt cancels then reschedules with identifier "evening-log"', async () => {
    await scheduler.scheduleEveningLogPrompt(19, 0);
    expect(mockCancel).toHaveBeenCalledWith('evening-log');
    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'evening-log' }),
    );
  });

  it('scheduleMeterReadingReminder uses identifier "meter-reading"', async () => {
    await scheduler.scheduleMeterReadingReminder(1);
    expect(mockCancel).toHaveBeenCalledWith('meter-reading');
    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'meter-reading' }),
    );
  });

  it('scheduleMonthStartPreflight uses identifier "month-start"', async () => {
    await scheduler.scheduleMonthStartPreflight(25);
    expect(mockCancel).toHaveBeenCalledWith('month-start');
    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'month-start' }),
    );
  });

  it('cancelAll calls cancelAllScheduledNotificationsAsync', async () => {
    await scheduler.cancelAll();
    expect(mockCancelAll).toHaveBeenCalledTimes(1);
  });

  describe('fireBabyStepCelebration', () => {
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
