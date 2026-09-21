/**
 * South African (SARS) tax year helpers — 1 March to end of February.
 *
 * A tax year is keyed by its starting calendar year: the "2026/27" tax year
 * runs 1 Mar 2026 – 28 Feb 2027 (or 29 Feb on the far side of a leap year)
 * and is keyed '2026-2027'.
 *
 * All dates in and out of this module are local date-only strings
 * ('yyyy-MM-dd') — never `Date`/`toISOString()` — so callers must already
 * have derived "today" via the app's local-date convention
 * (`format(new Date(), 'yyyy-MM-dd')`).
 */

export interface TaxYearRange {
  /** Starting calendar year, e.g. 2026 for the 2026/27 tax year. */
  startYear: number;
  /** Ending calendar year, e.g. 2027 for the 2026/27 tax year. */
  endYear: number;
  /** Inclusive start date, 'yyyy-MM-dd' — always 1 March of startYear. */
  startDate: string;
  /** Inclusive end date, 'yyyy-MM-dd' — last day of February of endYear. */
  endDate: string;
  /** Stable identifier, e.g. '2026-2027'. */
  key: string;
}

export interface TaxYearOption {
  /** TaxYearRange.key, or ALL_TIME_KEY for the "All time" option. */
  key: string;
  /** Display label, e.g. "2026/27 tax year (1 Mar 2026 – 28 Feb 2027)". */
  label: string;
  /** Inclusive range start, or null for "All time" (no date filter). */
  startDate: string | null;
  /** Inclusive range end, or null for "All time" (no date filter). */
  endDate: string | null;
}

export const ALL_TIME_KEY = 'all-time';
export const ALL_TIME_LABEL = 'All time';

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function februaryDays(year: number): number {
  return isLeapYear(year) ? 29 : 28;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseDateOnly(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split('-').map((part) => parseInt(part, 10));
  return { year, month, day };
}

function buildTaxYearRange(startYear: number): TaxYearRange {
  const endYear = startYear + 1;
  const startDate = `${startYear}-03-01`;
  const endDate = `${endYear}-02-${pad2(februaryDays(endYear))}`;
  return { startYear, endYear, startDate, endDate, key: `${startYear}-${endYear}` };
}

/**
 * Returns the SARS tax year (1 Mar – end Feb) containing `dateStr`.
 * January and February fall in the tax year that STARTED the previous
 * calendar year; March through December fall in the tax year starting that
 * same calendar year.
 */
export function taxYearForDate(dateStr: string): TaxYearRange {
  const { year, month } = parseDateOnly(dateStr);
  const startYear = month >= 3 ? year : year - 1;
  return buildTaxYearRange(startYear);
}

/** The key of the tax year containing `todayStr`, e.g. '2026-2027'. */
export function currentTaxYearKey(todayStr: string): string {
  return taxYearForDate(todayStr).key;
}

/**
 * Human label, e.g. "2026/27 tax year (1 Mar 2026 – 28 Feb 2027)".
 * Uses an en dash to match the rest of the app's date-range labels
 * (see BudgetScreen's `viewedPeriodRange`).
 */
export function formatTaxYearLabel(range: TaxYearRange): string {
  const shortEnd = String(range.endYear).slice(-2);
  const endDay = februaryDays(range.endYear);
  return `${range.startYear}/${shortEnd} tax year (1 Mar ${range.startYear} – ${endDay} Feb ${range.endYear})`;
}

/**
 * Builds the tax-year picker options: the current tax year (from
 * `todayStr`) plus every tax year with at least one date in
 * `transactionDates`, newest first, followed by "All time" last.
 *
 * The current tax year is always included — even with zero transactions —
 * so a household that hasn't logged a business expense yet this tax year
 * still sees it as the (correct) default selection instead of it silently
 * vanishing from the list.
 */
export function getTaxYearOptions(transactionDates: string[], todayStr: string): TaxYearOption[] {
  const currentRange = taxYearForDate(todayStr);
  const startYears = new Set<number>([currentRange.startYear]);
  for (const date of transactionDates) {
    startYears.add(taxYearForDate(date).startYear);
  }

  const options: TaxYearOption[] = Array.from(startYears)
    .sort((a, b) => b - a)
    .map(buildTaxYearRange)
    .map((range) => ({
      key: range.key,
      label: formatTaxYearLabel(range),
      startDate: range.startDate,
      endDate: range.endDate,
    }));

  options.push({ key: ALL_TIME_KEY, label: ALL_TIME_LABEL, startDate: null, endDate: null });
  return options;
}
