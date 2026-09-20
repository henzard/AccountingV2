import { sortEnvelopesByUsageDescending } from '../sortEnvelopesByUsageDescending';
import type { EnvelopeEntity } from '../../../../domain/envelopes/EnvelopeEntity';

function makeEnvelope(id: string, allocatedCents: number, spentCents: number): EnvelopeEntity {
  return {
    id,
    householdId: 'hh-1',
    name: id,
    allocatedCents,
    spentCents,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-09-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  } as EnvelopeEntity;
}

describe('sortEnvelopesByUsageDescending', () => {
  it('sorts overspent envelopes first', () => {
    const a = makeEnvelope('a-low', 10000, 1000); // 10%
    const b = makeEnvelope('b-over', 10000, 15000); // 150%
    const c = makeEnvelope('c-mid', 10000, 5000); // 50%

    const sorted = sortEnvelopesByUsageDescending([a, b, c]);

    expect(sorted.map((e) => e.id)).toEqual(['b-over', 'c-mid', 'a-low']);
  });

  it('does not mutate the input array', () => {
    const a = makeEnvelope('a', 10000, 1000);
    const b = makeEnvelope('b', 10000, 9000);
    const input = [a, b];

    sortEnvelopesByUsageDescending(input);

    expect(input).toEqual([a, b]);
  });

  it('treats a zero-allocation envelope with spend as fully used (sorts first)', () => {
    const zeroAllocWithSpend = makeEnvelope('zero-spend', 0, 500);
    const halfUsed = makeEnvelope('half', 10000, 5000);

    const sorted = sortEnvelopesByUsageDescending([halfUsed, zeroAllocWithSpend]);

    expect(sorted[0].id).toBe('zero-spend');
  });

  it('treats a zero-allocation, zero-spend envelope as 0% used (sorts last)', () => {
    const zeroBoth = makeEnvelope('zero-both', 0, 0);
    const halfUsed = makeEnvelope('half', 10000, 5000);

    const sorted = sortEnvelopesByUsageDescending([zeroBoth, halfUsed]);

    expect(sorted.map((e) => e.id)).toEqual(['half', 'zero-both']);
  });

  it('is stable for equal usage ratios', () => {
    const a = makeEnvelope('a', 10000, 5000);
    const b = makeEnvelope('b', 20000, 10000);

    const sorted = sortEnvelopesByUsageDescending([a, b]);

    expect(sorted.map((e) => e.id)).toEqual(['a', 'b']);
  });
});
