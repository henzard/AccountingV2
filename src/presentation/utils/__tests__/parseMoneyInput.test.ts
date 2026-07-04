import { parseMoneyInput } from '../parseMoneyInput';

describe('parseMoneyInput', () => {
  describe('accepted inputs', () => {
    const cases: Array<[string, number]> = [
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
      ['  1234.56  ', 123456], // surrounding whitespace on the whole string
      ['12.3', 1230], // single trailing decimal digit, padded
      ['12,3', 1230],
      ['007', 700], // leading zeros
    ];

    it.each(cases)('parses %s -> %i cents', (input, expectedCents) => {
      const result = parseMoneyInput(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.cents).toBe(expectedCents);
      }
    });
  });

  describe('rejected inputs', () => {
    const cases: string[] = [
      '1,234.56', // two separators — thousands + decimal
      '1.234.567', // two separators
      '1 000', // space between digits
      '12.345', // more than 2 decimal places
      'abc', // non-numeric
      '-5', // negative
      '', // empty
      '   ', // whitespace-only
      '.', // bare separator
      ',', // bare separator
      '1,234', // ambiguous: thousands-sep or 3-decimal — reject either way
      'R', // currency symbol with nothing after it
      '1..5', // malformed
      '1-5', // stray character
      '1,5,6', // multiple separators
      '1 .5', // space before separator
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
    const result = parseMoneyInput('-5');
    expect(result).toEqual({ ok: false, error: 'Amount cannot be negative' });
  });

  it('gives a specific error for empty input', () => {
    const result = parseMoneyInput('');
    expect(result).toEqual({ ok: false, error: 'Enter an amount' });
  });

  it('rejects non-string input defensively', () => {
    // @ts-expect-error — exercising runtime guard against non-string callers
    const result = parseMoneyInput(undefined);
    expect(result.ok).toBe(false);
  });
});
