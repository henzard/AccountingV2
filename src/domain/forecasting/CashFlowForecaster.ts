import { differenceInDays, parseISO } from 'date-fns';
import type { EnvelopeEntity } from '../envelopes/EnvelopeEntity';
import type { TransactionEntity } from '../transactions/TransactionEntity';

export type ForecastStatus = 'on_track' | 'warning' | 'over_budget';

export interface EnvelopeForecast {
  envelopeId: string;
  envelopeName: string;
  allocatedCents: number;
  spentCents: number;
  dailySpendCents: number;
  daysElapsed: number;
  daysRemaining: number;
  projectedSpendRemainingCents: number;
  projectedRemainingCents: number;
  projectedRemainingPct: number;
  status: ForecastStatus;
}

export interface ForecastInput {
  envelopes: EnvelopeEntity[];
  transactions: TransactionEntity[];
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  today?: Date;
}

export class CashFlowForecaster {
  project(input: ForecastInput): EnvelopeForecast[] {
    const today = input.today ?? new Date();
    const start = parseISO(input.periodStart);
    const end = parseISO(input.periodEnd);

    // +1 for inclusive counting: today counts as elapsed, period-end counts as remaining
    const daysElapsed = Math.max(1, differenceInDays(today, start) + 1);
    const daysRemaining = Math.max(0, differenceInDays(end, today) + 1);

    return input.envelopes
      .filter(
        (e) => !e.isArchived && e.envelopeType !== 'income' && e.envelopeType !== 'sinking_fund',
      )
      .map((e): EnvelopeForecast => {
        const spentCents = e.spentCents;
        const dailySpendCents = Math.round(spentCents / daysElapsed);
        const projectedSpendRemainingCents = dailySpendCents * daysRemaining;
        const projectedRemainingCents =
          e.allocatedCents - spentCents - projectedSpendRemainingCents;
        const projectedRemainingPct =
          e.allocatedCents === 0
            ? 100
            : Math.round((projectedRemainingCents / e.allocatedCents) * 100);

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
        };
      });
  }
}
