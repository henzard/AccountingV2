import { BudgetPeriodEngine } from '../BudgetPeriodEngine';

const engine = new BudgetPeriodEngine();

describe('BudgetPeriodEngine.isNewPeriodWithin', () => {
  it('returns true when today is within N days after payday boundary', () => {
    // Simulate: today IS the payday (day 0 of new period) — always within window
    const today = new Date();
    const paydayDay = today.getUTCDate();
    expect(engine.isNewPeriodWithin(paydayDay, 2, today)).toBe(true);
  });

  it('returns true when today is 1 day after payday', () => {
    const yesterday = new Date(Date.UTC(2026, 3, 24)); // 24 Apr 2026
    const dayAfter = new Date(Date.UTC(2026, 3, 25)); // 25 Apr 2026
    // paydayDay = 24, reference = 25 Apr → 1 day into new period → within 2-day window
    expect(engine.isNewPeriodWithin(24, 2, dayAfter)).toBe(true);
    void yesterday; // referenced to silence lint
  });

  it('returns false when more than windowDays have passed since payday', () => {
    // paydayDay = 1, reference = 5 Apr → 4 days into period → outside 2-day window
    const ref = new Date(Date.UTC(2026, 3, 5)); // 5 Apr 2026
    expect(engine.isNewPeriodWithin(1, 2, ref)).toBe(false);
  });

  it('returns false mid-period', () => {
    // paydayDay = 25, reference = 10 Apr → still 15 days before next payday
    const ref = new Date(Date.UTC(2026, 3, 10)); // 10 Apr 2026
    expect(engine.isNewPeriodWithin(25, 2, ref)).toBe(false);
  });
});
