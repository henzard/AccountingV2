import { groupBusinessExpenses } from '../BusinessExpenseReport';
import type { TransactionEntity } from '../TransactionEntity';

function tx(overrides: Partial<TransactionEntity>): TransactionEntity {
  return {
    id: 'id-1',
    householdId: 'hh-1',
    envelopeId: 'env-1',
    amountCents: 10000,
    payee: 'Supplier',
    description: null,
    transactionDate: '2026-03-15',
    isBusinessExpense: true,
    spendingTriggerNote: null,
    slipId: null,
    createdAt: '2026-03-15T10:00:00Z',
    updatedAt: '2026-03-15T10:00:00Z',
    ...overrides,
  };
}

describe('groupBusinessExpenses', () => {
  it('returns empty array for no transactions', () => {
    expect(groupBusinessExpenses([])).toEqual([]);
  });

  it('filters out non-business transactions', () => {
    const result = groupBusinessExpenses([tx({ isBusinessExpense: false })]);
    expect(result).toEqual([]);
  });

  it('groups by YYYY-MM month key', () => {
    const txs = [
      tx({ id: '1', transactionDate: '2026-03-10', amountCents: 5000 }),
      tx({ id: '2', transactionDate: '2026-03-25', amountCents: 3000 }),
      tx({ id: '3', transactionDate: '2026-04-05', amountCents: 7000 }),
    ];
    const result = groupBusinessExpenses(txs);
    expect(result).toHaveLength(2);
    expect(result[0].monthKey).toBe('2026-04');
    expect(result[0].totalCents).toBe(7000);
    expect(result[1].monthKey).toBe('2026-03');
    expect(result[1].totalCents).toBe(8000);
    expect(result[1].transactions).toHaveLength(2);
  });

  it('sorts months descending (most recent first)', () => {
    const txs = [
      tx({ id: '1', transactionDate: '2026-01-15', amountCents: 1000 }),
      tx({ id: '2', transactionDate: '2026-04-15', amountCents: 2000 }),
      tx({ id: '3', transactionDate: '2026-02-15', amountCents: 3000 }),
    ];
    const keys = groupBusinessExpenses(txs).map((g) => g.monthKey);
    expect(keys).toEqual(['2026-04', '2026-02', '2026-01']);
  });

  it('sorts transactions within month descending by date', () => {
    const txs = [
      tx({ id: '1', transactionDate: '2026-03-10', amountCents: 1000 }),
      tx({ id: '2', transactionDate: '2026-03-25', amountCents: 2000 }),
    ];
    const result = groupBusinessExpenses(txs);
    expect(result[0].transactions[0].transactionDate).toBe('2026-03-25');
  });
});
