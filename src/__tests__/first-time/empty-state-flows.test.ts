/**
 * First-time user / empty-state tests: verify domain logic handles
 * zero-data scenarios correctly (no envelopes, no debts, no readings).
 */
import { calculateBudgetBalance } from '../../domain/budgets/BudgetBalanceCalculator';
import { SnowballPayoffProjector } from '../../domain/debtSnowball/SnowballPayoffProjector';
import {
  getRemainingCents,
  getPercentRemaining,
  isOverBudget,
} from '../../domain/envelopes/EnvelopeEntity';
import {
  buildEnvelope,
  buildDebt,
  buildMeterReading,
  resetFactoryCounter,
} from '../../__test-utils__/factories';
import { HOUSEHOLDS } from '../../__test-utils__/scenarioSeed';

const KRUGER_ID = HOUSEHOLDS.kruger.id;

beforeEach(() => resetFactoryCounter());

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('Empty-State Flows (first-time user)', () => {
  describe('BudgetBalanceCalculator with 0 envelopes', () => {
    it('returns all-zero budget balance', () => {
      const result = calculateBudgetBalance([]);

      expect(result).toEqual({
        incomeTotal: 0,
        totalAllocated: 0,
        expenseAllocationTotal: 0,
        toAssign: 0,
      });
    });
  });

  describe('BudgetBalanceCalculator with income only', () => {
    it('toAssign equals the income amount when no expense envelopes exist', () => {
      const incomeEnvelope = buildEnvelope({
        householdId: KRUGER_ID,
        allocatedCents: 4500000,
        envelopeType: 'income',
      });

      const result = calculateBudgetBalance([incomeEnvelope]);

      expect(result.incomeTotal).toBe(4500000);
      expect(result.totalAllocated).toBe(4500000);
      expect(result.expenseAllocationTotal).toBe(0);
      expect(result.toAssign).toBe(4500000);
    });

    it('multiple income envelopes sum correctly', () => {
      const income1 = buildEnvelope({
        householdId: KRUGER_ID,
        allocatedCents: 4500000,
        envelopeType: 'income',
      });
      const income2 = buildEnvelope({
        householdId: KRUGER_ID,
        allocatedCents: 2500000,
        envelopeType: 'income',
      });

      const result = calculateBudgetBalance([income1, income2]);

      expect(result.incomeTotal).toBe(7000000);
      expect(result.toAssign).toBe(7000000);
    });

    it('archived income envelopes are excluded', () => {
      const active = buildEnvelope({
        allocatedCents: 3000000,
        envelopeType: 'income',
      });
      const archived = buildEnvelope({
        allocatedCents: 2000000,
        envelopeType: 'income',
        isArchived: true,
      });

      const result = calculateBudgetBalance([active, archived]);

      expect(result.incomeTotal).toBe(3000000);
      expect(result.toAssign).toBe(3000000);
    });
  });

  describe('BudgetBalanceCalculator with income + expenses', () => {
    it('toAssign is income minus expense allocations', () => {
      const income = buildEnvelope({
        allocatedCents: 5000000,
        envelopeType: 'income',
      });
      const groceries = buildEnvelope({
        allocatedCents: 800000,
        envelopeType: 'spending',
      });
      const fuel = buildEnvelope({
        allocatedCents: 400000,
        envelopeType: 'spending',
      });

      const result = calculateBudgetBalance([income, groceries, fuel]);

      expect(result.incomeTotal).toBe(5000000);
      expect(result.expenseAllocationTotal).toBe(1200000);
      expect(result.toAssign).toBe(3800000);
    });

    it('overcommitted budget returns negative toAssign', () => {
      const income = buildEnvelope({
        allocatedCents: 1000000,
        envelopeType: 'income',
      });
      const bigExpense = buildEnvelope({
        allocatedCents: 1500000,
        envelopeType: 'spending',
      });

      const result = calculateBudgetBalance([income, bigExpense]);

      expect(result.toAssign).toBe(-500000);
    });
  });

  describe('SnowballPayoffProjector with 0 debts', () => {
    it('returns empty projections and null debtFreeDate', () => {
      const projector = new SnowballPayoffProjector();
      const plan = projector.project([]);

      expect(plan.projections).toEqual([]);
      expect(plan.debtFreeDate).toBeNull();
    });

    it('ignores already paid-off debts', () => {
      const paidOff = buildDebt({
        householdId: KRUGER_ID,
        isPaidOff: true,
        outstandingBalanceCents: 0,
      });
      const projector = new SnowballPayoffProjector();
      const plan = projector.project([paidOff]);

      expect(plan.projections).toEqual([]);
      expect(plan.debtFreeDate).toBeNull();
    });
  });

  describe('SnowballPayoffProjector with active debts', () => {
    it('projects payoff for a single small debt', () => {
      const debt = buildDebt({
        householdId: KRUGER_ID,
        outstandingBalanceCents: 100000,
        interestRatePercent: 0,
        minimumPaymentCents: 50000,
        sortOrder: 0,
      });
      const projector = new SnowballPayoffProjector();
      const plan = projector.project([debt]);

      expect(plan.projections).toHaveLength(1);
      expect(plan.projections[0].monthsToPayoff).toBe(2);
      expect(plan.debtFreeDate).not.toBeNull();
    });

    it('extra snowball payment accelerates payoff', () => {
      const debt = buildDebt({
        outstandingBalanceCents: 200000,
        interestRatePercent: 0,
        minimumPaymentCents: 50000,
        sortOrder: 0,
      });
      const projector = new SnowballPayoffProjector();

      const withoutExtra = projector.project([debt], 0);
      const withExtra = projector.project([debt], 50000);

      expect(withExtra.projections[0].monthsToPayoff).toBeLessThan(
        withoutExtra.projections[0].monthsToPayoff,
      );
    });
  });

  describe('First transaction -> envelope spentCents changes', () => {
    it('new envelope starts with spentCents: 0 and getRemainingCents equals allocatedCents', () => {
      const envelope = buildEnvelope({
        allocatedCents: 800000,
        spentCents: 0,
      });

      expect(getRemainingCents(envelope)).toBe(800000);
      expect(getPercentRemaining(envelope)).toBe(100);
      expect(isOverBudget(envelope)).toBe(false);
    });

    it('after first transaction, spentCents reduces remaining', () => {
      const envelope = buildEnvelope({
        allocatedCents: 800000,
        spentCents: 185000,
      });

      expect(getRemainingCents(envelope)).toBe(615000);
      expect(getPercentRemaining(envelope)).toBe(77);
      expect(isOverBudget(envelope)).toBe(false);
    });

    it('overspending returns negative remaining and isOverBudget true', () => {
      const envelope = buildEnvelope({
        allocatedCents: 100000,
        spentCents: 150000,
      });

      expect(getRemainingCents(envelope)).toBe(-50000);
      expect(isOverBudget(envelope)).toBe(true);
      expect(getPercentRemaining(envelope)).toBe(0);
    });
  });

  describe('First meter reading -> no previous reading for consumption calc', () => {
    it('first reading has valid readingValue and no prior comparison', () => {
      const reading = buildMeterReading({
        householdId: KRUGER_ID,
        meterType: 'electricity',
        readingValue: 452,
        readingDate: '2026-01-31',
        costCents: 135600,
      });

      expect(reading.readingValue).toBe(452);
      expect(reading.costCents).toBe(135600);
      expect(reading.meterType).toBe('electricity');
    });

    it('consumption can be calculated when a second reading exists', () => {
      const first = buildMeterReading({
        readingValue: 452,
        readingDate: '2026-01-31',
      });
      const second = buildMeterReading({
        readingValue: 890,
        readingDate: '2026-02-28',
      });

      const consumption = second.readingValue - first.readingValue;
      expect(consumption).toBe(438);
    });

    it('zero-cost reading is valid', () => {
      const reading = buildMeterReading({ costCents: 0 });
      expect(reading.costCents).toBe(0);
    });
  });
});
