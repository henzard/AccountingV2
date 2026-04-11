import { LocalNotificationScheduler } from '../LocalNotificationScheduler';

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
});
