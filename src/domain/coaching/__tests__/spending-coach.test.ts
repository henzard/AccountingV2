import { SpendingCoach } from '../SpendingCoach';

describe('SpendingCoach', () => {
  const coach = new SpendingCoach();

  it('returns null when projected spend is under allocated', () => {
    const result = coach.evaluate({
      amountCents: 5000,
      availableCents: 20000, // allocated 50000 - spent 30000
      scope: 'period',
    });
    expect(result).toBeNull();
  });

  it('returns null when projected spend exactly equals allocated', () => {
    const result = coach.evaluate({
      amountCents: 10000,
      availableCents: 10000, // allocated 50000 - spent 40000
      scope: 'period',
    });
    expect(result).toBeNull();
  });

  it('returns coaching message when projected spend exceeds allocated', () => {
    const result = coach.evaluate({
      amountCents: 20000,
      availableCents: 10000, // allocated 50000 - spent 40000
      scope: 'period',
    });
    expect(result).not.toBeNull();
    expect(result!.message).toBeTruthy();
    expect(result!.overspendCents).toBe(10000);
  });

  it('calculates correct overspend amount', () => {
    const result = coach.evaluate({
      amountCents: 5000,
      availableCents: 2000, // allocated 10000 - spent 8000
      scope: 'period',
    });
    expect(result).not.toBeNull();
    expect(result!.overspendCents).toBe(3000);
  });

  it('returns message when availableCents is 0 and spending any amount', () => {
    const result = coach.evaluate({
      amountCents: 100,
      availableCents: 0, // allocated 0 - spent 0
      scope: 'period',
    });
    expect(result).not.toBeNull();
    expect(result!.overspendCents).toBe(100);
  });

  it('returns message when already over budget before this transaction', () => {
    const result = coach.evaluate({
      amountCents: 1000,
      availableCents: -5000, // allocated 50000 - spent 55000
      scope: 'period',
    });
    expect(result).not.toBeNull();
    expect(result!.overspendCents).toBe(6000);
  });

  it('returns messages from a known set', () => {
    const messages = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const r = coach.evaluate({ amountCents: 20000, availableCents: 10000, scope: 'period' });
      if (r) messages.add(r.message);
    }
    expect(messages.size).toBeGreaterThanOrEqual(2);
  });
});
