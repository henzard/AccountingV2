import {
  BASELINE_WEIGHT_AT_PERIOD_END,
  BASELINE_WEIGHT_AT_PERIOD_START,
  baselineWeightFor,
  blendProjectedTotalSpendCents,
  getPeriodDayCounts,
} from '../ForecastBlend';
import { parseISO } from 'date-fns';

describe('getPeriodDayCounts', () => {
  it('counts period_start itself as day 1 and today as elapsed', () => {
    expect(getPeriodDayCounts('2026-04-01', '2026-04-30', parseISO('2026-04-01'))).toEqual({
      daysElapsed: 1,
      daysRemaining: 29,
      daysInPeriod: 30,
    });
  });

  it('counts the last day as fully elapsed with nothing remaining', () => {
    expect(getPeriodDayCounts('2026-04-01', '2026-04-30', parseISO('2026-04-30'))).toEqual({
      daysElapsed: 30,
      daysRemaining: 0,
      daysInPeriod: 30,
    });
  });

  it('never reports fewer than one elapsed day, even before the period starts', () => {
    expect(getPeriodDayCounts('2026-04-01', '2026-04-30', parseISO('2026-03-20')).daysElapsed).toBe(
      1,
    );
  });
});

describe('the blending rule', () => {
  it('leans (almost) entirely on history on day 1', () => {
    const weight = baselineWeightFor(1, 30);
    expect(weight).toBeCloseTo(29 / 30, 5);
    expect(weight).toBeGreaterThan(0.9);
    expect(weight).toBeLessThan(BASELINE_WEIGHT_AT_PERIOD_START);
  });

  it('is an even split halfway through', () => {
    expect(baselineWeightFor(15, 30)).toBeCloseTo(0.5, 5);
  });

  it('leans entirely on what actually happened on the last day', () => {
    expect(baselineWeightFor(30, 30)).toBe(BASELINE_WEIGHT_AT_PERIOD_END);
  });

  it('never leaves the two endpoint weights, whatever the clock says', () => {
    expect(baselineWeightFor(99, 30)).toBe(BASELINE_WEIGHT_AT_PERIOD_END);
    expect(baselineWeightFor(-5, 30)).toBe(BASELINE_WEIGHT_AT_PERIOD_START);
    expect(baselineWeightFor(1, 0)).toBe(BASELINE_WEIGHT_AT_PERIOD_END);
  });

  it('moves monotonically from history toward actuals', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let day = 1; day <= 30; day += 1) {
      const weight = baselineWeightFor(day, 30);
      expect(weight).toBeLessThan(previous);
      previous = weight;
    }
  });
});

describe('blendProjectedTotalSpendCents', () => {
  it('weights the two forecasts as the rule says', () => {
    expect(blendProjectedTotalSpendCents(0, 240000, 150000, 0.5)).toBe(195000);
  });

  it('never projects LESS than what has already been spent (no invented refunds)', () => {
    // History says R1 000 a period; R4 000 is already gone.
    expect(blendProjectedTotalSpendCents(400000, 400000, 100000, 0.9)).toBe(400000);
  });

  it('still blends for a net-refunded category (negative spend is not a floor that bites)', () => {
    expect(blendProjectedTotalSpendCents(-30000, -30000, 100000, 1)).toBe(100000);
  });
});
