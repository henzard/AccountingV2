import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { MeterReadingEntity } from './MeterReadingEntity';

export interface RateCalculationResult {
  consumptionUnits: number;  // kWh, kL, or km consumed between readings
  unitRateCents: number;     // cents per unit (0 if no cost provided)
  costCents: number;
}

export class UnitRateCalculator {
  calculate(current: MeterReadingEntity, previous: MeterReadingEntity): Result<RateCalculationResult> {
    if (current.meterType !== previous.meterType) {
      return createFailure({ code: 'TYPE_MISMATCH', message: 'Both readings must be the same meter type' });
    }
    const consumptionUnits = current.readingValue - previous.readingValue;
    if (consumptionUnits <= 0) {
      return createFailure({ code: 'INVALID_CONSUMPTION', message: 'Current reading must exceed the previous reading' });
    }
    const costCents = current.costCents ?? 0;
    const unitRateCents = costCents > 0 ? Math.round(costCents / consumptionUnits) : 0;
    return createSuccess({ consumptionUnits, unitRateCents, costCents });
  }
}
