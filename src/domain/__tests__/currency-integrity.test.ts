import {
  getRemainingCents,
  getPercentRemaining,
  isOverBudget,
  type EnvelopeEntity,
} from '../envelopes/EnvelopeEntity';

function makeEnvelope(overrides: Partial<EnvelopeEntity> = {}): EnvelopeEntity {
  return {
    id: 'env-1',
    householdId: 'hh-1',
    name: 'Groceries',
    allocatedCents: 100_00,
    spentCents: 0,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-06-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('Currency Integrity — getRemainingCents', () => {
  it('returns difference for normal values', () => {
    const env = makeEnvelope({ allocatedCents: 500_00, spentCents: 200_00 });
    expect(getRemainingCents(env)).toBe(300_00);
  });

  it('returns zero when fully spent', () => {
    const env = makeEnvelope({ allocatedCents: 500_00, spentCents: 500_00 });
    expect(getRemainingCents(env)).toBe(0);
  });

  it('returns negative when overspent', () => {
    const env = makeEnvelope({ allocatedCents: 500_00, spentCents: 600_00 });
    expect(getRemainingCents(env)).toBe(-100_00);
  });

  it('handles zero allocated', () => {
    const env = makeEnvelope({ allocatedCents: 0, spentCents: 0 });
    expect(getRemainingCents(env)).toBe(0);
  });

  it('handles large values (999999999 cents = ~R10M)', () => {
    const env = makeEnvelope({ allocatedCents: 999_999_999, spentCents: 1 });
    expect(getRemainingCents(env)).toBe(999_999_998);
  });

  it('never returns NaN or Infinity', () => {
    const cases: Partial<EnvelopeEntity>[] = [
      { allocatedCents: 0, spentCents: 0 },
      { allocatedCents: 999_999_999, spentCents: 999_999_999 },
      { allocatedCents: 1, spentCents: 999_999_999 },
    ];
    for (const c of cases) {
      const result = getRemainingCents(makeEnvelope(c));
      expect(Number.isFinite(result)).toBe(true);
      expect(Number.isNaN(result)).toBe(false);
    }
  });
});

describe('Currency Integrity — getPercentRemaining', () => {
  it('returns 100 when allocatedCents is 0 (avoids division by zero)', () => {
    const env = makeEnvelope({ allocatedCents: 0, spentCents: 0 });
    expect(getPercentRemaining(env)).toBe(100);
  });

  it('returns 50 when half is spent', () => {
    const env = makeEnvelope({ allocatedCents: 1000_00, spentCents: 500_00 });
    expect(getPercentRemaining(env)).toBe(50);
  });

  it('returns 0 when 100% is spent', () => {
    const env = makeEnvelope({ allocatedCents: 1000_00, spentCents: 1000_00 });
    expect(getPercentRemaining(env)).toBe(0);
  });

  it('returns 0 (clamped) when overspent', () => {
    const env = makeEnvelope({ allocatedCents: 1000_00, spentCents: 1500_00 });
    expect(getPercentRemaining(env)).toBe(0);
  });

  it('rounds correctly for 33.33% edge case', () => {
    const env = makeEnvelope({ allocatedCents: 300, spentCents: 200 });
    // remaining = 100/300 = 33.33...% → rounds to 33
    expect(getPercentRemaining(env)).toBe(33);
  });

  it('rounds correctly for 66.67% edge case', () => {
    const env = makeEnvelope({ allocatedCents: 300, spentCents: 100 });
    // remaining = 200/300 = 66.67% → rounds to 67
    expect(getPercentRemaining(env)).toBe(67);
  });

  it('always returns an integer', () => {
    const cases = [
      { allocatedCents: 7, spentCents: 3 },
      { allocatedCents: 13, spentCents: 5 },
      { allocatedCents: 999_999, spentCents: 333_333 },
    ];
    for (const c of cases) {
      const result = getPercentRemaining(makeEnvelope(c));
      expect(Number.isInteger(result)).toBe(true);
    }
  });

  it('never returns NaN or Infinity', () => {
    const cases: Partial<EnvelopeEntity>[] = [
      { allocatedCents: 0, spentCents: 0 },
      { allocatedCents: 0, spentCents: 100 },
      { allocatedCents: 1, spentCents: 999_999_999 },
    ];
    for (const c of cases) {
      const result = getPercentRemaining(makeEnvelope(c));
      expect(Number.isFinite(result)).toBe(true);
      expect(Number.isNaN(result)).toBe(false);
    }
  });
});

describe('Currency Integrity — isOverBudget', () => {
  it('returns false when spent equals allocated (exact match)', () => {
    const env = makeEnvelope({ allocatedCents: 500_00, spentCents: 500_00 });
    expect(isOverBudget(env)).toBe(false);
  });

  it('returns true when overspent by 1 cent', () => {
    const env = makeEnvelope({ allocatedCents: 500_00, spentCents: 500_01 });
    expect(isOverBudget(env)).toBe(true);
  });

  it('returns false when underspent', () => {
    const env = makeEnvelope({ allocatedCents: 500_00, spentCents: 499_99 });
    expect(isOverBudget(env)).toBe(false);
  });

  it('returns false for zero budget with zero spending', () => {
    const env = makeEnvelope({ allocatedCents: 0, spentCents: 0 });
    expect(isOverBudget(env)).toBe(false);
  });

  it('returns true for zero budget with any spending', () => {
    const env = makeEnvelope({ allocatedCents: 0, spentCents: 1 });
    expect(isOverBudget(env)).toBe(true);
  });
});
