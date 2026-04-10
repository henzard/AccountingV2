import { BudgetPeriodEngine } from './BudgetPeriodEngine';
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
