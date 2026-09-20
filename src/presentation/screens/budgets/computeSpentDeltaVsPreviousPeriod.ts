import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

type ComparableEnvelope = Pick<EnvelopeEntity, 'name' | 'envelopeType' | 'spentCents'>;

/**
 * The change in `spentCents` between `currentEnvelope` and its match in
 * `previousPeriodEnvelopes` (VAL2-4) — "vs previous month" on the budget
 * screen's expense rows.
 *
 * A PERIOD-scoped envelope ('spending' | 'income' | 'utility') gets a fresh
 * row every period (see `getEnvelopeScope`), so there is no shared id to
 * join on across periods. Rollover copies envelope NAMES verbatim (see
 * `StartNewPeriodUseCase`), so matching by name + type is the correct join
 * key here — an id-based join would never match anything.
 *
 * Returns `null` when no previous-period envelope has the same name and
 * type (a brand-new envelope this period, or the household skipped/renamed
 * it) — there is nothing to compare against, not a delta of the full spend.
 */
export function computeSpentDeltaVsPreviousPeriod(
  currentEnvelope: ComparableEnvelope,
  previousPeriodEnvelopes: ComparableEnvelope[],
): number | null {
  const match = previousPeriodEnvelopes.find(
    (e) => e.name === currentEnvelope.name && e.envelopeType === currentEnvelope.envelopeType,
  );
  return match ? currentEnvelope.spentCents - match.spentCents : null;
}
