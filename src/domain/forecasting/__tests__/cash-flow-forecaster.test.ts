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

    it('excludes archived envelopes', () => {
      const result = forecaster.project({
        envelopes: [env({ isArchived: true })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result).toHaveLength(0);
    });

    it('includes spending, savings, emergency_fund, baby_step, utility types', () => {
      const types = ['spending', 'savings', 'emergency_fund', 'baby_step', 'utility'] as const;
      const envelopes = types.map((t, i) => env({ id: `env-${i}`, envelopeType: t as any }));
      const result = forecaster.project({
        envelopes,
        periodStart,
        periodEnd,
        today,
      });
      expect(result).toHaveLength(5);
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
});
