import type { EnvelopeForecast } from './CashFlowForecaster';
import type { CategoryBaseline } from './CategoryBaseline';

/**
 * Turns a forecast into the sentences a household can act on, instead of a
 * bar and a percentage.
 *
 * Money is rendered through an injected `formatCurrency` rather than imported
 * here: currency formatting lives in the presentation layer (`formatCurrency`
 * in `presentation/utils/currency`), and the domain must not reach into it.
 * The screen passes that exact shared helper in, so there is still only one
 * money format in the app.
 */
export type CurrencyFormatter = (cents: number) => string;

/** How many "most likely to overshoot" categories a period summary names. */
export const MAX_AT_RISK_CATEGORIES = 3;

export interface ForecastInsightCopy {
  /** The headline sentence — position at period end vs the allocation. */
  headline: string;
  /** Pace against the household's usual pace by this day, or null without history. */
  pace: string | null;
  /** One accessibility label carrying both, for the row's figures. */
  accessibilityLabel: string;
}

function projectedText(
  forecast: EnvelopeForecast,
  baseline: CategoryBaseline | null,
  format: CurrencyFormatter,
): string {
  if (baseline === null) return `projected to reach ${format(forecast.projectedTotalSpendCents)}`;
  return `you usually spend about ${format(baseline.typicalPeriodSpendCents)} on ${forecast.envelopeName}`;
}

/**
 * Plain-language position for one category. Every branch names the CASH
 * figure, never a colour or a bar alone — "over budget" must be legible with
 * the colours switched off.
 */
export function buildEnvelopeInsight(
  forecast: EnvelopeForecast,
  format: CurrencyFormatter,
): ForecastInsightCopy {
  const baseline = forecast.baseline ?? null;
  const overshootCents = forecast.projectedTotalSpendCents - forecast.allocatedCents;

  let headline: string;
  if (forecast.allocatedCents <= 0 && forecast.projectedTotalSpendCents > 0) {
    // Zero allocation with spend is an overspend, not a free pass — the same
    // rule the percentage already encodes.
    headline = `Not budgeted this period — ${format(forecast.spentCents)} spent, ${projectedText(forecast, baseline, format)}`;
  } else if (overshootCents > 0) {
    headline = `Likely over by ${format(overshootCents)} — ${projectedText(forecast, baseline, format)}`;
  } else {
    headline = `On track — ${projectedText(forecast, baseline, format)}; ${format(-overshootCents)} left`;
  }

  let pace: string | null = null;
  if (forecast.paceVsTypicalCents !== null && baseline?.throughDayOfPeriod != null) {
    const day = baseline.throughDayOfPeriod;
    const delta = forecast.paceVsTypicalCents;
    if (delta > 0) {
      pace = `${format(delta)} ahead of your usual pace by day ${day}`;
    } else if (delta < 0) {
      pace = `${format(-delta)} behind your usual pace by day ${day}`;
    } else {
      pace = `Exactly your usual pace by day ${day}`;
    }
  }

  return {
    headline,
    pace,
    accessibilityLabel: pace === null ? headline : `${headline}. ${pace}.`,
  };
}

export interface PeriodForecastSummary {
  projectedTotalSpendCents: number;
  totalAllocatedCents: number;
  incomeAllocatedCents: number;
  /** `totalAllocatedCents - projectedTotalSpendCents`: negative means the budget does not cover the projection. */
  projectedVsAllocatedCents: number;
  /** `incomeAllocatedCents - projectedTotalSpendCents`: negative means the projection outruns the income allocated. */
  projectedVsIncomeCents: number;
  /** The categories most likely to overshoot, biggest overshoot first, at most `MAX_AT_RISK_CATEGORIES`. */
  atRisk: EnvelopeForecast[];
}

/**
 * The period-level position: what the whole budget is projected to cost,
 * against what was allocated and what was allocated as income.
 *
 * `incomeAllocatedCents` is supplied by the caller from the INCOME envelopes'
 * allocations — income envelopes are never forecast as spending (the
 * forecaster filters them out entirely), so their money can only enter here
 * as an explicit total.
 */
export function summarisePeriodForecast(
  forecasts: readonly EnvelopeForecast[],
  incomeAllocatedCents: number,
): PeriodForecastSummary {
  let projectedTotalSpendCents = 0;
  let totalAllocatedCents = 0;
  for (const forecast of forecasts) {
    projectedTotalSpendCents += forecast.projectedTotalSpendCents;
    totalAllocatedCents += forecast.allocatedCents;
  }

  const atRisk = forecasts
    .filter((f) => f.projectedTotalSpendCents > f.allocatedCents)
    .sort(
      (a, b) =>
        b.projectedTotalSpendCents -
        b.allocatedCents -
        (a.projectedTotalSpendCents - a.allocatedCents),
    )
    .slice(0, MAX_AT_RISK_CATEGORIES);

  return {
    projectedTotalSpendCents,
    totalAllocatedCents,
    incomeAllocatedCents,
    projectedVsAllocatedCents: totalAllocatedCents - projectedTotalSpendCents,
    projectedVsIncomeCents: incomeAllocatedCents - projectedTotalSpendCents,
    atRisk,
  };
}

/** The period summary as one sentence, plus the at-risk categories as another. */
export function buildPeriodSummaryCopy(
  summary: PeriodForecastSummary,
  format: CurrencyFormatter,
): { headline: string; atRisk: string | null } {
  const headline =
    summary.projectedVsAllocatedCents >= 0
      ? `Projected to spend ${format(summary.projectedTotalSpendCents)} of the ${format(summary.totalAllocatedCents)} allocated — ${format(summary.projectedVsAllocatedCents)} to spare.`
      : `Projected to spend ${format(summary.projectedTotalSpendCents)} against ${format(summary.totalAllocatedCents)} allocated — ${format(-summary.projectedVsAllocatedCents)} more than budgeted.`;

  const atRisk =
    summary.atRisk.length === 0
      ? null
      : `Most likely to overshoot: ${summary.atRisk
          .map(
            (f) =>
              `${f.envelopeName} (${format(f.projectedTotalSpendCents - f.allocatedCents)} over)`,
          )
          .join(', ')}.`;

  return { headline, atRisk };
}
