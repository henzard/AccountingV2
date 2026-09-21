/**
 * moneyDirection.test.ts — the single source of truth for "money in vs money out".
 *
 * The shape that forced this module into existence: a real household whose
 * imported history books salary deposits as transactions against an `income`
 * envelope. Those rows must never land in a "spent" total, while refunds
 * (negative amounts on a spending envelope) must stay in it and net it down.
 */
import {
  classifyMoney,
  countsAsSpending,
  isIncomeEnvelopeType,
  summariseEnvelopePeriodMoney,
  summariseMoney,
} from '../moneyDirection';

describe('classifyMoney', () => {
  it('calls a row on an income envelope income, however positive the amount', () => {
    expect(classifyMoney({ amountCents: 3_500_00, envelopeType: 'income' })).toBe('income');
  });

  it('calls a negative amount on a spending envelope a refund, not income', () => {
    expect(classifyMoney({ amountCents: -2500, envelopeType: 'spending' })).toBe('refund');
  });

  it('calls an ordinary purchase spend', () => {
    expect(classifyMoney({ amountCents: 2500, envelopeType: 'spending' })).toBe('spend');
  });

  it('treats an UNKNOWN envelope as not-income, so money is never dropped from a total', () => {
    expect(classifyMoney({ amountCents: 2500 })).toBe('spend');
    expect(classifyMoney({ amountCents: 2500, envelopeType: null })).toBe('spend');
  });

  it('never calls a savings or utility row income', () => {
    expect(classifyMoney({ amountCents: 1000, envelopeType: 'savings' })).toBe('spend');
    expect(classifyMoney({ amountCents: 1000, envelopeType: 'utility' })).toBe('spend');
  });
});

describe('isIncomeEnvelopeType / countsAsSpending', () => {
  it('recognises only the income type', () => {
    expect(isIncomeEnvelopeType('income')).toBe(true);
    expect(isIncomeEnvelopeType('spending')).toBe(false);
    expect(isIncomeEnvelopeType(undefined)).toBe(false);
  });

  it('keeps refunds inside the spent total and income out of it', () => {
    expect(countsAsSpending({ amountCents: -2500, envelopeType: 'spending' })).toBe(true);
    expect(countsAsSpending({ amountCents: 3_500_00, envelopeType: 'income' })).toBe(false);
  });
});

describe('summariseMoney', () => {
  it('keeps a salary deposit out of Spent and reports it as Received', () => {
    const summary = summariseMoney([
      { amountCents: 25_000, envelopeType: 'spending' },
      { amountCents: 3_500_00, envelopeType: 'income' },
    ]);

    expect(summary.spentCents).toBe(25_000);
    expect(summary.receivedCents).toBe(3_500_00);
    expect(summary.incomeCount).toBe(1);
  });

  it('still nets a refund out of Spent', () => {
    const summary = summariseMoney([
      { amountCents: 25_000, envelopeType: 'spending' },
      { amountCents: -10_000, envelopeType: 'spending' },
    ]);

    expect(summary.spentCents).toBe(15_000);
    expect(summary.receivedCents).toBe(0);
    expect(summary.incomeCount).toBe(0);
  });

  it('reports no income at all for a period of pure spending', () => {
    const summary = summariseMoney([{ amountCents: 100, envelopeType: 'spending' }]);
    expect(summary).toEqual({ spentCents: 100, receivedCents: 0, incomeCount: 0 });
  });

  it('nets a reversed income row against the deposits, then reports it positive', () => {
    const summary = summariseMoney([
      { amountCents: 3_500_00, envelopeType: 'income' },
      { amountCents: -1_000_00, envelopeType: 'income' },
    ]);
    expect(summary.receivedCents).toBe(2_500_00);
    expect(summary.spentCents).toBe(0);
  });
});

describe('summariseEnvelopePeriodMoney', () => {
  const envelope = (over: Partial<Parameters<typeof summariseEnvelopePeriodMoney>[0][0]>) => ({
    envelopeType: 'spending' as const,
    allocatedCents: 0,
    spentCents: 0,
    ...over,
  });

  it('never counts the income envelope as budgeted-out or spent', () => {
    const money = summariseEnvelopePeriodMoney([
      envelope({ envelopeType: 'spending', allocatedCents: 200_000, spentCents: 150_000 }),
      envelope({ envelopeType: 'income', allocatedCents: 3_500_00, spentCents: 3_480_00 }),
    ]);

    expect(money.allocatedCents).toBe(200_000);
    expect(money.spentCents).toBe(150_000);
    expect(money.receivedCents).toBe(3_480_00);
    expect(money.expectedIncomeCents).toBe(3_500_00);
  });

  it("excludes a fund's all-time spend from the period's Spent, but keeps its contribution in Budget", () => {
    const money = summariseEnvelopePeriodMoney([
      envelope({ envelopeType: 'spending', allocatedCents: 100_000, spentCents: 40_000 }),
      envelope({ envelopeType: 'savings', allocatedCents: 50_000, spentCents: 900_000 }),
    ]);

    expect(money.allocatedCents).toBe(150_000);
    expect(money.spentCents).toBe(40_000);
  });

  it('ignores archived envelopes entirely', () => {
    const money = summariseEnvelopePeriodMoney([
      envelope({ allocatedCents: 100_000, spentCents: 40_000, isArchived: true }),
    ]);
    expect(money).toEqual({
      allocatedCents: 0,
      spentCents: 0,
      receivedCents: 0,
      expectedIncomeCents: 0,
    });
  });

  it('reports zero received when the household has no income envelope', () => {
    const money = summariseEnvelopePeriodMoney([
      envelope({ allocatedCents: 100_000, spentCents: 40_000 }),
    ]);
    expect(money.receivedCents).toBe(0);
    expect(money.expectedIncomeCents).toBe(0);
  });
});
