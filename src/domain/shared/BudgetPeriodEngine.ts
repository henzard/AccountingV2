import { format } from 'date-fns';
import type { BudgetPeriod } from './types';

/** Number of days in `year`/`month` (`month` is 0-based, matching `Date.UTC`). */
function daysInUtcMonth(year: number, month: number): number {
  // Day 0 of "next month" is the last day of `month` — a standard UTC-safe
  // trick that also correctly accounts for leap Februaries.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * The payday day-of-month to actually use when building a boundary in
 * `year`/`month` (0-based): `paydayDay` clamped to that month's last real
 * day. Without this clamp, `Date.UTC(year, month, paydayDay)` silently
 * OVERFLOWS into the next month whenever `paydayDay` (28/29/30/31) exceeds
 * the number of days `month` actually has (e.g. payday 31 in a 28/29/30-day
 * month) — see M13 in the 2026-07-05 exhaustive audit. Clamping here makes
 * every boundary land ON the short month's last day instead, matching the
 * intended "paid on this day, or the last day of the month if it doesn't
 * have that day" semantics.
 */
function clampPaydayForMonth(year: number, month: number, paydayDay: number): number {
  return Math.min(paydayDay, daysInUtcMonth(year, month));
}

/**
 * Formats a `BudgetPeriod` boundary Date as a `yyyy-MM-dd` key using its UTC
 * calendar fields — the exact fields `Date.UTC(...)` used to build it above.
 *
 * `period.startDate`/`endDate` are constructed at UTC midnight, but callers
 * across the app have historically formatted them with date-fns
 * `format(date, 'yyyy-MM-dd')`, which reads the HOST's LOCAL calendar day —
 * on any UTC-negative device that is one calendar day earlier than the UTC
 * instant actually stored (L7, 2026-07-05 audit). Since `period_start` is
 * used as an exact-match scope key (`envelopeScopeCondition`) and hashed
 * into the deterministic rollover id (`rolloverEnvelopeId`), a local-tz
 * format() call produces the WRONG key on such devices — envelope queries
 * silently miss the period's own rows. Use this helper instead of
 * `format(date, 'yyyy-MM-dd')` wherever a period boundary becomes a
 * persisted/queried key, to keep the key tz-independent everywhere it is
 * computed.
 */
export function formatPeriodDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class BudgetPeriodEngine {
  getCurrentPeriod(paydayDay: number, referenceDate: Date = new Date()): BudgetPeriod {
    return this.getPeriodForDate(paydayDay, referenceDate);
  }

  getPeriodForDate(paydayDay: number, date: Date): BudgetPeriod {
    const day = date.getUTCDate();
    let startYear = date.getUTCFullYear();
    let startMonth = date.getUTCMonth(); // 0-based

    // Compare against THIS month's clamped payday, not the raw `paydayDay` —
    // otherwise a short month (e.g. Feb with paydayDay=31) would never
    // satisfy `day >= paydayDay` and always look "before payday".
    const effectivePaydayThisMonth = clampPaydayForMonth(startYear, startMonth, paydayDay);

    if (day >= effectivePaydayThisMonth) {
      // We are in or past this month's payday — period starts this month
    } else {
      // We haven't reached this month's payday — period started last month
      startMonth -= 1;
      if (startMonth < 0) {
        startMonth = 11;
        startYear -= 1;
      }
    }

    const startDay = clampPaydayForMonth(startYear, startMonth, paydayDay);
    const startDate = new Date(Date.UTC(startYear, startMonth, startDay));

    // End date is one day before next month's payday
    let endMonth = startMonth + 1;
    let endYear = startYear;
    if (endMonth > 11) {
      endMonth = 0;
      endYear += 1;
    }
    const endDay = clampPaydayForMonth(endYear, endMonth, paydayDay);
    const endDate = new Date(Date.UTC(endYear, endMonth, endDay - 1));

    const label = `${format(startDate, 'd MMM')} – ${format(endDate, 'd MMM')}`;

    return { startDate, endDate, label };
  }

  isDateInPeriod(date: Date, period: BudgetPeriod): boolean {
    return date >= period.startDate && date <= period.endDate;
  }

  /**
   * Returns true if `referenceDate` is within `windowDays` days of the most
   * recent payday boundary. Used by the dashboard rollover prompt to fire once
   * at the start of each new period, then stay silent for the rest of the month.
   */
  isNewPeriodWithin(
    paydayDay: number,
    windowDays: number,
    referenceDate: Date = new Date(),
  ): boolean {
    const period = this.getPeriodForDate(paydayDay, referenceDate);
    const msSinceStart = referenceDate.getTime() - period.startDate.getTime();
    const daysSinceStart = Math.floor(msSinceStart / (1000 * 60 * 60 * 24));
    return daysSinceStart >= 0 && daysSinceStart <= windowDays;
  }
}
