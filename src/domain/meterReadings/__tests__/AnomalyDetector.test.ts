import { addDays, format } from 'date-fns';
import { AnomalyDetector } from '../AnomalyDetector';
import type { MeterReadingEntity } from '../MeterReadingEntity';

// Evenly-spaced (30-day) dates from a fixed base. Using EQUAL gaps between
// every reading (including the current one) means the per-day normalisation
// added for MTR-1 divides and re-multiplies by the same day count, so the
// pre-existing exact-number assertions below still hold — this is not
// special-cased math, just a day-gap length that keeps the arithmetic clean.
const BASE = new Date(2026, 0, 1);
function d(daysFromBase: number): string {
  return format(addDays(BASE, daysFromBase), 'yyyy-MM-dd');
}

function makeReading(value: number, date: string): MeterReadingEntity {
  return {
    id: date,
    householdId: 'h1',
    meterType: 'electricity',
    readingValue: value,
    readingDate: date,
    costCents: null,
    vehicleId: null,
    notes: null,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  };
}

describe('AnomalyDetector', () => {
  const detector = new AnomalyDetector();

  it('returns isAnomaly false when fewer than 3 prior readings', () => {
    const current = makeReading(1200, '2026-04-01');
    const prior = [makeReading(1000, '2026-03-01'), makeReading(1100, '2026-02-01')];
    const result = detector.detect(current, prior);
    expect(result.isAnomaly).toBe(false);
  });

  it('returns isAnomaly false when consumption is within 20% of average', () => {
    // Rolling average consumption: 100, 100, 100 = 100. Current: 115 = 15% above → no anomaly
    const prior = [
      makeReading(1000, d(0)),
      makeReading(1100, d(30)),
      makeReading(1200, d(60)),
      makeReading(1300, d(90)),
    ];
    const current = makeReading(1415, d(120)); // 115 units consumed
    const result = detector.detect(current, prior);
    expect(result.isAnomaly).toBe(false);
    expect(result.currentConsumption).toBe(115);
  });

  it('returns isAnomaly true when consumption exceeds 20% above average', () => {
    // Rolling average: 100. Current: 150 = 50% above → anomaly
    const prior = [
      makeReading(1000, d(0)),
      makeReading(1100, d(30)),
      makeReading(1200, d(60)),
      makeReading(1300, d(90)),
    ];
    const current = makeReading(1450, d(120)); // 150 units consumed
    const result = detector.detect(current, prior);
    expect(result.isAnomaly).toBe(true);
    expect(result.currentConsumption).toBe(150);
    expect(result.rollingAverageConsumption).toBeCloseTo(100);
    expect(result.deviationPercent).toBeCloseTo(0.5);
  });

  it('returns isAnomaly true when consumption is more than 20% below average', () => {
    // Rolling average: 100. Current: 50 = 50% below → anomaly
    const prior = [
      makeReading(1000, d(0)),
      makeReading(1100, d(30)),
      makeReading(1200, d(60)),
      makeReading(1300, d(90)),
    ];
    const current = makeReading(1350, d(120)); // 50 units consumed
    const result = detector.detect(current, prior);
    expect(result.isAnomaly).toBe(true);
  });

  // MTR-1: without per-day normalisation, a skipped reading period produces
  // one oversized raw delta that drags the rolling average up, then flags a
  // perfectly normal reading as anomalous purely because of the gap length.
  it('does not flag a normal reading as anomalous after a skipped reading period', () => {
    const prior = [
      makeReading(1000, d(0)),
      makeReading(1100, d(30)), // +100 / 30 days
      makeReading(1200, d(60)), // +100 / 30 days
      makeReading(1500, d(150)), // +300 / 90 days — a skipped period, SAME per-day rate (~3.33/day)
    ];
    // Same per-day rate as the baseline: +100 over the next 30 days.
    const current = makeReading(1600, d(180));
    const result = detector.detect(current, prior);
    expect(result.isAnomaly).toBe(false);
  });

  // MTR-1/MTR-2: a meter replacement produces a negative delta in the prior
  // history. It must be excluded from the rolling-average baseline entirely
  // rather than dragging the average toward/below zero (which would either
  // suppress real anomalies or throw off the deviation math).
  it('excludes a negative delta (meter replacement) from the rolling-average baseline', () => {
    const prior = [
      makeReading(1000, d(0)),
      makeReading(1100, d(30)), // +100 / 30 days
      makeReading(50, d(60)), // meter replaced — negative delta, must be ignored
      makeReading(150, d(90)), // +100 / 30 days on the NEW meter
    ];
    // Consistent with the surviving +100/30-day baseline rate.
    const current = makeReading(250, d(120));
    const result = detector.detect(current, prior);
    expect(result.isAnomaly).toBe(false);
    expect(result.rollingAverageConsumption).toBeCloseTo(100);
  });
});
