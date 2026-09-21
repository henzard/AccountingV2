import { parseISO } from 'date-fns';
import { CashFlowForecaster } from '../CashFlowForecaster';
import { baselineKey } from '../CategoryBaseline';
import type { CategoryBaseline } from '../CategoryBaseline';
import type { EnvelopeEntity } from '../../envelopes/EnvelopeEntity';

function env(overrides: Partial<EnvelopeEntity>): EnvelopeEntity {
  return {
    id: 'env-1',
    householdId: 'hh-1',
    name: 'Food',
    allocatedCents: 150000,
    spentCents: 0,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-04-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function baseline(overrides: Partial<CategoryBaseline> = {}): Map<string, CategoryBaseline> {
  const value: CategoryBaseline = {
    categoryKey: 'food',
    displayName: 'Food',
    envelopeType: 'spending',
    periodsObserved: 6,
    typicalPeriodSpendCents: 150000,
    lowestPeriodSpendCents: 100000,
    highestPeriodSpendCents: 200000,
    typicalSpendByDayCents: 55000,
    throughDayOfPeriod: 9,
    typicalAllocatedCents: 150000,
    ...overrides,
  };
  return new Map([[baselineKey(value.envelopeType, value.displayName), value]]);
}

describe('CashFlowForecaster with a history baseline', () => {
  const forecaster = new CashFlowForecaster();
  // 1 Apr – 30 Apr: 30 days.
  const periodStart = '2026-04-01';
  const periodEnd = '2026-04-30';

  it('does not turn one day-2 grocery shop into an absurd month', () => {
    const withoutHistory = forecaster.project({
      envelopes: [env({ spentCents: 80000 })],
      periodStart,
      periodEnd,
      today: parseISO('2026-04-02'),
    })[0];
    const withHistory = forecaster.project({
      envelopes: [env({ spentCents: 80000 })],
      baselines: baseline(),
      periodStart,
      periodEnd,
      today: parseISO('2026-04-02'),
    })[0];

    // The run rate alone: R400/day x 30 days = R12 000 against a R1 500 budget.
    expect(withoutHistory.projectedTotalSpendCents).toBe(1200000);
    // With six periods of evidence, the projection stays in the real world.
    expect(withHistory.projectedTotalSpendCents).toBeLessThan(250000);
    expect(withHistory.projectedTotalSpendCents).toBeGreaterThan(150000);
  });

  it('is (almost) the baseline on day 1', () => {
    const [result] = forecaster.project({
      envelopes: [env({ spentCents: 0 })],
      baselines: baseline(),
      periodStart,
      periodEnd,
      today: parseISO('2026-04-01'),
    });
    expect(result.baselineWeight).toBeCloseTo(29 / 30, 5);
    expect(result.projectedTotalSpendCents).toBe(145000); // 29/30 of 150000, nothing spent yet
  });

  it('is purely the actual on the last day', () => {
    const [result] = forecaster.project({
      envelopes: [env({ spentCents: 132000 })],
      baselines: baseline(),
      periodStart,
      periodEnd,
      today: parseISO('2026-04-30'),
    });
    expect(result.baselineWeight).toBe(0);
    expect(result.projectedTotalSpendCents).toBe(132000);
    expect(result.projectedSpendRemainingCents).toBe(0);
    expect(result.projectedRemainingCents).toBe(18000);
  });

  it('splits the difference halfway through', () => {
    const [result] = forecaster.project({
      envelopes: [env({ spentCents: 90000 })],
      baselines: baseline(),
      periodStart,
      periodEnd,
      today: parseISO('2026-04-15'),
    });
    // Day 15 of 30: run rate 6000/day x 15 remaining → run-rate total 180000.
    expect(result.baselineWeight).toBeCloseTo(0.5, 5);
    expect(result.projectedTotalSpendCents).toBe(165000);
  });

  it('reports pace against the typical spend by this same day', () => {
    const [result] = forecaster.project({
      envelopes: [env({ spentCents: 75000 })],
      baselines: baseline(),
      periodStart,
      periodEnd,
      today: parseISO('2026-04-09'),
    });
    expect(result.daysElapsed).toBe(9);
    expect(result.typicalSpendByTodayCents).toBe(55000);
    expect(result.paceVsTypicalCents).toBe(20000);
  });

  it('matches the baseline by name, case-insensitively and trimmed', () => {
    const [result] = forecaster.project({
      envelopes: [env({ name: '  food  ', spentCents: 0 })],
      baselines: baseline(),
      periodStart,
      periodEnd,
      today: parseISO('2026-04-01'),
    });
    expect(result.baseline).not.toBeNull();
  });

  it('never matches a baseline of a DIFFERENT envelope type', () => {
    const [result] = forecaster.project({
      envelopes: [env({ name: 'Food', envelopeType: 'utility', spentCents: 0 })],
      baselines: baseline(),
      periodStart,
      periodEnd,
      today: parseISO('2026-04-01'),
    });
    expect(result.baseline).toBeNull();
    expect(result.baselineWeight).toBe(0);
  });

  describe('behaviours fixed in earlier rounds stay fixed WITH history', () => {
    it('keeps zero allocation with spend over budget', () => {
      const [result] = forecaster.project({
        envelopes: [env({ allocatedCents: 0, spentCents: 50000 })],
        baselines: baseline(),
        periodStart,
        periodEnd,
        today: parseISO('2026-04-09'),
      });
      expect(result.projectedRemainingPct).toBe(0);
      expect(result.status).toBe('over_budget');
    });

    it('never projects future refunds for a net-refunded envelope', () => {
      const [result] = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: -30000 })],
        baselines: baseline({ typicalPeriodSpendCents: -50000 }),
        periodStart,
        periodEnd,
        today: parseISO('2026-04-09'),
      });
      expect(result.dailySpendCents).toBe(0);
      expect(result.projectedSpendRemainingCents).toBe(0);
    });

    it('never prints more than 100% projected left, and stays truthful below zero', () => {
      const refunded = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: -30000 })],
        baselines: baseline({ typicalPeriodSpendCents: -50000 }),
        periodStart,
        periodEnd,
        today: parseISO('2026-04-09'),
      })[0];
      expect(refunded.projectedRemainingPct).toBe(100);

      const overspent = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: 300000 })],
        baselines: baseline({ typicalPeriodSpendCents: 90000 }),
        periodStart,
        periodEnd,
        today: parseISO('2026-04-09'),
      })[0];
      expect(overspent.projectedRemainingPct).toBeLessThan(0);
      expect(overspent.status).toBe('over_budget');
    });
  });

  describe('no usable history', () => {
    it('falls back byte-for-byte to the run-rate behaviour', () => {
      const withEmptyBaselines = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: 30000 })],
        baselines: new Map(),
        periodStart,
        periodEnd,
        today: parseISO('2026-04-10'),
      })[0];
      const withNoBaselinesAtAll = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: 30000 })],
        periodStart,
        periodEnd,
        today: parseISO('2026-04-10'),
      })[0];

      expect(withEmptyBaselines).toEqual(withNoBaselinesAtAll);
      expect(withEmptyBaselines.dailySpendCents).toBe(3000);
      expect(withEmptyBaselines.projectedSpendRemainingCents).toBe(60000);
      expect(withEmptyBaselines.projectedRemainingPct).toBe(10);
      expect(withEmptyBaselines.baseline).toBeNull();
      expect(withEmptyBaselines.paceVsTypicalCents).toBeNull();
    });
  });
});
