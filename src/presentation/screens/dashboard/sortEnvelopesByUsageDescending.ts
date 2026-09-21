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
 * Ranking value for sort purposes: a net-refunded envelope (refunds
 * exceeding purchases, per REFUNDS — a transaction amount may be negative)
 * has a NEGATIVE `usageRatio`. Sorting on that raw ratio put it BELOW a
 * completely untouched envelope (ratio 0), which is arbitrary — "less than
 * no usage" isn't a meaningful distinction the user asked for. Clamped to 0
 * so it ranks alongside untouched envelopes instead.
 */
function rankingRatio(envelope: EnvelopeEntity): number {
  return Math.max(0, usageRatio(envelope));
}

/**
 * Sorts spend envelopes by percentage used, descending (overspent first) —
 * UX2-17. Pure; does not mutate its input.
 *
 * Ties: for any tie NOT involving a clamped negative ratio, `Array.prototype
 * .sort`'s stability keeps envelopes in their original relative order,
 * unchanged from before REFUNDS. A tie AT the clamped ranking of 0 can now
 * mix two different actual ratios (a net-refunded envelope's negative ratio
 * and a genuinely untouched envelope's 0 ratio) that clamping made
 * numerically indistinguishable, so — only for that group — the tie is
 * broken deterministically by name instead of left to input order.
 */
export function sortEnvelopesByUsageDescending(envelopes: EnvelopeEntity[]): EnvelopeEntity[] {
  return [...envelopes].sort((a, b) => {
    // Ties (including a net-refunded envelope against an untouched one, both
    // ranked 0) keep their input order via sort stability. A name tie-break
    // applied ONLY when a refunded envelope is involved would not be a
    // consistent ordering: with B and C untouched and A refunded, A could sort
    // between them by name while B and C still compare equal — a comparator
    // like that gives engine-dependent results.
    return rankingRatio(b) - rankingRatio(a);
  });
}
