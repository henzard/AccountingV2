import { SpendingCoach } from '../SpendingCoach';

describe('SpendingCoach', () => {
  const coach = new SpendingCoach();

  it('returns null when transaction keeps envelope on budget', () => {
    const result = coach.evaluate({
      amountCents: 5000,
      availableCents: 10000, // allocated 50000 - spent 40000
      scope: 'period',
    });
    // 5000 <= 10000 remaining → no warning
    expect(result).toBeNull();
  });

  it('returns a coaching message when transaction would overspend', () => {
    const result = coach.evaluate({
      amountCents: 20000,
      availableCents: 10000, // allocated 50000 - spent 40000
      scope: 'period',
    });
    // 20000 > 10000 remaining → warning, overspend = 10000
    expect(result).not.toBeNull();
    expect(result!.message).toBeTruthy();
    expect(result!.overspendCents).toBe(10000);
    expect(result!.scope).toBe('period');
  });

  it('returns a message when envelope is already over budget', () => {
    const result = coach.evaluate({
      amountCents: 1000,
      availableCents: -1000, // allocated 50000 - spent 51000
      scope: 'period',
    });
    expect(result).not.toBeNull();
    expect(result!.overspendCents).toBe(2000);
  });

  it('returns null when amount exactly meets remaining budget', () => {
    const result = coach.evaluate({
      amountCents: 10000,
      availableCents: 10000, // allocated 50000 - spent 40000
      scope: 'period',
    });
    expect(result).toBeNull();
  });

  it('returns different messages to avoid repetition', () => {
    const messages = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const r = coach.evaluate({ amountCents: 20000, availableCents: 10000, scope: 'period' });
      if (r) messages.add(r.message);
    }
    // At least 2 distinct messages in 20 calls
    expect(messages.size).toBeGreaterThanOrEqual(2);
  });

  // REG-8/VAL2-2: a persistent envelope's "budget" is a saved balance, not
  // allocatedCents - spentCents, and it must never be described as "over
  // budget" — it uses a distinct message pool and reports scope 'persistent'.
  describe('persistent scope (funds)', () => {
    it('returns null when the spend does not exceed the saved balance', () => {
      const result = coach.evaluate({
        amountCents: 2000,
        availableCents: 600000, // R6 000 saved
        scope: 'persistent',
      });
      expect(result).toBeNull();
    });

    it('warns, with scope "persistent", when the spend exceeds what is saved', () => {
      const result = coach.evaluate({
        amountCents: 700000,
        availableCents: 600000, // R6 000 saved
        scope: 'persistent',
      });
      expect(result).not.toBeNull();
      expect(result!.scope).toBe('persistent');
      expect(result!.overspendCents).toBe(100000);
    });

    it('never returns a period-scope message for a persistent-scope overspend', () => {
      for (let i = 0; i < 30; i++) {
        const r = coach.evaluate({ amountCents: 200000, availableCents: 0, scope: 'persistent' });
        expect(r).not.toBeNull();
        expect(r!.message.toLowerCase()).not.toContain('budget');
      }
    });
  });
});
