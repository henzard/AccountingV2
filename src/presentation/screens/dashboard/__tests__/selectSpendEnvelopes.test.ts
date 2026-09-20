import { selectSpendEnvelopes } from '../selectSpendEnvelopes';
import type { EnvelopeEntity } from '../../../../domain/envelopes/EnvelopeEntity';

function makeEnvelope(overrides: Partial<EnvelopeEntity>): EnvelopeEntity {
  return {
    id: overrides.id ?? 'e1',
    householdId: 'hh-1',
    name: overrides.name ?? 'Envelope',
    allocatedCents: overrides.allocatedCents ?? 10000,
    spentCents: overrides.spentCents ?? 0,
    envelopeType: overrides.envelopeType ?? 'spending',
    isSavingsLocked: overrides.isSavingsLocked ?? false,
    isArchived: overrides.isArchived ?? false,
    periodStart: overrides.periodStart ?? '2026-09-01',
    targetAmountCents: overrides.targetAmountCents ?? null,
    targetDate: overrides.targetDate ?? null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('selectSpendEnvelopes', () => {
  it('excludes income envelopes', () => {
    const income = makeEnvelope({ id: 'income-1', envelopeType: 'income', allocatedCents: 500000 });
    const groceries = makeEnvelope({ id: 'groceries', envelopeType: 'spending' });
    const result = selectSpendEnvelopes([income, groceries]);
    expect(result).toEqual([groceries]);
  });

  it('keeps persistent envelope types (savings, emergency_fund, baby_step, sinking_fund)', () => {
    const income = makeEnvelope({ id: 'income-1', envelopeType: 'income' });
    const savings = makeEnvelope({ id: 'savings-1', envelopeType: 'savings' });
    const emergency = makeEnvelope({ id: 'emergency-1', envelopeType: 'emergency_fund' });
    const babyStep = makeEnvelope({ id: 'baby-step-1', envelopeType: 'baby_step' });
    const sinking = makeEnvelope({ id: 'sinking-1', envelopeType: 'sinking_fund' });
    const utility = makeEnvelope({ id: 'utility-1', envelopeType: 'utility' });

    const result = selectSpendEnvelopes([income, savings, emergency, babyStep, sinking, utility]);

    expect(result.map((e) => e.id).sort()).toEqual(
      ['savings-1', 'emergency-1', 'baby-step-1', 'sinking-1', 'utility-1'].sort(),
    );
  });

  it('returns an empty array when only income envelopes are present', () => {
    const income1 = makeEnvelope({ id: 'income-1', envelopeType: 'income' });
    const income2 = makeEnvelope({ id: 'income-2', envelopeType: 'income' });
    expect(selectSpendEnvelopes([income1, income2])).toEqual([]);
  });

  it('returns an empty array unchanged', () => {
    expect(selectSpendEnvelopes([])).toEqual([]);
  });
});
