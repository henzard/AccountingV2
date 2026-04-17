import { format } from 'date-fns';
import type { BudgetPeriod } from './types';

export class BudgetPeriodEngine {
  getCurrentPeriod(paydayDay: number, referenceDate: Date = new Date()): BudgetPeriod {
    return this.getPeriodForDate(paydayDay, referenceDate);
  }

  getPeriodForDate(paydayDay: number, date: Date): BudgetPeriod {
    const day = date.getUTCDate();
    let startYear = date.getUTCFullYear();
    let startMonth = date.getUTCMonth(); // 0-based

    if (day >= paydayDay) {
      // We are in or past this month's payday — period starts this month
    } else {
      // We haven't reached this month's payday — period started last month
      startMonth -= 1;
      if (startMonth < 0) {
        startMonth = 11;
        startYear -= 1;
      }
    }

    const startDate = new Date(Date.UTC(startYear, startMonth, paydayDay));

    // End date is one day before next month's payday
    let endMonth = startMonth + 1;
    let endYear = startYear;
    if (endMonth > 11) {
      endMonth = 0;
      endYear += 1;
    }
    const endDate = new Date(Date.UTC(endYear, endMonth, paydayDay - 1));

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
