/**
 * matchesQuery.test.ts — Unit tests for the transaction search filter
 */
import { matchesQuery } from '../TransactionListScreen';
import type { TransactionEntity } from '../../../../domain/transactions/TransactionEntity';

const mockTransaction: TransactionEntity = {
  id: 'tx-1',
  householdId: 'hh-1',
  envelopeId: 'env-1',
  amountCents: 2500, // R25.00
  payee: 'Woolworths',
  description: 'Weekly groceries',
  transactionDate: '2026-06-15',
  spendingTriggerNote: null,
  isBusinessExpense: false,
  createdAt: '2026-06-15T10:00:00Z',
  updatedAt: '2026-06-15T10:00:00Z',
};

const envelopeNames = new Map([
  ['env-1', 'Groceries'],
  ['env-2', 'Transport'],
  ['env-3', 'Entertainment'],
]);

describe('matchesQuery', () => {
  describe('payee matching', () => {
    it('matches payee (query already lowercase from screen)', () => {
      const result = matchesQuery(mockTransaction, 'woolworths', envelopeNames);
      expect(result).toBe(true);
    });

    it('matches payee substring', () => {
      const result = matchesQuery(mockTransaction, 'woolw', envelopeNames);
      expect(result).toBe(true);
    });

    it('does not match when payee does not contain query', () => {
      const result = matchesQuery(mockTransaction, 'random', envelopeNames);
      expect(result).toBe(false);
    });
  });

  describe('description matching', () => {
    it('matches description', () => {
      const result = matchesQuery(mockTransaction, 'groceries', envelopeNames);
      expect(result).toBe(true);
    });

    it('matches description substring', () => {
      const result = matchesQuery(mockTransaction, 'weekly', envelopeNames);
      expect(result).toBe(true);
    });

    it('does not match when description does not contain query', () => {
      const result = matchesQuery(mockTransaction, 'random', envelopeNames);
      expect(result).toBe(false);
    });
  });

  describe('envelope name matching', () => {
    it('matches envelope name', () => {
      const result = matchesQuery(mockTransaction, 'groceries', envelopeNames);
      expect(result).toBe(true);
    });

    it('matches envelope name substring', () => {
      const result = matchesQuery(mockTransaction, 'groc', envelopeNames);
      expect(result).toBe(true);
    });

    it('does not match when envelope is not found in map', () => {
      const tx = { ...mockTransaction, envelopeId: 'env-nonexistent' };
      const result = matchesQuery(tx, 'anytext', envelopeNames);
      expect(result).toBe(false);
    });
  });

  describe('amount matching', () => {
    it('matches plain amount value "25"', () => {
      const result = matchesQuery(mockTransaction, '25', envelopeNames);
      expect(result).toBe(true);
    });

    it('matches amount with dot decimal "25.00"', () => {
      const result = matchesQuery(mockTransaction, '25.00', envelopeNames);
      expect(result).toBe(true);
    });

    it('matches amount with comma decimal "25,00"', () => {
      const result = matchesQuery(mockTransaction, '25,00', envelopeNames);
      expect(result).toBe(true);
    });

    it('matches just the numeric part of formatted currency', () => {
      // User types "25" which matches the formatted "R25,00" after removing prefix
      const result = matchesQuery(mockTransaction, '25', envelopeNames);
      expect(result).toBe(true);
    });

    it('does not match when amount does not match', () => {
      const result = matchesQuery(mockTransaction, '99', envelopeNames);
      expect(result).toBe(false);
    });

    it('matches large amount with thousands separator part', () => {
      const tx = { ...mockTransaction, amountCents: 123456 }; // R1 234,56
      // User can search for any part of the amount
      expect(matchesQuery(tx, '234', envelopeNames)).toBe(true);
    });

    it('matches large amount plain value "1234" or "1234.56"', () => {
      const tx = { ...mockTransaction, amountCents: 123456 }; // R1234.56
      expect(matchesQuery(tx, '1234', envelopeNames)).toBe(true);
      expect(matchesQuery(tx, '1234.56', envelopeNames)).toBe(true);
      expect(matchesQuery(tx, '1234,56', envelopeNames)).toBe(true);
    });
  });

  describe('empty query', () => {
    it('matches everything when query is empty string', () => {
      const result = matchesQuery(mockTransaction, '', envelopeNames);
      expect(result).toBe(true);
    });

    it('matches everything when query is only whitespace', () => {
      // Note: whitespace is trimmed before calling matchesQuery
      const result = matchesQuery(mockTransaction, '', envelopeNames);
      expect(result).toBe(true);
    });
  });

  describe('no match cases', () => {
    it('does not match when query does not match any field', () => {
      const result = matchesQuery(mockTransaction, 'nonexistenttext', envelopeNames);
      expect(result).toBe(false);
    });

    it('does not match when query is a price that does not exist', () => {
      const result = matchesQuery(mockTransaction, '99.99', envelopeNames);
      expect(result).toBe(false);
    });
  });

  describe('case handling', () => {
    it('handles text comparisons case-insensitively (data is lowercased)', () => {
      // The test data's payee/description/envelope names are lowercased in the function
      const result1 = matchesQuery(mockTransaction, 'woolworths', envelopeNames);
      const result2 = matchesQuery(mockTransaction, 'groceries', envelopeNames);
      const result3 = matchesQuery(mockTransaction, 'weekly', envelopeNames);
      expect(result1 && result2 && result3).toBe(true);
    });
  });
});

describe('matchesQuery — the amount as the row displays it', () => {
  const tx = { payee: 'Shop', description: null, envelopeId: 'e1', amountCents: 123456 } as never;
  const names = new Map<string, string>();

  it.each(['r 1 234', 'r1 234,56', 'r1234', '1 234,56'])('matches "%s"', (q) => {
    expect(matchesQuery(tx, q, names)).toBe(true);
  });

  it('does not match a different amount', () => {
    expect(matchesQuery(tx, 'r 9 999', names)).toBe(false);
  });
});

describe('matchesQuery — refunds (negative amountCents)', () => {
  const names = new Map<string, string>();
  // A R25,00 refund. The user searching for it types the amount they see on
  // the slip — "25" — not "-25", so the filter matches on the ABSOLUTE value.
  const refund = {
    payee: 'Checkers refund',
    description: null,
    envelopeId: 'e1',
    amountCents: -2500,
  } as never;

  it.each(['25', '25.00', '25,00', 'r25,00', 'r 25,00'])(
    'finds a refund by its absolute value, searching "%s"',
    (q) => {
      expect(matchesQuery(refund, q, names)).toBe(true);
    },
  );

  it('still does not match an unrelated amount', () => {
    expect(matchesQuery(refund, '9 999', names)).toBe(false);
  });

  it('finds a refund by payee as usual', () => {
    expect(matchesQuery(refund, 'refund', names)).toBe(true);
  });
});
