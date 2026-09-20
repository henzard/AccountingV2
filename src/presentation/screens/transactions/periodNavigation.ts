import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import type { BudgetPeriod } from '../../../domain/shared/types';

const engine = new BudgetPeriodEngine();

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Steps to the budget period immediately BEFORE `period`, for `paydayDay`.
 *
 * `period.startDate`/`endDate` are UTC-midnight instants (see
 * `BudgetPeriodEngine`), so subtracting exactly one day in milliseconds
 * lands on the last day of the previous period with no DST/local-timezone
 * risk, and re-deriving the period from that date via
 * `getPeriodForDate` reuses the engine's own payday-clamping rule
 * (28/29/30/31-day months) rather than re-implementing it here.
 */
export function getPreviousPeriod(paydayDay: number, period: BudgetPeriod): BudgetPeriod {
  const dayBeforeStart = new Date(period.startDate.getTime() - ONE_DAY_MS);
  return engine.getPeriodForDate(paydayDay, dayBeforeStart);
}

/**
 * Steps to the budget period immediately AFTER `period`, for `paydayDay`.
 * See `getPreviousPeriod` for why one-day arithmetic on the UTC boundary is
 * safe here.
 */
export function getNextPeriod(paydayDay: number, period: BudgetPeriod): BudgetPeriod {
  const dayAfterEnd = new Date(period.endDate.getTime() + ONE_DAY_MS);
  return engine.getPeriodForDate(paydayDay, dayAfterEnd);
}

/**
 * True when `period` is the household's CURRENT budget period (or, as a
 * safety net, somehow already past it) — used to disable the "next period"
 * control so users can't navigate into the future.
 */
export function isCurrentOrFuturePeriod(paydayDay: number, period: BudgetPeriod): boolean {
  const current = engine.getCurrentPeriod(paydayDay);
  return period.startDate.getTime() >= current.startDate.getTime();
}
