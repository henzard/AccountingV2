import { computeSpentDeltaVsPreviousPeriod } from '../computeSpentDeltaVsPreviousPeriod';

describe('computeSpentDeltaVsPreviousPeriod', () => {
  it('returns the difference in spentCents for a matching name + type', () => {
    const delta = computeSpentDeltaVsPreviousPeriod(
      { name: 'Groceries', envelopeType: 'spending', spentCents: 30000 },
      [{ name: 'Groceries', envelopeType: 'spending', spentCents: 20000 }],
    );
    expect(delta).toBe(10000);
  });

  it('returns a negative delta when spend decreased', () => {
    const delta = computeSpentDeltaVsPreviousPeriod(
      { name: 'Groceries', envelopeType: 'spending', spentCents: 10000 },
      [{ name: 'Groceries', envelopeType: 'spending', spentCents: 20000 }],
    );
    expect(delta).toBe(-10000);
  });

  it('returns null when no previous-period envelope has the same name', () => {
    const delta = computeSpentDeltaVsPreviousPeriod(
      { name: 'New Envelope', envelopeType: 'spending', spentCents: 5000 },
      [{ name: 'Groceries', envelopeType: 'spending', spentCents: 20000 }],
    );
    expect(delta).toBeNull();
  });

  it('does not match across different envelope types with the same name', () => {
    const delta = computeSpentDeltaVsPreviousPeriod(
      { name: 'Groceries', envelopeType: 'spending', spentCents: 5000 },
      [{ name: 'Groceries', envelopeType: 'utility', spentCents: 20000 }],
    );
    expect(delta).toBeNull();
  });

  it('returns null against an empty previous-period list', () => {
    const delta = computeSpentDeltaVsPreviousPeriod(
      { name: 'Groceries', envelopeType: 'spending', spentCents: 5000 },
      [],
    );
    expect(delta).toBeNull();
  });
});
