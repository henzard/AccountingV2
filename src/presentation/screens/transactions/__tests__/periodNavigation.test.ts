import { BudgetPeriodEngine } from '../../../../domain/shared/BudgetPeriodEngine';
import { getPreviousPeriod, getNextPeriod, isCurrentOrFuturePeriod } from '../periodNavigation';

const engine = new BudgetPeriodEngine();

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

describe('periodNavigation', () => {
  describe('getNextPeriod / getPreviousPeriod — simple payday (no clamping)', () => {
    const paydayDay = 25;
    const august = engine.getPeriodForDate(paydayDay, utc(2026, 7, 25)); // Aug 25 – Sep 24

    it('steps forward to the next period', () => {
      const next = getNextPeriod(paydayDay, august);
      const expected = engine.getPeriodForDate(paydayDay, utc(2026, 8, 25)); // Sep 25 – Oct 24
      expect(next.startDate.getTime()).toBe(expected.startDate.getTime());
      expect(next.endDate.getTime()).toBe(expected.endDate.getTime());
      expect(next.label).toBe(expected.label);
    });

    it('steps backward to the previous period', () => {
      const prev = getPreviousPeriod(paydayDay, august);
      const expected = engine.getPeriodForDate(paydayDay, utc(2026, 6, 25)); // Jul 25 – Aug 24
      expect(prev.startDate.getTime()).toBe(expected.startDate.getTime());
      expect(prev.endDate.getTime()).toBe(expected.endDate.getTime());
    });

    it('next then previous returns to the original period', () => {
      const roundTrip = getPreviousPeriod(paydayDay, getNextPeriod(paydayDay, august));
      expect(roundTrip.startDate.getTime()).toBe(august.startDate.getTime());
      expect(roundTrip.endDate.getTime()).toBe(august.endDate.getTime());
    });
  });

  describe('payday 29–31 clamping across month lengths', () => {
    const paydayDay = 31;

    it('steps from a 31-clamped January period into a short (28-day) February', () => {
      const jan = engine.getPeriodForDate(paydayDay, utc(2026, 0, 31)); // Jan 31 – Feb 27 (2026 not leap)
      const next = getNextPeriod(paydayDay, jan);
      const expected = engine.getPeriodForDate(paydayDay, utc(2026, 1, 28)); // Feb 28 – Mar 30
      expect(next.startDate.getTime()).toBe(expected.startDate.getTime());
      expect(next.endDate.getTime()).toBe(expected.endDate.getTime());
      // The clamped February start lands on the 28th, not the 31st.
      expect(next.startDate.getUTCDate()).toBe(28);
    });

    it('steps forward again from the clamped February period into 31-day March', () => {
      const feb = engine.getPeriodForDate(paydayDay, utc(2026, 1, 28)); // Feb 28 – Mar 30
      const next = getNextPeriod(paydayDay, feb);
      const expected = engine.getPeriodForDate(paydayDay, utc(2026, 2, 31)); // Mar 31 – Apr 29
      expect(next.startDate.getTime()).toBe(expected.startDate.getTime());
      expect(next.startDate.getUTCDate()).toBe(31);
    });

    it('steps backward from a 31-clamped January period into 31-day December', () => {
      const jan = engine.getPeriodForDate(paydayDay, utc(2026, 0, 31)); // Jan 31 – Feb 27
      const prev = getPreviousPeriod(paydayDay, jan);
      const expected = engine.getPeriodForDate(paydayDay, utc(2025, 11, 31)); // Dec 31 – Jan 30
      expect(prev.startDate.getTime()).toBe(expected.startDate.getTime());
      expect(prev.endDate.getTime()).toBe(expected.endDate.getTime());
    });

    it('clamps to the 29th in a leap-year February instead of the 28th', () => {
      const jan2028 = engine.getPeriodForDate(paydayDay, utc(2028, 0, 31)); // Jan 31 – Feb 28 (2028 leap)
      const next = getNextPeriod(paydayDay, jan2028);
      expect(next.startDate.getUTCDate()).toBe(29);
      expect(next.startDate.getUTCMonth()).toBe(1); // February
    });
  });

  describe('isCurrentOrFuturePeriod', () => {
    const paydayDay = 25;

    it('is true for the household current period', () => {
      const current = engine.getCurrentPeriod(paydayDay);
      expect(isCurrentOrFuturePeriod(paydayDay, current)).toBe(true);
    });

    it('is false for a past period', () => {
      const current = engine.getCurrentPeriod(paydayDay);
      const past = getPreviousPeriod(paydayDay, current);
      expect(isCurrentOrFuturePeriod(paydayDay, past)).toBe(false);
    });

    it('is true for a period after the current one (safety net against navigating into the future)', () => {
      const current = engine.getCurrentPeriod(paydayDay);
      const future = getNextPeriod(paydayDay, current);
      expect(isCurrentOrFuturePeriod(paydayDay, future)).toBe(true);
    });
  });
});
