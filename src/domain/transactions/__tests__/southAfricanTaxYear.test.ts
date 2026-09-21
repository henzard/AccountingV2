/**
 * Tests for southAfricanTaxYear — SARS tax year math (1 Mar – end Feb).
 */
import {
  taxYearForDate,
  currentTaxYearKey,
  formatTaxYearLabel,
  getTaxYearOptions,
  ALL_TIME_KEY,
  ALL_TIME_LABEL,
} from '../southAfricanTaxYear';

describe('taxYearForDate', () => {
  it('places 1 March in the tax year starting that year', () => {
    const range = taxYearForDate('2026-03-01');
    expect(range.startYear).toBe(2026);
    expect(range.endYear).toBe(2027);
    expect(range.startDate).toBe('2026-03-01');
    expect(range.endDate).toBe('2027-02-28');
    expect(range.key).toBe('2026-2027');
  });

  it('places 28 Feb (non-leap end year) at the end of the PREVIOUS tax year', () => {
    // 2026 is not a leap year, so the 2025/26 tax year ends 28 Feb 2026.
    const range = taxYearForDate('2026-02-28');
    expect(range.key).toBe('2025-2026');
    expect(range.startDate).toBe('2025-03-01');
    expect(range.endDate).toBe('2026-02-28');
  });

  it('places 29 Feb (leap end year) at the end of that tax year, not spilling into March', () => {
    // 2028 is a leap year, so the 2027/28 tax year ends 29 Feb 2028.
    const range = taxYearForDate('2028-02-29');
    expect(range.key).toBe('2027-2028');
    expect(range.endDate).toBe('2028-02-29');
  });

  it('rolls a leap-year tax year over into the next tax year on 1 March', () => {
    const range = taxYearForDate('2028-03-01');
    expect(range.key).toBe('2028-2029');
    expect(range.startDate).toBe('2028-03-01');
    expect(range.endDate).toBe('2029-02-28');
  });

  it('places 1 January in the tax year that started the previous calendar year', () => {
    const range = taxYearForDate('2026-01-01');
    expect(range.key).toBe('2025-2026');
  });

  it('places 31 December in the tax year that started that same calendar year', () => {
    const range = taxYearForDate('2026-12-31');
    expect(range.key).toBe('2026-2027');
  });

  it('computes a non-leap Feb end date correctly (28 days) for a century non-leap year', () => {
    // 2100 is divisible by 100 but not 400, so NOT a leap year.
    const range = taxYearForDate('2099-06-15');
    expect(range.endDate).toBe('2100-02-28');
  });

  it('computes a leap Feb end date correctly for a 400-divisible century year', () => {
    // 2000 is divisible by 400, so it IS a leap year.
    const range = taxYearForDate('1999-06-15');
    expect(range.endDate).toBe('2000-02-29');
  });
});

describe('currentTaxYearKey', () => {
  it('derives the key from a local date-only string', () => {
    expect(currentTaxYearKey('2026-09-21')).toBe('2026-2027');
    expect(currentTaxYearKey('2026-02-28')).toBe('2025-2026');
  });
});

describe('formatTaxYearLabel', () => {
  it('formats a non-leap-end tax year label', () => {
    const range = taxYearForDate('2026-06-01');
    expect(formatTaxYearLabel(range)).toBe('2026/27 tax year (1 Mar 2026 – 28 Feb 2027)');
  });

  it('formats a leap-end tax year label with 29 Feb', () => {
    const range = taxYearForDate('2027-06-01');
    expect(formatTaxYearLabel(range)).toBe('2027/28 tax year (1 Mar 2027 – 29 Feb 2028)');
  });
});

describe('getTaxYearOptions', () => {
  it('always includes the current tax year even with no transactions', () => {
    const options = getTaxYearOptions([], '2026-09-21');
    expect(options.map((o) => o.key)).toEqual(['2026-2027', ALL_TIME_KEY]);
  });

  it('includes every distinct tax year present in the transaction dates, newest first', () => {
    const options = getTaxYearOptions(
      ['2024-05-01', '2022-01-15', '2025-04-01', '2024-06-01'],
      '2026-09-21',
    );
    // 2024-05-01 & 2024-06-01 -> 2024-2025; 2022-01-15 -> 2021-2022;
    // 2025-04-01 -> 2025-2026; plus current 2026-2027; plus All time.
    expect(options.map((o) => o.key)).toEqual([
      '2026-2027',
      '2025-2026',
      '2024-2025',
      '2021-2022',
      ALL_TIME_KEY,
    ]);
  });

  it('de-duplicates tax years shared by multiple transaction dates', () => {
    const options = getTaxYearOptions(['2024-05-01', '2024-06-01', '2025-01-01'], '2026-09-21');
    const keys = options.map((o) => o.key);
    expect(keys.filter((k) => k === '2024-2025')).toHaveLength(1);
  });

  it('appends "All time" last with null start/end dates', () => {
    const options = getTaxYearOptions(['2024-05-01'], '2026-09-21');
    const allTime = options[options.length - 1];
    expect(allTime.key).toBe(ALL_TIME_KEY);
    expect(allTime.label).toBe(ALL_TIME_LABEL);
    expect(allTime.startDate).toBeNull();
    expect(allTime.endDate).toBeNull();
  });

  it('gives every non-"All time" option a matching label built from formatTaxYearLabel', () => {
    const options = getTaxYearOptions(['2024-05-01'], '2026-09-21');
    for (const option of options) {
      if (option.key === ALL_TIME_KEY) continue;
      expect(option.label).toContain('tax year (1 Mar');
      expect(option.startDate).toMatch(/^\d{4}-03-01$/);
      expect(option.endDate).toMatch(/^\d{4}-02-(28|29)$/);
    }
  });
});
