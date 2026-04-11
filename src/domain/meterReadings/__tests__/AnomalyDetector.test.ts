import { AnomalyDetector } from '../AnomalyDetector';
import type { MeterReadingEntity } from '../MeterReadingEntity';

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
    isSynced: false,
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
      makeReading(1000, '2026-01-01'),
      makeReading(1100, '2026-02-01'),
      makeReading(1200, '2026-03-01'),
      makeReading(1300, '2026-04-01'),
    ];
    const current = makeReading(1415, '2026-05-01'); // 115 units consumed
    const result = detector.detect(current, prior);
    expect(result.isAnomaly).toBe(false);
    expect(result.currentConsumption).toBe(115);
  });

  it('returns isAnomaly true when consumption exceeds 20% above average', () => {
    // Rolling average: 100. Current: 150 = 50% above → anomaly
    const prior = [
      makeReading(1000, '2026-01-01'),
      makeReading(1100, '2026-02-01'),
      makeReading(1200, '2026-03-01'),
      makeReading(1300, '2026-04-01'),
    ];
    const current = makeReading(1450, '2026-05-01'); // 150 units consumed
    const result = detector.detect(current, prior);
    expect(result.isAnomaly).toBe(true);
    expect(result.currentConsumption).toBe(150);
    expect(result.rollingAverageConsumption).toBe(100);
    expect(result.deviationPercent).toBeCloseTo(0.5);
  });

  it('returns isAnomaly true when consumption is more than 20% below average', () => {
    // Rolling average: 100. Current: 50 = 50% below → anomaly
    const prior = [
      makeReading(1000, '2026-01-01'),
      makeReading(1100, '2026-02-01'),
      makeReading(1200, '2026-03-01'),
      makeReading(1300, '2026-04-01'),
    ];
    const current = makeReading(1350, '2026-05-01'); // 50 units consumed
    const result = detector.detect(current, prior);
    expect(result.isAnomaly).toBe(true);
  });
});
