import type { EnvelopeEntity } from '../envelopes/EnvelopeEntity';
import { getEnvelopeScope } from '../envelopes/EnvelopeEntity';
import type { TransactionEntity } from '../transactions/TransactionEntity';
import type { CategoryBaseline, CategoryBaselines } from './CategoryBaseline';
import { baselineKey } from './CategoryBaseline';
import {
  baselineWeightFor,
  blendProjectedTotalSpendCents,
  getPeriodDayCounts,
} from './ForecastBlend';

export type ForecastStatus = 'on_track' | 'warning' | 'over_budget';

export interface EnvelopeForecast {
  envelopeId: string;
  envelopeName: string;
  allocatedCents: number;
  spentCents: number;
  /**
   * Observed average spend per elapsed day, FLOORED AT ZERO — a net-refunded
   * envelope has a negative `spentCents` and refunds are not a spending rate
   * to extrapolate. Never negative.
   */
  dailySpendCents: number;
  daysElapsed: number;
  daysRemaining: number;
  projectedSpendRemainingCents: number;
  projectedRemainingCents: number;
  projectedRemainingPct: number;
  status: ForecastStatus;
  /**
   * True when this envelope's spend was classified as a FIXED commitment
   * (see `isFixedCommitment`), so `projectedSpendRemainingCents` is 0 and the
   * projection is simply what has already been spent. `dailySpendCents` is
   * still the observed average and is meaningless for these.
   */
  isFixed: boolean;
  /**
   * The history baseline this category was matched to by
   * (envelope_type, lower(trim(name))), or null when there is no usable
   * history — in which case every figure below is the pure run-rate
   * behaviour this screen has always had.
   */
  baseline: CategoryBaseline | null;
  /**
   * Projected TOTAL spend for the whole period: `spentCents +
   * projectedSpendRemainingCents`, carried explicitly because it is what the
   * period summary adds up and what "likely to overshoot" compares against
   * the allocation.
   */
  projectedTotalSpendCents: number;
  /** Weight the history baseline carried in that projection — see `ForecastBlend`. */
  baselineWeight: number;
  /**
   * What this household has USUALLY spent on this category by this same
   * day-of-period (median over the baseline's periods), or null without a
   * baseline.
   */
  typicalSpendByTodayCents: number | null;
  /**
   * `spentCents - typicalSpendByTodayCents`: positive means spending FASTER
   * than usual by this day of the period, negative slower. Null without a
   * baseline.
   */
  paceVsTypicalCents: number | null;
}

export interface ForecastInput {
  envelopes: EnvelopeEntity[];
  /**
   * This period's transactions. Used ONLY to tell a fixed commitment (rent,
   * one debit order) from ongoing day-by-day spending — see
   * `isFixedCommitment`. Amounts still come from the envelope aggregates, so
   * omitting this costs no accuracy on `spentCents`; it only disables
   * fixed-bill detection, leaving every envelope extrapolated as before.
   */
  transactions?: TransactionEntity[];
  /**
   * History baselines keyed by `baselineKey(envelopeType, name)` — see
   * `buildCategoryBaselines`. OPTIONAL on purpose: omitted (or with no entry
   * matching a given envelope) the forecast is exactly the current-period
   * run-rate extrapolation it has always been, which is the right answer for
   * a household with no closed periods to learn from.
   */
  baselines?: CategoryBaselines;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  today?: Date;
}

/** At most this many transactions in a period still reads as a fixed commitment, not a spending pattern. */
const FIXED_COMMITMENT_MAX_TRANSACTIONS = 2;

/** A single transaction worth at least this share of the allocation is the bill itself, not a sample of a rate. */
const FIXED_COMMITMENT_DOMINANT_SHARE = 0.5;

/**
 * True if this envelope's spend is a FIXED commitment rather than a daily
 * burn rate that can sensibly be extrapolated.
 *
 * Rent debited on day 1 of the period produced the worst forecast in the app:
 * one R12,000 transaction over 1 elapsed day became "R12,000/day", projected
 * another R348,000 for the rest of the month and reported every household as
 * catastrophically over budget. A commitment paid in one or two lumps has
 * already happened — the honest projection is what has been spent, with
 * nothing added.
 *
 * Two independent signals, either of which is enough:
 *  - at most `FIXED_COMMITMENT_MAX_TRANSACTIONS` transactions in the period
 *    (a bill, or a bill plus a correction — not a spending pattern), or
 *  - a single transaction of at least `FIXED_COMMITMENT_DOMINANT_SHARE` of
 *    the allocation (the envelope's whole purpose arrived in one payment,
 *    even if some small extras followed).
 *
 * At least one transaction must be present: with none, the envelope's spend
 * cannot be characterised at all and the ordinary extrapolation applies.
 */
function isFixedCommitment(
  envelope: EnvelopeEntity,
  periodTransactions: TransactionEntity[],
): boolean {
  if (periodTransactions.length === 0) return false;
  if (periodTransactions.length <= FIXED_COMMITMENT_MAX_TRANSACTIONS) return true;
  if (envelope.allocatedCents <= 0) return false;
  const largest = periodTransactions.reduce((max, tx) => Math.max(max, tx.amountCents), 0);
  return largest >= envelope.allocatedCents * FIXED_COMMITMENT_DOMINANT_SHARE;
}

/** Groups `transactions` by `envelopeId`, so each envelope's classification is an O(1) lookup. */
function groupByEnvelope(transactions: TransactionEntity[]): Map<string, TransactionEntity[]> {
  const byEnvelope = new Map<string, TransactionEntity[]>();
  for (const transaction of transactions) {
    const bucket = byEnvelope.get(transaction.envelopeId);
    if (bucket) {
      bucket.push(transaction);
    } else {
      byEnvelope.set(transaction.envelopeId, [transaction]);
    }
  }
  return byEnvelope;
}

export class CashFlowForecaster {
  project(input: ForecastInput): EnvelopeForecast[] {
    const today = input.today ?? new Date();
    const { daysElapsed, daysRemaining, daysInPeriod } = getPeriodDayCounts(
      input.periodStart,
      input.periodEnd,
      today,
    );

    const transactionsByEnvelope = groupByEnvelope(input.transactions ?? []);
    const canClassify = input.transactions !== undefined;

    return input.envelopes
      .filter(
        // PERSISTENT envelopes ('sinking_fund' | 'emergency_fund' | 'savings'
        // | 'baby_step') are excluded wholesale via the canonical scope
        // helper, not by naming 'sinking_fund' alone as before. Their
        // `spentCents` is an ALL-TIME total spanning every period the fund
        // has existed, so dividing it by this period's elapsed days invented
        // a daily burn rate out of years-old withdrawals — and their
        // `allocatedCents` is a monthly contribution, not a spending budget,
        // so "% of budget remaining" is meaningless for them either way.
        (e) => !e.isArchived && e.envelopeType !== 'income' && getEnvelopeScope(e) === 'period',
      )
      .map((e): EnvelopeForecast => {
        const spentCents = e.spentCents;
        // REFUNDS: `spentCents` is a derived signed SUM, so a net-refunded
        // envelope makes this negative — and a negative rate multiplied by
        // `daysRemaining` below would forecast FUTURE REFUNDS, inventing
        // money the household has no reason to expect. A refund is a one-off
        // credit, not a spending rate, so the observed rate floors at zero:
        // the honest projection for such an envelope is "no further spend".
        const dailySpendCents = Math.max(0, Math.round(spentCents / daysElapsed));
        const isFixed = canClassify && isFixedCommitment(e, transactionsByEnvelope.get(e.id) ?? []);
        const runRateSpendRemainingCents = isFixed ? 0 : dailySpendCents * daysRemaining;

        // HISTORY. With a baseline, the run-rate extrapolation stops being
        // the whole answer and becomes one of two, weighted by how much of
        // the period has actually been observed (see `ForecastBlend` for the
        // rule). Without one, `projectedSpendRemainingCents` is byte-for-byte
        // the run-rate figure this screen has always produced.
        const baseline = input.baselines?.get(baselineKey(e.envelopeType, e.name)) ?? null;
        const weight = baseline === null ? 0 : baselineWeightFor(daysElapsed, daysInPeriod);
        const projectedTotalSpendCents =
          baseline === null
            ? spentCents + runRateSpendRemainingCents
            : blendProjectedTotalSpendCents(
                spentCents,
                spentCents + runRateSpendRemainingCents,
                baseline.typicalPeriodSpendCents,
                weight,
              );
        // Never negative: a projection below what is already spent would be a
        // forecast of future REFUNDS, which no history entitles anyone to
        // expect (the same rule the floored daily rate enforces above).
        const projectedSpendRemainingCents = Math.max(0, projectedTotalSpendCents - spentCents);
        const projectedRemainingCents = e.allocatedCents - projectedTotalSpendCents;
        // No allocation means no denominator. Untouched stays 100% / on_track;
        // any real or projected spend against a zero budget is unbudgeted
        // overspend, so report 0% and let the `< 10` threshold mark it over_budget.
        // REFUNDS: a net-refunded envelope projects MORE money left than it
        // was allocated, which printed as "180% projected left". An envelope
        // cannot have more than all of its budget remaining, so the top is
        // capped at 100. The bottom is deliberately NOT clamped: a heavy
        // overspend legitimately reports a negative percentage, and the
        // `< 10` / `< 20` status thresholds below read it.
        const projectedRemainingPct =
          e.allocatedCents === 0
            ? spentCents > 0 || projectedSpendRemainingCents > 0
              ? 0
              : 100
            : Math.min(100, Math.round((projectedRemainingCents / e.allocatedCents) * 100));

        let status: ForecastStatus;
        if (projectedRemainingPct < 10) {
          status = 'over_budget';
        } else if (projectedRemainingPct < 20) {
          status = 'warning';
        } else {
          status = 'on_track';
        }

        return {
          envelopeId: e.id,
          envelopeName: e.name,
          allocatedCents: e.allocatedCents,
          spentCents,
          dailySpendCents,
          daysElapsed,
          daysRemaining,
          projectedSpendRemainingCents,
          projectedRemainingCents,
          projectedRemainingPct,
          status,
          isFixed,
          baseline,
          projectedTotalSpendCents,
          baselineWeight: weight,
          typicalSpendByTodayCents: baseline?.typicalSpendByDayCents ?? null,
          paceVsTypicalCents:
            baseline?.typicalSpendByDayCents === undefined ||
            baseline?.typicalSpendByDayCents === null
              ? null
              : spentCents - baseline.typicalSpendByDayCents,
        };
      });
  }
}
