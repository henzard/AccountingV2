import { formatCurrency } from '../../utils/currency';
import type { EnvelopeScope } from '../../../domain/envelopes/EnvelopeEntity';

export interface AfterThisPreviewInput {
  scope: EnvelopeScope;
  envelopeName: string;
  /** The amount currently typed into the Amount field, in cents. */
  amountCents: number;
  /**
   * Period envelopes only: the envelope's remaining budget BEFORE this
   * transaction (`allocatedCents - spentCents`, already net of the
   * transaction's own old amount when editing).
   */
  remainingBeforeCents: number;
  /**
   * Persistent envelopes only: the fund's saved balance BEFORE this
   * transaction (`getPersistentEnvelopeSavedCents`, already net of the
   * transaction's own old amount when editing).
   */
  savedBeforeCents: number;
  /**
   * Period envelopes only: whole days left in the current budget period,
   * including today. Ignored for persistent envelopes.
   */
  daysRemaining: number;
}

export interface AfterThisPreview {
  text: string;
  isNegative: boolean;
}

/**
 * REG-8/VAL2-2 + new "live line" — a cheap, pure preview of what this
 * envelope will look like immediately after the amount currently typed into
 * the Amount field, computed BEFORE the transaction is saved:
 *  - period envelopes show the remaining budget and a per-day burn rate for
 *    the rest of the period;
 *  - funds (persistent envelopes) show the saved balance instead — they have
 *    no "days left" or per-day rate, and must never be described as a
 *    budget (see SpendingCoach).
 *
 * Returns `null` when there is nothing meaningful to preview yet (no
 * envelope selected, callers check that before calling this).
 */
export function computeAfterThisPreview(input: AfterThisPreviewInput): AfterThisPreview {
  if (input.scope === 'persistent') {
    const remaining = input.savedBeforeCents - input.amountCents;
    return {
      text: `After this: ${formatCurrency(remaining)} saved in ${input.envelopeName}`,
      isNegative: remaining < 0,
    };
  }

  const remaining = input.remainingBeforeCents - input.amountCents;
  const days = input.daysRemaining < 1 ? 1 : input.daysRemaining;
  const perDay = Math.round(remaining / days);
  const dayLabel = days === 1 ? 'day' : 'days';
  return {
    text: `After this: ${formatCurrency(remaining)} left in ${input.envelopeName} · about ${formatCurrency(perDay)}/day for ${days} ${dayLabel}`,
    isNegative: remaining < 0,
  };
}
