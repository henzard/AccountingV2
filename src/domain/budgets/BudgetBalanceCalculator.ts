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
 *
 * PERSISTENT envelopes ('sinking_fund' | 'emergency_fund' | 'savings' |
 * 'baby_step') count toward `expenseAllocationTotal` by their
 * `allocatedCents` and NOTHING else, because on those rows `allocatedCents`
 * is precisely this period's MONTHLY CONTRIBUTION — the money being assigned
 * out of this period's income. Their accumulated balance is a separate,
 * derived figure (`getPersistentEnvelopeSavedCents`) built from the
 * contribution ledger, and it must never reach this calculation: charging a
 * fund's whole R1,500 saved against one month's income would show the budget
 * wildly overcommitted every period after the first.
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

/**
 * The only three fields this calculation reads. Typed structurally rather
 * than as a whole `EnvelopeEntity` so a caller working with an in-progress,
 * not-yet-persisted allocation set — the rollover wizard's adjust step, whose
 * "To assign" figure must reflect what the user has TYPED, not what is in the
 * database — can pass those numbers straight in instead of fabricating full
 * entities. Every existing `EnvelopeEntity[]` caller still satisfies this.
 */
export type BudgetBalanceInput = Pick<
  EnvelopeEntity,
  'allocatedCents' | 'envelopeType' | 'isArchived'
>;

export function calculateBudgetBalance(envelopes: readonly BudgetBalanceInput[]): BudgetBalance {
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
