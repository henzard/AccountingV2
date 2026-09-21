import { differenceInCalendarDays, parse } from 'date-fns';
import type { MeterReadingEntity } from './MeterReadingEntity';

export interface AnomalyResult {
  isAnomaly: boolean;
  currentConsumption: number;
  rollingAverageConsumption: number;
  deviationPercent: number; // e.g. 0.5 = 50% deviation
}

// readingDate is a plain 'yyyy-MM-dd' string. Parsing it with `new Date(str)`
// (or anything that goes through Date's ISO-8601 fast path) treats it as UTC
// midnight, which shifts by a day in local time zones ahead of UTC. Parse it
// as a LOCAL calendar date instead so day-gap math matches the date the user
// actually picked.
function parseLocalDate(dateStr: string): Date {
  return parse(dateStr, 'yyyy-MM-dd', new Date());
}

export class AnomalyDetector {
  private static readonly THRESHOLD = 0.2;

  /**
   * Detects if currentReading deviates >20% from the 3-month rolling average.
   * previousReadings must contain at least 4 entries to produce 3 consumption deltas.
   * Fewer than 4 prior readings always returns isAnomaly: false.
   *
   * Consecutive deltas are normalised to a units-PER-DAY rate before being
   * averaged. Without this, a skipped reading period (e.g. two months
   * between readings instead of one) produces one oversized raw delta that
   * skews the rolling average and then flags perfectly normal readings (or
   * hides a real spike) purely because of the gap length, not the actual
   * rate of consumption.
   */
  detect(current: MeterReadingEntity, previousReadings: MeterReadingEntity[]): AnomalyResult {
    const sorted = [...previousReadings].sort((a, b) => a.readingDate.localeCompare(b.readingDate));

    if (sorted.length < 4) {
      return {
        isAnomaly: false,
        currentConsumption: 0,
        rollingAverageConsumption: 0,
        deviationPercent: 0,
      };
    }

    // Compute sequential per-day consumption rates from prior readings.
    // Non-positive deltas (e.g. a replaced meter starting near zero, or a
    // duplicate-dated row) are excluded from the baseline entirely rather
    // than dragging the average toward/below zero. A zero-day gap is
    // guarded against too, even though duplicate dates are rejected
    // upstream by LogMeterReadingUseCase.
    const dailyRates: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const delta = sorted[i].readingValue - sorted[i - 1].readingValue;
      if (delta <= 0) continue;
      const days = differenceInCalendarDays(
        parseLocalDate(sorted[i].readingDate),
        parseLocalDate(sorted[i - 1].readingDate),
      );
      if (days <= 0) continue;
      dailyRates.push(delta / days);
    }

    const lastThreeRates = dailyRates.slice(-3);
    const lastPrior = sorted[sorted.length - 1];
    const currentConsumption = current.readingValue - lastPrior.readingValue;

    if (lastThreeRates.length === 0) {
      return {
        isAnomaly: false,
        currentConsumption,
        rollingAverageConsumption: 0,
        deviationPercent: 0,
      };
    }

    const averageDailyRate = lastThreeRates.reduce((sum, r) => sum + r, 0) / lastThreeRates.length;

    const currentDays = differenceInCalendarDays(
      parseLocalDate(current.readingDate),
      parseLocalDate(lastPrior.readingDate),
    );

    // Project the baseline rate onto the CURRENT interval's length so
    // rollingAverageConsumption stays comparable (same units, same period)
    // to currentConsumption for both the deviation math and the UI, which
    // displays it directly as "your X <unit> average".
    const rollingAverageConsumption = currentDays > 0 ? averageDailyRate * currentDays : 0;

    if (rollingAverageConsumption <= 0 || currentConsumption <= 0) {
      return {
        isAnomaly: false,
        currentConsumption,
        rollingAverageConsumption,
        deviationPercent: 0,
      };
    }

    const deviationPercent =
      Math.abs(currentConsumption - rollingAverageConsumption) / rollingAverageConsumption;

    return {
      isAnomaly: deviationPercent > AnomalyDetector.THRESHOLD,
      currentConsumption,
      rollingAverageConsumption,
      deviationPercent,
    };
  }
}
