import { HabitScoreCalculator } from '../RamseyScoreCalculator';
import { LevelAdvancementEvaluator } from '../LevelAdvancementEvaluator';
import { resolveLoggingDays } from '../resolveLoggingDays';
import { resolveBabyStepIsActive } from '../../shared/resolveBabyStepIsActive';

// ---------------------------------------------------------------------------
// HabitScoreCalculator (alias: RamseyScoreCalculator)
// ---------------------------------------------------------------------------

describe('HabitScoreCalculator', () => {
  const calc = new HabitScoreCalculator();

  it('returns perfect 100 when all categories maxed', () => {
    const result = calc.calculate({
      loggingDaysCount: 30,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 10,
      totalEnvelopes: 10,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.score).toBe(100);
    expect(result.loggingPoints).toBe(30);
    expect(result.disciplinePoints).toBe(30);
    expect(result.metersPoints).toBe(20);
    expect(result.babyStepPoints).toBe(20);
  });

  it('returns 0 for zero activity (no meters, no steps, no logging, all over-budget)', () => {
    const result = calc.calculate({
      loggingDaysCount: 0,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 0,
      totalEnvelopes: 10,
      meterReadingsLoggedThisPeriod: false,
      babyStepIsActive: false,
    });
    expect(result.score).toBe(0);
    expect(result.loggingPoints).toBe(0);
    expect(result.disciplinePoints).toBe(0);
    expect(result.metersPoints).toBe(0);
    expect(result.babyStepPoints).toBe(0);
  });

  it('handles zero denominators gracefully (totalDaysInPeriod=0)', () => {
    const result = calc.calculate({
      loggingDaysCount: 5,
      totalDaysInPeriod: 0,
      envelopesOnBudget: 0,
      totalEnvelopes: 0,
      meterReadingsLoggedThisPeriod: false,
      babyStepIsActive: false,
    });
    expect(result.loggingPoints).toBe(0);
    expect(result.disciplinePoints).toBe(30);
  });

  it('awards full discipline when totalEnvelopes is 0', () => {
    const result = calc.calculate({
      loggingDaysCount: 0,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 0,
      totalEnvelopes: 0,
      meterReadingsLoggedThisPeriod: false,
      babyStepIsActive: false,
    });
    expect(result.disciplinePoints).toBe(30);
  });

  it('calculates partial score correctly', () => {
    const result = calc.calculate({
      loggingDaysCount: 15,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 3,
      totalEnvelopes: 6,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: false,
    });
    expect(result.loggingPoints).toBe(15);
    expect(result.disciplinePoints).toBe(15);
    expect(result.metersPoints).toBe(20);
    expect(result.babyStepPoints).toBe(0);
    expect(result.score).toBe(50);
  });

  it('caps individual components at their max', () => {
    const result = calc.calculate({
      loggingDaysCount: 60,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 20,
      totalEnvelopes: 10,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.loggingPoints).toBeLessThanOrEqual(30);
    expect(result.disciplinePoints).toBeLessThanOrEqual(30);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// LevelAdvancementEvaluator
// ---------------------------------------------------------------------------

describe('LevelAdvancementEvaluator', () => {
  const evaluator = new LevelAdvancementEvaluator();

  it('advances to level 2 when last 3 scores all >= 70', () => {
    const result = evaluator.evaluate([60, 70, 75, 80]);
    expect(result.shouldAdvanceToLevel2).toBe(true);
  });

  it('stays at level 1 when one of last 3 is < 70', () => {
    const result = evaluator.evaluate([60, 69, 75, 80]);
    expect(result.shouldAdvanceToLevel2).toBe(false);
  });

  it('does not advance with fewer than 3 scores', () => {
    const result = evaluator.evaluate([80, 90]);
    expect(result.shouldAdvanceToLevel2).toBe(false);
  });

  it('shows coaching warning when last 2 both < 60', () => {
    const result = evaluator.evaluate([80, 55, 40]);
    expect(result.shouldShowCoachingWarning).toBe(true);
  });

  it('no coaching warning when only 1 of last 2 < 60', () => {
    const result = evaluator.evaluate([80, 55, 65]);
    expect(result.shouldShowCoachingWarning).toBe(false);
  });

  it('empty scores → no advance, no warning', () => {
    const result = evaluator.evaluate([]);
    expect(result.shouldAdvanceToLevel2).toBe(false);
    expect(result.shouldShowCoachingWarning).toBe(false);
  });

  it('exactly threshold (70, 70, 70) → advances', () => {
    const result = evaluator.evaluate([70, 70, 70]);
    expect(result.shouldAdvanceToLevel2).toBe(true);
  });

  it('exactly warning threshold (59, 59) → shows warning', () => {
    const result = evaluator.evaluate([59, 59]);
    expect(result.shouldShowCoachingWarning).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveLoggingDays
// ---------------------------------------------------------------------------

describe('resolveLoggingDays', () => {
  function mockDb(count: number) {
    return {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ count }]),
        }),
      }),
    };
  }

  it('count=5 → returns 5', async () => {
    const db = mockDb(5);
    const result = await resolveLoggingDays(db as any, 'hh-1', '2026-04-01', '2026-04-30');
    expect(result).toBe(5);
  });

  it('count=0 → returns 0', async () => {
    const db = mockDb(0);
    const result = await resolveLoggingDays(db as any, 'hh-1', '2026-04-01', '2026-04-30');
    expect(result).toBe(0);
  });

  it('null row → returns 0', async () => {
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      }),
    };
    const result = await resolveLoggingDays(db as any, 'hh-1', '2026-04-01', '2026-04-30');
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveBabyStepIsActive
// ---------------------------------------------------------------------------

describe('resolveBabyStepIsActive', () => {
  function mockDb(rows: Record<string, unknown>[]) {
    const whereFn = jest.fn().mockResolvedValue(rows);
    const fromFn = jest.fn().mockReturnValue({ where: whereFn });
    const selectFn = jest.fn().mockReturnValue({ from: fromFn });
    return { select: selectFn };
  }

  it('rows present → returns true', async () => {
    const db = mockDb([{ id: 'bs-1', stepNumber: 1, isCompleted: true }]);
    const result = await resolveBabyStepIsActive(db as any, 'hh-1');
    expect(result).toBe(true);
  });

  it('empty rows → returns false', async () => {
    const db = mockDb([]);
    const result = await resolveBabyStepIsActive(db as any, 'hh-1');
    expect(result).toBe(false);
  });

  it('multiple completed steps → returns true', async () => {
    const db = mockDb([
      { id: 'bs-1', stepNumber: 1, isCompleted: true },
      { id: 'bs-2', stepNumber: 2, isCompleted: true },
    ]);
    const result = await resolveBabyStepIsActive(db as any, 'hh-1');
    expect(result).toBe(true);
  });
});
