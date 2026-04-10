import {
  TransactionEntity,
  getTransactionDisplayDate,
  formatTransactionAmount,
} from '../TransactionEntity';

const base: TransactionEntity = {
  id: 't1',
  householdId: 'h1',
  envelopeId: 'e1',
  amountCents: 2500,
  payee: 'Checkers',
  description: null,
  transactionDate: '2026-04-10',
  isBusinessExpense: false,
  spendingTriggerNote: null,
  createdAt: '2026-04-10T10:00:00.000Z',
  updatedAt: '2026-04-10T10:00:00.000Z',
};

describe('TransactionEntity', () => {
  it('getTransactionDisplayDate returns formatted date', () => {
    expect(getTransactionDisplayDate(base)).toBe('10 Apr 2026');
  });

  it('formatTransactionAmount returns positive cents as-is', () => {
    expect(formatTransactionAmount(base)).toBe(2500);
  });
});
