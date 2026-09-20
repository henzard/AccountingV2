import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

/**
 * Percent of an envelope's allocation used, for sort purposes only — NOT the
 * same rounding as the dashboard row's displayed `%` (which rounds and caps
 * at 100 for the progress bar). An envelope with `allocatedCents === 0` and
 * any spend at all sorts as "fully used" (Infinity) so a zero-budget
 * envelope that has spending against it still surfaces as overspent instead
 * of sorting to the bottom as if it were 0% used.
 */
function usageRatio(envelope: EnvelopeEntity): number {
  if (envelope.allocatedCents <= 0) {
    return envelope.spentCents > 0 ? Number.POSITIVE_INFINITY : 0;
  }
  return envelope.spentCents / envelope.allocatedCents;
}

/**
 * Sorts spend envelopes by percentage used, descending (overspent first) —
 * UX2-17. Pure and stable: ties keep their original relative order (JS
 * `Array.prototype.sort` is stable), so this never re-sorts within a tie.
 * Does not mutate its input.
 */
export function sortEnvelopesByUsageDescending(envelopes: EnvelopeEntity[]): EnvelopeEntity[] {
  return [...envelopes].sort((a, b) => usageRatio(b) - usageRatio(a));
}
