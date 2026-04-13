import { UnitRateCalculator } from '../UnitRateCalculator';
import type { MeterReadingEntity } from '../MeterReadingEntity';

function makeReading(
  value: number,
  costCents: number | null,
  type: 'electricity' | 'water' | 'odometer' = 'electricity',
): MeterReadingEntity {
  return {
    id: 'r1',
    householdId: 'h1',
    meterType: type,
    readingValue: value,
    readingDate: '2026-04-01',
    costCents,
    vehicleId: null,
    notes: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    isSynced: false,
  };
}

describe('UnitRateCalculator', () => {
  const calculator = new UnitRateCalculator();

  it('returns TYPE_MISMATCH when meter types differ', () => {
    const result = calculator.calculate(
      makeReading(1200, 500, 'electricity'),
      makeReading(1000, null, 'water'),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TYPE_MISMATCH');
  });

  it('returns INVALID_CONSUMPTION when current <= previous', () => {
    const result = calculator.calculate(makeReading(900, 500), makeReading(1000, null));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_CONSUMPTION');
  });

  it('returns INVALID_CONSUMPTION when readings are equal', () => {
    const result = calculator.calculate(makeReading(1000, 500), makeReading(1000, null));
    expect(result.success).toBe(false);
  });

  it('calculates correct consumption and unit rate', () => {
    // 200 kWh used, R525.00 cost → R2.625/kWh → 263 cents/kWh (rounded)
    const result = calculator.calculate(makeReading(1200, 52500), makeReading(1000, null));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.consumptionUnits).toBe(200);
      expect(result.data.costCents).toBe(52500);
      expect(result.data.unitRateCents).toBe(263);
    }
  });

  it('returns unitRateCents 0 when no cost provided', () => {
    const result = calculator.calculate(makeReading(1200, null), makeReading(1000, null));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.unitRateCents).toBe(0);
      expect(result.data.consumptionUnits).toBe(200);
    }
  });
});
