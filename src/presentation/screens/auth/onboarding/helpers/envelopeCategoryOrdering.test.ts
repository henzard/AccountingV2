import { sortCategoriesByPriority } from './envelopeCategoryOrdering';

describe('sortCategoriesByPriority', () => {
  it('prioritizes Rent, Groceries, Transport ahead of others', () => {
    const input = ['Entertainment', 'Rent', 'Groceries', 'Airtime'];
    const result = sortCategoriesByPriority(input);
    expect(result).toEqual(['Rent', 'Groceries', 'Entertainment', 'Airtime']);
  });

  it('respects the priority order: Rent before Mortgage before Groceries', () => {
    const input = ['Groceries', 'Rent', 'Mortgage', 'Clothing'];
    const result = sortCategoriesByPriority(input);
    // Rent comes before Mortgage which comes before Groceries
    expect(result.indexOf('Rent')).toBeLessThan(result.indexOf('Mortgage'));
    expect(result.indexOf('Mortgage')).toBeLessThan(result.indexOf('Groceries'));
    expect(result.indexOf('Groceries')).toBeLessThan(result.indexOf('Clothing'));
  });

  it('handles case-insensitive matching', () => {
    const input = ['Entertainment', 'rent', 'GROCERIES', 'Medical'];
    const result = sortCategoriesByPriority(input);
    // Case-insensitive: 'rent' and 'GROCERIES' should be treated as priority
    expect(result[0]).toBe('rent');
    expect(result[1]).toBe('GROCERIES');
    expect(result[2]).toBe('Entertainment');
    expect(result[3]).toBe('Medical');
  });

  it('leaves non-priority categories in original order', () => {
    const input = ['Medical', 'Airtime', 'Clothing', 'Entertainment'];
    const result = sortCategoriesByPriority(input);
    expect(result).toEqual(['Medical', 'Airtime', 'Clothing', 'Entertainment']);
  });

  it('handles mixed priority and non-priority with correct ordering', () => {
    const input = ['Airtime', 'Transport', 'Medical', 'Rent', 'Clothing', 'Utilities'];
    const result = sortCategoriesByPriority(input);
    // Priority: Rent, Transport, Utilities (in that order)
    // Rest: Airtime, Medical, Clothing (in original order)
    expect(result).toEqual(['Rent', 'Transport', 'Utilities', 'Airtime', 'Medical', 'Clothing']);
  });

  it('handles empty input', () => {
    const result = sortCategoriesByPriority([]);
    expect(result).toEqual([]);
  });

  it('handles single priority category', () => {
    const result = sortCategoriesByPriority(['Rent']);
    expect(result).toEqual(['Rent']);
  });

  it('handles single non-priority category', () => {
    const result = sortCategoriesByPriority(['Entertainment']);
    expect(result).toEqual(['Entertainment']);
  });

  it('includes Electricity in priority list', () => {
    const input = ['Entertainment', 'Electricity', 'Medical'];
    const result = sortCategoriesByPriority(input);
    expect(result[0]).toBe('Electricity');
  });

  it('includes Mortgage in priority list', () => {
    const input = ['Entertainment', 'Mortgage', 'Clothing'];
    const result = sortCategoriesByPriority(input);
    expect(result[0]).toBe('Mortgage');
  });

  it('includes Rent / Mortgage variant', () => {
    const input = ['Entertainment', 'Rent / Mortgage', 'Medical'];
    const result = sortCategoriesByPriority(input);
    expect(result[0]).toBe('Rent / Mortgage');
  });
});
