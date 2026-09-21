/**
 * THE BLENDING RULE — stated once, here, and nowhere else.
 *
 * Two forecasts of what a category will cost by period end are available:
 *
 *  - the HISTORY BASELINE: the median of the last N closed periods. It knows
 *    nothing about this period, but it is never absurd.
 *  - the RUN RATE: `spent / daysElapsed * daysRemaining + spent`. It knows
 *    everything about this period, but on day 2 a single grocery shop
 *    extrapolates to a fantasy month and a rent payment on day 1 "projects"
 *    thirty rents.
 *
 * Their reliability is exactly inverted over the period, so the weight moves
 * linearly with how much of the period has actually been observed:
 *
 *     baselineWeight = 1 - daysElapsed / daysInPeriod
 *
 * Day 1 of 30 → 0.97 baseline (the run rate has seen 1/30th of the evidence);
 * halfway → an even split; the last day → 0 baseline, i.e. purely what
 * actually happened, which by then is a fact rather than a forecast.
 *
 * A linear ramp is deliberate over anything cleverer: it is monotone, it hits
 * both endpoints exactly, and a household can be told what it does in one
 * sentence — "early in the month we go on what you usually spend, and hand
 * over to what you have actually spent as the month plays out".
 */

import { differenceInDays, parseISO } from 'date-fns';

export interface PeriodDayCounts {
  /** 1-based: `periodStart` itself is day 1, and today counts as elapsed. */
  daysElapsed: number;
  /** Days after today, up to and including `periodEnd`. */
  daysRemaining: number;
  /** Total days the period spans, inclusive of both boundaries. */
  daysInPeriod: number;
}

/**
 * Where `today` sits inside `[periodStart, periodEnd]`.
 *
 * Lives beside the blending rule because the rule is a function of it, and is
 * exported so the SCREEN asks history for its cumulative figure at exactly
 * the same day-of-period the projection is blended at — two different
 * definitions of "day 9" would silently compare this period's day 9 against
 * history's day 10.
 */
export function getPeriodDayCounts(
  periodStart: string,
  periodEnd: string,
  today: Date = new Date(),
): PeriodDayCounts {
  const start = parseISO(periodStart);
  const end = parseISO(periodEnd);
  // +1 so today counts as an elapsed day (Apr 1 → Apr 10 = 10 days, not 9).
  // daysRemaining is exclusive of today (already in elapsed): Apr 10 → Apr 30 = 20 days.
  return {
    daysElapsed: Math.max(1, differenceInDays(today, start) + 1),
    daysRemaining: Math.max(0, differenceInDays(end, today)),
    daysInPeriod: Math.max(1, differenceInDays(end, start) + 1),
  };
}

/** Baseline weight on day 1 of the period: trust history almost entirely. */
export const BASELINE_WEIGHT_AT_PERIOD_START = 1;

/** Baseline weight on the last day: the period is over, only facts remain. */
export const BASELINE_WEIGHT_AT_PERIOD_END = 0;

/**
 * Weight given to the HISTORY BASELINE for a period that is `daysElapsed`
 * days into its `daysInPeriod` days. The run rate gets `1 - this`.
 *
 * `daysElapsed` is 1-based (period_start itself is day 1), matching
 * `CashFlowForecaster`. Clamped to [0, 1] so a stale clock, a period being
 * viewed after it ended, or a zero-length period can never produce a weight
 * outside the two endpoint constants above.
 */
export function baselineWeightFor(daysElapsed: number, daysInPeriod: number): number {
  if (daysInPeriod <= 0) return BASELINE_WEIGHT_AT_PERIOD_END;
  const elapsedFraction = Math.min(1, Math.max(0, daysElapsed / daysInPeriod));
  return (
    BASELINE_WEIGHT_AT_PERIOD_START +
    (BASELINE_WEIGHT_AT_PERIOD_END - BASELINE_WEIGHT_AT_PERIOD_START) * elapsedFraction
  );
}

/**
 * The blended projection of TOTAL spend for the period, in whole cents.
 *
 * Floored at `spentCents`: money already out of the account cannot be
 * un-spent, so a baseline lower than what has already gone never forecasts a
 * refund. (The floor is a `max`, not a clamp, so a net-refunded category —
 * negative `spentCents` — still simply takes the blend.)
 */
export function blendProjectedTotalSpendCents(
  spentCents: number,
  runRateTotalCents: number,
  baselineTotalCents: number,
  weight: number,
): number {
  const blended = Math.round(baselineTotalCents * weight + runRateTotalCents * (1 - weight));
  return Math.max(spentCents, blended);
}
