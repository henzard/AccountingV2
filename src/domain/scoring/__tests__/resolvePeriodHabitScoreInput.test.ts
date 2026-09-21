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
jest.mock('../resolveMetersApplicable', () => ({
  resolveMetersApplicable: jest.fn(),
}));

import { resolveLoggingDays } from '../resolveLoggingDays';
import { resolveBabyStepIsActive } from '../../shared/resolveBabyStepIsActive';
import { resolveMeterReadingsLogged } from '../../../presentation/screens/dashboard/resolveMeterReadingsLogged';
import { resolveMetersApplicable } from '../resolveMetersApplicable';

describe('resolvePeriodHabitScoreInput', () => {
  const db = {} as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (resolveLoggingDays as jest.Mock).mockResolvedValue(10);
    (resolveMeterReadingsLogged as jest.Mock).mockResolvedValue(true);
    (resolveBabyStepIsActive as jest.Mock).mockResolvedValue(false);
    (resolveMetersApplicable as jest.Mock).mockResolvedValue(true);
  });

  it('loads the four async signals and assembles them with the given envelopes', async () => {
    const result = await resolvePeriodHabitScoreInput(db, 'hh-1', '2026-06-01', '2026-06-30', [
      { spentCents: 100, allocatedCents: 200 },
      { spentCents: 300, allocatedCents: 100 },
    ]);

    expect(resolveLoggingDays).toHaveBeenCalledWith(db, 'hh-1', '2026-06-01', '2026-06-30');
    expect(resolveMeterReadingsLogged).toHaveBeenCalledWith(db, 'hh-1', '2026-06-01', '2026-06-30');
    expect(resolveBabyStepIsActive).toHaveBeenCalledWith(db, 'hh-1');
    // Applicability is asked about the period's END, not its range — see
    // `resolveMetersApplicable` for why "ever, by then" is the question.
    expect(resolveMetersApplicable).toHaveBeenCalledWith(db, 'hh-1', '2026-06-30');

    expect(result).toEqual({
      loggingDaysCount: 10,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 1,
      totalEnvelopes: 2,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: false,
      metersApplicable: true,
    });
  });

  it('passes a never-used-meters household through as NOT applicable', async () => {
    (resolveMetersApplicable as jest.Mock).mockResolvedValue(false);

    const result = await resolvePeriodHabitScoreInput(db, 'hh-1', '2026-06-01', '2026-06-30', []);

    expect(result.metersApplicable).toBe(false);
  });

  it('computes totalDaysInPeriod inclusively (a single-day period is 1 day)', async () => {
    const result = await resolvePeriodHabitScoreInput(db, 'hh-1', '2026-06-01', '2026-06-01', []);
    expect(result.totalDaysInPeriod).toBe(1);
  });
});
