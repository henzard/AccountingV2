import { resolvePeriodHabitScoreInput } from '../resolvePeriodHabitScoreInput';

jest.mock('../resolveLoggingDays', () => ({
  resolveLoggingDays: jest.fn(),
}));
jest.mock('../../shared/resolveBabyStepIsActive', () => ({
  resolveBabyStepIsActive: jest.fn(),
}));
jest.mock('../../../presentation/screens/dashboard/resolveMeterReadingsLogged', () => ({
  resolveMeterReadingsLogged: jest.fn(),
}));

import { resolveLoggingDays } from '../resolveLoggingDays';
import { resolveBabyStepIsActive } from '../../shared/resolveBabyStepIsActive';
import { resolveMeterReadingsLogged } from '../../../presentation/screens/dashboard/resolveMeterReadingsLogged';

describe('resolvePeriodHabitScoreInput', () => {
  const db = {} as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (resolveLoggingDays as jest.Mock).mockResolvedValue(10);
    (resolveMeterReadingsLogged as jest.Mock).mockResolvedValue(true);
    (resolveBabyStepIsActive as jest.Mock).mockResolvedValue(false);
  });

  it('loads the three async signals and assembles them with the given envelopes', async () => {
    const result = await resolvePeriodHabitScoreInput(db, 'hh-1', '2026-06-01', '2026-06-30', [
      { spentCents: 100, allocatedCents: 200 },
      { spentCents: 300, allocatedCents: 100 },
    ]);

    expect(resolveLoggingDays).toHaveBeenCalledWith(db, 'hh-1', '2026-06-01', '2026-06-30');
    expect(resolveMeterReadingsLogged).toHaveBeenCalledWith(db, 'hh-1', '2026-06-01', '2026-06-30');
    expect(resolveBabyStepIsActive).toHaveBeenCalledWith(db, 'hh-1');

    expect(result).toEqual({
      loggingDaysCount: 10,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 1,
      totalEnvelopes: 2,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: false,
    });
  });

  it('computes totalDaysInPeriod inclusively (a single-day period is 1 day)', async () => {
    const result = await resolvePeriodHabitScoreInput(db, 'hh-1', '2026-06-01', '2026-06-01', []);
    expect(result.totalDaysInPeriod).toBe(1);
  });
});
