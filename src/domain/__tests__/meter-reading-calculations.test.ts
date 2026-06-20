import { UnitRateCalculator } from '../meterReadings/UnitRateCalculator';
import { AnomalyDetector } from '../meterReadings/AnomalyDetector';
import { buildMeterReading } from '../../__test-utils__/factories';
import type { MeterReadingEntity } from '../meterReadings/MeterReadingEntity';

describe('Meter Reading Calculations', () => {
  const calculator = new UnitRateCalculator();
  const anomalyDetector = new AnomalyDetector();

  describe('UnitRateCalculator', () => {
    describe('electricity rate calculation', () => {
      it('500 kWh consumed, R1,200 cost -> R2.40/kWh (240 cents/kWh)', () => {
        const previous = buildMeterReading({
          meterType: 'electricity',
          readingValue: 10000,
          readingDate: '2026-01-31',
          costCents: null,
        });
        const current = buildMeterReading({
          meterType: 'electricity',
          readingValue: 10500, // 500 kWh consumed
          readingDate: '2026-02-28',
          costCents: 120000, // R1,200
        });

        const result = calculator.calculate(current, previous);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.consumptionUnits).toBe(500);
          expect(result.data.unitRateCents).toBe(240); // 120000 / 500 = 240
          expect(result.data.costCents).toBe(120000);
        }
      });
    });

    describe('water rate calculation', () => {
      it('15 kL consumed, R350 cost -> R23.33/kL (2333 cents/kL)', () => {
        const previous = buildMeterReading({
          meterType: 'water',
          readingValue: 200,
          readingDate: '2026-01-31',
          costCents: null,
        });
        const current = buildMeterReading({
          meterType: 'water',
          readingValue: 215, // 15 kL consumed
          readingDate: '2026-02-28',
          costCents: 35000, // R350
        });

        const result = calculator.calculate(current, previous);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.consumptionUnits).toBe(15);
          expect(result.data.unitRateCents).toBe(Math.round(35000 / 15)); // 2333
          expect(result.data.costCents).toBe(35000);
        }
      });
    });

    describe('missing cost: consumption calculated but no rate', () => {
      it('returns 0 unitRateCents when costCents is null', () => {
        const previous = buildMeterReading({
          meterType: 'electricity',
          readingValue: 5000,
          readingDate: '2026-01-31',
          costCents: null,
        });
        const current = buildMeterReading({
          meterType: 'electricity',
          readingValue: 5450,
          readingDate: '2026-02-28',
          costCents: null,
        });

        const result = calculator.calculate(current, previous);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.consumptionUnits).toBe(450);
          expect(result.data.unitRateCents).toBe(0);
          expect(result.data.costCents).toBe(0);
        }
      });
    });

    describe('first reading: no previous -> no consumption calc', () => {
      it('negative consumption returns failure', () => {
        const previous = buildMeterReading({
          meterType: 'electricity',
          readingValue: 5000,
          readingDate: '2026-02-28',
          costCents: null,
        });
        const current = buildMeterReading({
          meterType: 'electricity',
          readingValue: 5000, // same as previous (no consumption)
          readingDate: '2026-03-31',
          costCents: 100000,
        });

        const result = calculator.calculate(current, previous);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('INVALID_CONSUMPTION');
        }
      });
    });

    describe('meter type mismatch -> early return error', () => {
      it('returns failure when comparing electricity to water', () => {
        const previous = buildMeterReading({
          meterType: 'electricity',
          readingValue: 5000,
          readingDate: '2026-01-31',
        });
        const current = buildMeterReading({
          meterType: 'water',
          readingValue: 5500,
          readingDate: '2026-02-28',
          costCents: 100000,
        });

        const result = calculator.calculate(current, previous);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('TYPE_MISMATCH');
          expect(result.error.message).toContain('same meter type');
        }
      });

      it('returns failure when comparing water to odometer', () => {
        const previous = buildMeterReading({
          meterType: 'water',
          readingValue: 100,
          readingDate: '2026-01-31',
        });
        const current = buildMeterReading({
          meterType: 'odometer',
          readingValue: 200,
          readingDate: '2026-02-28',
          costCents: 50000,
        });

        const result = calculator.calculate(current, previous);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('TYPE_MISMATCH');
        }
      });
    });

    describe('edge cases', () => {
      it('1 unit consumption', () => {
        const previous = buildMeterReading({ readingValue: 1000, meterType: 'electricity' });
        const current = buildMeterReading({
          readingValue: 1001,
          meterType: 'electricity',
          costCents: 300,
        });

        const result = calculator.calculate(current, previous);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.consumptionUnits).toBe(1);
          expect(result.data.unitRateCents).toBe(300);
        }
      });

      it('large consumption value', () => {
        const previous = buildMeterReading({ readingValue: 0, meterType: 'electricity' });
        const current = buildMeterReading({
          readingValue: 100000,
          meterType: 'electricity',
          costCents: 25000000,
        });

        const result = calculator.calculate(current, previous);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.consumptionUnits).toBe(100000);
          expect(result.data.unitRateCents).toBe(250);
        }
      });
    });
  });

  describe('AnomalyDetector', () => {
    function buildSequentialReadings(
      values: number[],
      meterType: 'electricity' | 'water' = 'electricity',
    ): MeterReadingEntity[] {
      return values.map((val, i) =>
        buildMeterReading({
          id: `reading-${i}`,
          meterType,
          readingValue: val,
          readingDate: `2026-${(i + 1).toString().padStart(2, '0')}-28`,
          costCents: null,
        }),
      );
    }

    describe('consumption spike >20% from 3-month average triggers warning', () => {
      it('detects anomaly when consumption spikes >20%', () => {
        // Cumulative readings: consumption deltas are ~450/month, then a spike
        const previousReadings = buildSequentialReadings([1000, 1450, 1900, 2350]);
        // Deltas: 450, 450, 450 -> avg = 450
        // Current reading: 2350 + 600 = 2950 -> consumption = 600
        // Deviation: |600 - 450| / 450 = 0.333 -> >20%
        const current = buildMeterReading({
          meterType: 'electricity',
          readingValue: 2950,
          readingDate: '2026-05-28',
        });

        const result = anomalyDetector.detect(current, previousReadings);
        expect(result.isAnomaly).toBe(true);
        expect(result.currentConsumption).toBe(600);
        expect(result.rollingAverageConsumption).toBe(450);
        expect(result.deviationPercent).toBeCloseTo(0.333, 2);
      });

      it('no anomaly when consumption is within 20%', () => {
        const previousReadings = buildSequentialReadings([1000, 1450, 1900, 2350]);
        // Normal consumption: ~450, slight increase to 500
        // Deviation: |500 - 450| / 450 = 0.111 -> < 20%
        const current = buildMeterReading({
          meterType: 'electricity',
          readingValue: 2850,
          readingDate: '2026-05-28',
        });

        const result = anomalyDetector.detect(current, previousReadings);
        expect(result.isAnomaly).toBe(false);
        expect(result.currentConsumption).toBe(500);
        expect(result.deviationPercent).toBeCloseTo(0.111, 2);
      });

      it('detects anomaly for consumption drop >20%', () => {
        const previousReadings = buildSequentialReadings([1000, 1450, 1900, 2350]);
        // Low consumption: 300 (drop from avg 450)
        // Deviation: |300 - 450| / 450 = 0.333 -> > 20%
        const current = buildMeterReading({
          meterType: 'electricity',
          readingValue: 2650,
          readingDate: '2026-05-28',
        });

        const result = anomalyDetector.detect(current, previousReadings);
        expect(result.isAnomaly).toBe(true);
        expect(result.currentConsumption).toBe(300);
        expect(result.deviationPercent).toBeCloseTo(0.333, 2);
      });
    });

    describe('fewer than 4 readings -> anomaly detection returns no anomaly', () => {
      it('returns no anomaly with 0 previous readings', () => {
        const current = buildMeterReading({ readingValue: 500, meterType: 'electricity' });
        const result = anomalyDetector.detect(current, []);
        expect(result.isAnomaly).toBe(false);
        expect(result.currentConsumption).toBe(0);
        expect(result.deviationPercent).toBe(0);
      });

      it('returns no anomaly with 1 previous reading', () => {
        const current = buildMeterReading({ readingValue: 1000, meterType: 'electricity' });
        const readings = buildSequentialReadings([500]);
        const result = anomalyDetector.detect(current, readings);
        expect(result.isAnomaly).toBe(false);
      });

      it('returns no anomaly with 2 previous readings', () => {
        const current = buildMeterReading({ readingValue: 1500, meterType: 'electricity' });
        const readings = buildSequentialReadings([500, 1000]);
        const result = anomalyDetector.detect(current, readings);
        expect(result.isAnomaly).toBe(false);
      });

      it('returns no anomaly with 3 previous readings', () => {
        const current = buildMeterReading({ readingValue: 2000, meterType: 'electricity' });
        const readings = buildSequentialReadings([500, 1000, 1500]);
        const result = anomalyDetector.detect(current, readings);
        expect(result.isAnomaly).toBe(false);
      });

      it('works with exactly 4 previous readings', () => {
        const current = buildMeterReading({
          readingValue: 3000,
          meterType: 'electricity',
          readingDate: '2026-05-28',
        });
        const readings = buildSequentialReadings([500, 1000, 1500, 2000]);
        // Deltas: 500, 500, 500 -> avg = 500
        // Current consumption: 3000 - 2000 = 1000
        // Deviation: |1000 - 500| / 500 = 1.0 -> >20%
        const result = anomalyDetector.detect(current, readings);
        expect(result.isAnomaly).toBe(true);
        expect(result.currentConsumption).toBe(1000);
      });
    });

    describe('zero consumption -> no anomaly', () => {
      it('returns no anomaly when current consumption is zero or negative', () => {
        const previousReadings = buildSequentialReadings([1000, 1450, 1900, 2350]);
        const current = buildMeterReading({
          meterType: 'electricity',
          readingValue: 2350, // same as last = 0 consumption
          readingDate: '2026-05-28',
        });

        const result = anomalyDetector.detect(current, previousReadings);
        expect(result.isAnomaly).toBe(false);
        expect(result.currentConsumption).toBe(0);
      });
    });

    describe('water meter anomaly detection', () => {
      it('detects water consumption spike', () => {
        // Water readings (cumulative kL): ~18 kL/month consumption
        const previousReadings = buildSequentialReadings([100, 118, 136, 154], 'water');
        // Deltas: 18, 18, 18 -> avg = 18
        // Current: 154 + 25 = 179 -> consumption = 25
        // Deviation: |25 - 18| / 18 = 0.389 -> >20%
        const current = buildMeterReading({
          meterType: 'water',
          readingValue: 179,
          readingDate: '2026-05-28',
        });

        const result = anomalyDetector.detect(current, previousReadings);
        expect(result.isAnomaly).toBe(true);
        expect(result.currentConsumption).toBe(25);
        expect(result.rollingAverageConsumption).toBe(18);
      });
    });

    describe('readings sorted by date regardless of input order', () => {
      it('handles unsorted previous readings correctly', () => {
        const readings: MeterReadingEntity[] = [
          buildMeterReading({
            id: 'r3',
            readingValue: 1900,
            readingDate: '2026-03-28',
            meterType: 'electricity',
          }),
          buildMeterReading({
            id: 'r1',
            readingValue: 1000,
            readingDate: '2026-01-28',
            meterType: 'electricity',
          }),
          buildMeterReading({
            id: 'r4',
            readingValue: 2350,
            readingDate: '2026-04-28',
            meterType: 'electricity',
          }),
          buildMeterReading({
            id: 'r2',
            readingValue: 1450,
            readingDate: '2026-02-28',
            meterType: 'electricity',
          }),
        ];
        const current = buildMeterReading({
          meterType: 'electricity',
          readingValue: 2950,
          readingDate: '2026-05-28',
        });

        const result = anomalyDetector.detect(current, readings);
        // After sorting: [1000, 1450, 1900, 2350] -> deltas [450, 450, 450] -> avg 450
        // current consumption: 2950 - 2350 = 600
        // deviation: |600-450|/450 = 0.333
        expect(result.isAnomaly).toBe(true);
        expect(result.currentConsumption).toBe(600);
        expect(result.rollingAverageConsumption).toBe(450);
      });
    });

    describe('boundary: exactly 20% deviation', () => {
      it('does NOT trigger anomaly at exactly 20% (threshold is strictly greater)', () => {
        // avg = 500, consumption needs to be exactly 600 for 20%
        const previousReadings = buildSequentialReadings([1000, 1500, 2000, 2500]);
        // Deltas: 500, 500, 500 -> avg = 500
        // Current: 2500 + 600 = 3100 -> consumption = 600
        // Deviation: |600-500|/500 = 0.2 exactly
        const current = buildMeterReading({
          meterType: 'electricity',
          readingValue: 3100,
          readingDate: '2026-05-28',
        });

        const result = anomalyDetector.detect(current, previousReadings);
        expect(result.isAnomaly).toBe(false);
        expect(result.deviationPercent).toBeCloseTo(0.2, 5);
      });

      it('triggers anomaly just above 20%', () => {
        const previousReadings = buildSequentialReadings([1000, 1500, 2000, 2500]);
        // consumption = 601, deviation = 101/500 = 0.202
        const current = buildMeterReading({
          meterType: 'electricity',
          readingValue: 3101,
          readingDate: '2026-05-28',
        });

        const result = anomalyDetector.detect(current, previousReadings);
        expect(result.isAnomaly).toBe(true);
        expect(result.deviationPercent).toBeGreaterThan(0.2);
      });
    });
  });
});
