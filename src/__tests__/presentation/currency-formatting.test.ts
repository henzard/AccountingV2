/**
 * Currency formatting tests: verify ZAR formatting for various cent values.
 */
import { formatCurrency } from '../../presentation/utils/currency';

describe('Currency Formatting (ZAR)', () => {
  it('formats standard amount correctly', () => {
    const result = formatCurrency(123456);
    // 123456 cents = R1,234.56 (en-ZA locale uses space as group separator)
    // The exact format depends on the locale implementation
    expect(result).toMatch(/^R/);
    expect(result).toContain('1');
    expect(result).toContain('234');
    expect(result).toContain('56');
  });

  it('formats zero as R0.00 or equivalent', () => {
    const result = formatCurrency(0);
    expect(result).toMatch(/^R/);
    expect(result).toMatch(/0[.,]00/);
  });

  it('formats smallest unit (1 cent)', () => {
    const result = formatCurrency(1);
    expect(result).toMatch(/^R/);
    expect(result).toMatch(/0[.,]01/);
  });

  it('formats negative amount with minus sign', () => {
    const result = formatCurrency(-500);
    expect(result).toMatch(/^-R/);
    expect(result).toMatch(/5[.,]00/);
  });

  it('formats large amount (bond-size: R1,200,000.00)', () => {
    const result = formatCurrency(120000000);
    expect(result).toMatch(/^R/);
    // 120000000 cents = R1,200,000.00
    expect(result).toContain('200');
    expect(result).toContain('000');
  });

  it('formats typical grocery amount', () => {
    const result = formatCurrency(185000);
    // 185000 cents = R1,850.00
    expect(result).toMatch(/^R/);
    expect(result).toContain('850');
  });

  it('formats R100 exactly', () => {
    const result = formatCurrency(10000);
    expect(result).toMatch(/^R/);
    expect(result).toMatch(/100[.,]00/);
  });

  it('formats amount with cents (R45.50)', () => {
    const result = formatCurrency(4550);
    expect(result).toMatch(/^R/);
    expect(result).toMatch(/45[.,]50/);
  });

  it('preserves absolute value for negative formatting', () => {
    const positive = formatCurrency(12345);
    const negative = formatCurrency(-12345);
    // Negative should be "-R" + the same number
    expect(negative).toBe('-' + positive);
  });
});
