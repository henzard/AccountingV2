import { parseMoneyInput } from '../parseMoneyInput';

describe('parseMoneyInput', () => {
  describe('accepted inputs', () => {
    const cases: Array<[string, number]> = [
      // Plain amounts + decimals (comma OR period, af-ZA + en-ZA).
      ['1,50', 150],
      ['1.50', 150],
      ['1.5', 150],
      ['1234', 123400],
      ['1234.56', 123456],
      ['0', 0],
      ['0.00', 0],
      ['0,00', 0],
      ['R 42', 4200],
      ['R42', 4200],
      ['$42', 4200],
      ['$ 42.50', 4250],
      ['  1234.56  ', 123456],
      ['12.3', 1230],
      ['12,3', 1230],
      ['007', 700],
      // Thousands separators — the behaviour this fix adds.
      ['1 500', 150000], // space thousands (SA standard)
      ['150 000', 15000000],
      ['1 000 000', 100000000],
      ['1,500', 150000], // comma thousands (3 trailing digits => grouping)
      ['1,234', 123400],
      ['1,234,567', 123456700], // multi-group comma thousands
      ['1.000.000', 100000000], // period thousands (European)
      ['1.234.567', 123456700],
      // Thousands + decimal combined (last separator is the decimal).
      ['1 500.00', 150000],
      ['1 500,00', 150000],
      ['1,000.50', 100050],
      ['1 000,50', 100050],
      ['1.500,00', 150000], // European: '.' thousands, ',' decimal
      ['10 000.50', 1000050],
      ['1500.5', 150050],
      // 3 trailing digits after a single separator = grouping, not a fraction.
      ['12.345', 1234500],
    ];

    it.each(cases)('parses %j -> %i cents', (input, expectedCents) => {
      const result = parseMoneyInput(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.cents).toBe(expectedCents);
      }
    });
  });

  describe('rejected inputs (ambiguous / malformed are refused, never coerced)', () => {
    const cases: string[] = [
      'abc', // non-numeric
      '-5', // negative
      '', // empty
      '   ', // whitespace-only
      '.', // bare separator, no digit
      ',', // bare separator, no digit
      'R', // currency symbol with nothing after it
      '1..5', // doubled separator
      '1-5', // stray character
      '1,5,6', // decimal tail with malformed integer grouping
      '1 .5', // space before the separator
      // Malformed thousands grouping — groups must be exactly 3 digits.
      '1,00,000', // 2-digit inner group
      '1 2 3', // 1-digit groups
      '12 34', // 2-digit trailing group
      '100 00', // 2-digit trailing group
      '1,2,3', // 1-digit groups
    ];

    it.each(cases)('rejects %j', (input) => {
      const result = parseMoneyInput(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.length).toBeGreaterThan(0);
      }
    });
  });

  it('gives a specific error for negative amounts', () => {
    expect(parseMoneyInput('-5')).toEqual({ ok: false, error: 'Amount cannot be negative' });
  });

  it('gives a specific error for empty input', () => {
    expect(parseMoneyInput('')).toEqual({ ok: false, error: 'Enter an amount' });
  });

  it('rejects non-string input defensively', () => {
    // @ts-expect-error — exercising runtime guard against non-string callers
    const result = parseMoneyInput(undefined);
    expect(result.ok).toBe(false);
  });

  describe('whole-part overflow guard', () => {
    it('rejects a whole part longer than the safe-integer cap (would lose precision)', () => {
      expect(parseMoneyInput('99999999999999999999')).toEqual({
        ok: false,
        error: 'Amount is too large',
      });
    });

    it('rejects an over-cap whole part even with a decimal fraction', () => {
      const result = parseMoneyInput('123456789012345.99');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('Amount is too large');
    });

    it('rejects an over-cap whole part expressed with thousands separators', () => {
      // 16 whole digits via grouping -> still over the 13-digit cap.
      const result = parseMoneyInput('9 999 999 999 999 999');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('Amount is too large');
    });

    it('still accepts a large-but-safe amount (13-digit whole part)', () => {
      const result = parseMoneyInput('9999999999999.99');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.cents).toBe(999999999999999);
        expect(Number.isSafeInteger(result.cents)).toBe(true);
      }
    });

    it('accepts the same large amount written with thousands separators', () => {
      const result = parseMoneyInput('9 999 999 999 999.99');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.cents).toBe(999999999999999);
    });
  });
});
