import { formatCurrency } from '../utils/currency';
import type { NudgeMessage } from '../../infrastructure/notifications/LocalNotificationScheduler';

/**
 * VAL2-11 pull-back nudges: the minimal PERIOD-scoped envelope shape the
 * message builders below need. Deliberately not `EnvelopeEntity` — callers
 * (currently `rearmBudgetNudges`) already read `allocatedCents` and a
 * derived `spentCents` (from `getEnvelopeSpentCents`) for period-scoped rows
 * only; persistent envelopes never belong in this input (a fund isn't "on
 * track" against a monthly allocation — see `getEnvelopeScope`).
 */
export interface PeriodEnvelopeSnapshot {
  allocatedCents: number;
  spentCents: number;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * "Payday countdown" nudge copy: total UNSPENT allocation left across every
 * PERIOD envelope, as of schedule time. Pure — takes the numbers it needs as
 * input rather than reading anything itself, so it is trivially unit
 * testable and never needs a real clock, db, or store.
 */
export function buildPeriodClosingMessage(envelopes: PeriodEnvelopeSnapshot[]): NudgeMessage {
  const remainingCents = envelopes.reduce(
    (sum, envelope) => sum + Math.max(0, envelope.allocatedCents - envelope.spentCents),
    0,
  );
  return {
    title: '3 days to payday',
    body: `${formatCurrency(remainingCents)} left across ${pluralize(envelopes.length, 'envelope')}`,
  };
}

/**
 * "Weekly check-in" nudge copy: this week's total spend (`weekSpentCents`,
 * computed by the caller from the transaction ledger) alongside how many
 * PERIOD envelopes are still within their allocation ("on track") as of
 * schedule time.
 */
export function buildWeeklyCheckInMessage(
  envelopes: PeriodEnvelopeSnapshot[],
  weekSpentCents: number,
): NudgeMessage {
  const onTrackCount = envelopes.filter(
    (envelope) => envelope.spentCents <= envelope.allocatedCents,
  ).length;
  return {
    title: 'Your week in envelopes',
    body: `This week: ${formatCurrency(weekSpentCents)} spent, ${pluralize(onTrackCount, 'envelope')} on track`,
  };
}
