/**
 * useBudgetBalance — wraps BudgetBalanceCalculator over current-period envelopes.
 *
 * Follows useEnvelopes pattern for current-period resolution (caller passes periodStart).
 * Memoises the calculated result so the reference is stable when envelopes haven't changed.
 *
 * Returns { incomeTotal, expenseAllocationTotal, toAssign, isBalanced }.
 *
 * Spec §Presentation layer — useBudgetBalance.
 */

import { useMemo } from 'react';
import { calculateBudgetBalance } from '../../domain/budgets/BudgetBalanceCalculator';
import type { EnvelopeEntity } from '../../domain/envelopes/EnvelopeEntity';

export interface UseBudgetBalanceResult {
  incomeTotal: number;
  expenseAllocationTotal: number;
  toAssign: number;
  isBalanced: boolean;
}

export function useBudgetBalance(envelopes: EnvelopeEntity[]): UseBudgetBalanceResult {
  return useMemo(() => {
    const balance = calculateBudgetBalance(envelopes);
    return {
      incomeTotal: balance.incomeTotal,
      expenseAllocationTotal: balance.expenseAllocationTotal,
      toAssign: balance.toAssign,
      isBalanced: balance.toAssign === 0,
    };
  }, [envelopes]);
}
