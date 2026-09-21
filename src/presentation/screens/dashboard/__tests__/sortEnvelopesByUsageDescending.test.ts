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

  // REFUNDS: a transaction amount may be negative, so an envelope's derived
  // `spentCents` (a signed sum) can be NEGATIVE when refunds exceed
  // purchases. That made its usage ratio negative, which sorted it BELOW a
  // completely untouched envelope (ratio 0) — arbitrary, since "less than no
  // usage" isn't a meaningful ordering. Negative ratios are now clamped to 0
  // for ranking, with a deterministic name tie-break among the resulting
  // ties (0-ratio envelopes, whether net-refunded or simply untouched).
  describe('net-refunded envelopes (negative usage ratio)', () => {
    it('does NOT sort a net-refunded envelope below an untouched one', () => {
      const untouched = makeEnvelope('untouched', 10000, 0); // 0%
      const netRefunded = makeEnvelope('refunded', 10000, -2000); // -20%
      const overspent = makeEnvelope('overspent', 10000, 15000); // 150%

      const sorted = sortEnvelopesByUsageDescending([untouched, netRefunded, overspent]);

      // Overspent still ranks first; the net-refunded envelope ties with the
      // untouched one for last (both clamp to 0), rather than sorting below it.
      expect(sorted[0].id).toBe('overspent');
      expect(
        sorted
          .slice(1)
          .map((e) => e.id)
          .sort(),
      ).toEqual(['refunded', 'untouched']);
    });

    it('keeps a net-refunded envelope in input order among the untouched ones it ties with', () => {
      const zebra = makeEnvelope('zebra-untouched', 10000, 0);
      const alpha = makeEnvelope('alpha-refunded', 10000, -500);
      const mid = makeEnvelope('mid-untouched', 10000, 0);

      const sorted = sortEnvelopesByUsageDescending([zebra, mid, alpha]);

      // All three rank 0, so stability keeps the input order exactly — the
      // refunded envelope is neither pushed below the untouched ones (the bug)
      // nor pulled above them by some secondary key.
      expect(sorted.map((e) => e.id)).toEqual([
        'zebra-untouched',
        'mid-untouched',
        'alpha-refunded',
      ]);
    });

    it('is deterministic between two net-refunded envelopes: input order, whatever the refund size', () => {
      const b = makeEnvelope('b-refunded', 10000, -100);
      const a = makeEnvelope('a-refunded', 10000, -900);

      // Both clamp to a ranking of 0 despite very different refund amounts, so
      // stability decides: same input order in, same order out, both ways round.
      expect(sortEnvelopesByUsageDescending([b, a]).map((e) => e.id)).toEqual([
        'b-refunded',
        'a-refunded',
      ]);
      expect(sortEnvelopesByUsageDescending([a, b]).map((e) => e.id)).toEqual([
        'a-refunded',
        'b-refunded',
      ]);
    });

    it('does not change the ordering of the normal, non-refund case at all', () => {
      // Names deliberately out of alphabetical order relative to input and
      // to usage ranking, so any accidental name-based tie-breaking of a
      // normal (non-zero, non-negative, unequal-ratio) comparison would show
      // up as a reorder here.
      const zLow = makeEnvelope('z-low', 10000, 1000); // 10%
      const aOver = makeEnvelope('a-over', 10000, 15000); // 150%
      const mMid = makeEnvelope('m-mid', 10000, 5000); // 50%

      const sorted = sortEnvelopesByUsageDescending([zLow, aOver, mMid]);

      expect(sorted.map((e) => e.id)).toEqual(['a-over', 'm-mid', 'z-low']);
    });

    it('does not name-tie-break two envelopes with an equal, non-zero, non-negative ratio', () => {
      // Both at 50%, names in the opposite order from input — a real
      // name-based tie-break here (rather than only among 0-ranked ties)
      // would flip this from input order.
      const zFirst = makeEnvelope('z-first', 10000, 5000);
      const aSecond = makeEnvelope('a-second', 10000, 5000);

      const sorted = sortEnvelopesByUsageDescending([zFirst, aSecond]);

      expect(sorted.map((e) => e.id)).toEqual(['z-first', 'a-second']);
    });
  });
});
