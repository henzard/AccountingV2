import { parseRatePercent } from '../parseRatePercent';

describe('parseRatePercent', () => {
  describe('valid inputs', () => {
    it('parses comma-decimal rate', () => {
      expect(parseRatePercent('12,5')).toBe(12.5);
    });

    it('parses period-decimal rate', () => {
      expect(parseRatePercent('12.5')).toBe(12.5);
    });

    it('parses whole number', () => {
      expect(parseRatePercent('12')).toBe(12);
    });

    it('parses zero', () => {
      expect(parseRatePercent('0')).toBe(0);
    });

    it('parses 100', () => {
      expect(parseRatePercent('100')).toBe(100);
    });

    it('trims whitespace', () => {
      expect(parseRatePercent('  12.5  ')).toBe(12.5);
    });

    it('parses rate with two decimal places', () => {
      expect(parseRatePercent('12.50')).toBe(12.5);
    });

    it('parses rate with leading zero', () => {
      expect(parseRatePercent('0.5')).toBe(0.5);
    });
  });

  describe('invalid inputs', () => {
    it('rejects empty string', () => {
      expect(parseRatePercent('')).toBeNull();
    });

    it('rejects whitespace-only input', () => {
      expect(parseRatePercent('   ')).toBeNull();
    });

    it('rejects input with spaces in the middle', () => {
      expect(parseRatePercent('1 2')).toBeNull();
    });

    it('rejects input with letters', () => {
      expect(parseRatePercent('abc')).toBeNull();
    });

    it('rejects input with multiple decimal separators', () => {
      expect(parseRatePercent('12,5,1')).toBeNull();
    });

    it('rejects input with percent sign', () => {
      expect(parseRatePercent('12%')).toBeNull();
    });

    it('rejects input with mixed separators', () => {
      expect(parseRatePercent('12.5,0')).toBeNull();
    });

    it('rejects non-string input', () => {
      expect(parseRatePercent(12.5 as any)).toBeNull();
    });
  });
});
