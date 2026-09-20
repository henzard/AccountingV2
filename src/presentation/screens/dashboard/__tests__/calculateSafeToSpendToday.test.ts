import { calculateSafeToSpendToday } from '../calculateSafeToSpendToday';

describe('calculateSafeToSpendToday', () => {
  it('divides the remaining budget evenly over the days left', () => {
    expect(calculateSafeToSpendToday(10000, 4)).toBe(2500);
  });

  it('rounds to the nearest whole cent', () => {
    expect(calculateSafeToSpendToday(10000, 3)).toBe(3333);
  });

  it('clamps a negative remaining (over budget) to 0', () => {
    expect(calculateSafeToSpendToday(-5000, 5)).toBe(0);
  });

  it('uses a minimum divisor of 1 when daysRemaining is 0', () => {
    expect(calculateSafeToSpendToday(10000, 0)).toBe(10000);
  });

  it('uses a minimum divisor of 1 when daysRemaining is negative', () => {
    expect(calculateSafeToSpendToday(10000, -3)).toBe(10000);
  });

  it('returns 0 when remaining is 0', () => {
    expect(calculateSafeToSpendToday(0, 10)).toBe(0);
  });
});
