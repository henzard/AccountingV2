import { parseISO } from 'date-fns';
import { CashFlowForecaster } from '../CashFlowForecaster';
import type { EnvelopeEntity } from '../../envelopes/EnvelopeEntity';

function env(overrides: Partial<EnvelopeEntity> = {}): EnvelopeEntity {
  return {
    id: 'env-1',
    householdId: 'hh-1',
    name: 'Groceries',
    allocatedCents: 100000,
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

describe('CashFlowForecaster', () => {
  const forecaster = new CashFlowForecaster();
  const periodStart = '2026-04-01';
  const periodEnd = '2026-04-30';
  const today = parseISO('2026-04-10');

  describe('on_track status (projected remaining >= 20%)', () => {
    it('returns on_track when 80% remains projected', () => {
      // 10 days elapsed, spent 5000 → daily 500 → projected remaining spend = 500*20 = 10000
      // projected remaining = 100000 - 5000 - 10000 = 85000 → 85% → on_track
      const result = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: 5000 })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].status).toBe('on_track');
      expect(result[0].projectedRemainingPct).toBeGreaterThanOrEqual(20);
    });

    it('returns on_track when nothing spent', () => {
      const result = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: 0 })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].status).toBe('on_track');
      expect(result[0].projectedRemainingCents).toBe(100000);
    });
  });

  describe('warning status (projected remaining 10-19%)', () => {
    it('returns warning when projected remaining is ~15%', () => {
      // Need projectedRemainingPct between 10-19
      // spent/10 * 20 + spent = total projected depletion
      // projectedRemaining = alloc - spent - (spent/10)*20 = alloc - 3*spent
      // For 15%: 15000 = 100000 - 3*spent → spent = 28333
      const result = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: 28333 })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].status).toBe('warning');
    });
  });

  describe('over_budget status (projected remaining < 10%)', () => {
    it('returns over_budget when heavily overspending', () => {
      // spent 50000 in 10 days → daily 5000 → projected = 5000*20 = 100000
      // projected remaining = 100000 - 50000 - 100000 = -50000 → negative → over_budget
      const result = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: 50000 })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].status).toBe('over_budget');
      expect(result[0].projectedRemainingCents).toBeLessThan(0);
    });
  });

  describe('excluded envelope types', () => {
    it('excludes income envelopes', () => {
      const result = forecaster.project({
        envelopes: [env({ envelopeType: 'income' })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result).toHaveLength(0);
    });

    it('excludes sinking_fund envelopes', () => {
      const result = forecaster.project({
        envelopes: [env({ envelopeType: 'sinking_fund' })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result).toHaveLength(0);
    });

    it('excludes every PERSISTENT-scope envelope type (DOM-7/VAL-7)', () => {
      // Their spentCents is an ALL-TIME total across every period the fund
      // has existed, so dividing it by THIS period's elapsed days invented a
      // daily burn rate out of years-old withdrawals. Only 'sinking_fund'
      // used to be excluded, by name.
      const types = ['sinking_fund', 'emergency_fund', 'savings', 'baby_step'] as const;
      const result = forecaster.project({
        envelopes: types.map((envelopeType, i) => env({ id: `env-${i}`, envelopeType })),
        periodStart,
        periodEnd,
        today,
      });
      expect(result).toHaveLength(0);
    });

    it('excludes archived envelopes', () => {
      const result = forecaster.project({
        envelopes: [env({ isArchived: true })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result).toHaveLength(0);
    });

    it('includes the PERIOD-scope types: spending and utility', () => {
      const types = ['spending', 'utility'] as const;
      const envelopes = types.map((envelopeType, i) => env({ id: `env-${i}`, envelopeType }));
      const result = forecaster.project({
        envelopes,
        periodStart,
        periodEnd,
        today,
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('allocatedCents=0 edge case', () => {
    it('returns 100% remaining when allocated is 0 (no budget set)', () => {
      const result = forecaster.project({
        envelopes: [env({ allocatedCents: 0, spentCents: 0 })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].projectedRemainingPct).toBe(100);
      expect(result[0].status).toBe('on_track');
    });

    it('is over_budget with a non-positive pct when there is real spend against a zero allocation', () => {
      // An envelope with no budget at all but real spend is entirely
      // unbudgeted overspend, not "100% left" — that hid the spend behind
      // an on_track status.
      const result = forecaster.project({
        envelopes: [env({ allocatedCents: 0, spentCents: 5000 })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].projectedRemainingPct).toBeLessThanOrEqual(0);
      expect(result[0].status).toBe('over_budget');
    });

    it('uses 0 (not a large negative number) as the display pct, since there is no real denominator', () => {
      // 0 is chosen deliberately: it is a sensible, non-alarming stand-in
      // for "no allocation to measure against" that still reads correctly
      // wherever the pct is rendered (e.g. ForecastScreen's progress bar and
      // "X% projected left" label), unlike an unbounded negative percentage.
      const result = forecaster.project({
        envelopes: [env({ allocatedCents: 0, spentCents: 1 })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].projectedRemainingPct).toBe(0);
      expect(result[0].status).toBe('over_budget');
    });
  });

  describe('daily rate calculation', () => {
    it('computes correct daily spend rate', () => {
      // 10 days elapsed (Apr 1 → Apr 10), spent 30000 → daily = 3000
      const result = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: 30000 })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].dailySpendCents).toBe(3000);
      expect(result[0].daysElapsed).toBe(10);
      expect(result[0].daysRemaining).toBe(20);
    });
  });

  // REFUNDS: `spentCents` is a derived signed SUM over the transaction ledger,
  // so an envelope whose refunds exceed its purchases has a NEGATIVE spend.
  describe('net-refunded envelopes', () => {
    it('never projects a NEGATIVE daily spend rate (a refund is not a spending rate)', () => {
      const result = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: -30000 })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].dailySpendCents).toBe(0);
    });

    it('does not forecast FUTURE refunds for the rest of the period', () => {
      // Unfloored this would be -3000/day x 20 remaining days = -60000,
      // i.e. the forecast inventing R600,00 of refunds still to come.
      const result = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: -30000 })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].projectedSpendRemainingCents).toBe(0);
    });

    it('caps the projected percentage at 100 instead of printing "130% projected left"', () => {
      const result = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: -30000 })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].projectedRemainingPct).toBe(100);
      expect(result[0].status).toBe('on_track');
      // The cash figure stays truthful — only the PERCENTAGE is capped.
      expect(result[0].projectedRemainingCents).toBe(130000);
    });

    it('caps a heavily net-refunded envelope at 100 too', () => {
      const result = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: -500000 })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].projectedRemainingPct).toBe(100);
      expect(result[0].dailySpendCents).toBe(0);
    });

    it('still reports a NEGATIVE pct for a heavy overspend (only the top is capped)', () => {
      const result = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: 300000 })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].projectedRemainingPct).toBeLessThan(0);
      expect(result[0].status).toBe('over_budget');
    });

    it('leaves an ordinary envelope untouched', () => {
      const result = forecaster.project({
        envelopes: [env({ allocatedCents: 100000, spentCents: 30000 })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].dailySpendCents).toBe(3000);
      expect(result[0].projectedSpendRemainingCents).toBe(60000);
      expect(result[0].projectedRemainingPct).toBe(10);
    });
  });
});
