import { RamseyScoreCalculator } from '../RamseyScoreCalculator';

describe('RamseyScoreCalculator', () => {
  const calc = new RamseyScoreCalculator();

  it('returns 100 for perfect inputs', () => {
    const result = calc.calculate({
      loggingDaysCount: 30,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 5,
      totalEnvelopes: 5,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.score).toBe(100);
    expect(result.loggingPoints).toBe(30);
    expect(result.disciplinePoints).toBe(30);
    expect(result.metersPoints).toBe(20);
    expect(result.babyStepPoints).toBe(20);
  });

  it('returns 0 for all-zero inputs', () => {
    const result = calc.calculate({
      loggingDaysCount: 0,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 0,
      totalEnvelopes: 5,
      meterReadingsLoggedThisPeriod: false,
      babyStepIsActive: false,
    });
    expect(result.score).toBe(0);
  });

  it('calculates logging points proportionally', () => {
    const result = calc.calculate({
      loggingDaysCount: 15,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 5,
      totalEnvelopes: 5,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.loggingPoints).toBe(15); // 50% of 30
    expect(result.score).toBe(85);
  });

  it('calculates discipline points proportionally', () => {
    const result = calc.calculate({
      loggingDaysCount: 30,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 2,
      totalEnvelopes: 4,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.disciplinePoints).toBe(15); // 50% of 30
    expect(result.score).toBe(85);
  });

  it('awards full discipline points when no envelopes exist', () => {
    const result = calc.calculate({
      loggingDaysCount: 30,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 0,
      totalEnvelopes: 0,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.disciplinePoints).toBe(30);
  });

  it('does not exceed 100', () => {
    const result = calc.calculate({
      loggingDaysCount: 100,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 10,
      totalEnvelopes: 5,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
