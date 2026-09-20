import { computeDebtProgressMessage } from '../debtProgressMessage';
import { formatCurrency } from '../../../utils/currency';

describe('computeDebtProgressMessage', () => {
  it('returns no messages when there is no previous snapshot', () => {
    const result = computeDebtProgressMessage(
      { totalDebtCents: 100000, debtFreeDate: new Date('2028-01-01') },
      null,
    );
    expect(result).toEqual({ dateMessage: null, paidOffMessage: null });
  });

  it('says "N months sooner than last month" when the current payoff date is earlier', () => {
    const result = computeDebtProgressMessage(
      { totalDebtCents: 100000, debtFreeDate: new Date('2028-01-01') },
      { totalDebtCents: 100000, debtFreeDateISO: new Date('2028-04-01').toISOString() },
    );
    expect(result.dateMessage).toBe('3 months sooner than last month');
  });

  it('uses singular "month" for a 1-month difference', () => {
    const result = computeDebtProgressMessage(
      { totalDebtCents: 100000, debtFreeDate: new Date('2028-01-01') },
      { totalDebtCents: 100000, debtFreeDateISO: new Date('2028-02-01').toISOString() },
    );
    expect(result.dateMessage).toBe('1 month sooner than last month');
  });

  it('says "N months later than last month" when the current payoff date is later (setback)', () => {
    const result = computeDebtProgressMessage(
      { totalDebtCents: 100000, debtFreeDate: new Date('2028-06-01') },
      { totalDebtCents: 100000, debtFreeDateISO: new Date('2028-01-01').toISOString() },
    );
    expect(result.dateMessage).toBe('5 months later than last month');
  });

  it('has no date message when both fall in the same calendar month', () => {
    const result = computeDebtProgressMessage(
      { totalDebtCents: 100000, debtFreeDate: new Date('2028-01-05') },
      { totalDebtCents: 100000, debtFreeDateISO: new Date('2028-01-25').toISOString() },
    );
    expect(result.dateMessage).toBeNull();
  });

  it('has no date message when the current plan has no payoff date', () => {
    const result = computeDebtProgressMessage(
      { totalDebtCents: 100000, debtFreeDate: null },
      { totalDebtCents: 100000, debtFreeDateISO: new Date('2028-01-01').toISOString() },
    );
    expect(result.dateMessage).toBeNull();
  });

  it('has no date message when the previous snapshot has no payoff date', () => {
    const result = computeDebtProgressMessage(
      { totalDebtCents: 100000, debtFreeDate: new Date('2028-01-01') },
      { totalDebtCents: 100000, debtFreeDateISO: null },
    );
    expect(result.dateMessage).toBeNull();
  });

  it('says "R… paid off since last month" when total debt dropped', () => {
    const result = computeDebtProgressMessage(
      { totalDebtCents: 80000, debtFreeDate: null },
      { totalDebtCents: 100000, debtFreeDateISO: null },
    );
    expect(result.paidOffMessage).toBe(`${formatCurrency(20000)} paid off since last month`);
  });

  it('has no paid-off message when total debt is unchanged', () => {
    const result = computeDebtProgressMessage(
      { totalDebtCents: 100000, debtFreeDate: null },
      { totalDebtCents: 100000, debtFreeDateISO: null },
    );
    expect(result.paidOffMessage).toBeNull();
  });

  it('has no paid-off message when total debt increased (new debt taken on)', () => {
    const result = computeDebtProgressMessage(
      { totalDebtCents: 120000, debtFreeDate: null },
      { totalDebtCents: 100000, debtFreeDateISO: null },
    );
    expect(result.paidOffMessage).toBeNull();
  });
});
