import { addMonths } from 'date-fns';
import type { DebtEntity } from './DebtEntity';

export interface DebtProjection {
  debtId: string;
  creditorName: string;
  monthsToPayoff: number; // -1 if not payable with current payments
  payoffDate: Date;
}

export interface SnowballPlan {
  projections: DebtProjection[];
  debtFreeDate: Date | null;
}

export class SnowballPayoffProjector {
  private static readonly MAX_MONTHS = 600; // 50-year safety cap

  /**
   * Simulates the Dave Ramsey snowball method month-by-month.
   * Debts are processed in sortOrder ascending (smallest balance first by default).
   * All debts receive minimum payments each month. The focus debt (smallest first)
   * receives the extra snowball amount. When a debt is paid off, its minimum rolls
   * into the snowball for the next focus debt.
   */
  project(debts: DebtEntity[], extraMonthlyPaymentCents = 0): SnowballPlan {
    const activeDebts = debts
      .filter((d) => !d.isPaidOff && d.outstandingBalanceCents > 0)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    if (activeDebts.length === 0) {
      return { projections: [], debtFreeDate: null };
    }

    const today = new Date();
    const balances = activeDebts.map((d) => d.outstandingBalanceCents);
    const paidOff = activeDebts.map(() => false);
    const paidOffMonth = activeDebts.map(() => 0);
    let snowball = extraMonthlyPaymentCents;
    let focusIdx = 0;

    // Advance focus to first unpaid debt (should be 0 initially)
    while (focusIdx < activeDebts.length && paidOff[focusIdx]) {
      focusIdx++;
    }

    // Short-circuit: if ALL debts have payment <= 0, they can never be paid off
    const totalPayment = activeDebts.reduce((sum, d) => sum + d.minimumPaymentCents, 0) + snowball;
    if (totalPayment <= 0) {
      return {
        projections: activeDebts.map((d) => ({
          debtId: d.id,
          creditorName: d.creditorName,
          monthsToPayoff: -1,
          payoffDate: addMonths(today, SnowballPayoffProjector.MAX_MONTHS),
        })),
        debtFreeDate: null,
      };
    }

    let month = 0;
    while (focusIdx < activeDebts.length && month < SnowballPayoffProjector.MAX_MONTHS) {
      month++;

      for (let i = 0; i < activeDebts.length; i++) {
        if (paidOff[i]) continue;

        const debt = activeDebts[i];
        const monthlyRate = debt.interestRatePercent / 100 / 12;
        const interest = Math.round(balances[i] * monthlyRate);
        let payment = debt.minimumPaymentCents;
        if (i === focusIdx) payment += snowball;

        balances[i] = balances[i] + interest - payment;
        if (balances[i] <= 0) {
          balances[i] = 0;
          paidOff[i] = true;
          paidOffMonth[i] = month;
          snowball += debt.minimumPaymentCents;
        }
      }

      // Advance focus past any newly paid-off debts
      while (focusIdx < activeDebts.length && paidOff[focusIdx]) {
        focusIdx++;
      }
    }

    const projections: DebtProjection[] = activeDebts.map((debt, i) => ({
      debtId: debt.id,
      creditorName: debt.creditorName,
      monthsToPayoff: paidOff[i] ? paidOffMonth[i] : -1,
      payoffDate: paidOff[i]
        ? addMonths(today, paidOffMonth[i])
        : addMonths(today, SnowballPayoffProjector.MAX_MONTHS),
    }));

    const allPaidOff = paidOff.every((p) => p);
    const lastMonth = Math.max(...paidOffMonth.filter((_, i) => paidOff[i]));
    const debtFreeDate = allPaidOff ? addMonths(today, lastMonth) : null;

    return { projections, debtFreeDate };
  }
}
