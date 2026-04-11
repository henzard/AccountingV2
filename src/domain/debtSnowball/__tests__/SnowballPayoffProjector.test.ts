import { SnowballPayoffProjector } from '../SnowballPayoffProjector';
import type { DebtEntity } from '../DebtEntity';

function makeDebt(id: string, balanceCents: number, minPayCents: number, sortOrder: number): DebtEntity {
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

  it('rolls paid-off minimum into snowball for next debt', () => {
    // Debt1: R1000, R500/month → paid off in 2 months
    // Debt2: R2000, R500/month. After debt1 paid off, payment = R1000/month → 2 months more
    const debt1 = makeDebt('d1', 100000, 50000, 0);
    const debt2 = makeDebt('d2', 200000, 50000, 1);
    const result = projector.project([debt1, debt2], 0);
    expect(result.projections[0].monthsToPayoff).toBe(2);
    expect(result.projections[1].monthsToPayoff).toBe(4); // 2 + 2 more after snowball
  });

  it('debtFreeDate is the payoff date of the last debt', () => {
    const debt = makeDebt('d1', 100000, 50000, 0);
    const result = projector.project([debt], 0);
    expect(result.debtFreeDate).toEqual(result.projections[0].payoffDate);
  });
});
