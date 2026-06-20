import { BudgetPeriodEngine } from '../BudgetPeriodEngine';

const engine = new BudgetPeriodEngine();

describe('BudgetPeriodEngine.isNewPeriodWithin', () => {
  it('returns true when today is within N days after payday boundary', () => {
    const today = new Date(Date.UTC(2026, 3, 15));
    expect(engine.isNewPeriodWithin(15, 2, today)).toBe(true);
  });

  it('returns true when today is 1 day after payday', () => {
    const dayAfter = new Date(Date.UTC(2026, 3, 25)); // 25 Apr 2026
    expect(engine.isNewPeriodWithin(24, 2, dayAfter)).toBe(true);
  });

  it('returns false when more than windowDays have passed since payday', () => {
    const ref = new Date(Date.UTC(2026, 3, 5)); // 5 Apr 2026
    expect(engine.isNewPeriodWithin(1, 2, ref)).toBe(false);
  });

  it('returns false mid-period', () => {
    const ref = new Date(Date.UTC(2026, 3, 10)); // 10 Apr 2026
    expect(engine.isNewPeriodWithin(25, 2, ref)).toBe(false);
  });

  it('returns true on exact boundary day (daysSinceStart === 0)', () => {
    const ref = new Date(Date.UTC(2026, 5, 1));
    expect(engine.isNewPeriodWithin(1, 0, ref)).toBe(true);
  });

  it('returns true at exact windowDays boundary (daysSinceStart === windowDays)', () => {
    const ref = new Date(Date.UTC(2026, 5, 4)); // 3 days after payday=1
    expect(engine.isNewPeriodWithin(1, 3, ref)).toBe(true);
  });

  it('returns false when daysSinceStart === windowDays + 1', () => {
    const ref = new Date(Date.UTC(2026, 5, 5)); // 4 days after payday=1
    expect(engine.isNewPeriodWithin(1, 3, ref)).toBe(false);
  });
});

describe('BudgetPeriodEngine.getPeriodForDate – paydayDay=1 (month boundary)', () => {
  it('returns period starting on 1st when date is on payday', () => {
    const ref = new Date(Date.UTC(2026, 5, 1)); // 1 Jun
    const period = engine.getPeriodForDate(1, ref);
    expect(period.startDate).toEqual(new Date(Date.UTC(2026, 5, 1)));
    expect(period.endDate).toEqual(new Date(Date.UTC(2026, 6, 0))); // 30 Jun
  });

  it('wraps to previous month when date is before payday=1 (never happens since day>=1)', () => {
    const ref = new Date(Date.UTC(2026, 5, 1));
    const period = engine.getPeriodForDate(1, ref);
    expect(period.startDate.getUTCMonth()).toBe(5);
  });

  it('returns correct period mid-month for paydayDay=1', () => {
    const ref = new Date(Date.UTC(2026, 5, 15)); // 15 Jun
    const period = engine.getPeriodForDate(1, ref);
    expect(period.startDate).toEqual(new Date(Date.UTC(2026, 5, 1)));
  });
});

describe('BudgetPeriodEngine.getPeriodForDate – December→January year crossover', () => {
  it('returns period crossing year boundary when payday is in December', () => {
    const ref = new Date(Date.UTC(2026, 11, 25)); // 25 Dec 2026
    const period = engine.getPeriodForDate(25, ref);
    expect(period.startDate).toEqual(new Date(Date.UTC(2026, 11, 25))); // 25 Dec
    expect(period.endDate).toEqual(new Date(Date.UTC(2027, 0, 24))); // 24 Jan 2027
    expect(period.label).toContain('25 Dec');
    expect(period.label).toContain('24 Jan');
  });

  it('wraps to previous year when January date is before payday', () => {
    const ref = new Date(Date.UTC(2027, 0, 10)); // 10 Jan 2027
    const period = engine.getPeriodForDate(25, ref);
    expect(period.startDate).toEqual(new Date(Date.UTC(2026, 11, 25))); // 25 Dec 2026
    expect(period.endDate).toEqual(new Date(Date.UTC(2027, 0, 24)));
  });

  it('returns correct label across year boundary', () => {
    const ref = new Date(Date.UTC(2026, 11, 31));
    const period = engine.getPeriodForDate(25, ref);
    expect(period.label).toBe('25 Dec – 24 Jan');
  });
});

describe('BudgetPeriodEngine.getPeriodForDate – paydayDay=28 edge case', () => {
  it('handles February with paydayDay=28', () => {
    const ref = new Date(Date.UTC(2026, 1, 28)); // 28 Feb
    const period = engine.getPeriodForDate(28, ref);
    expect(period.startDate).toEqual(new Date(Date.UTC(2026, 1, 28)));
    expect(period.endDate).toEqual(new Date(Date.UTC(2026, 2, 27))); // 27 Mar
  });
});

describe('BudgetPeriodEngine.isDateInPeriod', () => {
  it('returns true for date equal to startDate', () => {
    const start = new Date(Date.UTC(2026, 5, 1));
    const end = new Date(Date.UTC(2026, 5, 30));
    const period = { startDate: start, endDate: end, label: '1 Jun – 30 Jun' };
    expect(engine.isDateInPeriod(start, period)).toBe(true);
  });

  it('returns true for date equal to endDate', () => {
    const start = new Date(Date.UTC(2026, 5, 1));
    const end = new Date(Date.UTC(2026, 5, 30));
    const period = { startDate: start, endDate: end, label: '1 Jun – 30 Jun' };
    expect(engine.isDateInPeriod(end, period)).toBe(true);
  });

  it('returns false for date before period', () => {
    const start = new Date(Date.UTC(2026, 5, 1));
    const end = new Date(Date.UTC(2026, 5, 30));
    const period = { startDate: start, endDate: end, label: '1 Jun – 30 Jun' };
    const before = new Date(Date.UTC(2026, 4, 31));
    expect(engine.isDateInPeriod(before, period)).toBe(false);
  });

  it('returns false for date after period', () => {
    const start = new Date(Date.UTC(2026, 5, 1));
    const end = new Date(Date.UTC(2026, 5, 30));
    const period = { startDate: start, endDate: end, label: '1 Jun – 30 Jun' };
    const after = new Date(Date.UTC(2026, 6, 1));
    expect(engine.isDateInPeriod(after, period)).toBe(false);
  });
});
