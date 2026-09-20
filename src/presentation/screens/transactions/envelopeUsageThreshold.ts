import { formatCurrency } from '../../utils/currency';

export type UsageThreshold = 80 | 100;

/**
 * Detects whether a save just pushed an envelope's usage (spent/allocated)
 * across the 80% or 100% line — VAL-13.
 *
 * "Crossing" means BEFORE this save the envelope was strictly under the
 * threshold and AFTER this save it is at/over it, so the toast fires once,
 * on the save that actually crosses the line — not on every subsequent save
 * that keeps the envelope above it (e.g. logging a second R10 transaction
 * against an envelope already at 150% must not re-toast).
 *
 * 100% takes priority over 80%: a save that jumps straight from 50% to 120%
 * is "over budget", not "80% used".
 */
export function detectThresholdCrossing(
  previousSpentCents: number,
  newSpentCents: number,
  allocatedCents: number,
): UsageThreshold | null {
  if (allocatedCents <= 0) return null;

  const previousPercent = (previousSpentCents / allocatedCents) * 100;
  const newPercent = (newSpentCents / allocatedCents) * 100;

  if (previousPercent < 100 && newPercent >= 100) return 100;
  if (previousPercent < 80 && newPercent >= 80) return 80;
  return null;
}

/** Builds the toast copy for a detected threshold crossing. */
export function buildThresholdToastMessage(
  threshold: UsageThreshold,
  envelopeName: string,
  allocatedCents: number,
  newSpentCents: number,
): string {
  if (threshold === 100) {
    const overspendCents = newSpentCents - allocatedCents;
    return `${envelopeName} is over budget by ${formatCurrency(overspendCents)}`;
  }
  return `You've used 80% of ${envelopeName}`;
}
