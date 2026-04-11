import type { MeterReadingEntity } from './MeterReadingEntity';

export interface AnomalyResult {
  isAnomaly: boolean;
  currentConsumption: number;
  rollingAverageConsumption: number;
  deviationPercent: number; // e.g. 0.5 = 50% deviation
}

export class AnomalyDetector {
  private static readonly THRESHOLD = 0.20;

  /**
   * Detects if currentReading deviates >20% from the 3-month rolling average.
   * previousReadings must contain at least 3 entries (ordered oldest→newest).
   * Fewer than 3 prior readings always returns isAnomaly: false.
   */
  detect(current: MeterReadingEntity, previousReadings: MeterReadingEntity[]): AnomalyResult {
    const sorted = [...previousReadings].sort((a, b) => a.readingDate.localeCompare(b.readingDate));

    if (sorted.length < 3) {
      return { isAnomaly: false, currentConsumption: 0, rollingAverageConsumption: 0, deviationPercent: 0 };
    }

    // Compute sequential consumption deltas from prior readings
    const deltas: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      deltas.push(sorted[i].readingValue - sorted[i - 1].readingValue);
    }
    const lastThreeDeltas = deltas.slice(-3);
    const rollingAverageConsumption =
      lastThreeDeltas.reduce((sum, d) => sum + d, 0) / lastThreeDeltas.length;

    const lastPrior = sorted[sorted.length - 1];
    const currentConsumption = current.readingValue - lastPrior.readingValue;

    if (rollingAverageConsumption <= 0 || currentConsumption <= 0) {
      return { isAnomaly: false, currentConsumption, rollingAverageConsumption, deviationPercent: 0 };
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
