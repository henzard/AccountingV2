import { calculateBudgetBalance } from '../BudgetBalanceCalculator';
import type { EnvelopeEntity } from '../../envelopes/EnvelopeEntity';

/** Helper to build a minimal envelope stub */
function makeEnvelope(
  overrides: Partial<EnvelopeEntity> & { envelopeType: EnvelopeEntity['envelopeType'] },
): EnvelopeEntity {
  return {
    id: 'e-' + Math.random().toString(36).slice(2),
    householdId: 'h1',
    name: 'Test',
    allocatedCents: 10000,
    spentCents: 0,
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-04-01',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('BudgetBalanceCalculator', () => {
  describe('basic calculations', () => {
    it('returns zeros for an empty envelope list', () => {
      const result = calculateBudgetBalance([]);
      expect(result.incomeTotal).toBe(0);
      expect(result.totalAllocated).toBe(0);
      expect(result.expenseAllocationTotal).toBe(0);
      expect(result.toAssign).toBe(0);
    });

    it('correctly sums income and expense envelopes', () => {
      const envelopes = [
        makeEnvelope({ envelopeType: 'income', allocatedCents: 50000 }),
        makeEnvelope({ envelopeType: 'spending', allocatedCents: 20000 }),
        makeEnvelope({ envelopeType: 'savings', allocatedCents: 10000 }),
      ];
      const result = calculateBudgetBalance(envelopes);
      expect(result.incomeTotal).toBe(50000);
      expect(result.totalAllocated).toBe(80000);
      expect(result.expenseAllocationTotal).toBe(30000);
      expect(result.toAssign).toBe(20000); // 50000 - 30000
    });

    it('positive toAssign when income exceeds expenses (money left to assign)', () => {
      const envelopes = [
        makeEnvelope({ envelopeType: 'income', allocatedCents: 100000 }),
        makeEnvelope({ envelopeType: 'spending', allocatedCents: 40000 }),
      ];
      const result = calculateBudgetBalance(envelopes);
      // incomeTotal=100000, totalAllocated=140000, expenseAllocationTotal=40000, toAssign=60000
      expect(result.toAssign).toBe(60000);
    });

    it('zero toAssign means every rand assigned', () => {
      const envelopes = [
        makeEnvelope({ envelopeType: 'income', allocatedCents: 50000 }),
        makeEnvelope({ envelopeType: 'spending', allocatedCents: 30000 }),
        makeEnvelope({ envelopeType: 'savings', allocatedCents: 20000 }),
      ];
      const result = calculateBudgetBalance(envelopes);
      expect(result.toAssign).toBe(0);
    });

    it('negative toAssign means overcommitted', () => {
      const envelopes = [
        makeEnvelope({ envelopeType: 'income', allocatedCents: 50000 }),
        makeEnvelope({ envelopeType: 'spending', allocatedCents: 40000 }),
        makeEnvelope({ envelopeType: 'savings', allocatedCents: 20000 }),
      ];
      const result = calculateBudgetBalance(envelopes);
      // incomeTotal=50000, totalAllocated=110000, expenseAllocationTotal=60000, toAssign=-10000
      expect(result.toAssign).toBe(-10000);
    });
  });

  describe('archived envelope exclusion', () => {
    it('excludes archived envelopes from all totals', () => {
      const envelopes = [
        makeEnvelope({ envelopeType: 'income', allocatedCents: 50000 }),
        makeEnvelope({ envelopeType: 'spending', allocatedCents: 20000 }),
        makeEnvelope({ envelopeType: 'spending', allocatedCents: 99999, isArchived: true }),
        makeEnvelope({ envelopeType: 'income', allocatedCents: 99999, isArchived: true }),
      ];
      const result = calculateBudgetBalance(envelopes);
      expect(result.incomeTotal).toBe(50000);
      expect(result.totalAllocated).toBe(70000);
      expect(result.expenseAllocationTotal).toBe(20000);
      expect(result.toAssign).toBe(30000);
    });

    it('returns zeros when all envelopes are archived', () => {
      const envelopes = [
        makeEnvelope({ envelopeType: 'income', allocatedCents: 50000, isArchived: true }),
        makeEnvelope({ envelopeType: 'spending', allocatedCents: 20000, isArchived: true }),
      ];
      const result = calculateBudgetBalance(envelopes);
      expect(result.incomeTotal).toBe(0);
      expect(result.totalAllocated).toBe(0);
    });
  });

  describe('caller-filter contract', () => {
    /**
     * The calculator sums whatever envelopes are passed.
     * Mixed-period data is the caller's responsibility to pre-filter.
     * This test documents and enforces that the calculator does NOT filter by period.
     */
    it('sums all passed envelopes regardless of period (caller must pre-filter)', () => {
      const envelopes = [
        makeEnvelope({ envelopeType: 'income', allocatedCents: 50000, periodStart: '2026-03-01' }),
        makeEnvelope({ envelopeType: 'income', allocatedCents: 50000, periodStart: '2026-04-01' }),
      ];
      const result = calculateBudgetBalance(envelopes);
      // Both periods summed — caller should have filtered before passing
      expect(result.incomeTotal).toBe(100000);
    });
  });

  describe('no type enumeration', () => {
    it('treats unknown future envelope types as non-income (expense bucket)', () => {
      // If a new type is added to the union, it should be treated as expense
      // by not incrementing incomeTotal. This tests the sealed behaviour.
      const envelopes = [
        makeEnvelope({ envelopeType: 'income', allocatedCents: 50000 }),
        makeEnvelope({ envelopeType: 'savings', allocatedCents: 10000 }),
        makeEnvelope({ envelopeType: 'emergency_fund', allocatedCents: 5000 }),
        makeEnvelope({ envelopeType: 'spending', allocatedCents: 5000 }),
        makeEnvelope({ envelopeType: 'utility', allocatedCents: 5000 }),
        makeEnvelope({ envelopeType: 'baby_step', allocatedCents: 5000 }),
      ];
      const result = calculateBudgetBalance(envelopes);
      expect(result.incomeTotal).toBe(50000);
      expect(result.expenseAllocationTotal).toBe(30000);
    });
  });
});
