import { BudgetPeriodEngine } from '../BudgetPeriodEngine';

const engine = new BudgetPeriodEngine();

describe('BudgetPeriodEngine.isNewPeriodWithin – payday-day scenarios', () => {
  it('returns true on payday itself (daysSinceStart === 0)', () => {
    const payday = new Date(Date.UTC(2026, 5, 20)); // 20 Jun
    expect(engine.isNewPeriodWithin(20, 3, payday)).toBe(true);
  });

  it('returns true the day after payday within window', () => {
    const dayAfter = new Date(Date.UTC(2026, 5, 21)); // 21 Jun, payday=20
    expect(engine.isNewPeriodWithin(20, 3, dayAfter)).toBe(true);
  });

  it('returns true on last day of window (daysSinceStart === windowDays)', () => {
    const lastDay = new Date(Date.UTC(2026, 5, 23)); // 3 days after payday=20
    expect(engine.isNewPeriodWithin(20, 3, lastDay)).toBe(true);
  });

  it('returns false one day past the window', () => {
    const pastWindow = new Date(Date.UTC(2026, 5, 24)); // 4 days after payday=20
    expect(engine.isNewPeriodWithin(20, 3, pastWindow)).toBe(false);
  });

  it('returns false mid-period (well outside window)', () => {
    const midPeriod = new Date(Date.UTC(2026, 6, 5)); // 15 days after payday=20
    expect(engine.isNewPeriodWithin(20, 3, midPeriod)).toBe(false);
  });

  it('returns true with windowDays=0 on exact payday', () => {
    const exact = new Date(Date.UTC(2026, 5, 15));
    expect(engine.isNewPeriodWithin(15, 0, exact)).toBe(true);
  });

  it('returns false with windowDays=0 one day after payday', () => {
    const dayAfter = new Date(Date.UTC(2026, 5, 16));
    expect(engine.isNewPeriodWithin(15, 0, dayAfter)).toBe(false);
  });
});

describe('BudgetPeriodEngine.isNewPeriodWithin – paydayDay=1 month boundary', () => {
  it('returns true on the 1st of the month', () => {
    const first = new Date(Date.UTC(2026, 6, 1)); // 1 Jul
    expect(engine.isNewPeriodWithin(1, 2, first)).toBe(true);
  });

  it('returns true on the 2nd (within window=2)', () => {
    const second = new Date(Date.UTC(2026, 6, 2));
    expect(engine.isNewPeriodWithin(1, 2, second)).toBe(true);
  });

  it('returns false on the 4th (outside window=2)', () => {
    const fourth = new Date(Date.UTC(2026, 6, 4));
    expect(engine.isNewPeriodWithin(1, 2, fourth)).toBe(false);
  });

  it('returns true on 1 Jan after December period', () => {
    const janFirst = new Date(Date.UTC(2027, 0, 1));
    expect(engine.isNewPeriodWithin(1, 3, janFirst)).toBe(true);
  });

  it('returns false on 31st of month (last day before next payday)', () => {
    const lastDay = new Date(Date.UTC(2026, 6, 31)); // 31 Jul, 30 days after payday=1
    expect(engine.isNewPeriodWithin(1, 2, lastDay)).toBe(false);
  });
});

describe('BudgetPeriodEngine.isNewPeriodWithin – December→January year crossover', () => {
  it('returns true on 25 Dec when paydayDay=25', () => {
    const dec25 = new Date(Date.UTC(2026, 11, 25));
    expect(engine.isNewPeriodWithin(25, 3, dec25)).toBe(true);
  });

  it('returns true on 27 Dec (2 days into window=3, paydayDay=25)', () => {
    const dec27 = new Date(Date.UTC(2026, 11, 27));
    expect(engine.isNewPeriodWithin(25, 3, dec27)).toBe(true);
  });

  it('returns false on 31 Dec (6 days past payday=25, window=3)', () => {
    const dec31 = new Date(Date.UTC(2026, 11, 31));
    expect(engine.isNewPeriodWithin(25, 3, dec31)).toBe(false);
  });

  it('returns false on 10 Jan (mid-period for payday=25 Dec)', () => {
    const jan10 = new Date(Date.UTC(2027, 0, 10));
    expect(engine.isNewPeriodWithin(25, 3, jan10)).toBe(false);
  });

  it('returns true on 25 Jan (new period starts, payday=25)', () => {
    const jan25 = new Date(Date.UTC(2027, 0, 25));
    expect(engine.isNewPeriodWithin(25, 3, jan25)).toBe(true);
  });

  it('returns true on 1 Jan for paydayDay=1 (year crossover)', () => {
    const jan1 = new Date(Date.UTC(2027, 0, 1));
    expect(engine.isNewPeriodWithin(1, 2, jan1)).toBe(true);
  });

  it('returns false on 5 Jan for paydayDay=1 with window=2', () => {
    const jan5 = new Date(Date.UTC(2027, 0, 5));
    expect(engine.isNewPeriodWithin(1, 2, jan5)).toBe(false);
  });
});
