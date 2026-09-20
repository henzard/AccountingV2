/**
 * "Safe to spend today" — the remaining spend-budget spread evenly over the
 * days left in the period, so a household can see a single daily number
 * instead of doing the division themselves against "Remaining" and "N days
 * left".
 *
 * `remainingCents` is clamped to 0 first (an over-budget period has nothing
 * safe left to spend, not a negative daily figure), and `daysRemainingInPeriod`
 * is clamped to a minimum of 1 (the last day of a period still needs a real
 * divisor, not a divide-by-zero/negative result). Returns whole cents,
 * rounded, ready for `formatCurrency`.
 */
export function calculateSafeToSpendToday(
  remainingCents: number,
  daysRemainingInPeriod: number,
): number {
  const days = daysRemainingInPeriod < 1 ? 1 : daysRemainingInPeriod;
  const safeRemaining = Math.max(0, remainingCents);
  return Math.round(safeRemaining / days);
}
