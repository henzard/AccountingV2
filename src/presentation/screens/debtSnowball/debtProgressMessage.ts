import { differenceInCalendarMonths } from 'date-fns';
import { formatCurrency } from '../../utils/currency';
import type { DebtSnapshot } from '../../../domain/scoring/RecordPeriodScoreUseCase';

export interface CurrentDebtState {
  totalDebtCents: number;
  debtFreeDate: Date | null;
}

export interface DebtProgressMessages {
  /** "N months sooner/later than last month", or null when there is no
   * previous snapshot, either date is unknown, or the two dates fall in the
   * same calendar month. */
  dateMessage: string | null;
  /** "R… paid off since last month", or null when there is no previous
   * snapshot or total debt did not drop. */
  paidOffMessage: string | null;
}

/**
 * Compares the household's CURRENT debt-snowball plan against last month's
 * recorded snapshot (VAL2-10) — pure and side-effect free so it is testable
 * as a plain table of inputs/outputs. `previous` is whatever
 * `getLatestDebtSnapshot` found, which is `null` when this device has no
 * earlier snapshot at all (new debt plan, or a household migrated before
 * this feature shipped).
 */
export function computeDebtProgressMessage(
  current: CurrentDebtState,
  previous: DebtSnapshot | null,
): DebtProgressMessages {
  if (!previous) {
    return { dateMessage: null, paidOffMessage: null };
  }

  let dateMessage: string | null = null;
  if (current.debtFreeDate && previous.debtFreeDateISO) {
    const previousDate = new Date(previous.debtFreeDateISO);
    if (!Number.isNaN(previousDate.getTime())) {
      // Positive => the current payoff date is EARLIER than last month's
      // (progress); negative => later (setback); zero => no change.
      const monthsSooner = differenceInCalendarMonths(previousDate, current.debtFreeDate);
      if (monthsSooner > 0) {
        dateMessage = `${monthsSooner} ${monthsSooner === 1 ? 'month' : 'months'} sooner than last month`;
      } else if (monthsSooner < 0) {
        const monthsLater = Math.abs(monthsSooner);
        dateMessage = `${monthsLater} ${monthsLater === 1 ? 'month' : 'months'} later than last month`;
      }
    }
  }

  let paidOffMessage: string | null = null;
  const paidOffCents = previous.totalDebtCents - current.totalDebtCents;
  if (paidOffCents > 0) {
    paidOffMessage = `${formatCurrency(paidOffCents)} paid off since last month`;
  }

  return { dateMessage, paidOffMessage };
}
