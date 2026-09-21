/**
 * Tests for buildBusinessExpenseCsv
 */

import {
  buildBusinessExpenseCsv,
  transactionsToCsvRows,
  applyFormulaInjectionGuard,
  escapeAmountField,
  type BusinessExpenseRow,
} from '../buildBusinessExpenseCsv';
import type { TransactionEntity } from '../../../../domain/transactions/TransactionEntity';

describe('buildBusinessExpenseCsv', () => {
  describe('CSV quoting and escaping', () => {
    it('should quote all text fields and escape inner quotes', () => {
      const rows: BusinessExpenseRow[] = [
        {
          date: '2026-01-15',
          payee: 'John "Jack" Doe',
          description: 'Test with "quotes"',
          amountCents: 100000,
        },
      ];
      const csv = buildBusinessExpenseCsv(rows);
      const lines = csv.split('\r\n');

      // Header line
      expect(lines[0]).toBe('Date,Payee,Description,Amount (ZAR)');

      // Data line - quotes should be doubled
      expect(lines[1]).toContain('"John ""Jack"" Doe"');
      expect(lines[1]).toContain('"Test with ""quotes"""');
    });

    it('should guard against CSV injection with formula-like prefixes and control chars', () => {
      const rows: BusinessExpenseRow[] = [
        {
          date: '2026-01-01',
          payee: '=SUM(A1:A10)',
          description: '+External Link',
          amountCents: 100,
        },
        {
          date: '2026-01-02',
          payee: '-Minus',
          description: '@IMPORT("http://example.com")',
          amountCents: 200,
        },
        {
          date: '2026-01-03',
          payee: '\tTab attack',
          description: '\rCarriage return',
          amountCents: 300,
        },
      ];
      const csv = buildBusinessExpenseCsv(rows);
      const lines = csv.split('\r\n');

      // Formulas should be prefixed with ' to prevent execution
      expect(lines[1]).toContain('"\'=SUM(A1:A10)"');
      expect(lines[1]).toContain('"\'+External Link"');
      expect(lines[2]).toContain('"\'-Minus"');
      expect(lines[2]).toContain('"\'@IMPORT(""http://example.com"")"');
      // Control characters should also be prefixed (OWASP CSV injection guidance)
      // The actual tab and carriage return characters appear in the output
      expect(lines[3]).toContain("'\tTab attack");
      expect(lines[3]).toContain("'\rCarriage return");
    });

    it('should handle empty and null fields', () => {
      const rows: BusinessExpenseRow[] = [
        {
          date: '2026-01-01',
          payee: null,
          description: null,
          amountCents: 5000,
        },
        {
          date: '2026-01-02',
          payee: '',
          description: null,
          amountCents: 3000,
        },
      ];
      const csv = buildBusinessExpenseCsv(rows);
      const lines = csv.split('\r\n');

      // Empty/null should be ""
      expect(lines[1]).toBe(`"2026-01-01","","","50.00"`);
      expect(lines[2]).toBe(`"2026-01-02","","","30.00"`);
    });
  });

  describe('Amount formatting', () => {
    it('should format amounts as decimals with two places', () => {
      const rows: BusinessExpenseRow[] = [
        {
          date: '2026-01-01',
          payee: 'Payee A',
          description: 'Desc A',
          amountCents: 123456,
        },
        {
          date: '2026-01-02',
          payee: 'Payee B',
          description: 'Desc B',
          amountCents: 1,
        },
        {
          date: '2026-01-03',
          payee: 'Payee C',
          description: 'Desc C',
          amountCents: 0,
        },
      ];
      const csv = buildBusinessExpenseCsv(rows);
      const lines = csv.split('\r\n');

      expect(lines[1]).toContain('"1234.56"');
      expect(lines[2]).toContain('"0.01"');
      expect(lines[3]).toContain('"0.00"');
    });
  });

  describe('Row sorting', () => {
    it('should sort rows by date ascending', () => {
      const rows: BusinessExpenseRow[] = [
        {
          date: '2026-03-01',
          payee: 'C',
          description: 'March',
          amountCents: 100,
        },
        {
          date: '2026-01-01',
          payee: 'A',
          description: 'January',
          amountCents: 100,
        },
        {
          date: '2026-02-15',
          payee: 'B',
          description: 'February',
          amountCents: 100,
        },
      ];
      const csv = buildBusinessExpenseCsv(rows);
      const lines = csv.split('\r\n');

      expect(lines[1]).toContain('2026-01-01');
      expect(lines[2]).toContain('2026-02-15');
      expect(lines[3]).toContain('2026-03-01');
    });
  });

  describe('Total row', () => {
    it('should include a total row at the end', () => {
      const rows: BusinessExpenseRow[] = [
        {
          date: '2026-01-01',
          payee: 'A',
          description: 'Test 1',
          amountCents: 10000,
        },
        {
          date: '2026-01-02',
          payee: 'B',
          description: 'Test 2',
          amountCents: 25000,
        },
      ];
      const csv = buildBusinessExpenseCsv(rows);
      const lines = csv.split('\r\n');

      const lastLine = lines[lines.length - 1];
      expect(lastLine).toBe(`"","","Total","350.00"`);
    });

    it('should calculate correct total for empty list', () => {
      const rows: BusinessExpenseRow[] = [];
      const csv = buildBusinessExpenseCsv(rows);
      const lines = csv.split('\r\n');

      expect(lines[0]).toBe('Date,Payee,Description,Amount (ZAR)');
      expect(lines[1]).toBe(`"","","Total","0.00"`);
    });
  });

  describe('Line endings', () => {
    it('should use CRLF (\\r\\n) line endings', () => {
      const rows: BusinessExpenseRow[] = [
        {
          date: '2026-01-01',
          payee: 'Test',
          description: 'Desc',
          amountCents: 100,
        },
      ];
      const csv = buildBusinessExpenseCsv(rows);

      expect(csv).toContain('\r\n');
      expect(csv).not.toMatch(/[^\r]\n/);
    });
  });

  describe('transactionsToCsvRows', () => {
    it('should convert TransactionEntity to BusinessExpenseRow', () => {
      const transactions: TransactionEntity[] = [
        {
          id: 'tx-1',
          householdId: 'hh-1',
          envelopeId: 'env-1',
          amountCents: 50000,
          payee: 'Store A',
          description: 'Supplies',
          transactionDate: '2026-01-15',
          isBusinessExpense: true,
          spendingTriggerNote: 'Q1 Office',
          createdAt: '2026-01-15T10:00:00Z',
          updatedAt: '2026-01-15T10:00:00Z',
        },
      ];

      const rows = transactionsToCsvRows(transactions);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        date: '2026-01-15',
        payee: 'Store A',
        description: 'Supplies',
        amountCents: 50000,
      });
    });

    it('should prefer description over spendingTriggerNote', () => {
      const transactions: TransactionEntity[] = [
        {
          id: 'tx-1',
          householdId: 'hh-1',
          envelopeId: 'env-1',
          amountCents: 50000,
          payee: 'Store A',
          description: 'Explicit description',
          transactionDate: '2026-01-15',
          isBusinessExpense: true,
          spendingTriggerNote: 'Trigger note',
          createdAt: '2026-01-15T10:00:00Z',
          updatedAt: '2026-01-15T10:00:00Z',
        },
      ];

      const rows = transactionsToCsvRows(transactions);

      expect(rows[0].description).toBe('Explicit description');
    });

    it('should fallback to spendingTriggerNote if description is missing', () => {
      const transactions: TransactionEntity[] = [
        {
          id: 'tx-1',
          householdId: 'hh-1',
          envelopeId: 'env-1',
          amountCents: 50000,
          payee: 'Store A',
          description: null,
          transactionDate: '2026-01-15',
          isBusinessExpense: true,
          spendingTriggerNote: 'Trigger note',
          createdAt: '2026-01-15T10:00:00Z',
          updatedAt: '2026-01-15T10:00:00Z',
        },
      ];

      const rows = transactionsToCsvRows(transactions);

      expect(rows[0].description).toBe('Trigger note');
    });

    it('should handle both description and spendingTriggerNote as null', () => {
      const transactions: TransactionEntity[] = [
        {
          id: 'tx-1',
          householdId: 'hh-1',
          envelopeId: 'env-1',
          amountCents: 50000,
          payee: 'Store A',
          description: null,
          transactionDate: '2026-01-15',
          isBusinessExpense: true,
          spendingTriggerNote: null,
          createdAt: '2026-01-15T10:00:00Z',
          updatedAt: '2026-01-15T10:00:00Z',
        },
      ];

      const rows = transactionsToCsvRows(transactions);

      expect(rows[0].description).toBeNull();
    });
  });

  describe('Amount column formula-injection guard (B-04)', () => {
    // A positive amount produces the same CSV bytes whether or not the
    // Amount column is routed through the guard (no realistic amount string
    // ever starts with a formula-trigger character), so these two
    // higher-level tests alone can't prove the guard is actually wired in —
    // they just pin the existing visible output.
    it('formats a positive amount as a plain, unprefixed, quoted number', () => {
      const rows: BusinessExpenseRow[] = [
        { date: '2026-01-01', payee: 'A', description: 'Test', amountCents: 12345 },
      ];
      const csv = buildBusinessExpenseCsv(rows);
      const lines = csv.split('\r\n');
      expect(lines[1]).toBe(`"2026-01-01","A","Test","123.45"`);
    });

    it('keeps a negative total row a plain parseable number', () => {
      const rows: BusinessExpenseRow[] = [
        { date: '2026-01-01', payee: 'Refund', description: 'Credit note', amountCents: -5000 },
        { date: '2026-01-02', payee: 'Refund 2', description: 'Credit note 2', amountCents: -1000 },
      ];
      const csv = buildBusinessExpenseCsv(rows);
      const lines = csv.split('\r\n');
      const lastLine = lines[lines.length - 1];
      expect(lastLine).toBe(`"","","Total","-60.00"`);
    });

    // The following exercise the exported guard helpers directly — this is
    // the part that actually fails without the fix (the old module exports
    // neither `applyFormulaInjectionGuard` nor `escapeAmountField` at all,
    // so importing them is a compile/runtime error before the fix).
    it('exposes the module-wide formula-injection guard, and it DOES prefix a bare leading "-" (OWASP guidance for free text)', () => {
      expect(applyFormulaInjectionGuard('-50.00')).toBe("'-50.00");
      expect(applyFormulaInjectionGuard('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(applyFormulaInjectionGuard('123.45')).toBe('123.45');
    });

    it('escapeAmountField routes through the SAME guard, but exempts a clean negative decimal so it stays numeric', () => {
      // Legitimate negative amount: NOT apostrophe-guarded, unlike the
      // general text guard above — this is the deliberate exemption
      // documented on escapeAmountField (a formatted amount can only ever
      // be `-?\d+\.\d\d`, so a leading '-' here is always a real amount,
      // never the start of an injected formula).
      expect(escapeAmountField('-50.00')).toBe('"-50.00"');
      // Positive amount: unaffected, as before.
      expect(escapeAmountField('123.45')).toBe('"123.45"');
      // Defense in depth: any other formula-trigger character reaching this
      // helper (should never happen for a value produced by formatAmount)
      // is still guarded exactly like a text field.
      expect(escapeAmountField('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    });
  });
});

describe('applyFormulaInjectionGuard — leading line feed', () => {
  it('guards a value that starts with LF, like CR and tab', () => {
    expect(applyFormulaInjectionGuard('\n=HYPERLINK("x")')).toBe('\'\n=HYPERLINK("x")');
  });
});
