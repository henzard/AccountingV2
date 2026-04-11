import { addMonths } from 'date-fns';
import type { DebtEntity } from './DebtEntity';

export interface DebtProjection {
  debtId: string;
  creditorName: string;
  monthsToPayoff: number;  // -1 if not payable with current payments
  payoffDate: Date;
}

export interface SnowballPlan {
  projections: DebtProjection[];
  debtFreeDate: Date | null;
}

export class SnowballPayoffProjector {
  private static readonly MAX_MONTHS = 600; // 50-year safety cap

  /**
   * Simulates the Dave Ramsey snowball method.
   * Debts are processed in sortOrder ascending (smallest balance first by default).
   * extraMonthlyPaymentCents is added to the first debt's payment and rolls forward.
   */
  project(debts: DebtEntity[], extraMonthlyPaymentCents = 0): SnowballPlan {
    const activeDebts = debts
      .filter((d) => !d.isPaidOff && d.outstandingBalanceCents > 0)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    if (activeDebts.length === 0) {
      return { projections: [], debtFreeDate: null };
    }

    const today = new Date();
    const projections: DebtProjection[] = [];
    let snowballCents = extraMonthlyPaymentCents;
    let cumulativeMonths = 0;

    for (const debt of activeDebts) {
      let balance = debt.outstandingBalanceCents;
      const monthlyRate = debt.interestRatePercent / 100 / 12;
      const payment = debt.minimumPaymentCents + snowballCents;
      let months = 0;

      while (balance > 0 && months < SnowballPayoffProjector.MAX_MONTHS) {
        const interest = Math.round(balance * monthlyRate);
        balance = balance + interest - payment;
        if (balance < 0) balance = 0;
        months++;
      }

      if (months >= SnowballPayoffProjector.MAX_MONTHS) {
        projections.push({
          debtId: debt.id,
          creditorName: debt.creditorName,
          monthsToPayoff: -1,
          payoffDate: addMonths(today, SnowballPayoffProjector.MAX_MONTHS),
        });
      } else {
        cumulativeMonths += months;
        projections.push({
          debtId: debt.id,
          creditorName: debt.creditorName,
          monthsToPayoff: cumulativeMonths,
          payoffDate: addMonths(today, cumulativeMonths),
        });
        snowballCents += debt.minimumPaymentCents;
      }
    }

    const lastProjection = projections[projections.length - 1];
    const debtFreeDate = lastProjection ? lastProjection.payoffDate : null;

    return { projections, debtFreeDate };
  }
}
