import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

/**
 * Envelopes to use for the dashboard's spend-side totals: the "Budget"/
 * "Spent" stats, the budget usage ring, the habit-score's discipline inputs
 * (`envelopesOnBudget`/`totalEnvelopes`), the envelope list, and the
 * "N active" count.
 *
 * Excludes 'income' envelopes — onboarding always creates a "Monthly Income"
 * envelope, and its `allocatedCents` is money coming IN, not budgeted OUT.
 * Summing it into "Budget" double-counts every allocation (income + every
 * expense envelope it funds), which both inflates the "Budget" total ~2x and
 * caps the usage ring at roughly 50% even when every expense envelope is
 * fully spent. It also always reads as "on budget" in the habit score since
 * nothing is ever spent against it, quietly inflating the discipline score.
 *
 * Income is shown separately via `calculateBudgetBalance` (see
 * `domain/budgets/BudgetBalanceCalculator`) as an "Income / To assign" line.
 */
export function selectSpendEnvelopes(envelopes: EnvelopeEntity[]): EnvelopeEntity[] {
  return envelopes.filter((e) => e.envelopeType !== 'income');
}
