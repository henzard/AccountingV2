import { SnowballPayoffProjector } from '../SnowballPayoffProjector';
import type { DebtEntity } from '../DebtEntity';

function makeDebt(
  id: string,
  balanceCents: number,
  minPayCents: number,
  sortOrder: number,
): DebtEntity {
  return {
    id,
    householdId: 'h1',
    creditorName: `Debt ${id}`,
    debtType: 'personal_loan',
    outstandingBalanceCents: balanceCents,
    initialBalanceCents: balanceCents,
    interestRatePercent: 0, // zero interest simplifies month-count assertions
    minimumPaymentCents: minPayCents,
    sortOrder,
    isPaidOff: false,
    totalPaidCents: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isSynced: false,
  };
}

describe('SnowballPayoffProjector', () => {
  const projector = new SnowballPayoffProjector();

  it('returns empty plan when no active debts', () => {
    const result = projector.project([]);
    expect(result.projections).toHaveLength(0);
    expect(result.debtFreeDate).toBeNull();
  });

  it('skips debts that are already paid off', () => {
    const paid = { ...makeDebt('d1', 0, 1000, 0), isPaidOff: true };
    const result = projector.project([paid]);
    expect(result.projections).toHaveLength(0);
  });

  it('calculates correct months to payoff for a single zero-interest debt', () => {
    // R5000 balance, R1000/month min payment = 5 months
    const debt = makeDebt('d1', 500000, 100000, 0);
    const result = projector.project([debt], 0);
    expect(result.projections).toHaveLength(1);
    expect(result.projections[0].monthsToPayoff).toBe(5);
  });

  it('returns -1 immediately when minimumPaymentCents is 0 and no extra payment', () => {
    const debt: DebtEntity = {
      ...makeDebt('d1', 500000, 0, 0),
      interestRatePercent: 10,
    };
    const startTime = Date.now();
    const result = projector.project([debt], 0);
    const elapsed = Date.now() - startTime;
    expect(result.projections).toHaveLength(1);
    expect(result.projections[0].monthsToPayoff).toBe(-1);
    // Should short-circuit instantly, not loop 600 times
    expect(elapsed).toBeLessThan(50);
  });

  it('pays off debt when minimumPaymentCents is 0 but extra payment covers it', () => {
    // Balance R1000, min=0, extra=R500/month → 2 months
    const debt = makeDebt('d1', 100000, 0, 0);
    const result = projector.project([debt], 50000);
    expect(result.projections).toHaveLength(1);
    expect(result.projections[0].monthsToPayoff).toBe(2);
  });

  it('rolls paid-off minimum into snowball for next debt', () => {
    // Debt1: R1000, R500/month → paid off in 2 months
    // While debt1 is focus, debt2 receives R500/month minimum, reducing it to R1000
    // Debt2: R1000 remaining, payment = R500 + R500 snowball = R1000/month → 1 more month
    // Total: 3 months
    const debt1 = makeDebt('d1', 100000, 50000, 0);
    const debt2 = makeDebt('d2', 200000, 50000, 1);
    const result = projector.project([debt1, debt2], 0);
    expect(result.projections[0].monthsToPayoff).toBe(2);
    expect(result.projections[1].monthsToPayoff).toBe(3);
  });

  it('debtFreeDate is the payoff date of the last debt', () => {
    const debt = makeDebt('d1', 100000, 50000, 0);
    const result = projector.project([debt], 0);
    expect(result.debtFreeDate).toEqual(result.projections[0].payoffDate);
  });
});
