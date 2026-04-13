/**
 * BudgetBalanceCalculator — pure function, no side effects, no repository access.
 *
 * Callers MUST pre-filter envelopes to the current period before passing them.
 * This calculator sums whatever it receives; mixed-period data is caller's problem.
 *
 * Spec §Zero-based budgeting:
 *   incomeTotal = sum(allocatedCents WHERE type='income' AND !archived)
 *   totalAllocated = sum(allocatedCents WHERE !archived)
 *   expenseAllocationTotal = totalAllocated - incomeTotal
 *   toAssign = incomeTotal - expenseAllocationTotal
 *
 * Sealed against future envelope types — no enumeration of spending subtypes.
 */

import type { EnvelopeEntity } from '../envelopes/EnvelopeEntity';

export interface BudgetBalance {
  /** Sum of allocatedCents for income envelopes (not archived). */
  incomeTotal: number;
  /** Sum of allocatedCents for ALL non-archived envelopes. */
  totalAllocated: number;
  /** totalAllocated - incomeTotal */
  expenseAllocationTotal: number;
  /** incomeTotal - expenseAllocationTotal — positive means unassigned, negative means overcommitted */
  toAssign: number;
}

export function calculateBudgetBalance(envelopes: EnvelopeEntity[]): BudgetBalance {
  let incomeTotal = 0;
  let totalAllocated = 0;

  for (const envelope of envelopes) {
    if (envelope.isArchived) continue;
    totalAllocated += envelope.allocatedCents;
    if (envelope.envelopeType === 'income') {
      incomeTotal += envelope.allocatedCents;
    }
  }

  const expenseAllocationTotal = totalAllocated - incomeTotal;
  const toAssign = incomeTotal - expenseAllocationTotal;

  return { incomeTotal, totalAllocated, expenseAllocationTotal, toAssign };
}
