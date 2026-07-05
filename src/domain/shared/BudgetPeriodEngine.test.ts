import { BudgetPeriodEngine, formatPeriodDateKey } from './BudgetPeriodEngine';
import type { BudgetPeriod } from './types';

describe('BudgetPeriodEngine', () => {
  const engine = new BudgetPeriodEngine();

  describe('getCurrentPeriod with payday=20', () => {
    it('returns correct period when today is before payday', () => {
      // Today is 15 April → period is 20 Mar – 19 Apr
      const period = engine.getCurrentPeriod(20, new Date('2026-04-15'));
      expect(period.startDate).toEqual(new Date('2026-03-20'));
      expect(period.endDate).toEqual(new Date('2026-04-19'));
    });

    it('returns correct period when today IS payday', () => {
      // Today is 20 April → new period starts: 20 Apr – 19 May
      const period = engine.getCurrentPeriod(20, new Date('2026-04-20'));
      expect(period.startDate).toEqual(new Date('2026-04-20'));
      expect(period.endDate).toEqual(new Date('2026-05-19'));
    });

    it('returns correct period when today is after payday', () => {
      // Today is 25 April → period is 20 Apr – 19 May
      const period = engine.getCurrentPeriod(20, new Date('2026-04-25'));
      expect(period.startDate).toEqual(new Date('2026-04-20'));
      expect(period.endDate).toEqual(new Date('2026-05-19'));
    });

    it('handles month boundary: payday 20, today 19 Dec', () => {
      // Today is 19 Dec → period is 20 Nov – 19 Dec
      const period = engine.getCurrentPeriod(20, new Date('2026-12-19'));
      expect(period.startDate).toEqual(new Date('2026-11-20'));
      expect(period.endDate).toEqual(new Date('2026-12-19'));
    });

    it('generates human-readable label', () => {
      const period = engine.getCurrentPeriod(20, new Date('2026-04-15'));
      expect(period.label).toBe('20 Mar – 19 Apr');
    });
  });

  describe('getCurrentPeriod with payday=31 (short-month overflow, M13)', () => {
    it('clamps to 28 Feb in a non-leap year (2026) instead of overflowing to 3 Mar', () => {
      // Today is 1 Mar 2026 → previous month (Feb, 28 days, non-leap) has no
      // 31st, so the period must start on 28 Feb, not overflow to 3 Mar.
      const period = engine.getCurrentPeriod(31, new Date('2026-03-01'));
      expect(period.startDate).toEqual(new Date('2026-02-28'));
      expect(period.endDate).toEqual(new Date('2026-03-30'));
    });

    it('clamps to 29 Feb in a leap year (2024)', () => {
      const period = engine.getCurrentPeriod(31, new Date('2024-03-01'));
      expect(period.startDate).toEqual(new Date('2024-02-29'));
      expect(period.endDate).toEqual(new Date('2024-03-30'));
    });

    it('clamps to 30 in a 30-day month (April)', () => {
      // Today is 1 Apr 2026 → previous month is March (31 days, no clamp),
      // so the period starts 31 Mar; April only has 30 days so the period
      // must end 29 Apr (one day before April's clamped "31st" = 30th).
      const period = engine.getCurrentPeriod(31, new Date('2026-04-01'));
      expect(period.startDate).toEqual(new Date('2026-03-31'));
      expect(period.endDate).toEqual(new Date('2026-04-29'));
    });

    it('does not clamp in a real 31-day month (no regression)', () => {
      const period = engine.getCurrentPeriod(31, new Date('2026-01-31'));
      expect(period.startDate).toEqual(new Date('2026-01-31'));
      expect(period.endDate).toEqual(new Date('2026-02-27'));
    });

    it('the boundary after a short-month clamp still starts exactly when the prior one ended + 1 day', () => {
      // Period ending 30 Apr (clamped from a nominal "31st") is immediately
      // followed by a period starting 30 Apr (April's own clamped payday) —
      // no gap, no overlap.
      const aprilPeriod = engine.getCurrentPeriod(31, new Date('2026-04-01'));
      const mayPeriod = engine.getCurrentPeriod(31, new Date('2026-04-30'));
      expect(mayPeriod.startDate).toEqual(new Date('2026-04-30'));
      expect(aprilPeriod.endDate.getTime()).toBe(mayPeriod.startDate.getTime() - 86400000);
    });

    it('isNewPeriodWithin fires correctly for a clamped short-month period start', () => {
      // Regression for the audit's concrete failure: previously this
      // returned false (daysSinceStart went negative) because the period
      // start overflowed into the future.
      expect(engine.isNewPeriodWithin(31, 2, new Date('2026-03-01'))).toBe(true);
    });
  });

  describe('formatPeriodDateKey (L7 tz-consistent period key)', () => {
    it('formats a UTC-midnight period boundary using its UTC calendar fields, not local ones', () => {
      // The exact instant getPeriodForDate builds for payday=25 in June 2026.
      const startDate = new Date(Date.UTC(2026, 5, 25));
      expect(formatPeriodDateKey(startDate)).toBe('2026-06-25');
    });

    it('does not shift a day even when the host TZ offset would move the local calendar date', () => {
      // Regression for the audit's concrete failure mode: on a UTC-negative
      // host, date-fns `format(date, 'yyyy-MM-dd')` reads LOCAL fields and
      // would render this UTC midnight instant as the day before. Reading
      // UTC fields directly must always agree with how the engine built the
      // date, regardless of the test runner's local TZ.
      const midnightUtc = new Date(Date.UTC(2026, 0, 1)); // 2026-01-01T00:00:00Z
      expect(formatPeriodDateKey(midnightUtc)).toBe('2026-01-01');
      expect(midnightUtc.getUTCDate()).toBe(1);
    });

    it('pads single-digit month/day with a leading zero', () => {
      const date = new Date(Date.UTC(2026, 2, 5)); // 5 Mar 2026
      expect(formatPeriodDateKey(date)).toBe('2026-03-05');
    });

    it("matches the engine's own period.startDate for a real getCurrentPeriod call", () => {
      const period = engine.getCurrentPeriod(25, new Date('2026-06-30'));
      expect(formatPeriodDateKey(period.startDate)).toBe('2026-06-25');
    });
  });

  describe('isDateInPeriod', () => {
    it('returns true for date within period', () => {
      const period: BudgetPeriod = {
        startDate: new Date('2026-03-20'),
        endDate: new Date('2026-04-19'),
        label: '20 Mar – 19 Apr',
      };
      expect(engine.isDateInPeriod(new Date('2026-04-01'), period)).toBe(true);
    });

    it('returns false for date outside period', () => {
      const period: BudgetPeriod = {
        startDate: new Date('2026-03-20'),
        endDate: new Date('2026-04-19'),
        label: '20 Mar – 19 Apr',
      };
      expect(engine.isDateInPeriod(new Date('2026-04-20'), period)).toBe(false);
    });
  });
});
