import { formatCurrency } from '../currency';

describe('formatCurrency', () => {
  it('formats zero cents', () => {
    expect(formatCurrency(0)).toBe('R0,00');
  });

  it('formats positive cents', () => {
    expect(formatCurrency(12345)).toBe('R123,45');
  });

  it('formats negative cents with leading minus', () => {
    expect(formatCurrency(-500)).toBe('-R5,00');
  });

  it('formats large amounts with thousand separator', () => {
    const result = formatCurrency(1_234_567);
    expect(result).toMatch(/R.*12.*345,67/);
  });

  it('formats single cent correctly', () => {
    expect(formatCurrency(1)).toBe('R0,01');
  });

  it('formats exactly one rand', () => {
    expect(formatCurrency(100)).toBe('R1,00');
  });

  it('formats boundary at 99 cents', () => {
    expect(formatCurrency(99)).toBe('R0,99');
  });

  it('formats negative large amount', () => {
    const result = formatCurrency(-1_000_000);
    expect(result).toMatch(/-R.*10.*000,00/);
  });
});
