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

  describe('H8 fix: focus follows CURRENT balance, not stale sortOrder', () => {
    it('gives the snowball to the smaller-CURRENT-balance debt even though it has the LATER sortOrder', () => {
      // debtA was entered FIRST (sortOrder 0, e.g. a bond) but has since been
      // paid down to R4000. debtB was entered SECOND (sortOrder 1, e.g. a
      // credit card) and — via real payments made after creation — now sits
      // at R1000, BELOW debtA. Trusting the create-time sortOrder (the H8
      // bug) would keep pouring the snowball into debtA (sortOrder 0)
      // forever; the fix must redirect it to debtB, the true smallest
      // CURRENT balance, per the Ramsey snowball method.
      const debtA = makeDebt('debtA', 400000, 50000, 0); // R4000, sortOrder 0
      const debtB = makeDebt('debtB', 100000, 50000, 1); // R1000, sortOrder 1 (smaller balance)

      const result = projector.project([debtA, debtB], 100000); // R1000/month extra

      const byId = Object.fromEntries(result.projections.map((p) => [p.debtId, p]));

      // debtB (smaller CURRENT balance) is paid off first — proof the
      // snowball focus followed the balance, not creation order.
      expect(byId.debtB.monthsToPayoff).toBeLessThan(byId.debtA.monthsToPayoff);
      // Concretely: with R500 min + R1000 snowball, debtB's R1000 balance
      // clears in month 1 — it could only receive the snowball THIS month if
      // the projector focused it ahead of debtA despite the sortOrder.
      expect(byId.debtB.monthsToPayoff).toBe(1);
    });

    it('projections are ordered smallest-current-balance-first regardless of sortOrder', () => {
      const bigSortOrderZero = makeDebt('big', 900000, 10000, 0);
      const smallSortOrderOne = makeDebt('small', 50000, 10000, 1);
      const result = projector.project([bigSortOrderZero, smallSortOrderOne], 0);
      expect(result.projections.map((p) => p.debtId)).toEqual(['small', 'big']);
    });

    it('falls back to sortOrder as a stable tie-break when balances are equal', () => {
      const first = makeDebt('first', 100000, 10000, 0);
      const second = makeDebt('second', 100000, 10000, 1);
      // Order given reversed on purpose — output must still be sortOrder-stable.
      const result = projector.project([second, first], 0);
      expect(result.projections.map((p) => p.debtId)).toEqual(['first', 'second']);
    });
  });
});
