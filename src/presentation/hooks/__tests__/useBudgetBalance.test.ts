/**
 * Tests for useBudgetBalance.
 * Spec §Presentation layer — useBudgetBalance.
 */

import { renderHook } from '@testing-library/react-native';
import { useBudgetBalance } from '../useBudgetBalance';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

function makeEnvelope(overrides: Partial<EnvelopeEntity>): EnvelopeEntity {
  return {
    id: 'env-1',
    householdId: 'hh-1',
    name: 'Test',
    allocatedCents: 0,
    spentCents: 0,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-04-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('useBudgetBalance', () => {
  it('returns zeros for empty envelope list', () => {
    const { result } = renderHook(() => useBudgetBalance([]));
    expect(result.current.incomeTotal).toBe(0);
    expect(result.current.expenseAllocationTotal).toBe(0);
    expect(result.current.toAssign).toBe(0);
    expect(result.current.isBalanced).toBe(true);
  });

  it('isBalanced = true when toAssign === 0', () => {
    const envelopes = [
      makeEnvelope({ id: 'i1', envelopeType: 'income', allocatedCents: 500000 }),
      makeEnvelope({ id: 'e1', envelopeType: 'spending', allocatedCents: 500000 }),
    ];
    const { result } = renderHook(() => useBudgetBalance(envelopes));
    expect(result.current.toAssign).toBe(0);
    expect(result.current.isBalanced).toBe(true);
  });

  it('isBalanced = false when toAssign > 0 (under-allocated)', () => {
    const envelopes = [
      makeEnvelope({ id: 'i1', envelopeType: 'income', allocatedCents: 500000 }),
      makeEnvelope({ id: 'e1', envelopeType: 'spending', allocatedCents: 200000 }),
    ];
    const { result } = renderHook(() => useBudgetBalance(envelopes));
    // incomeTotal=500000, totalAllocated=700000, expenseAllocationTotal=200000, toAssign=500000-200000=300000
    expect(result.current.toAssign).toBe(300000);
    expect(result.current.isBalanced).toBe(false);
  });

  it('isBalanced = false when toAssign < 0 (over-committed)', () => {
    const envelopes = [
      makeEnvelope({ id: 'i1', envelopeType: 'income', allocatedCents: 100000 }),
      makeEnvelope({ id: 'e1', envelopeType: 'spending', allocatedCents: 200000 }),
    ];
    const { result } = renderHook(() => useBudgetBalance(envelopes));
    // expenseAllocationTotal = 300000 - 100000 = 200000
    // toAssign = 100000 - 200000 = -100000
    expect(result.current.toAssign).toBeLessThan(0);
    expect(result.current.isBalanced).toBe(false);
  });

  it('excludes archived envelopes from calculation', () => {
    const envelopes = [
      makeEnvelope({ id: 'i1', envelopeType: 'income', allocatedCents: 500000 }),
      makeEnvelope({ id: 'e1', envelopeType: 'spending', allocatedCents: 500000 }),
      makeEnvelope({
        id: 'archived',
        envelopeType: 'spending',
        allocatedCents: 999999,
        isArchived: true,
      }),
    ];
    const { result } = renderHook(() => useBudgetBalance(envelopes));
    expect(result.current.toAssign).toBe(0);
    expect(result.current.isBalanced).toBe(true);
  });

  it('exposes correct incomeTotal and expenseAllocationTotal', () => {
    const envelopes = [
      makeEnvelope({ id: 'i1', envelopeType: 'income', allocatedCents: 300000 }),
      makeEnvelope({ id: 'e1', envelopeType: 'spending', allocatedCents: 100000 }),
      makeEnvelope({ id: 'e2', envelopeType: 'savings', allocatedCents: 50000 }),
    ];
    const { result } = renderHook(() => useBudgetBalance(envelopes));
    expect(result.current.incomeTotal).toBe(300000);
    // totalAllocated = 450000, expenseAllocationTotal = 450000 - 300000 = 150000
    expect(result.current.expenseAllocationTotal).toBe(150000);
    // toAssign = 300000 - 150000 = 150000
    expect(result.current.toAssign).toBe(150000);
  });
});
